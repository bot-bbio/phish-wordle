// Reshuffle the future part of the daily schedule (data/schedule.json).
//
// The build only ever APPENDS new answers, so songs that become eligible join
// the back of the queue and would not appear for months. Run this once after
// a big change to the answer pool to mix them in sooner.
//
// It never touches a puzzle anyone could already have played: it keeps every
// puzzle up to the latest calendar date anywhere on Earth (UTC+14), because
// the game rolls over at each player's local midnight.
// Usage: node scripts/reshuffle-schedule.mjs [--seed=N]

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { reshuffleAfter, seededRandom } from './lib/select.mjs';
import { daysBetween } from '../js/game.js';

const SCHEDULE_PATH = fileURLToPath(new URL('../data/schedule.json', import.meta.url));
const EARLIEST_ZONE_HOURS = 14; // Line Islands, the first place a new day starts

const schedule = JSON.parse(readFileSync(SCHEDULE_PATH, 'utf8'));
const seedArg = process.argv.find((a) => a.startsWith('--seed='));
const seed = seedArg ? Number(seedArg.slice(7)) : Date.now();

const furthestDate = new Date(Date.now() + EARLIEST_ZONE_HOURS * 3_600_000).toISOString().slice(0, 10);
const keep = Math.max(0, daysBetween(schedule.epoch, furthestDate) + 1);

schedule.order = reshuffleAfter(schedule.order, keep, seededRandom(seed));
writeFileSync(SCHEDULE_PATH, JSON.stringify(schedule, null, 1) + '\n');
console.log(`kept puzzles #1-#${keep} (through ${furthestDate}), reshuffled ${schedule.order.length - keep} (seed ${seed})`);
