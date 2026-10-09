// Checks the baked data files: albums.json against the song list (so
// a typo in a tracklist or a broken precedence rule fails CI instead of
// silently dropping a song's album), and Gap vs Last played consistency.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { assignAlbums, ALBUM_TYPE_RANK, albumSlug, isAnswerEligible, ANSWER_THRESHOLDS } from '../scripts/lib/select.mjs';
import { normalizeTitle } from '../js/normalize.js';
import { compareSongs } from '../js/game.js';

const read = (p) => JSON.parse(readFileSync(new URL(`../${p}`, import.meta.url), 'utf8'));
const albums = read('data/albums.json');
const baked = read('data/songs.json');
const keys = new Set(baked.songs.map((s) => normalizeTitle(s.name)));
const { albumOf } = assignAlbums(albums, keys);
const albumFor = (name) => albums[albumOf.get(normalizeTitle(name))]?.title ?? null;

test('albums.json is well formed and in release order', () => {
  for (const [i, a] of albums.entries()) {
    assert.ok(a.title && Number.isInteger(a.year) && a.type in ALBUM_TYPE_RANK, a.title);
    assert.ok(Array.isArray(a.tracks) && a.tracks.length > 0, a.title);
    if (i > 0) assert.ok(albums[i - 1].year <= a.year, `${a.title} out of order`);
  }
});

test('the four v2 albums are present', () => {
  const titles = albums.map((a) => a.title);
  for (const t of ['Kasvot Växt: í rokk', 'A Live One', 'Slip Stitch and Pass', 'The Man Who Stepped into Yesterday']) {
    assert.ok(titles.includes(t), t);
  }
});

test('songs land on the album fans file them under', () => {
  const expected = {
    'Turtle in the Clouds': 'Kasvot Växt: í rokk',
    'Say It To Me S.A.N.T.O.S.': 'Kasvot Växt: í rokk',
    "Mike's Song": 'Slip Stitch and Pass',
    'Weekapaug Groove': 'Slip Stitch and Pass',
    'Jesus Just Left Chicago': 'Slip Stitch and Pass',
    'Harry Hood': 'A Live One',
    Gumbo: 'A Live One', // (Montana is a Tweezer jam excerpt; phish.net has no such song)
    Possum: 'The Man Who Stepped into Yesterday',
    'AC/DC Bag': 'The Man Who Stepped into Yesterday', // TMWSIY beats The White Tape
    Wilson: 'The Man Who Stepped into Yesterday', // TMWSIY beats A Live One
    'The Lizards': 'The Man Who Stepped into Yesterday',
    'You Enjoy Myself': 'Junta', // studio beats demo and live
    "Wolfman's Brother": 'Hoist', // studio beats Slip Stitch
    'Slave to the Traffic Light': 'The White Tape', // demo beats A Live One
    'Run Like an Antelope': 'Lawn Boy',
  };
  for (const [song, album] of Object.entries(expected)) assert.equal(albumFor(song), album, song);
});

test('every album has a cover thumbnail on disk', () => {
  for (const a of albums) {
    const found = ['jpg', 'png', 'webp'].some((ext) => existsSync(new URL(`../img/albums/${albumSlug(a.title)}.${ext}`, import.meta.url)));
    assert.ok(found, a.title);
  }
});

test('Gap and Last played never contradict each other on real data', () => {
  const byId = new Map(baked.songs.map((s) => [s.id, s]));
  const answers = read('data/schedule.json').order.map((id) => byId.get(id));
  let checked = 0;
  for (const answer of answers) {
    for (const guess of baked.songs) {
      const { gap, lastPlayed } = compareSongs(guess, answer, baked.albums);
      assert.equal(lastPlayed.status, gap.status);
      // Bigger gap <=> earlier date, so the arrows point opposite ways
      // (or Last played has none when both were last played on the same date).
      if (lastPlayed.direction && gap.direction) assert.notEqual(lastPlayed.direction, gap.direction, `${guess.name} vs ${answer.name}`);
      checked++;
    }
  }
  assert.ok(checked > 100_000);
});

test('every scheduled answer exists, is unique, and has a longest jam', () => {
  const byId = new Map(baked.songs.map((s) => [s.id, s]));
  const { order } = read('data/schedule.json');
  assert.equal(new Set(order).size, order.length);
  for (const id of order) assert.ok(byId.get(id)?.longest, `answer ${id}`);
});

test('no scheduled answer is below the play-count thresholds', () => {
  const byId = new Map(baked.songs.map((s) => [s.id, s]));
  for (const id of read('data/schedule.json').order) {
    const s = byId.get(id);
    assert.ok(isAnswerEligible(s, ANSWER_THRESHOLDS), `${s.name} (${s.timesPlayed} plays)`);
  }
});
