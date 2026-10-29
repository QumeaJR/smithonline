/**
 * Renders the app icons of the web app manifest: the SmithChart.Online mark (the simple
 * version of scripts/brand.mjs, as favicon.svg draws it) on the light canvas colour, an opaque
 * square as iOS and the maskable icon want. The mark is a Smith chart (rim, real axis, the r = 1
 * circle, the x = +1 and -1 arcs) with an exact L-network match: the load z = 0.15 + j0.35
 * along its constant-resistance circle (a series capacitor) to the unit-conductance circle,
 * then along that circle (a shunt inductor) into the centre.
 *
 * The repository has no rasterizer, so the shapes are sampled here (4 x 4 per pixel) and
 * written with a minimal PNG encoder (node:zlib for the deflate).
 *
 *   node scripts/icons.mjs
 *
 * writes apple-touch-icon.png (180 px), icon-192.png, icon-512.png and the maskable
 * icon-maskable-512.png to packages/app/public/. Run it again when the mark changes.
 * The output depends on nothing but this file: the same bytes on every run.
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '..', 'packages', 'app', 'public');

const hex = (h) => [
  parseInt(h.slice(1, 3), 16),
  parseInt(h.slice(3, 5), 16),
  parseInt(h.slice(5, 7), 16),
];
/** The light canvas of index.css and the light colours of the mark (scripts/brand.mjs). */
const CANVAS = hex('#F2F3F5');
const RING = hex('#087FAD');
const GRID = hex('#51819A');
const GRID_OPACITY = 0.43;
const EDGE = hex('#FFFFFF');
const CENTRE_DOT = hex('#3B65F6');
const STOPS = [
  [0, hex('#40E5EF')],
  [0.52, hex('#08A8ED')],
  [1, hex('#3B65F6')],
];

/** The mark in its 128 unit frame. */
const C = 64;
const R = 50;
const RING_W = 5;
const GRID_W = 3;
const TRACE_W = 11;
const DOT_R = 8;
const DOT_EDGE = 2;

const gammaOf = (r, x) => {
  const d = (r + 1) ** 2 + x * x;
  return [(r * r + x * x - 1) / d, (2 * x) / d];
};
const svgOf = ([a, b]) => [C + R * a, C - R * b];
const rLoad = 0.15;
const [SX, SY] = svgOf(gammaOf(rLoad, 0.35));
const [MX, MY] = svgOf(gammaOf(rLoad, -Math.sqrt(rLoad * (1 - rLoad))));
/** The two arcs: centre, radius and the screen angles they span (y down). */
const ARC1 = { cx: C + R * (rLoad / (1 + rLoad)), cy: C, r: R / (1 + rLoad) };
const ARC2 = { cx: C - R / 2, cy: C, r: R / 2 };
const angle = (a, x, y) => Math.atan2(y - a.cy, x - a.cx);
const A1_FROM = angle(ARC1, SX, SY); // about -146 degrees
const A1_TO = angle(ARC1, MX, MY); // about 146 degrees: arc 1 runs through 180 degrees
const A2_FROM = angle(ARC2, MX, MY); // about 100 degrees, down to 0 at the centre

const near = (x, y, cx, cy, r, w) => Math.abs(Math.hypot(x - cx, y - cy) - r) <= w / 2;
function onTrace(x, y) {
  const w = TRACE_W / 2;
  for (const [px, py] of [
    [SX, SY],
    [MX, MY],
    [C, C],
  ])
    if (Math.hypot(x - px, y - py) <= w) return true;
  if (near(x, y, ARC1.cx, ARC1.cy, ARC1.r, TRACE_W)) {
    const a = angle(ARC1, x, y);
    if (a >= A1_TO || a <= A1_FROM) return true;
  }
  if (near(x, y, ARC2.cx, ARC2.cy, ARC2.r, TRACE_W)) {
    const a = angle(ARC2, x, y);
    if (a >= 0 && a <= A2_FROM) return true;
  }
  return false;
}
function gradient(x, y) {
  const [x1, y1, x2, y2] = [22, 28, 112, 104];
  const dx = x2 - x1;
  const dy = y2 - y1;
  const t = Math.min(1, Math.max(0, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)));
  for (let k = 1; k < STOPS.length; k++) {
    const [t0, c0] = STOPS[k - 1];
    const [t1, c1] = STOPS[k];
    if (t <= t1) {
      const u = (t - t0) / (t1 - t0);
      return c0.map((v, i) => v + (c1[i] - v) * u);
    }
  }
  return STOPS[STOPS.length - 1][1];
}
const mix = (a, b, o) => a.map((v, i) => v * (1 - o) + b[i] * o);
const dot = (x, y, cx, cy, fill) => {
  const d = Math.hypot(x - cx, y - cy);
  if (Math.abs(d - DOT_R) <= DOT_EDGE / 2) return EDGE;
  if (d < DOT_R) return fill;
  return null;
};

/** The colour at a point of the 128 unit frame, painted in the order of the SVG. */
function colourAt(x, y) {
  let c = CANVAS;
  const d = Math.hypot(x - C, y - C);
  if (d < R) {
    const grid =
      Math.abs(y - C) <= GRID_W / 2 ||
      near(x, y, C + R / 2, C, R / 2, GRID_W) ||
      near(x, y, C + R, C - R, R, GRID_W) ||
      near(x, y, C + R, C + R, R, GRID_W);
    if (grid) c = mix(c, GRID, GRID_OPACITY);
  }
  if (Math.abs(d - R) <= RING_W / 2) c = RING;
  if (onTrace(x, y)) c = gradient(x, y);
  c = dot(x, y, SX, SY, STOPS[0][1]) ?? c;
  c = dot(x, y, C, C, CENTRE_DOT) ?? c;
  return c;
}

/**
 * The icon as RGBA pixels. The mark and its ring span `scale` of the side. The plain icons use
 * 0.8, the whole maskable safe zone; the maskable icon has its own artwork at MASKABLE_SCALE,
 * the mark well inside the safe zone (the circle of 40 percent of the side around the centre)
 * so a launcher's circle, squircle or rounded square never cuts the ring.
 */
function render(size, scale = 0.8) {
  const px = new Uint8Array(size * size * 4);
  const unitsPerPx = (2 * R + RING_W) / (size * scale);
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

/** The maskable icon's mark: 0.64 of the side, a margin of 0.08 of the side to the safe zone. */
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
