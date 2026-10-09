import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveTrackKey, pickLongestStandalone, pickRelease, assignAlbums } from '../scripts/lib/select.mjs';

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

test('assignAlbums uses the earliest regular album and falls back to demos only for leftovers', () => {
  const albums = [
    { title: 'The White Tape', demo: true, tracks: ['You Enjoy Myself', 'Run Like an Antelope', 'Minkin'] },
    { title: 'Junta', tracks: ['You Enjoy Myself', 'Fee'] },
    { title: 'Lawn Boy', tracks: ['Reba', 'Fee'] },
  ];
  const keys = new Set(['you enjoy myself', 'run like an antelope', 'fee', 'reba']);
  const { albumOf, unmatched } = assignAlbums(albums, keys);
  assert.equal(albumOf.get('you enjoy myself'), 1); // Junta, not the demo
  assert.equal(albumOf.get('fee'), 1); // first regular album wins
  assert.equal(albumOf.get('reba'), 2);
  assert.equal(albumOf.get('run like an antelope'), 0); // only on the demo
  assert.deepEqual(unmatched, ['The White Tape: Minkin']);
});

test('pickRelease prefers the official edition with the fewest tracks, then the earliest', () => {
  const release = (id, status, date, counts) => ({ id, status, date, media: counts.map((c) => ({ 'track-count': c })) });
  const releases = [
    release('deluxe', 'Official', '1992-11-10', [8, 6]),
    release('bootleg', 'Bootleg', '1990-01-01', [5]),
    release('digital-late', 'Official', '2012-04-27', [10]),
    release('digital-early', 'Official', '2012-04-21', [10]),
  ];
  assert.equal(pickRelease(releases).id, 'digital-early');
});
