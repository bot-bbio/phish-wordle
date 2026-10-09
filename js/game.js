// @ts-check
// Pure game rules: no DOM, no storage, no network. Everything here is a
// function of its inputs, which keeps it directly unit-testable in Node.

import { normalizeTitle } from './normalize.js';

/**
 * @typedef {{ seconds: number, date: string, venue: string }} Performance
 * @typedef {{
 *   id: number, name: string, slug: string, abbr?: string, artist: string,
 *   original: boolean, album: number | null, debut: string, lastPlayed: string,
 *   gap: number, timesPlayed: number, longest: Performance | null
 * }} Song
 * @typedef {{ title: string, year: number }} Album
 * @typedef {{ epoch: string, order: number[] }} Schedule
 *
 * A tile's verdict. `direction` says where the ANSWER lies relative to the
 * guess: "higher" = later album / later debut / bigger gap / longer jam.
 * @typedef {'correct' | 'close' | 'miss'} Status
 * @typedef {'higher' | 'lower' | null} Direction
 * @typedef {{ status: Status, direction: Direction }} Verdict
 * @typedef {{ album: Verdict, debut: Verdict, gap: Verdict, longest: Verdict }} Comparison
 */

export const MAX_GUESSES = 10;
export const ATTRIBUTES = /** @type {const} */ (['album', 'debut', 'gap', 'longest']);

// "Close" (yellow) thresholds. Exported so the help screen can quote them.
export const DEBUT_CLOSE_YEARS = 2;
export const GAP_CLOSE_SHOWS = 10;
export const LONGEST_CORRECT_SECONDS = 60;
export const LONGEST_CLOSE_SECONDS = 300;

/**
 * Generic numeric comparison: exact/near match is green, within `closeWithin`
 * is yellow, and the arrow points from the guess toward the answer.
 * @param {number} guess
 * @param {number} answer
 * @param {number} correctWithin
 * @param {number} closeWithin
 * @returns {Verdict}
 */
function compareNumbers(guess, answer, correctWithin, closeWithin) {
  const diff = Math.abs(answer - guess);
  if (diff <= correctWithin) return { status: 'correct', direction: null };
  return {
    status: diff <= closeWithin ? 'close' : 'miss',
    direction: answer > guess ? 'higher' : 'lower',
  };
}

/**
 * Compare a value that may be missing (no studio album, no recorded audio).
 * Two missing values match; one missing value is a plain miss, because there
 * is no meaningful "higher/lower" between a value and its absence.
 * @param {number | null} guess
 * @param {number | null} answer
 * @param {(g: number, a: number) => Verdict} compare
 * @returns {Verdict}
 */
function compareOptional(guess, answer, compare) {
  if (guess === null && answer === null) return { status: 'correct', direction: null };
  if (guess === null || answer === null) return { status: 'miss', direction: null };
  return compare(guess, answer);
}

/** @param {string} date YYYY-MM-DD */
const yearOf = (date) => Number(date.slice(0, 4));

/**
 * Score a guess against the answer, attribute by attribute.
 * Album "close" means the neighbouring studio album in release order.
 * @param {Song} guess
 * @param {Song} answer
 * @returns {Comparison}
 */
export function compareSongs(guess, answer) {
  return {
    album: compareOptional(guess.album, answer.album, (g, a) => compareNumbers(g, a, 0, 1)),
    debut: compareNumbers(yearOf(guess.debut), yearOf(answer.debut), 0, DEBUT_CLOSE_YEARS),
    gap: compareNumbers(guess.gap, answer.gap, 0, GAP_CLOSE_SHOWS),
    longest: compareOptional(guess.longest?.seconds ?? null, answer.longest?.seconds ?? null, (g, a) =>
      compareNumbers(g, a, LONGEST_CORRECT_SECONDS, LONGEST_CLOSE_SECONDS),
    ),
  };
}

// ---------------------------------------------------------------------------
// Daily puzzle calendar
// ---------------------------------------------------------------------------

const MS_PER_DAY = 86_400_000;

/**
 * Today's date in the player's own time zone, as YYYY-MM-DD, so the puzzle
 * rolls over at local midnight.
 * @param {Date} now
 */
export function localDateString(now) {
  const pad = (/** @type {number} */ n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * Whole days from `epoch` to `date`. Both are calendar dates, so the math is
 * done in UTC where every day is exactly 24h (no daylight-saving gaps).
 * @param {string} date YYYY-MM-DD
 * @param {string} epoch YYYY-MM-DD
 */
export function daysBetween(epoch, date) {
  const utc = (/** @type {string} */ d) => Date.UTC(yearOf(d), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)));
  return Math.round((utc(date) - utc(epoch)) / MS_PER_DAY);
}

/**
 * The answer for a date. The schedule cycles once exhausted; the modulo is
 * normalised so dates before the epoch still map to a valid index.
 * @param {Schedule} schedule
 * @param {string} date YYYY-MM-DD
 * @returns {number} song id
 */
export function dailyAnswerId(schedule, date) {
  const n = schedule.order.length;
  const day = daysBetween(schedule.epoch, date);
  return schedule.order[((day % n) + n) % n];
}

/**
 * 1-based puzzle number shown to players ("Phishle #12").
 * @param {Schedule} schedule
 * @param {string} date
 */
export const puzzleNumber = (schedule, date) => daysBetween(schedule.epoch, date) + 1;

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

/**
 * Rank songs for the guess box. Matching runs on normalized titles, so
 * "mikes" finds "Mike's Song". An exact abbreviation ("yem") ranks first,
 * then title prefixes, then word prefixes, then any substring; ties go to the
 * more-played song, which is more likely what the player means.
 * @param {Song[]} songs
 * @param {string} query
 * @param {{ limit?: number, exclude?: Set<number> }} [opts]
 * @returns {Song[]}
 */
export function searchSongs(songs, query, { limit = 8, exclude = new Set() } = {}) {
  const q = normalizeTitle(query);
  if (!q) return [];
  /** @type {{ song: Song, rank: number }[]} */
  const hits = [];
  for (const song of songs) {
    if (exclude.has(song.id)) continue;
    const name = normalizeTitle(song.name);
    let rank;
    if (song.abbr && normalizeTitle(song.abbr) === q) rank = 0;
    else if (name.startsWith(q)) rank = 1;
    else if (name.includes(` ${q}`)) rank = 2;
    else if (name.includes(q)) rank = 3;
    else continue;
    hits.push({ song, rank });
  }
  hits.sort((a, b) => a.rank - b.rank || b.song.timesPlayed - a.song.timesPlayed);
  return hits.slice(0, limit).map((h) => h.song);
}

// ---------------------------------------------------------------------------
// Stats and sharing
// ---------------------------------------------------------------------------

/**
 * @typedef {{
 *   played: number, wins: number, currentStreak: number, maxStreak: number,
 *   distribution: number[], lastDay: number | null
 * }} Stats
 */

/** @returns {Stats} */
export const emptyStats = () => ({
  played: 0,
  wins: 0,
  currentStreak: 0,
  maxStreak: 0,
  distribution: Array(MAX_GUESSES).fill(0),
  lastDay: null,
});

/**
 * Fold one finished daily puzzle into the stats. A streak continues only if
 * the previous finished puzzle was yesterday's; recording the same day twice
 * is a no-op, so a reload can never double-count.
 * @param {Stats} stats
 * @param {number} day days since epoch
 * @param {boolean} won
 * @param {number} guessCount
 * @returns {Stats}
 */
export function recordResult(stats, day, won, guessCount) {
  if (stats.lastDay !== null && day <= stats.lastDay) return stats;
  const distribution = [...stats.distribution];
  if (won) distribution[guessCount - 1] += 1;
  const continues = stats.lastDay === day - 1;
  const currentStreak = won ? (continues ? stats.currentStreak + 1 : 1) : 0;
  return {
    played: stats.played + 1,
    wins: stats.wins + (won ? 1 : 0),
    currentStreak,
    maxStreak: Math.max(stats.maxStreak, currentStreak),
    distribution,
    lastDay: day,
  };
}

/** @type {Record<Status, string>} */
const EMOJI = { correct: '🟩', close: '🟨', miss: '⬛' };

/**
 * Spoiler-free result grid: one emoji row per guess, one square per attribute.
 * @param {number} puzzle
 * @param {Comparison[]} rows
 * @param {boolean} won
 */
export function shareText(puzzle, rows, won) {
  const score = won ? `${rows.length}/${MAX_GUESSES}` : `X/${MAX_GUESSES}`;
  const grid = rows.map((row) => ATTRIBUTES.map((key) => EMOJI[row[key].status]).join('')).join('\n');
  return `Phishle #${puzzle} ${score}\n${grid}`;
}

// ---------------------------------------------------------------------------
// Display formatting
// ---------------------------------------------------------------------------

/** @param {number} seconds */
export function formatDuration(seconds) {
  const m = Math.floor(seconds / 60);
  const s = String(seconds % 60).padStart(2, '0');
  return `${m}:${s}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** @param {string} date YYYY-MM-DD -> "Jun 14, 1995" */
export function formatDate(date) {
  return `${MONTHS[Number(date.slice(5, 7)) - 1]} ${Number(date.slice(8, 10))}, ${date.slice(0, 4)}`;
}
