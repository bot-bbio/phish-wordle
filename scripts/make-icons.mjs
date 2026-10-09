// Generate the app icons (a red donut, after Fishman's dress, on navy) as
// PNG + SVG with no image library: we rasterize the shape ourselves and
// encode the PNG by hand using Node's built-in zlib.
//
// PNG format refresher: an 8-byte signature, then "chunks" (length, type,
// data, CRC-32). IHDR holds dimensions; IDAT holds the zlib-compressed pixel
// rows, each row prefixed with a filter byte (0 = none); IEND closes the file.
//
// Usage: node scripts/make-icons.mjs

import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const BG = [16, 26, 46]; // #101a2e
const RED = [229, 72, 77]; // #e5484d
const OUTER = 0.3; // donut radii as a fraction of the icon size; the maskable
const INNER = 0.12; // safe zone is the central 80%, so the donut stays inside it

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

/** @param {Buffer} buf */
function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** @param {string} type @param {Buffer} data */
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** @param {number} size */
function renderPng(size) {
  const SAMPLES = 4; // 4x4 supersampling per pixel for smooth (anti-aliased) edges
  const center = size / 2;
  const rows = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 3); // leading 0 = "no filter"
    for (let x = 0; x < size; x++) {
      let hits = 0;
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const dx = x + (sx + 0.5) / SAMPLES - center;
          const dy = y + (sy + 0.5) / SAMPLES - center;
          const r = Math.hypot(dx, dy) / size;
          if (r <= OUTER && r >= INNER) hits++;
        }
      }
      const t = hits / (SAMPLES * SAMPLES); // coverage -> blend factor
      for (let c = 0; c < 3; c++) row[1 + x * 3 + c] = Math.round(BG[c] + (RED[c] - BG[c]) * t);
    }
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: truecolor RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(rows), { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const hex = (/** @type {number[]} */ rgb) => '#' + rgb.map((c) => c.toString(16).padStart(2, '0')).join('');
const ringWidth = (OUTER - INNER) * 100;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
<rect width="100" height="100" rx="22" fill="${hex(BG)}"/>
<circle cx="50" cy="50" r="${((OUTER + INNER) / 2) * 100}" fill="none" stroke="${hex(RED)}" stroke-width="${ringWidth}"/>
</svg>
`;

const dir = fileURLToPath(new URL('../icons/', import.meta.url));
mkdirSync(dir, { recursive: true });
for (const size of [180, 192, 512]) writeFileSync(`${dir}icon-${size}.png`, renderPng(size));
writeFileSync(`${dir}icon.svg`, svg);
console.log(`icons written to ${dir}`);
