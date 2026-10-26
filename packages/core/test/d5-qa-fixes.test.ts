/**
 * Phase D5 (real parts), fixes of QA round 1 in the core: the catalogue value
 * and the BOM columns, CSV injection, the lossless inductor in the netlists,
 * data that is not passive, the linear inductor fit, the plain refusal of a
 * file that is not Touchstone, the .xmlsc refusal naming the element, and the
 * "no library part" flag of Realize.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  bomCsv,
  bomRows,
  buildXmlsc,
  complex,
  csvText,
  fitPartCircuit,
  libraryPartFromData,
  logFrequencies,
  MAX_PART_POINTS,
  partAt,
  partCatalogueValue,
  partDataFromCircuit,
  readPartFile,
  realizeLadder,
  SYNTHETIC_PARTS,
  syntheticPart,
  writeLtspice,
  writeNetlist,
  writeSpice,
  type Ladder,
  type LibraryPart,
} from '../src/index.js';

const synth = (name: string): LibraryPart => {
  const spec = SYNTHETIC_PARTS.find((p) => p.name === name);
  if (!spec) throw new Error(name);
  return syntheticPart(spec);
};

const lossless: LibraryPart = {
  manufacturer: 'M',
  partNumber: 'LOSSLESS',
  type: 'L',
  range: [1e6, 1e10],
  circuit: { type: 'L', l: 10e-9, cp: 0.08e-12, r: 0 },
};
const series = (part: LibraryPart): Ladder => ({
  z0: 50,
  frequency: 1e9,
  load: complex(50, 0),
  elements: [{ kind: 'part', orientation: 'series', part }],
});

describe('catalogue value', () => {
  it('is the nominal value rounded to two significant digits', () => {
    expect(partCatalogueValue(synth('SYNTH-C0402-10P'))).toBe(10e-12);
    expect(partCatalogueValue(synth('SYNTH-L0402-4N7'))).toBe(4.7e-9);
    expect(partCatalogueValue(synth('SYNTH-C0402-2P2'))).toBe(2.2e-12);
  });
});

describe('BOM of library parts', () => {
  const lib = [synth('SYNTH-L0402-2N2'), synth('SYNTH-L0402-4N7')];
  const ladder: Ladder = {
    z0: 50,
    frequency: 1e9,
    load: complex(10, 0),
    elements: [
      { kind: 'L', orientation: 'series', value: 3.18e-9 },
      { kind: 'part', orientation: 'shunt', part: synth('SYNTH-C0402-10P') },
      { kind: 'C', orientation: 'shunt', value: 12.7e-12 },
    ],
  };
  const r = realizeLadder(ladder, { source: { kind: 'library', parts: lib }, scope: 'all' });
  const rows = bomRows(r);

  it('a chosen part: catalogue value under Realized, the effective value at f0 on its own', () => {
    const row = rows[0];
    expect(row?.partNumber).toMatch(/^SYNTH-L0402-/);
    expect([2.2e-9, 4.7e-9]).toContain(row?.realized);
    expect(row?.effective).toBe(r.elements[0]?.parts[0]?.realized);
    expect(row?.effective).not.toBe(row?.realized);
  });

  it('a placed part: catalogue value under Realized, its value at f0 as ideal and effective', () => {
    const row = rows[1];
    expect(row?.realized).toBe(10e-12);
    const at = partAt(synth('SYNTH-C0402-10P'), 1e9)?.value;
    expect(row?.effective).toBe(at);
    expect(row?.ideal).toBe(at);
  });

  it('an L or C with no library candidate says so and keeps its ideal value', () => {
    expect(r.elements[2]?.noLibraryPart).toBe(true);
    expect(r.elements[0]?.noLibraryPart).toBeUndefined();
    expect(rows[2]?.source).toBe('no library part');
    expect(rows[2]?.realized).toBe(12.7e-12);
    expect(rows[2]?.partNumber).toBeUndefined();
  });

  it('the CSV has an Effective at f0 column after Realized', () => {
    const [head, , placed] = bomCsv(rows).split('\n');
    const cols = head?.split(';') ?? [];
    expect(cols.slice(3, 6)).toEqual(['Ideal', 'Realized', 'Effective at f0']);
    expect(placed?.split(';')[4]).toBe('10p');
  });

  it('locked and out-of-scope elements are not flagged', () => {
    const locked = realizeLadder(ladder, {
      source: { kind: 'library', parts: lib },
      scope: 'all',
      locked: [2],
    });
    expect(locked.elements[2]?.noLibraryPart).toBeUndefined();
    const onlyL = realizeLadder(ladder, { source: { kind: 'library', parts: lib }, scope: 'L' });
    expect(onlyL.elements[2]?.noLibraryPart).toBeUndefined();
    const e24 = realizeLadder(ladder, { source: { kind: 'series', series: 'E24' }, scope: 'all' });
    expect(e24.elements.some((e) => e.noLibraryPart)).toBe(false);
  });
});

describe('CSV injection', () => {
  it('text that a spreadsheet reads as a formula gets a leading apostrophe', () => {
    expect(csvText('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(csvText('+cmd')).toBe("'+cmd");
    expect(csvText('-1+1')).toBe("'-1+1");
    expect(csvText('@x')).toBe("'@x");
    expect(csvText('\tx')).toBe("'\tx");
    expect(csvText('=A;B')).toBe(`"'=A;B"`);
    expect(csvText('GRM1555')).toBe('GRM1555');
    expect(csvText('Series L')).toBe('Series L');
  });
});

describe('a lossless inductor fit (r = 0) in the netlists', () => {
  it('the CKT netlist writes the open-circuit parallel R, not R=0', () => {
    const line = writeNetlist(series(lossless))
      .split('\n')
      .find((l) => l.startsWith('PRLC'));
    expect(line).toBe('PRLC 1 2 R=1000000000000 L=10 C=0.08');
  });
  it('SPICE and LTspice write L across Cp with no loss resistor (no short)', () => {
    const spice = writeSpice(series(lossless));
    expect(spice).toMatch(/^L1 /m);
    expect(spice).toMatch(/^C1 /m);
    expect(spice).not.toMatch(/^RL1 /m);
    const asc = writeLtspice(series(lossless));
    expect(asc).not.toMatch(/InstName RL1/);
    expect(asc).toMatch(/InstName L1/);
  });
});

describe('data that is not passive', () => {
  it('a negative ESR is flagged, not shown as lossless', () => {
    const p = libraryPartFromData(
      partDataFromCircuit(
        { type: 'C', c: 10e-12, esl: 0.38e-9, esr: -0.02 },
        'series',
        logFrequencies(10e6, 10e9, 101),
      ),
      { manufacturer: 'M', partNumber: 'NOISY' },
    );
    const at = partAt(p, 1e9);
    expect(at?.passive).toBe(false);
    expect(Number.isNaN(at?.q)).toBe(true);
    const ok = partAt(synth('SYNTH-C0402-10P'), 1e9);
    expect(ok?.passive).toBe(true);
    expect(ok?.q).toBeGreaterThan(0);
  });
});

describe('the inductor fit without resonance is linear in the points', () => {
  afterEach(() => vi.restoreAllMocks());
  it('makes a fixed number of filter passes, whatever the number of points', () => {
    // The quadratic version filtered the whole frequency list once per point.
    const L = { type: 'L' as const, l: 10e-9, cp: 0.01e-12, r: 0.35 };
    const count = (n: number): number => {
      const data = partDataFromCircuit(L, 'series', logFrequencies(1e6, 3e9, n));
      const spy = vi.spyOn(Array.prototype, 'filter');
      fitPartCircuit(data, 'L');
      const calls = spy.mock.calls.length;
      spy.mockRestore();
      return calls;
    };
    expect(count(MAX_PART_POINTS)).toBe(count(201));
    expect(count(MAX_PART_POINTS)).toBeLessThan(20);
  });
});

describe('files that are not Touchstone', () => {
  it('say so instead of "Not a number"', () => {
    expect(() => readPartFile('nonsense\nmore nonsense', 'X.s2p')).toThrow(/Not a Touchstone file/);
    expect(() => readPartFile('<?xml version="1.0"?><x/>', 'X.s2p')).toThrow(
      /Not a Touchstone file/,
    );
  });
});

describe('.xmlsc and library parts', () => {
  it('the refusal names the element and the part', () => {
    const ladder: Ladder = {
      ...series(lossless),
      elements: [
        { kind: 'C', orientation: 'shunt', value: 1e-12 },
        { kind: 'part', orientation: 'series', part: lossless },
      ],
    };
    expect(() => buildXmlsc(ladder)).toThrow(/element 2 \(LOSSLESS\)/);
  });
});
