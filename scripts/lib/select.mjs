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
 * Map each song key to the index of its first studio album. Albums arrive in
 * release order, so the first match wins. Demo releases are a second pass:
 * they only claim songs that appear on no regular studio album.
 * @param {{ title: string, demo?: boolean, tracks: string[] }[]} albums
 * @param {Set<string>} songKeys normalized phish.net titles
 * @returns {{ albumOf: Map<string, number>, unmatched: string[] }}
 */
export function assignAlbums(albums, songKeys) {
  /** @type {Map<string, number>} */
  const albumOf = new Map();
  /** @type {string[]} */
  const unmatched = [];
  for (const demoPass of [false, true]) {
    albums.forEach((album, index) => {
      if (Boolean(album.demo) !== demoPass) return;
      for (const track of album.tracks) {
        const key = resolveTrackKey(track, songKeys);
        if (!key) unmatched.push(`${album.title}: ${track}`);
        else if (!albumOf.has(key)) albumOf.set(key, index);
      }
    });
  }
  return { albumOf, unmatched };
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
 * Pick the MusicBrainz edition that best represents the original album: the
 * official release with the fewest tracks (deluxe/remaster editions add bonus
 * live cuts), breaking ties by earliest date.
 * @param {any[]} releases
 */
export function pickRelease(releases) {
  const trackCount = (/** @type {any} */ r) => r.media.reduce((n, /** @type {any} */ m) => n + m['track-count'], 0);
  const official = releases.filter((r) => r.status === 'Official' && trackCount(r) > 0);
  const pool = official.length ? official : releases;
  return [...pool].sort((a, b) => trackCount(a) - trackCount(b) || (a.date || '9999').localeCompare(b.date || '9999'))[0];
}
