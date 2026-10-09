// Bake the game's data files from three sources:
//
//   phish.net  (API v5, needs PHISHNET_API_KEY)  song list, debut, gap, play counts
//   phish.in   (API v2, open)                    track durations -> longest version
//   data/discography.json (from MusicBrainz)     studio album membership
//
// Writes data/songs.json (everything the browser needs) and appends any newly
// eligible answers to data/schedule.json (the daily puzzle order).
//
// The API key stays on the machine (or in a GitHub Actions secret) running this
// script; the browser only ever sees the baked JSON. Usage:
//   node scripts/build-data.mjs            incremental (reuses cached durations)
//   node scripts/build-data.mjs --full     re-query every song on phish.in

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { fetchJson, readEnv, sleep } from './lib/http.mjs';
import { assignAlbums, pickLongestStandalone } from './lib/select.mjs';
import { normalizeTitle } from '../js/normalize.js';

const root = (/** @type {string} */ p) => fileURLToPath(new URL(`../${p}`, import.meta.url));
const SONGS_PATH = root('data/songs.json');
const SCHEDULE_PATH = root('data/schedule.json');
const DISCOGRAPHY_PATH = root('data/discography.json');

// Artists credited on phish.net that are really Phish members or their side
// projects. Songs credited to them count as originals (e.g. "Sand" is credited
// to Trey Anastasio, "Bug" to Amfibian).
const BAND_ARTISTS = new Set([
  'Phish', 'Trey Anastasio', 'Trey Anastasio Band', 'Mike Gordon', 'Page McConnell',
  'Jon Fishman', 'Ghosts of the Forest', 'Vida Blue', 'Amfibian', 'New York!', 'Oysterhead',
]);

// A song must have been played this many times to be a daily answer, so the
// puzzle stays about songs a regular listener would know.
const ANSWER_MIN_PLAYS = 40;

// First day of the daily puzzle (puzzle #1). Never change after launch, or
// every player's puzzle numbering and stats shift.
const SCHEDULE_EPOCH = '2026-10-09';

// phish.in uploads audio a few days after a show, so songs played this close
// to the previous build's latest show get their durations re-checked.
const RECHECK_WINDOW_DAYS = 14;
const PHISHIN_DELAY_MS = 250; // politeness gap between phish.in requests

const full = process.argv.includes('--full');

/** @param {string} path */
const readJson = (path) => (existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null);

/** @param {string} path @param {unknown} value */
const writeJson = (path, value) => writeFileSync(path, JSON.stringify(value, null, 1) + '\n');

/**
 * @param {string} method e.g. "songs.json"
 * @param {string} apiKey
 */
async function phishnet(method, apiKey) {
  const json = await fetchJson(`https://api.phish.net/v5/${method}?apikey=${encodeURIComponent(apiKey)}`, {
    label: `phish.net ${method}`, // label keeps the key out of error messages
  });
  // The API reports success as `error: false` and failure as a numeric code.
  if (json.error) throw new Error(`phish.net ${method}: error ${json.error} ${json.error_message}`);
  return json.data;
}

/**
 * Longest standalone performance of a song on phish.in (see
 * pickLongestStandalone for what counts). Pages through longest-first results
 * until one qualifies.
 * @param {string} slug phish.in song slug
 */
async function longestPerformance(slug) {
  for (let page = 1; page <= 3; page++) {
    const json = await fetchJson(
      `https://phish.in/api/v2/tracks?song_slug=${encodeURIComponent(slug)}&sort=duration:desc&per_page=20&page=${page}`,
      { label: `phish.in tracks ${slug}` },
    );
    const found = pickLongestStandalone(json.tracks);
    if (found || page >= json.total_pages) return found;
  }
  return null;
}

/** Deterministic PRNG (mulberry32) so the schedule shuffle is reproducible. */
function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * @template T
 * @param {T[]} items
 * @param {() => number} rand
 */
function shuffle(items, rand) {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** @param {string} date YYYY-MM-DD @param {number} days */
function shiftDate(date, days) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function main() {
  const apiKey = readEnv('PHISHNET_API_KEY', root('.env'));
  if (!apiKey) throw new Error('PHISHNET_API_KEY is not set (environment or .env)');

  const albums = readJson(DISCOGRAPHY_PATH);
  if (!albums) throw new Error('data/discography.json missing; run scripts/fetch-discography.mjs');
  const previous = full ? null : readJson(SONGS_PATH);

  console.log('fetching phish.net songs...');
  /** @type {any[]} */
  const netSongs = (await phishnet('songs.json', apiKey)).filter((s) => s.times_played > 0);
  const latestShow = netSongs.reduce((max, s) => (s.last_played > max ? s.last_played : max), '');

  const songKeys = new Set(netSongs.map((s) => normalizeTitle(s.song)));
  const { albumOf, unmatched } = assignAlbums(albums, songKeys);
  // Usually studio-only cuts never played live; a famous title here means a missing alias.
  if (unmatched.length) console.log(`album tracks with no live song (ignored): ${unmatched.join('; ')}`);

  console.log('fetching phish.in song index...');
  const inSongs = (await fetchJson('https://phish.in/api/v2/songs?per_page=2000', { label: 'phish.in songs' })).songs;
  /** @type {Map<string, string>} normalized title (and aliases) -> phish.in slug */
  const inSlugByKey = new Map();
  for (const s of inSongs) {
    if (!s.tracks_with_audio_count) continue;
    inSlugByKey.set(normalizeTitle(s.title), s.slug);
    if (s.alias) inSlugByKey.set(normalizeTitle(s.alias), s.slug);
  }
  const inSlugs = new Set(inSongs.map((/** @type {any} */ s) => s.slug));

  /** @type {Map<number, any>} */
  const cached = new Map((previous?.songs ?? []).map((/** @type {any} */ s) => [s.id, s]));
  const recheckFrom = previous ? shiftDate(previous.latestShow, -RECHECK_WINDOW_DAYS) : '';

  const songs = [];
  let queried = 0;
  for (const s of netSongs) {
    const key = normalizeTitle(s.song);
    const inSlug = inSlugByKey.get(key) ?? (inSlugs.has(s.slug) ? s.slug : undefined);
    const prior = cached.get(s.songid);
    let longest = prior?.longest ?? null;
    const stale = !prior || s.last_played >= recheckFrom;
    if (inSlug && stale) {
      longest = await longestPerformance(inSlug);
      queried++;
      if (queried % 50 === 0) console.log(`  phish.in: ${queried} songs checked`);
      await sleep(PHISHIN_DELAY_MS);
    }
    const original = BAND_ARTISTS.has(s.artist) || albumOf.has(key);
    songs.push({
      id: s.songid,
      name: s.song,
      slug: s.slug,
      abbr: s.abbr || undefined, // fan shorthand like "YEM"; dropped from JSON when empty
      artist: s.artist,
      original,
      album: albumOf.get(key) ?? null,
      debut: s.debut,
      lastPlayed: s.last_played,
      gap: s.gap,
      timesPlayed: s.times_played,
      longest,
    });
  }
  songs.sort((a, b) => a.name.localeCompare(b.name));

  const noDuration = songs.filter((s) => s.original && !s.longest).map((s) => s.name);
  if (noDuration.length) console.log(`originals with no phish.in duration: ${noDuration.length}`);

  // Keep the old timestamp when nothing changed, so the scheduled refresh
  // produces no diff (and no commit) on days without new shows.
  const unchanged = previous && previous.latestShow === latestShow && JSON.stringify(previous.songs) === JSON.stringify(songs);
  writeJson(SONGS_PATH, {
    generatedAt: unchanged ? previous.generatedAt : new Date().toISOString(),
    latestShow,
    sources: ['phish.net', 'phish.in', 'MusicBrainz'],
    albums: albums.map((/** @type {any} */ a) => ({ title: a.title, year: a.year })),
    songs,
  });

  // Append newly eligible answers to the end of the schedule. Existing entries
  // never move, so past and current puzzles stay stable across data refreshes.
  const schedule = readJson(SCHEDULE_PATH) ?? { epoch: SCHEDULE_EPOCH, order: [] };
  const scheduled = new Set(schedule.order);
  const fresh = songs
    .filter((s) => s.original && s.timesPlayed >= ANSWER_MIN_PLAYS && s.longest && !scheduled.has(s.id))
    .map((s) => s.id)
    .sort((a, b) => a - b);
  if (fresh.length) {
    schedule.order.push(...shuffle(fresh, seededRandom(schedule.order.length + 1)));
    writeJson(SCHEDULE_PATH, schedule);
  }

  console.log(
    `wrote ${songs.length} songs (latest show ${latestShow}), ` +
      `${queried} phish.in lookups, schedule ${schedule.order.length} answers (+${fresh.length})`,
  );
}

main().catch((err) => {
  console.error(`build-data failed: ${err.message}`);
  process.exit(1);
});
