// @ts-check
// Persistence for the daily game and stats. localStorage can throw (private
// browsing, storage disabled) or hold stale/hand-edited values, so every read
// is validated and falls back to a fresh default instead of crashing the game.

import { emptyStats, MAX_GUESSES } from './game.js';

const KEYS = {
  daily: 'phishle:daily',
  stats: 'phishle:stats',
  seenHelp: 'phishle:seenHelp',
};

/** @param {string} key */
function read(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? null : JSON.parse(raw);
  } catch {
    return null;
  }
}

/** @param {string} key @param {unknown} value */
function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage unavailable: the game still works, it just won't remember.
  }
}

const isIdList = (/** @type {unknown} */ v) =>
  Array.isArray(v) && v.length <= MAX_GUESSES && v.every((id) => Number.isInteger(id));

/**
 * Guesses made so far on `date`. A saved game from another day is discarded.
 * @param {string} date
 * @returns {number[]}
 */
export function loadDailyGuesses(date) {
  const saved = read(KEYS.daily);
  return saved && saved.date === date && isIdList(saved.guesses) ? saved.guesses : [];
}

/** @param {string} date @param {number[]} guesses */
export function saveDailyGuesses(date, guesses) {
  write(KEYS.daily, { date, guesses });
}

/** @returns {import('./game.js').Stats} */
export function loadStats() {
  const s = read(KEYS.stats);
  const fresh = emptyStats();
  if (!s || typeof s !== 'object') return fresh;
  const count = (/** @type {unknown} */ v) => (Number.isInteger(v) && /** @type {number} */ (v) >= 0 ? /** @type {number} */ (v) : 0);
  return {
    played: count(s.played),
    wins: count(s.wins),
    currentStreak: count(s.currentStreak),
    maxStreak: count(s.maxStreak),
    distribution: fresh.distribution.map((_, i) => count(s.distribution?.[i])),
    lastDay: Number.isInteger(s.lastDay) ? s.lastDay : null,
  };
}

/** @param {import('./game.js').Stats} stats */
export function saveStats(stats) {
  write(KEYS.stats, stats);
}

export const hasSeenHelp = () => read(KEYS.seenHelp) === true;
export const markHelpSeen = () => write(KEYS.seenHelp, true);
