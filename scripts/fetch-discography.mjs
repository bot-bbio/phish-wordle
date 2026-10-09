// Pull Phish studio album tracklists from MusicBrainz into data/discography.json.
//
// phish.net's API has no discography method, so MusicBrainz (an open music
// encyclopedia) fills that gap. The album list itself is hand-curated below
// rather than discovered automatically, because MusicBrainz's raw catalog mixes
// in side projects (e.g. "Crimes of the Mind" is a Dude of Life record) and
// dates some albums by their reissue rather than original release.
//
// Run rarely: only when Phish releases a new studio album. The output is
// committed and reviewed by hand. Usage: node scripts/fetch-discography.mjs

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { fetchJson, sleep } from './lib/http.mjs';
import { pickRelease } from './lib/select.mjs';

/**
 * Curated studio albums. `releaseGroup` is a MusicBrainz release-group id.
 * `release` optionally pins one specific edition when automatic selection
 * would pick a version padded with bonus/live tracks. `demo` marks a demo
 * release that only counts for songs on no other studio album.
 * @type {{ title: string, year: number, releaseGroup: string, release?: string, demo?: boolean }[]}
 */
const ALBUMS = [
  // A 1986 demo. Fans know YEM and Divided Sky as Junta songs, so it is only
  // used for songs with no other studio release (Slave, AC/DC Bag).
  { title: 'The White Tape', year: 1986, releaseGroup: 'a154bfe4-da9d-4c83-bd50-02b25586f02c', demo: true },
  // Self-released on cassette in 1989; MusicBrainz dates it by the 1992 Elektra CD.
  { title: 'Junta', year: 1989, releaseGroup: 'f5c7ae16-cee8-345e-9e0a-cc22ce40b769' },
  { title: 'Lawn Boy', year: 1990, releaseGroup: 'dcc86c28-67f5-30f4-b1c6-1aaf621a99ab' },
  { title: 'A Picture of Nectar', year: 1992, releaseGroup: '199014bb-9886-3df4-9e19-9ca955ae5c00' },
  { title: 'Rift', year: 1993, releaseGroup: 'd2d9611b-0ea5-32e9-96c7-db903e63b96a' },
  { title: 'Hoist', year: 1994, releaseGroup: '40adc4ab-120c-3714-a13c-60364b1ea24a' },
  { title: 'Billy Breathes', year: 1996, releaseGroup: '14d3d95a-b64c-329d-8b04-8c1e15050236' },
  { title: 'The Story of the Ghost', year: 1998, releaseGroup: 'c5b5fbd7-9702-3b16-bcd7-5116220ca401' },
  { title: 'The Siket Disc', year: 1999, releaseGroup: 'f6890966-c889-393d-a0e3-bdaa502e06c9' },
  { title: 'Farmhouse', year: 2000, releaseGroup: '9778a2aa-34eb-3d0c-8328-32a754b9c6fd' },
  { title: 'Round Room', year: 2002, releaseGroup: '218b119c-32f0-3579-87f3-e231ed87e2a5' },
  { title: 'Undermind', year: 2004, releaseGroup: '6807e4a5-8ef0-32f8-b97c-d81de4fbb91b' },
  { title: 'Joy', year: 2009, releaseGroup: '4831a0b6-a62c-4995-b01b-29ab2b175aff' },
  { title: 'Party Time', year: 2009, releaseGroup: 'e0c9f2dc-e23a-4b38-b000-4d88d4c4127f' },
  { title: 'Fuego', year: 2014, releaseGroup: '98982e44-87af-4126-bfe3-77ef277deab3' },
  { title: 'Big Boat', year: 2016, releaseGroup: '802aacbe-41d6-4930-b3c1-c605d1652f20' },
  { title: 'Sigma Oasis', year: 2020, releaseGroup: '12fb397d-d08b-4b78-b92e-c246bd1ec733' },
  { title: 'Get More Down', year: 2022, releaseGroup: '7353d7fb-a787-4218-aaad-e390d668bda6' },
  { title: 'Evolve', year: 2024, releaseGroup: '1900d988-5663-4e46-bf57-932d1e8742f5' },
];

const MB = 'https://musicbrainz.org/ws/2';
// MusicBrainz asks anonymous clients to stay at or under one request per second.
const MB_DELAY_MS = 1100;

async function main() {
  const out = [];
  for (const album of ALBUMS) {
    const url = album.release
      ? `${MB}/release/${album.release}?inc=recordings&fmt=json`
      : `${MB}/release?release-group=${album.releaseGroup}&inc=recordings&fmt=json&limit=100`;
    const json = await fetchJson(url, { label: `MusicBrainz ${album.title}` });
    const release = album.release ? json : pickRelease(json.releases);
    const tracks = release.media.flatMap((/** @type {any} */ m) => m.tracks.map((/** @type {any} */ t) => t.title));
    console.log(`${album.year} ${album.title}: ${tracks.length} tracks (release ${release.id})`);
    out.push({ title: album.title, year: album.year, demo: album.demo ?? false, musicbrainzRelease: release.id, tracks });
    await sleep(MB_DELAY_MS);
  }
  const target = fileURLToPath(new URL('../data/discography.json', import.meta.url));
  writeFileSync(target, JSON.stringify(out, null, 2) + '\n');
  console.log(`wrote ${target}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
