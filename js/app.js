// @ts-check
// UI controller: loads the baked data, renders guesses, and wires up input.
// Game rules live in game.js; this file only translates them into DOM.
//
// Security note: song names and venues come from third-party APIs, so they
// are only ever inserted with textContent (never innerHTML), and URLs built
// from them are percent-encoded.

import {
  MAX_GUESSES, ATTRIBUTES, DEBUT_CLOSE_YEARS, GAP_CLOSE_SHOWS, LONGEST_CORRECT_SECONDS, LONGEST_CLOSE_SECONDS,
  compareSongs, localDateString, daysBetween, dailyAnswerId, puzzleNumber, searchSongs,
  recordResult, shareText, formatDuration, formatDate,
} from './game.js';
import { loadDailyGuesses, saveDailyGuesses, loadStats, saveStats, hasSeenHelp, markHelpSeen } from './storage.js';

/** @typedef {import('./game.js').Song} Song */
/** @typedef {import('./game.js').Album} Album */
/** @typedef {import('./game.js').Comparison} Comparison */

const ATTRIBUTE_LABELS = { album: 'Album', debut: 'Debut', gap: 'Gap', longest: 'Longest jam' };

/**
 * @typedef {{
 *   mode: 'daily' | 'practice', answer: Song, guesses: Song[],
 *   date: string, puzzle: number, finished: boolean, won: boolean
 * }} Game
 */

/** @type {{ songs: Song[], byId: Map<number, Song>, albums: Album[], schedule: import('./game.js').Schedule, generatedAt: string }} */
let data;
/** @type {Game} */
let game;

// --- tiny DOM helpers -------------------------------------------------------

/** @param {string} id */
const $ = (id) => /** @type {HTMLElement} */ (document.getElementById(id));

/**
 * Create an element with optional class and text. Text is set via
 * textContent, which the browser never parses as HTML.
 * @param {string} tag
 * @param {string} [className]
 * @param {string} [text]
 */
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** @param {string} message */
function toast(message) {
  const t = $('toast');
  t.textContent = message;
  t.hidden = false;
  clearTimeout(Number(t.dataset.timer));
  t.dataset.timer = String(setTimeout(() => (t.hidden = true), 2200));
}

// --- data loading -------------------------------------------------------------

async function loadData() {
  const [songsRes, scheduleRes] = await Promise.all([fetch('data/songs.json'), fetch('data/schedule.json')]);
  if (!songsRes.ok || !scheduleRes.ok) throw new Error('data request failed');
  const songsJson = await songsRes.json();
  const schedule = await scheduleRes.json();
  /** @type {Song[]} */
  const songs = songsJson.songs;
  const byId = new Map(songs.map((s) => [s.id, s]));
  // Defensive: drop scheduled ids that no longer exist in the song list.
  schedule.order = schedule.order.filter((/** @type {number} */ id) => byId.has(id));
  if (!schedule.order.length) throw new Error('empty schedule');
  return { songs, byId, albums: songsJson.albums, schedule, generatedAt: songsJson.generatedAt };
}

// --- game lifecycle -----------------------------------------------------------

function startDaily() {
  const date = localDateString(new Date());
  const answer = /** @type {Song} */ (data.byId.get(dailyAnswerId(data.schedule, date)));
  const guesses = loadDailyGuesses(date)
    .map((id) => data.byId.get(id))
    .filter((s) => s !== undefined);
  game = { mode: 'daily', answer, guesses: /** @type {Song[]} */ (guesses), date, puzzle: puzzleNumber(data.schedule, date), finished: false, won: false };
  updateOutcome();
  renderAll();
}

function startPractice() {
  const pool = data.schedule.order;
  let id;
  do id = pool[Math.floor(Math.random() * pool.length)];
  while (pool.length > 1 && id === game?.answer.id);
  game = { mode: 'practice', answer: /** @type {Song} */ (data.byId.get(id)), guesses: [], date: '', puzzle: 0, finished: false, won: false };
  renderAll();
}

function updateOutcome() {
  game.won = game.guesses.some((g) => g.id === game.answer.id);
  game.finished = game.won || game.guesses.length >= MAX_GUESSES;
}

/** @param {Song} song */
function submitGuess(song) {
  if (game.finished || game.guesses.some((g) => g.id === song.id)) return;
  game.guesses.push(song);
  updateOutcome();
  if (game.mode === 'daily') {
    saveDailyGuesses(game.date, game.guesses.map((g) => g.id));
    if (game.finished) {
      const day = daysBetween(data.schedule.epoch, game.date);
      saveStats(recordResult(loadStats(), day, game.won, game.guesses.length));
    }
  }
  renderAll({ animateNewest: true });
  if (game.finished) setTimeout(() => $('result').scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 500);
}

// --- rendering ----------------------------------------------------------------

/** @param {{ animateNewest?: boolean }} [opts] */
function renderAll({ animateNewest = false } = {}) {
  const daily = game.mode === 'daily';
  $('mode-line').textContent = daily ? `Daily puzzle #${game.puzzle}` : 'Practice mode · random song, no stats';
  $('practice-btn').textContent = daily ? '∞' : '☀';
  $('practice-btn').setAttribute('aria-label', daily ? 'Practice mode' : 'Back to daily puzzle');
  $('practice-btn').title = daily ? 'Practice mode' : 'Back to daily puzzle';

  $('search-form').hidden = game.finished;
  $('counter').textContent = game.finished ? '' : `Guess ${game.guesses.length + 1} of ${MAX_GUESSES}`;

  const list = $('guesses');
  list.replaceChildren(
    ...game.guesses
      .map((g, i) => renderGuess(g, compareSongs(g, game.answer), animateNewest && i === game.guesses.length - 1))
      .reverse(), // newest on top, like Spotle
  );

  renderResult();
}

/**
 * @param {Song} song
 * @param {Comparison} cmp
 * @param {boolean} animate
 */
function renderGuess(song, cmp, animate) {
  const li = el('li', 'guess');
  const correct = song.id === game.answer.id;
  const name = el('div', 'guess-name' + (correct ? ' is-correct' : ''), song.name);
  li.append(name);
  const tiles = el('div', 'tiles');
  ATTRIBUTES.forEach((key, i) => {
    const { value, sub } = describe(song, key);
    const v = cmp[key];
    const tile = el('div', `tile ${v.status}${animate ? ' reveal' : ''}`);
    if (animate) tile.style.animationDelay = `${i * 150}ms`;
    const arrow = v.direction === 'higher' ? '↑' : v.direction === 'lower' ? '↓' : '';
    const hint = v.direction ? `, answer is ${v.direction}` : '';
    tile.setAttribute('aria-label', `${ATTRIBUTE_LABELS[key]}: ${value} ${sub}, ${v.status}${hint}`);
    const valueEl = el('span', 'tile-value', value);
    if (arrow) valueEl.append(el('span', 'tile-arrow', arrow));
    tile.append(el('span', 'tile-label', ATTRIBUTE_LABELS[key]), valueEl, el('span', 'tile-sub', sub));
    tiles.append(tile);
  });
  li.append(tiles);
  return li;
}

/**
 * Display strings for one attribute of a song.
 * @param {Song} song
 * @param {typeof ATTRIBUTES[number]} key
 * @returns {{ value: string, sub: string }}
 */
function describe(song, key) {
  switch (key) {
    case 'album': {
      const album = song.album === null ? null : data.albums[song.album];
      return album ? { value: album.title, sub: String(album.year) } : { value: 'None', sub: 'no studio album' };
    }
    case 'debut':
      return { value: song.debut.slice(0, 4), sub: formatDate(song.debut).replace(/, \d{4}$/, '') };
    case 'gap':
      return { value: String(song.gap), sub: song.gap === 1 ? 'show' : 'shows' };
    case 'longest':
      return song.longest
        ? { value: formatDuration(song.longest.seconds), sub: song.longest.date.slice(0, 4) }
        : { value: '—', sub: 'not tracked' }; // no audio, or only ever filed inside a medley
  }
}

function renderResult() {
  const box = $('result');
  if (!game.finished) {
    box.hidden = true;
    return;
  }
  const a = game.answer;
  const headline = game.won
    ? `${['Bustout!', 'Wow!', 'Nice!', 'Got it!'][Math.min(3, game.guesses.length - 1)]} Solved in ${game.guesses.length}.`
    : 'Out of guesses. The song was:';

  const card = el('div', 'answer-card');
  const title = el('a', 'answer-title', a.name);
  title.setAttribute('href', `https://phish.net/song/${encodeURIComponent(a.slug)}`);
  title.setAttribute('rel', 'noopener');
  title.setAttribute('target', '_blank');
  card.append(title);

  const facts = el('dl', 'answer-facts');
  const album = a.album === null ? 'No studio album' : `${data.albums[a.album].title} (${data.albums[a.album].year})`;
  /** @type {[string, string][]} */
  const rows = [
    ['Album', album],
    ['Debut', formatDate(a.debut)],
    ['Times played', String(a.timesPlayed)],
    ['Last played', `${formatDate(a.lastPlayed)} (gap ${a.gap})`],
  ];
  if (a.longest) rows.push(['Longest jam', `${formatDuration(a.longest.seconds)} · ${formatDate(a.longest.date)}, ${a.longest.venue}`]);
  for (const [k, v] of rows) facts.append(el('dt', '', k), el('dd', '', v));
  card.append(facts);

  if (a.longest) {
    const listen = el('a', 'listen-link', '▶ Hear the longest version on phish.in');
    listen.setAttribute('href', `https://phish.in/${encodeURIComponent(a.longest.date)}`);
    listen.setAttribute('rel', 'noopener');
    listen.setAttribute('target', '_blank');
    card.append(listen);
  }

  const actions = el('div', 'result-actions');
  if (game.mode === 'daily') {
    const share = el('button', 'btn primary', 'Share');
    share.setAttribute('type', 'button');
    share.addEventListener('click', shareResult);
    actions.append(share);
  }
  const practice = el('button', 'btn', game.mode === 'daily' ? 'Play practice' : 'Another song');
  practice.setAttribute('type', 'button');
  practice.addEventListener('click', startPractice);
  actions.append(practice);

  box.replaceChildren(el('p', 'result-headline', headline), card, actions);
  if (game.mode === 'daily') box.append(el('p', 'next-puzzle', `Next song in ${timeUntilMidnight()}`));
  box.hidden = false;
}

function timeUntilMidnight() {
  const now = new Date();
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const mins = Math.ceil((midnight.getTime() - now.getTime()) / 60000);
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

async function shareResult() {
  const rows = game.guesses.map((g) => compareSongs(g, game.answer));
  const text = `${shareText(game.puzzle, rows, game.won)}\n${location.origin}${location.pathname}`;
  try {
    if (navigator.share) await navigator.share({ text });
    else {
      await navigator.clipboard.writeText(text);
      toast('Copied to clipboard');
    }
  } catch (err) {
    // AbortError = the player closed the share sheet; not worth reporting.
    if (!(err instanceof DOMException && err.name === 'AbortError')) toast('Could not share');
  }
}

// --- search box (ARIA combobox) ----------------------------------------------------

/** @type {Song[]} */
let suggestions = [];
let active = -1;

function renderSuggestions() {
  const list = $('suggestions');
  const input = /** @type {HTMLInputElement} */ ($('guess-input'));
  list.replaceChildren(
    ...suggestions.map((s, i) => {
      const li = el('li', i === active ? 'active' : '', s.name);
      li.id = `sug-${s.id}`;
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', String(i === active));
      if (s.abbr) li.append(el('span', 'abbr', s.abbr));
      // pointerdown (not click) fires before the input loses focus on mobile.
      li.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        choose(s);
      });
      return li;
    }),
  );
  const open = suggestions.length > 0;
  list.hidden = !open;
  input.setAttribute('aria-expanded', String(open));
  if (active >= 0) input.setAttribute('aria-activedescendant', `sug-${suggestions[active].id}`);
  else input.removeAttribute('aria-activedescendant');
}

/** @param {Song} song */
function choose(song) {
  const input = /** @type {HTMLInputElement} */ ($('guess-input'));
  input.value = '';
  suggestions = [];
  active = -1;
  renderSuggestions();
  submitGuess(song);
  if (!game.finished) input.focus();
}

function wireSearch() {
  const input = /** @type {HTMLInputElement} */ ($('guess-input'));
  input.addEventListener('input', () => {
    suggestions = searchSongs(data.songs, input.value, { exclude: new Set(game.guesses.map((g) => g.id)) });
    active = suggestions.length ? 0 : -1;
    renderSuggestions();
  });
  input.addEventListener('keydown', (e) => {
    if (!suggestions.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      active = (active + step + suggestions.length) % suggestions.length;
      renderSuggestions();
    } else if (e.key === 'Escape') {
      suggestions = [];
      renderSuggestions();
    }
  });
  input.addEventListener('blur', () => {
    suggestions = [];
    renderSuggestions();
  });
  $('search-form').addEventListener('submit', (e) => {
    e.preventDefault();
    if (active >= 0 && suggestions[active]) choose(suggestions[active]);
    else if (input.value.trim()) toast('Pick a song from the list');
  });
}

// --- dialogs ------------------------------------------------------------------------

function renderHelp() {
  $('help-max').textContent = String(MAX_GUESSES);
  /** @type {[string, string][]} */
  const defs = [
    ['Album', 'First studio album the song appeared on (the 1986 White Tape demo counts only for songs on no other album). Yellow = the album released just before or after. Arrow points to the answer’s album in release order. Songs never released on a studio album show “None”.'],
    ['Debut', `Year Phish first played it live. Yellow = within ${DEBUT_CLOSE_YEARS} years.`],
    ['Gap', `Shows since it was last played, per phish.net. Yellow = within ${GAP_CLOSE_SHOWS} shows.`],
    ['Longest jam', `Longest standalone live version with audio on phish.in. Green = within ${LONGEST_CORRECT_SECONDS / 60} minute, yellow = within ${LONGEST_CLOSE_SECONDS / 60}. “Not tracked” = no audio, or the song only appears inside medley tracks.`],
  ];
  $('help-defs').replaceChildren(...defs.flatMap(([k, v]) => [el('dt', '', k), el('dd', '', v)]));
}

function renderStats() {
  const s = loadStats();
  const pct = s.played ? Math.round((100 * s.wins) / s.played) : 0;
  /** @type {[string, number][]} */
  const tiles = [['Played', s.played], ['Win %', pct], ['Streak', s.currentStreak], ['Best', s.maxStreak]];
  $('stat-row').replaceChildren(
    ...tiles.map(([label, n]) => {
      const box = el('div', 'stat');
      box.append(el('strong', '', String(n)), el('span', '', label));
      return box;
    }),
  );
  const max = Math.max(1, ...s.distribution);
  const highlight = game.mode === 'daily' && game.won ? game.guesses.length - 1 : -1;
  $('dist').replaceChildren(
    ...s.distribution.map((count, i) => {
      const row = el('div', 'dist-row');
      const bar = el('div', 'dist-bar' + (i === highlight ? ' current' : ''), String(count));
      bar.style.width = `${Math.max(8, (100 * count) / max)}%`;
      row.append(el('span', 'dist-n', String(i + 1)), bar);
      return row;
    }),
  );
}

/** @param {string} id */
const openDialog = (id) => /** @type {HTMLDialogElement} */ ($(id)).showModal();

function wireChrome() {
  $('help-btn').addEventListener('click', () => openDialog('help-dialog'));
  $('stats-btn').addEventListener('click', () => {
    renderStats();
    openDialog('stats-dialog');
  });
  $('practice-btn').addEventListener('click', () => (game.mode === 'daily' ? startPractice() : startDaily()));
  // Tapping the backdrop (outside the dialog box) closes it.
  for (const d of document.querySelectorAll('dialog')) {
    d.addEventListener('click', (e) => {
      if (e.target === d) /** @type {HTMLDialogElement} */ (d).close();
    });
  }
  // A tab left open past midnight should roll to the new puzzle when revisited.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && game.mode === 'daily' && game.date !== localDateString(new Date())) {
      startDaily();
    }
  });
}

// --- boot -------------------------------------------------------------------------

async function main() {
  try {
    data = await loadData();
  } catch {
    $('mode-line').textContent = 'Couldn’t load the song list. Check your connection and reload.';
    return;
  }
  $('data-date').textContent = `Data updated ${formatDate(data.generatedAt.slice(0, 10))}.`;
  renderHelp();
  wireSearch();
  wireChrome();
  startDaily();
  $('search-form').hidden = game.finished;
  if (!hasSeenHelp()) {
    openDialog('help-dialog');
    markHelpSeen();
  }
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {
    // Offline support is a bonus; the game works without it.
  });
}

main();
