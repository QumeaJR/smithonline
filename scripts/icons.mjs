/**
 * Renders the app icons of the web app manifest from the geometry of
 * packages/app/public/favicon.svg: the white disc with two constant resistance
 * circles, two constant reactance arcs and the real axis in the accent blue, on
 * the light canvas colour (an opaque square, as iOS and the maskable icon want).
 *
 * The repository has no rasterizer, so the shapes are sampled here (4 x 4 per
 * pixel) and written with a minimal PNG encoder (node:zlib for the deflate).
 *
 *   node scripts/icons.mjs
 *
 * writes apple-touch-icon.png (180 px), icon-192.png, icon-512.png and the maskable
 * icon-maskable-512.png to packages/app/public/. Run it again when favicon.svg changes.
 * The output depends on nothing but this file: the same bytes on every run.
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '..', 'packages', 'app', 'public');

/** The tokens of index.css: light canvas, surface and accent. */
const CANVAS = [0xf2, 0xf3, 0xf5];
const DISC = [0xff, 0xff, 0xff];
const ACCENT = [0x0b, 0x6b, 0xcb];

/** favicon.svg in its own 32 unit frame. */
const C = 16;
const R = 14;
const RIM = 1.6;
const GRID = 1.2;
const CIRCLES = [
  [23, 16, 7],
  [25.33, 16, 4.67],
  [30, 2, 14],
  [30, 30, 14],
];

/** The colour at a point of the 32 unit frame of favicon.svg. */
function colourAt(x, y) {
  const d = Math.hypot(x - C, y - C);
  if (Math.abs(d - R) <= RIM / 2) return ACCENT;
  if (d > R) return CANVAS;
  if (Math.abs(y - C) <= GRID / 2 && x >= 2 && x <= 30) return ACCENT;
  for (const [cx, cy, r] of CIRCLES) {
    if (Math.abs(Math.hypot(x - cx, y - cy) - r) <= GRID / 2) return ACCENT;
  }
  return DISC;
}

/**
 * The icon as RGBA pixels. The disc and its rim span `scale` of the side. The plain icons use
 * 0.8, the whole maskable safe zone; the maskable icon has its own artwork at MASKABLE_SCALE,
 * the disc well inside the safe zone (the circle of 40 percent of the side around the
 * centre) so a launcher's circle, squircle or rounded square never cuts the rim.
 */
function render(size, scale = 0.8) {
  const px = new Uint8Array(size * size * 4);
  // Icon pixels to favicon units: the disc's diameter plus the rim spans `scale` of the side.
  const unitsPerPx = (2 * R + RIM) / (size * scale);
  const n = 4;
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let sj = 0; sj < n; sj++) {
        for (let si = 0; si < n; si++) {
          const x = C + (i + (si + 0.5) / n - size / 2) * unitsPerPx;
          const y = C + (j + (sj + 0.5) / n - size / 2) * unitsPerPx;
          const c = colourAt(x, y);
          r += c[0];
          g += c[1];
          b += c[2];
        }
      }
      const k = (j * size + i) * 4;
      px[k] = Math.round(r / (n * n));
      px[k + 1] = Math.round(g / (n * n));
      px[k + 2] = Math.round(b / (n * n));
      px[k + 3] = 255;
    }
  }
  return px;
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** An 8 bit RGBA PNG, filter 0 on every row. */
function png(size, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** The maskable icon's disc: 0.64 of the side, a margin of 0.08 of the side to the safe zone. */
const MASKABLE_SCALE = 0.64;

for (const [name, size, scale] of [
  ['apple-touch-icon.png', 180, 0.8],
  ['icon-192.png', 192, 0.8],
  ['icon-512.png', 512, 0.8],
  ['icon-maskable-512.png', 512, MASKABLE_SCALE],
]) {
  writeFileSync(join(out, name), png(size, render(size, scale)));
  console.log(`wrote ${name} (${size} x ${size})`);
}
