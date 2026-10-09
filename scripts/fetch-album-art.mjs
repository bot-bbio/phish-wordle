// Download a small cover thumbnail for every album in data/albums.json into
// img/albums/, so the game can show covers offline and without loading
// images from other sites.
//
// Sources, in order:
//   1. Cover Art Archive (the image store behind MusicBrainz), for albums with
//      a `musicbrainz` release id: the 250px front-cover thumbnail.
//   2. Wikipedia, for albums with a `wikipedia` page title: the infobox cover,
//      scaled to 250px by Wikimedia's thumbnailer.
//
// Run rarely (when an album is added). Existing files are kept unless --force.
// Usage: node scripts/fetch-album-art.mjs [--force]

import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { fetchJson, sleep, USER_AGENT } from './lib/http.mjs';
import { albumSlug } from './lib/select.mjs';

const root = (/** @type {string} */ p) => fileURLToPath(new URL(`../${p}`, import.meta.url));
const ART_DIR = root('img/albums');
const THUMB_PX = 250;
const MAX_BYTES = 1_000_000; // a 250px thumbnail is ~20KB; anything huge is wrong
const REQUEST_GAP_MS = 1100; // stay polite to both volunteer-run services
const force = process.argv.includes('--force');

/**
 * Identify an image by its first bytes rather than trusting the server's
 * Content-Type header: these files are served from our own origin, so only
 * genuine JPEG/PNG/WebP data is accepted.
 * @param {Uint8Array} b
 * @returns {'jpg' | 'png' | 'webp' | null}
 */
function sniffImage(b) {
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';
  const ascii = (/** @type {number} */ from, /** @type {number} */ to) => String.fromCharCode(...b.slice(from, to));
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'webp';
  return null;
}

/**
 * @param {string} url
 * @param {string} label
 * @returns {Promise<Uint8Array | null>} image bytes, or null on 404
 */
async function fetchImage(url, label) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, redirect: 'follow' });
    if (res.status === 404) return null;
    // archive.org (where CAA stores files) has transient 5xx; back off and retry.
    if (res.status >= 500 && attempt < 3) {
      await sleep(2000 * 2 ** attempt);
      continue;
    }
    if (!res.ok) throw new Error(`${label}: HTTP ${res.status}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length > MAX_BYTES) throw new Error(`${label}: unexpectedly large (${bytes.length} bytes)`);
    return bytes;
  }
}

/** @param {{ release: string, releaseGroup?: string }} mb */
async function fromCoverArtArchive(mb) {
  const urls = [`https://coverartarchive.org/release/${mb.release}/front-${THUMB_PX}`];
  if (mb.releaseGroup) urls.push(`https://coverartarchive.org/release-group/${mb.releaseGroup}/front-${THUMB_PX}`);
  for (const url of urls) {
    try {
      const bytes = await fetchImage(url, 'Cover Art Archive');
      if (bytes) return bytes;
    } catch (err) {
      console.log(`  ${/** @type {Error} */ (err).message}; trying next source`);
    }
    await sleep(REQUEST_GAP_MS);
  }
  return null;
}

/** @param {string} page Wikipedia page title */
async function fromWikipedia(page) {
  const api = 'https://en.wikipedia.org/w/api.php?format=json&formatversion=2';
  const wikitext = (await fetchJson(`${api}&action=parse&prop=wikitext&redirects=1&page=${encodeURIComponent(page)}`, { label: `Wikipedia ${page}` }))
    .parse.wikitext;
  const file = wikitext.match(/^\s*\|\s*cover\s*=\s*(.+?)\s*$/m)?.[1];
  if (!file) return null;
  await sleep(REQUEST_GAP_MS);
  const info = await fetchJson(
    `${api}&action=query&prop=imageinfo&iiprop=url&iiurlwidth=${THUMB_PX}&titles=${encodeURIComponent(`File:${file}`)}`,
    { label: `Wikipedia File:${file}` },
  );
  const thumb = info.query.pages[0]?.imageinfo?.[0]?.thumburl;
  // Only follow URLs on Wikimedia's own image hosts.
  const host = thumb ? new URL(thumb).hostname : '';
  if (!['upload.wikimedia.org', 'thumb.wikimedia.org'].includes(host)) return null;
  await sleep(REQUEST_GAP_MS);
  return fetchImage(thumb, `Wikimedia ${file}`);
}

async function main() {
  /** @type {{ title: string, musicbrainz?: { release: string, releaseGroup?: string }, wikipedia?: string }[]} */
  const albums = JSON.parse(readFileSync(root('data/albums.json'), 'utf8'));
  mkdirSync(ART_DIR, { recursive: true });
  const missing = [];
  for (const album of albums) {
    const stem = `${ART_DIR}/${albumSlug(album.title)}`;
    const existing = ['jpg', 'png', 'webp'].map((ext) => `${stem}.${ext}`).filter(existsSync);
    if (existing.length && !force) continue;
    let bytes = album.musicbrainz ? await fromCoverArtArchive(album.musicbrainz) : null;
    if (!bytes && album.wikipedia) bytes = await fromWikipedia(album.wikipedia);
    const ext = bytes && sniffImage(bytes);
    if (!bytes || !ext) {
      missing.push(album.title);
      continue;
    }
    for (const old of existing) unlinkSync(old);
    writeFileSync(`${stem}.${ext}`, bytes);
    console.log(`${album.title}: ${ext}, ${Math.round(bytes.length / 1024)}KB`);
    await sleep(REQUEST_GAP_MS);
  }
  if (missing.length) console.log(`no cover found (placeholder will show): ${missing.join('; ')}`);
}

main().catch((err) => {
  console.error(`fetch-album-art failed: ${err.message}`);
  process.exit(1);
});
