/**
 * Adversarial QA, D5 round 1: hostile part files, stored records and the
 * consistency between what the reader accepts and what the restorers accept.
 */
import { describe, expect, it } from 'vitest';
import {
  complex,
  evaluateLadder,
  fitPartCircuit,
  libraryPartOf,
  logFrequencies,
  MAX_PART_POINTS,
  partAt,
  partDataFromCircuit,
  partSrf,
  readPartFile,
  withoutData,
  writeNetlist,
  writeTouchstone,
  type Complex,
  type LibraryPart,
  type PartCircuit,
  type PartFixture,
} from '@smithonline/core';

function fileOf(
  circuit: PartCircuit,
  fixture: PartFixture,
  freqs: readonly number[],
  opts: { unit?: 'HZ' | 'KHZ' | 'MHZ' | 'GHZ'; z0?: number; comments?: string[] } = {},
): string {
  const z0 = opts.z0 ?? 50;
  const data = partDataFromCircuit(circuit, fixture, freqs, z0);
  const points = data.f.map((frequency, k) => {
    const o = 8 * k;
    const c = (i: number): Complex => complex(data.s[o + i] as number, data.s[o + i + 1] as number);
    return { frequency, s: [c(0), c(2), c(4), c(6)] };
  });
  return writeTouchstone(
    { ports: 2, z0, points },
    { format: 'RI', frequencyUnit: opts.unit ?? 'MHZ', digits: 12, comments: opts.comments ?? [] },
  );
}

const C10: PartCircuit = { type: 'C', c: 10e-12, esl: 0.38e-9, esr: 0.2 };
const L10: PartCircuit = { type: 'L', l: 10e-9, cp: 0.08e-12, r: 0.35 };
const roundTrip = (p: LibraryPart): unknown => JSON.parse(JSON.stringify(p));

describe('the 20 001 point limit', () => {
  it('reads exactly MAX_PART_POINTS and refuses one more', () => {
    const ok = fileOf(C10, 'series', logFrequencies(1e6, 10e9, MAX_PART_POINTS));
    expect(readPartFile(ok, 'MAX.s2p').part.data?.f.length).toBe(MAX_PART_POINTS);
    const over = fileOf(C10, 'series', logFrequencies(1e6, 10e9, MAX_PART_POINTS + 1));
    expect(() => readPartFile(over, 'OVER.s2p')).toThrow(/at most/);
  }, 60000);
  it('an inductor without resonance in its data at the limit reads in well under the 3.6 s the quadratic fit took (generous bound; d5-qa-fixes counts the passes)', () => {
    // L with SRF far above the file (no resonance in the data): the Cp fit branch.
    const L: PartCircuit = { type: 'L', l: 10e-9, cp: 0.01e-12, r: 0.35 };
    const text = fileOf(L, 'series', logFrequencies(1e6, 3e9, MAX_PART_POINTS));
    const t0 = performance.now();
    const { part } = readPartFile(text, 'LBIG.s2p');
    const dt = performance.now() - t0;
    console.log('LBIG read ms', dt);
    expect(part.type).toBe('L');
    // A generous bound so a slow machine does not fail it; the algorithm is pinned in d5-qa-fixes.
    expect(dt).toBeLessThan(2000);
  }, 60000);
});

describe('hostile part files', () => {
  const body = (rows: string[]): string => ['# MHZ S RI R 50', ...rows].join('\n');
  const tries: [string, string][] = [
    ['NaN', body(['1 NaN 0 1 0 1 0 0 0', '2 0 0 1 0 1 0 0 0'])],
    ['Infinity', body(['1 Infinity 0 1 0 1 0 0 0', '2 0 0 1 0 1 0 0 0'])],
    ['huge', body(['1 1e308 0 1 0 1 0 0 0', '2 0 0 1 0 1 0 0 0'])],
    ['S21 = 0 series', body(['1 1 0 0 0 0 0 1 0', '2 1 0 0 0 0 0 1 0'])],
    ['through (S21 = 1)', body(['1 0 0 1 0 1 0 0 0', '2 0 0 1 0 1 0 0 0'])],
    ['1-port in s2p', body(['1 0.5 0', '2 0.5 0'])],
    [
      '4-port rows in s2p',
      body(['1 ' + '0 0 '.repeat(4), '0 0 '.repeat(4), '0 0 '.repeat(4), '0 0 '.repeat(4)]),
    ],
    ['empty', ''],
    ['only option line', '# MHZ S RI R 50\n'],
    ['one point', body(['1 0 0 1 0 1 0 0 0'])],
    ['equal frequencies', body(['1 0.1 0 0.9 0 0.9 0 0.1 0', '1 0.1 0 0.9 0 0.9 0 0.1 0'])],
    ['descending', body(['2 0.1 0 0.9 0 0.9 0 0.1 0', '1 0.1 0 0.9 0 0.9 0 0.1 0'])],
    ['zero frequency', body(['0 0.1 0 0.9 0 0.9 0 0.1 0', '1 0.1 0 0.9 0 0.9 0 0.1 0'])],
    ['xml', '<?xml version="1.0"?><x/>'],
    ['binary', '\u0000\u0001\u0002PK\u0003\u0004'],
  ];
  for (const [name, text] of tries) {
    it(`refuses "${name}" with a PartFileError or TouchstoneError, never anything else`, () => {
      try {
        readPartFile(text, 'X.s2p');
      } catch (e) {
        expect(['PartFileError', 'TouchstoneError']).toContain((e as Error).name);
        return;
      }
      throw new Error('accepted');
    });
  }
  it('BOM, CR line endings, tabs and a megabyte comment read like the plain file', () => {
    const plain = fileOf(C10, 'series', logFrequencies(10e6, 10e9, 51));
    const ref = readPartFile(plain, 'P.s2p').part;
    const hostile =
      '﻿! ' + 'x'.repeat(1 << 20) + '\r' + plain.replace(/\n/g, '\r').replace(/ +/g, '\t');
    const got = readPartFile(hostile, 'P.s2p').part;
    expect(got.data?.f).toEqual(ref.data?.f);
    expect(got.circuit).toEqual(ref.circuit);
  });
});

describe('hostile stored parts (a .json file or IndexedDB record)', () => {
  const good = (): LibraryPart =>
    readPartFile(fileOf(C10, 'series', logFrequencies(10e6, 10e9, 51)), 'G.s2p').part;
  it('data with S21 = 0 everywhere is refused like the reader refuses it', () => {
    const p = roundTrip(good()) as { data: { s: number[] } };
    p.data.s = p.data.s.map(() => 0);
    const back = libraryPartOf(p);
    if (back === null) return;
    const r = evaluateLadder({
      z0: 50,
      frequency: 1e9,
      load: complex(50, 0),
      elements: [{ kind: 'part', orientation: 'series', part: back }],
    });
    console.log('S21=0 record zin', r.zin, partAt(back, 1e9));
    expect('accepted').toBe('refused');
  });
  it('a capacitor record whose data is an inductor is refused', () => {
    const l = readPartFile(fileOf(L10, 'series', logFrequencies(10e6, 3e9, 51)), 'L.s2p').part;
    const c = good();
    const hybrid = { ...(roundTrip(c) as object), data: (roundTrip(l) as { data: unknown }).data };
    const back = libraryPartOf(hybrid);
    if (back === null) return;
    console.log('hybrid', back.type, back.circuit, partAt(back, 1e8));
    expect('accepted').toBe('refused');
  });
  it('prototype keys do not pollute', () => {
    const raw = JSON.parse(
      '{"manufacturer":"m","partNumber":"p","type":"C","range":[1e6,1e9],"circuit":{"type":"C","c":1e-11,"esl":0,"esr":0,"__proto__":{"polluted":1}},"__proto__":{"polluted":1}}',
    );
    const back = libraryPartOf(raw);
    expect(back).not.toBeNull();
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect((back as unknown as Record<string, unknown>).polluted).toBeUndefined();
  });
  it('wrong types everywhere are refused, not thrown', () => {
    const C = { type: 'C', c: 1e-11, esl: 0, esr: 0 };
    const base = { manufacturer: 'm', partNumber: 'p', type: 'C', range: [1, 2] };
    const bads: unknown[] = [
      null,
      1,
      'x',
      [],
      { manufacturer: 1 },
      { ...base, circuit: { type: 'L', l: 1e-9, cp: 0, r: 0 } },
      { ...base, range: [2, 1], circuit: C },
      { ...base, range: ['1', 2], circuit: C },
      { ...base, circuit: { ...C, c: 0 } },
      { ...base, circuit: { ...C, esl: -1e-9 } },
      { ...base, circuit: { ...C, esr: -1 } },
      { ...base, circuit: C, data: { z0: 50, fixture: 'series', f: { length: 2 }, s: [] } },
      {
        ...base,
        circuit: C,
        data: {
          z0: 50,
          fixture: 'series',
          f: new Array(30000).fill(1),
          s: new Array(240000).fill(0),
        },
      },
    ];
    for (const b of bads) expect(libraryPartOf(b)).toBeNull();
  });
});

describe('fitted circuit in the exports', () => {
  it('a lossless inductor (r = 0) is not written as a short in the ASCII netlist', () => {
    const part: LibraryPart = {
      manufacturer: 'M',
      partNumber: 'LOSSLESS',
      type: 'L',
      range: [1e6, 1e10],
      circuit: { type: 'L', l: 10e-9, cp: 0.08e-12, r: 0 },
    };
    const text = writeNetlist({
      z0: 50,
      frequency: 1e9,
      load: complex(50, 0),
      elements: [{ kind: 'part', orientation: 'series', part }],
    });
    const line = text.split('\n').find((l) => l.startsWith('PRLC')) ?? '';
    console.log(line);
    // R = 0 across a parallel RLC is a short (netlist.ts rlcValues comment).
    expect(line).not.toMatch(/ R=0 /);
  });
  it('a lossless inductor file fits r = 0 (so the netlist case is reachable from a file)', () => {
    const freqs = logFrequencies(10e6, 6e9, 201);
    const d = partDataFromCircuit({ type: 'L', l: 10e-9, cp: 0.08e-12, r: 0 }, 'series', freqs);
    const c = fitPartCircuit(d, 'L');
    expect(c.type === 'L' ? c.r : -1).toBe(0);
  });
  it('srf of a fitted-only part is computed', () => {
    const p = withoutData(
      readPartFile(fileOf(L10, 'series', logFrequencies(10e6, 10e9, 201)), 'L.s2p').part,
    );
    expect(partSrf(p)).not.toBeNull();
  });
});
