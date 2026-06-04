/**
 * make-icons.mjs — generate PNG app icons (192/512) from a solid-color base.
 *
 * Produces valid PNGs with zero dependencies by hand-encoding a single-color
 * RGBA bitmap through Node's built-in zlib. This guarantees the manifest's PNG
 * entries resolve (no 404) even on platforms that ignore the SVG icon.
 *
 * Usage:  node scripts/make-icons.mjs
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'frontend', 'assets', 'icons');
const NAVY = [13, 59, 102, 255];     // #0d3b66
const ACCENT = [244, 162, 89, 255];  // #f4a259

function crc32(buf) {
  let c, table = crc32.t || (crc32.t = (() => {
    const t = [];
    for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    return t;
  })());
  c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, 'ascii');
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function makePng(size) {
  // Build raw RGBA scanlines: navy background, accent rounded square center.
  const inset = Math.round(size * 0.23);
  const raw = Buffer.alloc((size * 4 + 1) * size);
  let o = 0;
  for (let y = 0; y < size; y++) {
    raw[o++] = 0; // filter type 0
    for (let x = 0; x < size; x++) {
      const inBox = x > inset && x < size - inset && y > size * 0.45 && y < size - inset;
      const px = inBox ? ACCENT : NAVY;
      raw[o++] = px[0]; raw[o++] = px[1]; raw[o++] = px[2]; raw[o++] = px[3];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // color type RGBA
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

for (const size of [192, 512]) {
  const file = join(outDir, `icon-${size}.png`);
  writeFileSync(file, makePng(size));
  console.log('wrote ' + file);
}
