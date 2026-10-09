import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  compareSongs, daysBetween, dailyAnswerId, puzzleNumber, searchSongs, recordResult,
  emptyStats, shareText, formatDuration, formatDate, formatMonthYear, localDateString, MAX_GUESSES, ATTRIBUTES,
} from '../js/game.js';
import { normalizeTitle } from '../js/normalize.js';

// Album fixture: index -> release year (two albums share 2009, like Joy and Party Time).
const ALBUMS = [1986, 1989, 1990, 1992, 1993, 2009, 2009, 2016].map((year, i) => ({ title: `A${i}`, year, art: null }));
const cmp = (guess, answer) => compareSongs(guess, answer, ALBUMS);

/** Build a song with sensible defaults so each test states only what it cares about. */
function song(overrides) {
  return {
    id: 1, name: 'Test', slug: 'test', artist: 'Phish', original: true, album: 3,
    debut: '1990-01-01', lastPlayed: '2026-01-01', gap: 20, timesPlayed: 100,
    longest: { seconds: 900, date: '1995-01-01', venue: 'Somewhere' },
    ...overrides,
  };
}

test('normalizeTitle folds punctuation, accents, ampersands, and case', () => {
  assert.equal(normalizeTitle("Mike's Song"), 'mikes song');
  assert.equal(normalizeTitle('Mike’s Song'), 'mikes song');
  assert.equal(normalizeTitle('Kasvot Växt'), 'kasvot vaxt');
  assert.equal(normalizeTitle('Rock & Roll'), 'rock and roll');
  assert.equal(normalizeTitle('  Fluffhead / Fluff\'s Travels '), 'fluffhead fluffs travels');
});

test('identical songs compare as all-correct', () => {
  const s = song({});
  const result = cmp(s, s);
  for (const key of ATTRIBUTES) {
    assert.deepEqual(result[key], { status: 'correct', direction: null }, key);
  }
});

test('album: same album is green, release within 3 years is yellow, arrow follows release year', () => {
  assert.deepEqual(cmp(song({ album: 3 }), song({ album: 3 })).album, { status: 'correct', direction: null });
  assert.deepEqual(cmp(song({ album: 1 }), song({ album: 3 })).album, { status: 'close', direction: 'higher' }); // 1989 -> 1992
  assert.deepEqual(cmp(song({ album: 4 }), song({ album: 0 })).album, { status: 'miss', direction: 'lower' }); // 1993 -> 1986
  assert.deepEqual(cmp(song({ album: 0 }), song({ album: 3 })).album, { status: 'miss', direction: 'higher' }); // 6 years
  assert.deepEqual(cmp(song({ album: 5 }), song({ album: 6 })).album, { status: 'close', direction: null }); // same year, other album
});

test('times played: exact is green, within 25% of the answer is yellow', () => {
  const answer = song({ timesPlayed: 400 });
  assert.equal(cmp(song({ timesPlayed: 400 }), answer).timesPlayed.status, 'correct');
  assert.deepEqual(cmp(song({ timesPlayed: 300 }), answer).timesPlayed, { status: 'close', direction: 'higher' });
  assert.deepEqual(cmp(song({ timesPlayed: 299 }), answer).timesPlayed, { status: 'miss', direction: 'higher' });
  assert.deepEqual(cmp(song({ timesPlayed: 500 }), answer).timesPlayed, { status: 'close', direction: 'lower' });
  // The window scales with the answer: 25% of 40 is 10.
  assert.equal(cmp(song({ timesPlayed: 51 }), song({ timesPlayed: 40 })).timesPlayed.status, 'miss');
});

test('last played mirrors the gap color and points the opposite way', () => {
  const answer = song({ gap: 50, lastPlayed: '2024-08-01' });
  const recent = cmp(song({ gap: 45, lastPlayed: '2024-12-31' }), answer); // played more recently than the answer
  assert.deepEqual(recent.gap, { status: 'close', direction: 'higher' });
  assert.deepEqual(recent.lastPlayed, { status: 'close', direction: 'lower' });
  const old = cmp(song({ gap: 200, lastPlayed: '2019-02-20' }), answer);
  assert.deepEqual(old.gap, { status: 'miss', direction: 'lower' });
  assert.deepEqual(old.lastPlayed, { status: 'miss', direction: 'higher' });
  const same = cmp(song({ gap: 50, lastPlayed: '2024-08-01' }), answer);
  assert.deepEqual(same.lastPlayed, { status: 'correct', direction: null });
});

test('album: missing albums match each other but give no arrow against a real album', () => {
  assert.deepEqual(cmp(song({ album: null }), song({ album: null })).album, { status: 'correct', direction: null });
  assert.deepEqual(cmp(song({ album: null }), song({ album: 5 })).album, { status: 'miss', direction: null });
  assert.deepEqual(cmp(song({ album: 5 }), song({ album: null })).album, { status: 'miss', direction: null });
});

test('debut compares by year with a two-year close window', () => {
  const answer = song({ debut: '1994-06-01' });
  assert.equal(cmp(song({ debut: '1994-12-31' }), answer).debut.status, 'correct');
  assert.deepEqual(cmp(song({ debut: '1992-01-01' }), answer).debut, { status: 'close', direction: 'higher' });
  assert.deepEqual(cmp(song({ debut: '1991-12-31' }), answer).debut, { status: 'miss', direction: 'higher' });
  assert.deepEqual(cmp(song({ debut: '1996-03-03' }), answer).debut, { status: 'close', direction: 'lower' });
});

test('gap is exact for green and within 10 shows for yellow', () => {
  const answer = song({ gap: 50 });
  assert.equal(cmp(song({ gap: 50 }), answer).gap.status, 'correct');
  assert.deepEqual(cmp(song({ gap: 40 }), answer).gap, { status: 'close', direction: 'higher' });
  assert.deepEqual(cmp(song({ gap: 61 }), answer).gap, { status: 'miss', direction: 'lower' });
});

test('longest jam: within a minute is green, within five is yellow, missing audio is a plain miss', () => {
  const answer = song({ longest: { seconds: 1800, date: 'x', venue: 'y' } });
  const withSeconds = (seconds) => song({ longest: { seconds, date: 'x', venue: 'y' } });
  assert.equal(cmp(withSeconds(1750), answer).longest.status, 'correct');
  assert.deepEqual(cmp(withSeconds(1500), answer).longest, { status: 'close', direction: 'higher' });
  assert.deepEqual(cmp(withSeconds(2400), answer).longest, { status: 'miss', direction: 'lower' });
  assert.deepEqual(cmp(song({ longest: null }), answer).longest, { status: 'miss', direction: null });
});

test('daysBetween counts calendar days, including across DST changes', () => {
  assert.equal(daysBetween('2026-10-09', '2026-10-09'), 0);
  assert.equal(daysBetween('2026-10-09', '2026-11-02'), 24); // spans the US DST change on Nov 1
  assert.equal(daysBetween('2026-10-09', '2027-10-09'), 365);
  assert.equal(daysBetween('2026-10-09', '2026-10-08'), -1);
});

test('dailyAnswerId walks the schedule and wraps in both directions', () => {
  const schedule = { epoch: '2026-10-09', order: [10, 20, 30] };
  assert.equal(dailyAnswerId(schedule, '2026-10-09'), 10);
  assert.equal(dailyAnswerId(schedule, '2026-10-11'), 30);
  assert.equal(dailyAnswerId(schedule, '2026-10-12'), 10);
  assert.equal(dailyAnswerId(schedule, '2026-10-08'), 30);
  assert.equal(puzzleNumber(schedule, '2026-10-09'), 1);
});

test('localDateString uses the local calendar date', () => {
  assert.equal(localDateString(new Date(2026, 0, 5, 23, 59)), '2026-01-05');
});

test('searchSongs ranks abbreviation, then prefix, then word prefix, then substring', () => {
  const songs = [
    song({ id: 1, name: 'You Enjoy Myself', abbr: 'YEM', timesPlayed: 600 }),
    song({ id: 2, name: 'Tweezer', timesPlayed: 400 }),
    song({ id: 3, name: 'Tweezer Reprise', timesPlayed: 500 }),
    song({ id: 4, name: 'Mike’s Song', timesPlayed: 300 }),
    song({ id: 5, name: 'Big Tweeze', timesPlayed: 5 }),
  ];
  assert.deepEqual(searchSongs(songs, 'yem').map((s) => s.id), [1]);
  assert.deepEqual(searchSongs(songs, 'twee').map((s) => s.id), [3, 2, 5]);
  assert.deepEqual(searchSongs(songs, "mike's").map((s) => s.id), [4]);
  assert.deepEqual(searchSongs(songs, 'twee', { exclude: new Set([3]) }).map((s) => s.id), [2, 5]);
  assert.deepEqual(searchSongs(songs, '   '), []);
});

test('recordResult builds streaks on consecutive days and resets on a loss or skipped day', () => {
  let stats = emptyStats();
  stats = recordResult(stats, 0, true, 3);
  stats = recordResult(stats, 1, true, 5);
  assert.equal(stats.currentStreak, 2);
  assert.equal(stats.distribution[2], 1);
  assert.equal(stats.distribution[4], 1);

  stats = recordResult(stats, 3, true, 1); // skipped day 2
  assert.equal(stats.currentStreak, 1);
  assert.equal(stats.maxStreak, 2);

  stats = recordResult(stats, 4, false, MAX_GUESSES);
  assert.equal(stats.currentStreak, 0);
  assert.deepEqual([stats.played, stats.wins], [4, 3]);
});

test('recordResult ignores a day that was already recorded', () => {
  const once = recordResult(emptyStats(), 7, true, 2);
  assert.equal(recordResult(once, 7, true, 2), once);
});

test('shareText renders one emoji row per guess without naming songs', () => {
  const miss = { status: 'miss', direction: 'higher' };
  const hit = { status: 'correct', direction: null };
  const close = { status: 'close', direction: 'lower' };
  const rows = [
    { album: miss, debut: close, timesPlayed: hit, lastPlayed: miss, gap: miss, longest: hit },
    { album: hit, debut: hit, timesPlayed: hit, lastPlayed: hit, gap: hit, longest: hit },
  ];
  assert.equal(shareText(4, rows, true), 'Phishle #4 2/10\n⬛🟨🟩⬛⬛🟩\n🟩🟩🟩🟩🟩🟩');
  assert.match(shareText(4, rows, false), /^Phishle #4 X\/10/);
});

test('formatters', () => {
  assert.equal(formatDuration(3016), '50:16');
  assert.equal(formatDuration(65), '1:05');
  assert.equal(formatDate('1995-06-14'), 'Jun 14, 1995');
  assert.equal(formatMonthYear('2025-08-31'), "Aug '25");
  assert.equal(formatMonthYear('1999-12-31'), "Dec '99");
});
