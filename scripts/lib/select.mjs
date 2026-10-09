// Pure selection rules used by the data build, split out so they can be unit
// tested without touching the network.

import { normalizeTitle } from '../../js/normalize.js';

/**
 * Album track titles that do not normalize to the phish.net title.
 * Keys are normalizeTitle() output; values are phish.net song names.
 */
export const ALBUM_TRACK_ALIASES = new Map([
  ['the divided sky', 'Divided Sky'],
  ['fluffhead fluffs travels', 'Fluffhead'],
]);

/**
 * Resolve an album track title to a normalized phish.net song key, or null
 * when the track was never played live (studio-only cuts).
 * @param {string} track
 * @param {Set<string>} songKeys normalized phish.net titles
 * @returns {string | null}
 */
export function resolveTrackKey(track, songKeys) {
  const key = normalizeTitle(track);
  const alias = ALBUM_TRACK_ALIASES.get(key);
  if (alias) return normalizeTitle(alias);
  if (songKeys.has(key)) return key;
  // "Scents and Subtle Sounds (intro)" -> "Scents and Subtle Sounds"
  const stripped = normalizeTitle(track.replace(/\s*\([^)]*\)\s*$/, ''));
  return songKeys.has(stripped) ? stripped : null;
}

/**
 * @typedef {'thesis' | 'studio' | 'demo' | 'live'} AlbumType
 * @typedef {{ title: string, year: number, type: AlbumType, tracks: string[] }} AlbumEntry
 */

/**
 * Which album "owns" a song that appears on several, lowest rank first:
 *  - thesis: The Man Who Stepped into Yesterday claims every song on it, even
 *    ones later recut in the studio (AC/DC Bag), because fans file the
 *    Gamehendge songs under it.
 *  - studio: the normal case (YEM is a Junta song, not an A Live One song).
 *  - demo:   The White Tape, only for songs on no real studio album (Slave).
 *  - live:   live/costume releases, only for songs never cut in the studio
 *            (Mike's Song -> Slip Stitch and Pass, Turtle in the Clouds -> Kasvot Växt).
 * Ties within a rank go to the earliest release.
 * @type {Record<AlbumType, number>}
 */
export const ALBUM_TYPE_RANK = { thesis: 0, studio: 1, demo: 2, live: 3 };

/**
 * Map each song key to the index of the album that owns it (see
 * ALBUM_TYPE_RANK). `albums` must be in release order; the index into that
 * array is what the browser receives.
 * @param {AlbumEntry[]} albums
 * @param {Set<string>} songKeys normalized phish.net titles
 * @returns {{ albumOf: Map<string, number>, unmatched: string[] }}
 */
export function assignAlbums(albums, songKeys) {
  /** @type {Map<string, number>} */
  const albumOf = new Map();
  /** @type {string[]} */
  const unmatched = [];
  /** True when album `a` should own a song over album `b`. */
  const outranks = (/** @type {number} */ a, /** @type {number} */ b) => {
    const [x, y] = [albums[a], albums[b]];
    if (x.type !== y.type) return ALBUM_TYPE_RANK[x.type] < ALBUM_TYPE_RANK[y.type];
    return x.year !== y.year ? x.year < y.year : a < b;
  };
  albums.forEach((album, index) => {
    if (!(album.type in ALBUM_TYPE_RANK)) throw new Error(`${album.title}: unknown album type "${album.type}"`);
    for (const track of album.tracks) {
      const key = resolveTrackKey(track, songKeys);
      const current = key === null ? undefined : albumOf.get(key);
      if (key === null) unmatched.push(`${album.title}: ${track}`);
      else if (current === undefined || outranks(index, current)) albumOf.set(key, index);
    }
  });
  return { albumOf, unmatched };
}

/**
 * Reshuffle the not-yet-played part of the daily schedule: the first
 * `keep` entries (puzzles players may already have seen) stay exactly where
 * they are; everything after is shuffled with a seeded PRNG so the result is
 * reproducible. Used once when the answer pool grows, so new songs show up
 * soon instead of only after the existing queue runs out.
 * @param {number[]} order
 * @param {number} keep
 * @param {() => number} rand
 * @returns {number[]}
 */
export function reshuffleAfter(order, keep, rand) {
  const head = order.slice(0, keep);
  const tail = order.slice(keep);
  for (let i = tail.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [tail[i], tail[j]] = [tail[j], tail[i]];
  }
  return [...head, ...tail];
}

/**
 * From phish.in tracks sorted longest-first, return the first standalone
 * performance as { seconds, date, venue }, or null if none qualifies.
 * Skipped: tracks bundling several songs (e.g. "YEM > Jam", so a medley never
 * counts as one song's jam), soundchecks, and tracks phish.in excludes from stats.
 * @param {any[]} tracks
 */
export function pickLongestStandalone(tracks) {
  for (const t of tracks) {
    const standalone = Array.isArray(t.songs) && t.songs.length === 1;
    if (!standalone || t.exclude_from_stats || /soundcheck/i.test(t.set_name ?? '')) continue;
    return {
      seconds: Math.round(t.duration / 1000),
      date: t.show_date,
      venue: [t.venue_name, t.venue_location].filter(Boolean).join(', '),
    };
  }
  return null;
}

/**
 * File-name stem for an album's cover art: "Kasvot Växt: í rokk" -> "kasvot-vaxt-i-rokk".
 * @param {string} title
 */
export const albumSlug = (title) => normalizeTitle(title).replace(/ /g, '-');

/**
 * Daily-answer thresholds, so the puzzle stays about songs a regular
 * listener would know: an original must have been played 40 times; a song on
 * an album only 5, since the album makes it familiar.
 */
export const ANSWER_THRESHOLDS = Object.freeze({ minPlays: 40, albumMinPlays: 5 });

/**
 * Daily-answer eligibility. Two routes in:
 *  - a band original played at least `minPlays` times (well known live), or
 *  - any song on an album (covers included) played at least `albumMinPlays`
 *    times; the album makes it recognisable, so the bar is lower, but true
 *    one-offs (a studio cut played once) are still left out.
 * A song also needs a longest-jam value, so no answer ever has a blank tile.
 * @param {{ original: boolean, timesPlayed: number, album: number | null, longest: unknown }} song
 * @param {{ minPlays: number, albumMinPlays: number }} thresholds
 */
export function isAnswerEligible(song, { minPlays, albumMinPlays }) {
  const popularOriginal = song.original && song.timesPlayed >= minPlays;
  const albumSong = song.album !== null && song.timesPlayed >= albumMinPlays;
  return (popularOriginal || albumSong) && Boolean(song.longest);
}

/**
 * Deterministic PRNG (mulberry32): the same seed always yields the same
 * sequence, so a schedule shuffle can be reproduced and reviewed.
 * @param {number} seed
 */
export function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
