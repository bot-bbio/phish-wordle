import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  compareSongs, daysBetween, dailyAnswerId, puzzleNumber, searchSongs, recordResult,
  emptyStats, shareText, formatDuration, formatDate, localDateString, MAX_GUESSES,
} from '../js/game.js';
import { normalizeTitle } from '../js/normalize.js';

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
  const result = compareSongs(s, s);
  for (const key of ['album', 'debut', 'gap', 'longest']) {
    assert.deepEqual(result[key], { status: 'correct', direction: null }, key);
  }
});

test('album: neighbouring album is close; arrow points toward the answer', () => {
  assert.deepEqual(compareSongs(song({ album: 3 }), song({ album: 4 })).album, { status: 'close', direction: 'higher' });
  assert.deepEqual(compareSongs(song({ album: 9 }), song({ album: 2 })).album, { status: 'miss', direction: 'lower' });
});

test('album: missing albums match each other but give no arrow against a real album', () => {
  assert.deepEqual(compareSongs(song({ album: null }), song({ album: null })).album, { status: 'correct', direction: null });
  assert.deepEqual(compareSongs(song({ album: null }), song({ album: 5 })).album, { status: 'miss', direction: null });
  assert.deepEqual(compareSongs(song({ album: 5 }), song({ album: null })).album, { status: 'miss', direction: null });
});

test('debut compares by year with a two-year close window', () => {
  const answer = song({ debut: '1994-06-01' });
  assert.equal(compareSongs(song({ debut: '1994-12-31' }), answer).debut.status, 'correct');
  assert.deepEqual(compareSongs(song({ debut: '1992-01-01' }), answer).debut, { status: 'close', direction: 'higher' });
  assert.deepEqual(compareSongs(song({ debut: '1991-12-31' }), answer).debut, { status: 'miss', direction: 'higher' });
  assert.deepEqual(compareSongs(song({ debut: '1996-03-03' }), answer).debut, { status: 'close', direction: 'lower' });
});

test('gap is exact for green and within 10 shows for yellow', () => {
  const answer = song({ gap: 50 });
  assert.equal(compareSongs(song({ gap: 50 }), answer).gap.status, 'correct');
  assert.deepEqual(compareSongs(song({ gap: 40 }), answer).gap, { status: 'close', direction: 'higher' });
  assert.deepEqual(compareSongs(song({ gap: 61 }), answer).gap, { status: 'miss', direction: 'lower' });
});

test('longest jam: within a minute is green, within five is yellow, missing audio is a plain miss', () => {
  const answer = song({ longest: { seconds: 1800, date: 'x', venue: 'y' } });
  const withSeconds = (seconds) => song({ longest: { seconds, date: 'x', venue: 'y' } });
  assert.equal(compareSongs(withSeconds(1750), answer).longest.status, 'correct');
  assert.deepEqual(compareSongs(withSeconds(1500), answer).longest, { status: 'close', direction: 'higher' });
  assert.deepEqual(compareSongs(withSeconds(2400), answer).longest, { status: 'miss', direction: 'lower' });
  assert.deepEqual(compareSongs(song({ longest: null }), answer).longest, { status: 'miss', direction: null });
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
    { album: miss, debut: close, gap: miss, longest: hit },
    { album: hit, debut: hit, gap: hit, longest: hit },
  ];
  assert.equal(shareText(4, rows, true), 'Phishle #4 2/10\n⬛🟨⬛🟩\n🟩🟩🟩🟩');
  assert.match(shareText(4, rows, false), /^Phishle #4 X\/10/);
});

test('formatters', () => {
  assert.equal(formatDuration(3016), '50:16');
  assert.equal(formatDuration(65), '1:05');
  assert.equal(formatDate('1995-06-14'), 'Jun 14, 1995');
});
