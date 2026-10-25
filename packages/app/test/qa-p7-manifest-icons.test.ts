/**
 * QA, redesign phase 7: the web app manifest and its icons, decoded pixel by pixel.
 *
 * Expected colours from scripts/icons.mjs and favicon.svg by hand: the disc and its 1.6 unit
 * rim span 0.8 of the side (outer rim radius 14.8 favicon units = 0.4 x side), the canvas
 * #f2f3f5 outside it, the accent #0b6bcb on the real axis through the centre, white #ffffff in
 * the disc away from every line (favicon point (9, 12)), every pixel opaque.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

const root = join(__dirname, '..');
const read = (p: string): string => readFileSync(join(root, p), 'utf8');

interface Png {
  readonly width: number;
  readonly height: number;
  readonly bitDepth: number;
  readonly colourType: number;
  readonly rgba: Uint8Array;
}

/** A minimal PNG reader for 8 bit RGBA, all five row filters. */
function decodePng(buf: Buffer): Png {
  expect([...buf.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  let p = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colourType = 0;
  const idat: Buffer[] = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.subarray(p + 4, p + 8).toString('ascii');
    const data = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8] as number;
      colourType = data[9] as number;
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  const out = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)] as number;
    for (let x = 0; x < stride; x++) {
      const v = raw[y * (stride + 1) + 1 + x] as number;
      const a = x >= 4 ? (out[y * stride + x - 4] as number) : 0;
      const b = y > 0 ? (out[(y - 1) * stride + x] as number) : 0;
      const c = x >= 4 && y > 0 ? (out[(y - 1) * stride + x - 4] as number) : 0;
      let pred = 0;
      if (filter === 1) pred = a;
      else if (filter === 2) pred = b;
      else if (filter === 3) pred = (a + b) >> 1;
      else if (filter === 4) {
        const pa = Math.abs(b - c);
        const pb = Math.abs(a - c);
        const pc = Math.abs(a + b - 2 * c);
        pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      out[y * stride + x] = (v + pred) & 0xff;
    }
  }
  return { width, height, bitDepth, colourType, rgba: out };
}

const px = (png: Png, i: number, j: number): number[] => {
  const k = (j * png.width + i) * 4;
  return [...png.rgba.subarray(k, k + 4)];
};

const CANVAS = [0xf2, 0xf3, 0xf5, 255];
const ACCENT = [0x0b, 0x6b, 0xcb, 255];
const WHITE = [255, 255, 255, 255];

const ICONS: readonly [string, number][] = [
  ['apple-touch-icon.png', 180],
  ['icon-192.png', 192],
  ['icon-512.png', 512],
];

describe('qa: the icons, decoded', () => {
  for (const [name, size] of ICONS) {
    describe(name, () => {
      const png = decodePng(readFileSync(join(root, 'public', name)));

      it(`is ${size} x ${size}, 8 bit RGBA`, () => {
        expect(png.width).toBe(size);
        expect(png.height).toBe(size);
        expect(png.bitDepth).toBe(8);
        expect(png.colourType).toBe(6);
      });

      it('is opaque everywhere (iOS fills transparency with black)', () => {
        for (let k = 3; k < png.rgba.length; k += 4) {
          if (png.rgba[k] !== 255) throw new Error(`pixel ${(k - 3) / 4} has alpha ${png.rgba[k]}`);
        }
      });

      it('canvas in the corners, accent at the centre, white in the disc', () => {
        expect(px(png, 0, 0)).toEqual(CANVAS);
        expect(px(png, size - 1, size - 1)).toEqual(CANVAS);
        expect(px(png, size / 2, size / 2)).toEqual(ACCENT);
        // favicon point (9, 12): i = size/2 - 7 size/37, j = size/2 - 4 size/37, rounded down.
        const i = Math.floor(size / 2 - (7 * size) / 37);
        const j = Math.floor(size / 2 - (4 * size) / 37);
        expect(px(png, i, j)).toEqual(WHITE);
      });

      it('nothing but canvas outside the maskable safe zone (radius 0.4 of the side)', () => {
        const c = size / 2;
        for (let j = 0; j < size; j++) {
          for (let i = 0; i < size; i++) {
            // The pixel's nearest corner more than one pixel outside the circle.
            const d = Math.hypot(Math.abs(i + 0.5 - c) - 0.5, Math.abs(j + 0.5 - c) - 0.5);
            if (d > 0.4 * size + 1 && px(png, i, j).join() !== CANVAS.join()) {
              throw new Error(`pixel ${i},${j} at ${d.toFixed(1)} px is not canvas`);
            }
          }
        }
      });
    });
  }
});

describe('qa: the manifest', () => {
  const manifest = JSON.parse(read('public/manifest.webmanifest')) as {
    name: string;
    short_name: string;
    description: string;
    start_url: string;
    scope: string;
    display: string;
    theme_color: string;
    background_color: string;
    icons: { src: string; sizes: string; type: string; purpose?: string }[];
  };

  it('every icon it lists exists; a maskable and an any icon at 512', () => {
    for (const icon of manifest.icons) {
      expect(() => readFileSync(join(root, 'public', icon.src))).not.toThrow();
    }
    const at512 = manifest.icons.filter((i) => i.sizes === '512x512').map((i) => i.purpose);
    expect(at512).toEqual(expect.arrayContaining(['any', 'maskable']));
  });

  it('the description is one plain sentence without dashes', () => {
    expect(manifest.description).toMatch(/^[A-Z][^–—]*\.$/);
  });

  it('the light theme-color meta of index.html is the manifest colour', () => {
    const html = read('index.html');
    expect(html).toContain(
      `<meta name="theme-color" content="${manifest.theme_color}" media="(prefers-color-scheme: light)" />`,
    );
  });

  it('URLs are relative, as vite base "./" promises a build that works from any folder', () => {
    // vite.config.ts: base './' makes dist/index.html loadable from any path or subfolder;
    // README: "Copy it to any web server". Vite rewrites index.html to ./manifest.webmanifest
    // but copies the manifest as is, so "/" start_url, scope and icons leave a subfolder.
    expect(read('vite.config.ts')).toContain("base: './'");
    expect(manifest.start_url.startsWith('/')).toBe(false);
    expect(manifest.scope.startsWith('/')).toBe(false);
    for (const icon of manifest.icons) expect(icon.src.startsWith('/')).toBe(false);
  });
});
