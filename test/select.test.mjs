import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveTrackKey, pickLongestStandalone, assignAlbums, reshuffleAfter, seededRandom, isAnswerEligible, albumSlug,
} from '../scripts/lib/select.mjs';

const track = (overrides) => ({
  duration: 600_000, show_date: '1997-11-22', venue_name: 'Hampton Coliseum', venue_location: 'Hampton, VA',
  set_name: 'Set 2', exclude_from_stats: false, songs: [{ slug: 'tweezer' }],
  ...overrides,
});

test('pickLongestStandalone skips medley tracks, soundchecks, and excluded tracks', () => {
  const tracks = [
    track({ duration: 1_980_000, songs: [{ slug: 'fluffhead' }, { slug: 'jam' }] }),
    track({ duration: 1_500_000, set_name: 'Soundcheck' }),
    track({ duration: 1_400_000, exclude_from_stats: true }),
    track({ duration: 1_332_400, show_date: '2022-08-13' }),
  ];
  assert.deepEqual(pickLongestStandalone(tracks), {
    seconds: 1332, date: '2022-08-13', venue: 'Hampton Coliseum, Hampton, VA',
  });
});

test('pickLongestStandalone returns null when nothing qualifies', () => {
  assert.equal(pickLongestStandalone([track({ songs: [] }), track({ songs: undefined })]), null);
  assert.equal(pickLongestStandalone([]), null);
});

test('resolveTrackKey handles exact titles, aliases, parenthetical suffixes, and studio-only tracks', () => {
  const keys = new Set(['divided sky', 'fluffhead', 'scents and subtle sounds', 'rikers mailbox x']);
  assert.equal(resolveTrackKey('Fluffhead', keys), 'fluffhead');
  assert.equal(resolveTrackKey('The Divided Sky', keys), 'divided sky');
  assert.equal(resolveTrackKey("Fluffhead / Fluff's Travels", keys), 'fluffhead');
  assert.equal(resolveTrackKey('Scents and Subtle Sounds (intro)', keys), 'scents and subtle sounds');
  assert.equal(resolveTrackKey('The Name Is Slick', keys), null);
});

test('assignAlbums: thesis beats studio, studio beats demo, demo beats live, then earliest wins', () => {
  const albums = [
    { title: 'The White Tape', year: 1986, type: 'demo', tracks: ['You Enjoy Myself', 'AC/DC Bag', 'Slave to the Traffic Light', 'Minkin'] },
    { title: 'TMWSIY', year: 1988, type: 'thesis', tracks: ['AC/DC Bag', 'Wilson'] },
    { title: 'Junta', year: 1989, type: 'studio', tracks: ['You Enjoy Myself', 'Fee'] },
    { title: 'Lawn Boy', year: 1990, type: 'studio', tracks: ['Reba', 'Fee'] },
    { title: 'A Live One', year: 1995, type: 'live', tracks: ['You Enjoy Myself', 'Wilson', 'Slave to the Traffic Light', 'Harry Hood'] },
    { title: 'Slip Stitch', year: 1997, type: 'live', tracks: ['Harry Hood', 'Mikes Song'] },
  ];
  const keys = new Set(['you enjoy myself', 'ac dc bag', 'slave to the traffic light', 'wilson', 'fee', 'reba', 'harry hood', 'mikes song']);
  const { albumOf, unmatched } = assignAlbums(albums, keys);
  assert.equal(albumOf.get('ac dc bag'), 1); // TMWSIY claims its songs over the earlier demo
  assert.equal(albumOf.get('wilson'), 1); // ...and over a live album
  assert.equal(albumOf.get('you enjoy myself'), 2); // studio over demo and live
  assert.equal(albumOf.get('fee'), 2); // earliest studio album
  assert.equal(albumOf.get('reba'), 3);
  assert.equal(albumOf.get('slave to the traffic light'), 0); // demo over live
  assert.equal(albumOf.get('harry hood'), 4); // live-only: earliest live album
  assert.equal(albumOf.get('mikes song'), 5);
  assert.deepEqual(unmatched, ['The White Tape: Minkin']);
});

test('assignAlbums rejects an unknown album type instead of silently mis-ranking it', () => {
  assert.throws(() => assignAlbums([{ title: 'X', year: 2000, type: 'bootleg', tracks: [] }], new Set()), /unknown album type/);
});

test('reshuffleAfter keeps the first entries fixed and only permutes the rest', () => {
  const order = Array.from({ length: 50 }, (_, i) => i);
  const out = reshuffleAfter(order, 2, seededRandom(7));
  assert.deepEqual(out.slice(0, 2), [0, 1]);
  assert.deepEqual([...out].sort((a, b) => a - b), order); // same ids, none lost or duplicated
  assert.notDeepEqual(out.slice(2), order.slice(2));
  assert.deepEqual(reshuffleAfter(order, 2, seededRandom(7)), out); // reproducible
  assert.deepEqual(order, Array.from({ length: 50 }, (_, i) => i)); // input untouched
});

test('isAnswerEligible: popular originals, or album songs past a lower bar, and always a longest jam', () => {
  const jam = { seconds: 600 };
  const t = { minPlays: 40, albumMinPlays: 5 };
  assert.equal(isAnswerEligible({ original: true, timesPlayed: 40, album: null, longest: jam }, t), true);
  assert.equal(isAnswerEligible({ original: true, timesPlayed: 39, album: null, longest: jam }, t), false);
  assert.equal(isAnswerEligible({ original: true, timesPlayed: 5, album: 19, longest: jam }, t), true); // rare-ish album song
  assert.equal(isAnswerEligible({ original: true, timesPlayed: 4, album: 19, longest: jam }, t), false); // e.g. Stray Dog
  assert.equal(isAnswerEligible({ original: false, timesPlayed: 90, album: 9, longest: jam }, t), true); // cover on a live album
  assert.equal(isAnswerEligible({ original: false, timesPlayed: 500, album: null, longest: jam }, t), false); // cover, no album
  assert.equal(isAnswerEligible({ original: true, timesPlayed: 87, album: 1, longest: null }, t), false); // medley-only
});

test('albumSlug makes file-safe names', () => {
  assert.equal(albumSlug('Kasvot Växt: í rokk'), 'kasvot-vaxt-i-rokk');
  assert.equal(albumSlug('The Man Who Stepped into Yesterday'), 'the-man-who-stepped-into-yesterday');
});
