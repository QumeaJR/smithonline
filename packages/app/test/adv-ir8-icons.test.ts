/**
 * Adversarial, phase 7: scripts/icons.mjs determinism and the PNG files it wrote (signature,
 * IHDR, every chunk CRC, IDAT inflates to the right size with valid filter bytes, opaque),
 * and the manifest under the relative base the build uses. Each test asserts the correct
 * behaviour; a failure is a defect.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { afterAll, describe, expect, it } from 'vitest';

const root = join(__dirname, '..', '..', '..');
const pub = join(__dirname, '..', 'public');
const ICONS: readonly [string, number][] = [
  ['apple-touch-icon.png', 180],
  ['icon-192.png', 192],
  ['icon-512.png', 512],
];

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}

interface Chunk {
  type: string;
  data: Buffer;
  crcOk: boolean;
}
function chunks(png: Buffer): Chunk[] {
  const out: Chunk[] = [];
  let p = 8;
  while (p < png.length) {
    const len = png.readUInt32BE(p);
    const type = png.subarray(p + 4, p + 8).toString('latin1');
    const data = png.subarray(p + 8, p + 8 + len);
    const crc = png.readUInt32BE(p + 8 + len);
    out.push({ type, data, crcOk: crc32(png.subarray(p + 4, p + 8 + len)) === crc });
    p += 12 + len;
  }
  expect(p).toBe(png.length);
  return out;
}

const tmp = mkdtempSync(join(tmpdir(), 'adv-icons-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function runScriptInto(dir: string): void {
  const src = readFileSync(join(root, 'scripts', 'icons.mjs'), 'utf8');
  const patched = src.replace(/const out = .*;/, `const out = ${JSON.stringify(dir)};`);
  expect(patched).not.toBe(src);
  const script = join(dir, 'icons-copy.mjs');
  writeFileSync(script, patched);
  execFileSync(process.execPath, [script], { cwd: dir });
}

describe('committed PNG icons', () => {
  for (const [name, size] of ICONS) {
    it(`${name} is a valid ${size} x ${size} RGBA PNG`, () => {
      const png = readFileSync(join(pub, name));
      expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      const cs = chunks(png);
      expect(cs[0]?.type).toBe('IHDR');
      expect(cs[cs.length - 1]?.type).toBe('IEND');
      expect(cs.every((c) => c.crcOk)).toBe(true);
      const ihdr = cs[0]!.data;
      expect(ihdr.length).toBe(13);
      expect(ihdr.readUInt32BE(0)).toBe(size);
      expect(ihdr.readUInt32BE(4)).toBe(size);
      expect([ihdr[8], ihdr[9], ihdr[10], ihdr[11], ihdr[12]]).toEqual([8, 6, 0, 0, 0]);
      const raw = inflateSync(
        Buffer.concat(cs.filter((c) => c.type === 'IDAT').map((c) => c.data)),
      );
      expect(raw.length).toBe(size * (size * 4 + 1));
      for (let y = 0; y < size; y++) {
        const row = y * (size * 4 + 1);
        expect(raw[row]).toBeLessThanOrEqual(4);
        // opaque (filter 0 rows: bytes are the pixels)
        if (raw[row] === 0)
          for (let x = 0; x < size; x++) expect(raw[row + 1 + x * 4 + 3]).toBe(255);
      }
    });
  }
});

describe('scripts/icons.mjs', () => {
  it('writes the same bytes twice and the same bytes as the committed files', () => {
    const a = join(tmp, 'a');
    const b = join(tmp, 'b');
    execFileSync(process.execPath, [
      '-e',
      `require('fs').mkdirSync(${JSON.stringify(a)});require('fs').mkdirSync(${JSON.stringify(b)})`,
    ]);
    runScriptInto(a);
    runScriptInto(b);
    for (const [name] of ICONS) {
      const x = readFileSync(join(a, name));
      const y = readFileSync(join(b, name));
      expect(Buffer.compare(x, y)).toBe(0);
      expect(Buffer.compare(x, readFileSync(join(pub, name)))).toBe(0);
    }
  }, 120000);
});

describe('manifest under the relative base', () => {
  it('icons and start_url resolve inside the folder the app is served from', () => {
    const m = JSON.parse(readFileSync(join(pub, 'manifest.webmanifest'), 'utf8')) as {
      start_url: string;
      scope: string;
      icons: { src: string }[];
    };
    // vite.config.ts uses base './' so the app runs from any subfolder; the manifest is
    // copied verbatim, and its URLs resolve against the manifest's own URL.
    const manifestUrl = 'https://example.org/tools/smith/manifest.webmanifest';
    for (const icon of m.icons) {
      expect(new URL(icon.src, manifestUrl).href).toMatch(
        /^https:\/\/example\.org\/tools\/smith\//,
      );
    }
    expect(new URL(m.start_url, manifestUrl).href).toMatch(
      /^https:\/\/example\.org\/tools\/smith\//,
    );
  });
});
