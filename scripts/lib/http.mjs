// Small HTTP + environment helpers for the data scripts. Node 18+ ships a
// global fetch, so the project needs no npm dependencies.

import { readFileSync, existsSync } from 'node:fs';

export const USER_AGENT = 'phish-wordle-data/1.0 (+https://github.com/bot-bbio/phish-wordle)';

/** @param {number} ms */
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Fetch JSON with a descriptive User-Agent and a few retries on transient
 * failures (network errors, 429, 5xx). Retries back off exponentially so a
 * struggling volunteer-run server is not hammered.
 * @param {string} url
 * @param {{ retries?: number, label?: string }} [opts]
 * @returns {Promise<any>}
 */
export async function fetchJson(url, { retries = 3, label = url } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(1000 * 2 ** attempt);
    try {
      const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } });
      if (res.status === 429 || res.status >= 500) {
        lastError = new Error(`${label}: HTTP ${res.status}`);
        continue;
      }
      if (!res.ok) throw new Error(`${label}: HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

/**
 * Read a variable from the process environment, falling back to a local .env
 * file (KEY=value lines). The value is never logged.
 * @param {string} name
 * @param {string} envPath
 * @returns {string | undefined}
 */
export function readEnv(name, envPath) {
  if (process.env[name]) return process.env[name];
  if (!existsSync(envPath)) return undefined;
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (match && match[1] === name) return match[2].replace(/^["']|["']$/g, '');
  }
  return undefined;
}
