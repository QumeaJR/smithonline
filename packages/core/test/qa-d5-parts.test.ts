/**
 * QA round 1 on phase D5 (real parts): closed forms of the fixture
 * conversions and the placements, a reference impedance other than 50 ohm,
 * linear-in-S interpolation pinned by hand, the self-resonance found between
 * two samples, the ends of the data range, refused file shapes, and Realize
 * from an empty, a one-part or a mismatched library with locks and scopes.
 *
 * Every expected value is a hand calculation from the textbook fixture
 * formulas (S11 = Z / (Z + 2 Z0), S21 = 2 Z0 / (Z + 2 Z0) in series-through;
 * S11 = -Z0 / (2 Z + Z0), S21 = 2 Z / (2 Z + Z0) in shunt-through), not output
 * of the code under test.
 */
import { describe, expect, it } from 'vitest';
import {
  complex,
  elementAbcd,
  libraryCandidates,
  partAbcd,
  partAt,
  partDataFromCircuit,
  partImpedance,
  partNominal,
  partRangeProblem,
  partSrf,
  PartFileError,
  libraryPartFromData,
  libraryPartOf,
  ladderStress,
  bomCsv,
  bomRows,
  readPartFile,
  realizeLadder,
  writeNetlist,
  type Complex,
  type Element,
  type Ladder,
  type LibraryPart,
  type PartCircuit,
} from '../src/index.js';

const TWO_PI = 2 * Math.PI;

function close(z: Complex, re: number, im: number, tol: number): void {
  expect(Math.abs(z.re - re), `re ${z.re} vs ${re}`).toBeLessThan(tol);
  expect(Math.abs(z.im - im), `im ${z.im} vs ${im}`).toBeLessThan(tol);
}

/** Plain complex helpers for the hand calculations (independent of core's complex.ts). */
const div = (a: [number, number], b: [number, number]): [number, number] => {
  const d = b[0] * b[0] + b[1] * b[1];
  return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d];
};

/** A part known only by its fitted circuit (a share link): exact closed forms. */
function circuitPart(circuit: PartCircuit, range: [number, number], name: string): LibraryPart {
  return { manufacturer: 'QA', partNumber: name, type: circuit.type, range, circuit };
}

describe('qa: placements against closed forms', () => {
  // C 10 pF, ESL 0.38 nH, ESR 0.2 ohm at 1 GHz:
  // w ESL = 2.3876104 ohm, 1 / (w C) = 15.9154943 ohm, X = -13.5278839 ohm.
  const cSeries: PartCircuit = { type: 'C', c: 10e-12, esl: 0.38e-9, esr: 0.2 };
  const X1G = 2.3876104167282426 - 15.915494309189533;
  const seriesData = partDataFromCircuit(cSeries, 'series', [0.5e9, 1e9, 2e9]);
  const seriesPart = libraryPartFromData(seriesData, { manufacturer: 'QA', partNumber: 'S' });

  it('a series part from a series-through file is [1 Z; 0 1] with Z = 0.2 - j13.528 at a sample', () => {
    const m = partAbcd(seriesPart, 'series', 1e9);
    close(m.a, 1, 0, 1e-9);
    close(m.b, 0.2, X1G, 1e-8);
    close(m.c, 0, 0, 1e-12);
    close(m.d, 1, 0, 1e-9);
  });

  it('a series-through file placed in shunt is [1 0; 1/Z 1]', () => {
    const m = partAbcd(seriesPart, 'shunt', 1e9);
    const y = div([1, 0], [0.2, X1G]);
    close(m.a, 1, 0, 1e-12);
    close(m.b, 0, 0, 1e-12);
    close(m.c, y[0], y[1], 1e-10);
  });

  it('a shunt-through file in shunt with a 0.5 nH via: branch Z + j 3.1416 ohm', () => {
    // C 10 pF, ESL 0.45 nH, ESR 0.2: X = 2.8274334 - 15.9154943 = -13.0880609; via j3.1415927.
    const c: PartCircuit = { type: 'C', c: 10e-12, esl: 0.45e-9, esr: 0.2 };
    const p = libraryPartFromData(partDataFromCircuit(c, 'shunt', [0.5e9, 1e9, 2e9]), {
      manufacturer: 'QA',
      partNumber: 'SH',
    });
    const branchIm = 2.827433388230814 - 15.915494309189533 + 3.141592653589793;
    const y = div([1, 0], [0.2, branchIm]);
    const m = partAbcd(p, 'shunt', 1e9, 0.5e-9);
    close(m.c, y[0], y[1], 1e-10);
    close(m.b, 0, 0, 1e-12);
    // The same file in series: [1 Z; 0 1] with Z = 1 / C of the chain matrix, without the via.
    const s = partAbcd(p, 'series', 1e9, 0.5e-9);
    close(s.b, 0.2, 2.827433388230814 - 15.915494309189533, 1e-8);
    close(s.c, 0, 0, 1e-12);
  });

  it('the via is ignored on a series part and on a part element in series', () => {
    const el: Element = {
      kind: 'part',
      orientation: 'series',
      part: seriesPart,
      board: { via: 1e-9 },
    };
    close(elementAbcd(el, 1e9).b, 0.2, X1G, 1e-8);
  });
});

describe('qa: a file at a reference impedance other than 50 ohm', () => {
  // Series-through at Z0 = 75 ohm of an ideal inductor X = 50 ohm at 1 GHz (L = 7.9577 nH):
  // S11 = j50 / (150 + j50) = (1 + 3j) / 10, S21 = (9 - 3j) / 10.
  // At 2 GHz X = 100: S11 = j100 / (150 + j100) = (4 + 6j) / 13, S21 = (9 - 6j) / 13.
  const text = [
    '! QA series-through file at 75 ohm',
    '# GHZ S RI R 75',
    `1 0.1 0.3 0.9 -0.3 0.9 -0.3 0.1 0.3`,
    `2 ${4 / 13} ${6 / 13} ${9 / 13} ${-6 / 13} ${9 / 13} ${-6 / 13} ${4 / 13} ${6 / 13}`,
  ].join('\n');

  it('reads Z0 = 75, detects series-through and gives Z = j50 and j100 at the samples', () => {
    const { part, guess } = readPartFile(text, 'QA-L75.s2p');
    expect(part.data?.z0).toBe(75);
    expect(guess.fixture).toBe('series');
    expect(guess.confident).toBe(true);
    expect(part.type).toBe('L');
    close(partImpedance(part, 1e9) as Complex, 0, 50, 1e-9);
    close(partImpedance(part, 2e9) as Complex, 0, 100, 1e-9);
    // Nominal: 50 / (2 pi 1e9) = 7.957747 nH.
    expect(Math.abs((partNominal(part) as number) / (50 / (TWO_PI * 1e9)) - 1)).toBeLessThan(1e-9);
  });

  it('in a 50 ohm ladder the measured two-port still gives B = j50 (the chain matrix is reference free)', () => {
    const { part } = readPartFile(text, 'QA-L75.s2p');
    const m = elementAbcd({ kind: 'part', orientation: 'series', part }, 1e9);
    close(m.b, 0, 50, 1e-9);
    close(m.a, 1, 0, 1e-12);
    close(m.c, 0, 0, 1e-12);
  });

  it('half way between the samples, S is the mean: Z = 150 S11 / S21 = 10/3 + j 220/3 ohm', () => {
    // S11 = (53 + 99j) / 260, S21 = (207 - 99j) / 260; Z = 150 (1170 + 25740j) / 52650.
    const { part } = readPartFile(text, 'QA-L75.s2p');
    close(partImpedance(part, 1.5e9) as Complex, 10 / 3, 220 / 3, 1e-9);
    // So linear-in-S interpolation shows a lossless inductor with Q = 22 between octave samples.
    expect((partAt(part, 1.5e9) as { q: number }).q).toBeCloseTo(22, 9);
  });

  it('a shunt-through file at 25 ohm: Z = -j25 and -j12.5 (C = 6.3662 pF)', () => {
    // Z = -j25 at 1 GHz: S11 = -25 / (25 - 50j) = -0.2 - 0.4j, S21 = 0.8 - 0.4j.
    // Z = -j12.5 at 2 GHz: S11 = -25 / (25 - 25j) = -0.5 - 0.5j, S21 = 0.5 - 0.5j.
    const shunt = [
      '# GHZ S RI R 25',
      '1 -0.2 -0.4 0.8 -0.4 0.8 -0.4 -0.2 -0.4',
      '2 -0.5 -0.5 0.5 -0.5 0.5 -0.5 -0.5 -0.5',
    ].join('\n');
    const { part, guess } = readPartFile(shunt, 'QA-C25.s2p');
    expect(guess.fixture).toBe('shunt');
    expect(part.type).toBe('C');
    close(partImpedance(part, 1e9) as Complex, 0, -25, 1e-9);
    close(partImpedance(part, 2e9) as Complex, 0, -12.5, 1e-9);
    expect(Math.abs((partNominal(part) as number) / (1 / (TWO_PI * 1e9 * 25)) - 1)).toBeLessThan(
      1e-9,
    );
  });
});

describe('qa: the self-resonance between two samples', () => {
  it('is where Im S21 of the linear interpolant is zero (C 10 pF, 0.38 nH, 0.2 ohm, samples 2 and 3 GHz)', () => {
    // Series-through: Z = 2 Z0 (1 / S21 - 1), so Im Z = 0 exactly where Im S21 = 0, and S21 is
    // linear in f between the samples. S21 = 100 / (100.2 + jX), Im S21 = -100 X / (100.2^2 + X^2).
    const xAt = (f: number): number => TWO_PI * f * 0.38e-9 - 1 / (TWO_PI * f * 10e-12);
    const imS21 = (f: number): number => {
      const x = xAt(f);
      return (-100 * x) / (100.2 * 100.2 + x * x);
    };
    const a = imS21(2e9); // +0.0316664
    const b = imS21(3e9); // -0.0184962
    const expected = 2e9 + (a / (a - b)) * 1e9; // 2.6313 GHz; the circuit's own is 2.5820 GHz
    const p = libraryPartFromData(
      partDataFromCircuit({ type: 'C', c: 10e-12, esl: 0.38e-9, esr: 0.2 }, 'series', [2e9, 3e9]),
      { manufacturer: 'QA', partNumber: 'SRF' },
    );
    expect(p.type).toBe('C');
    expect(Math.abs((partSrf(p) as number) / expected - 1)).toBeLessThan(1e-9);
    // Just past it the capacitor has no effective capacitance; just before, a positive one.
    expect(partAt(p, expected * 1.001)?.value).toBeNull();
    expect(partAt(p, expected * 0.999)?.value).toBeGreaterThan(0);
  });

  it('a fitted-only inductor (10 nH, Cp 0.08 pF) resonates at 1 / (2 pi sqrt(8e-22)) = 5.62698 GHz', () => {
    const c: PartCircuit = { type: 'L', l: 10e-9, cp: 0.08e-12, r: 0.35 };
    expect(
      Math.abs((partSrf(circuitPart(c, [1e7, 1e10], 'L')) as number) / 5.62698e9 - 1),
    ).toBeLessThan(1e-5);
    // Outside the range there is none to report.
    expect(partSrf(circuitPart(c, [1e7, 5e9], 'L'))).toBeNull();
  });

  it('a capacitor measured only above its resonance reads as an inductor (type from the lowest frequency)', () => {
    // C 10 pF, ESL 0.38 nH resonates at 2.582 GHz; data 3 to 6 GHz has X > 0 throughout.
    const p = libraryPartFromData(
      partDataFromCircuit({ type: 'C', c: 10e-12, esl: 0.38e-9, esr: 0.2 }, 'series', [3e9, 6e9]),
      { manufacturer: 'QA', partNumber: 'ABOVE' },
    );
    expect(p.type).toBe('L');
    expect(partSrf(p)).toBeNull();
  });
});

describe('qa: the ends of the data range', () => {
  const p = libraryPartFromData(
    partDataFromCircuit({ type: 'C', c: 10e-12, esl: 0.38e-9, esr: 0.2 }, 'series', [1e9, 2e9]),
    { manufacturer: 'QA', partNumber: 'EDGE' },
  );
  const z1 = complex(0.2, TWO_PI * 1e9 * 0.38e-9 - 1 / (TWO_PI * 1e9 * 10e-12));

  it('a frequency within 1e-9 of an end takes the end sample; beyond it the part has no value', () => {
    close(partImpedance(p, 1e9 * (1 - 5e-10)) as Complex, z1.re, z1.im, 1e-8);
    expect(partImpedance(p, 1e9 * (1 - 2e-9))).toBeNull();
    expect(Number.isNaN(partAbcd(p, 'series', 1e9 * (1 - 2e-9)).b.re)).toBe(true);
    expect(partRangeProblem(p, 1e9 * (1 - 2e-9))).toMatch(/^below/);
    expect(partRangeProblem(p, 2e9 * (1 + 2e-9))).toMatch(/^above/);
    expect(partRangeProblem(p, 2e9 * (1 + 5e-10))).toBeNull();
  });

  it('zero, negative, NaN and Infinity give no value and never throw', () => {
    for (const f of [0, -1e9, NaN, Infinity, -Infinity]) {
      expect(partImpedance(p, f)).toBeNull();
      expect(partAt(p, f)).toBeNull();
      expect(Number.isNaN(partAbcd(p, 'shunt', f).c.re)).toBe(true);
    }
  });
});

describe('qa: file shapes the reader must refuse', () => {
  const row = (f: number): string => `${f} 0.1 0.3 0.9 -0.3 0.9 -0.3 0.1 0.3`;

  it('a single frequency', () => {
    expect(() => readPartFile(['# GHZ S RI R 50', row(1)].join('\n'), 'ONE.s2p')).toThrow(
      PartFileError,
    );
  });

  it('a repeated frequency (the Touchstone reader lets it through, the part reader must not)', () => {
    expect(() =>
      readPartFile(['# GHZ S RI R 50', row(1), row(1), row(2)].join('\n'), 'DUP.s2p'),
    ).toThrow(/strictly ascending/);
  });

  it('descending frequencies', () => {
    expect(() => readPartFile(['# GHZ S RI R 50', row(2), row(1)].join('\n'), 'DESC.s2p')).toThrow(
      /ascending/,
    );
  });

  it('a zero frequency', () => {
    expect(() => readPartFile(['# GHZ S RI R 50', row(0), row(1)].join('\n'), 'ZERO.s2p')).toThrow(
      /positive/,
    );
  });
});

describe('qa: Realize from the part library', () => {
  // Fitted-only capacitors without ESL: |X| = 1 / (w C) exactly at every frequency.
  const range: [number, number] = [1e6, 1e10];
  const c1 = circuitPart({ type: 'C', c: 1e-12, esl: 0, esr: 0 }, range, 'C1P');
  const c2 = circuitPart({ type: 'C', c: 2e-12, esl: 0, esr: 0 }, range, 'C2P');
  const c5 = circuitPart({ type: 'C', c: 5e-12, esl: 0, esr: 0 }, range, 'C5P');
  const l3 = circuitPart({ type: 'L', l: 3.3e-9, cp: 0, r: 0 }, range, 'L3N3');
  const f = 1e9;

  it('candidates for 3 pF from 1, 2 and 5 pF: 2 pF (log 1.5 = 0.405) then 5 pF (log 1/0.6 = 0.511)', () => {
    expect(libraryCandidates([c1, c2, c5], 'C', 3e-12, f).map((p) => p.partNumber)).toEqual([
      'C2P',
      'C5P',
    ]);
    // A part at exactly the ideal reactance is one candidate, not two.
    expect(libraryCandidates([c1, c2, c5], 'C', 2e-12, f).map((p) => p.partNumber)).toEqual([
      'C2P',
    ]);
    // Only one side present: one candidate.
    expect(libraryCandidates([c1, c2], 'C', 10e-12, f).map((p) => p.partNumber)).toEqual(['C2P']);
  });

  it('no candidates for an empty library, the other type, or bad inputs', () => {
    expect(libraryCandidates([], 'C', 3e-12, f)).toEqual([]);
    expect(libraryCandidates([c1, c2, c5], 'L', 3e-9, f)).toEqual([]);
    for (const [v, ff] of [
      [0, f],
      [-1e-12, f],
      [NaN, f],
      [Infinity, f],
      [3e-12, 0],
      [3e-12, NaN],
    ] as const) {
      expect(libraryCandidates([c1, c2, c5], 'C', v, ff)).toEqual([]);
    }
    // A part whose data stops below f is no candidate.
    const short = circuitPart({ type: 'C', c: 3e-12, esl: 0, esr: 0 }, [1e6, 0.5e9], 'SHORT');
    expect(libraryCandidates([short], 'C', 3e-12, f)).toEqual([]);
  });

  const ideal: Ladder = {
    z0: 50,
    frequency: f,
    load: complex(10, 0),
    elements: [
      { kind: 'L', orientation: 'series', value: 3.18e-9 },
      { kind: 'C', orientation: 'shunt', value: 12.7e-12 },
    ],
  };

  it('an empty library leaves every element exact and says the source is the library', () => {
    const r = realizeLadder(ideal, { source: { kind: 'library', parts: [] }, scope: 'all' });
    expect(r.ladder.elements).toEqual(ideal.elements);
    expect(r.sourceLabel).toBe('library');
    expect(r.elements.map((e) => e.parts[0]?.source)).toEqual(['exact', 'exact']);
  });

  it('a one-part library replaces the element of its type only, with the effective value as realized', () => {
    const r = realizeLadder(ideal, { source: { kind: 'library', parts: [l3] }, scope: 'all' });
    const [a, b] = r.ladder.elements;
    expect(a?.kind).toBe('part');
    if (a?.kind === 'part') {
      expect(a.part.partNumber).toBe('L3N3');
      expect(a.orientation).toBe('series');
    }
    expect(b).toEqual(ideal.elements[1]);
    // L 3.3 nH ideal: effective value 3.3 nH, deviation 3.3 / 3.18 - 1 = +3.774 %.
    const p = r.elements[0]?.parts[0];
    expect(p?.realized).toBeCloseTo(3.3e-9, 18);
    expect(p?.deviation).toBeCloseTo(3.3 / 3.18 - 1, 9);
    expect(r.elements[1]?.parts[0]?.source).toBe('exact');
  });

  it('scope R replaces nothing; scope C only the capacitor; pairs snaps L and C each on its own', () => {
    const lib = { kind: 'library' as const, parts: [l3, c1, c2, c5] };
    const none = realizeLadder(ideal, { source: lib, scope: 'R' });
    expect(none.ladder.elements).toEqual(ideal.elements);
    const onlyC = realizeLadder(ideal, { source: lib, scope: 'C' });
    expect(onlyC.ladder.elements[0]).toEqual(ideal.elements[0]);
    expect(onlyC.ladder.elements[1]?.kind).toBe('part');
    // An adjacent L and C of the same orientation: a pair for values, two parts for the library.
    const pair: Ladder = {
      ...ideal,
      elements: [
        { kind: 'L', orientation: 'series', value: 3.18e-9 },
        { kind: 'C', orientation: 'series', value: 3e-12 },
      ],
    };
    const pairs = realizeLadder(pair, { source: lib, scope: 'pairs' });
    expect(pairs.ladder.elements.map((e) => e.kind)).toEqual(['part', 'part']);
    expect(pairs.elements.every((e) => e.detuning === undefined)).toBe(true);
  });

  it('locks keep both elements exact; a placed library part is never replaced', () => {
    const lib = { kind: 'library' as const, parts: [l3, c1, c2, c5] };
    const locked = realizeLadder(ideal, { source: lib, scope: 'all', locked: [0, 1] });
    expect(locked.ladder.elements).toEqual(ideal.elements);
    const placed: Ladder = {
      ...ideal,
      elements: [{ kind: 'part', orientation: 'series', part: c5 }, ideal.elements[1] as Element],
    };
    const r = realizeLadder(placed, { source: lib, scope: 'all' });
    expect(r.ladder.elements[0]).toBe(placed.elements[0]);
  });
});

describe('qa: CKT netlist of a fitted-only part in DIM units (nH, pF, ohm)', () => {
  it('a capacitor in shunt: SRLC 1 0 R=0.2 L=0.38 C=10', () => {
    const p = circuitPart({ type: 'C', c: 10e-12, esl: 0.38e-9, esr: 0.2 }, [1e7, 1e10], 'QA-C');
    const text = writeNetlist({
      z0: 50,
      frequency: 1e9,
      load: complex(50, 0),
      elements: [{ kind: 'part', orientation: 'shunt', part: p }],
    });
    expect(text).toContain('\nSRLC 1 0 R=0.2 L=0.38 C=10\n');
    expect(text).toContain('! QA-C: fitted equivalent circuit');
  });

  it('an inductor in series: PRLC with Rp = (R^2 + (w L)^2) / R = 11279.9 ohm at 1 GHz', () => {
    // R 0.35, L 10 nH: w L = 62.831853, (0.1225 + 3947.8418) / 0.35 = 11279.898.
    const p = circuitPart({ type: 'L', l: 10e-9, cp: 0.08e-12, r: 0.35 }, [1e7, 1e10], 'QA-L');
    const text = writeNetlist({
      z0: 50,
      frequency: 1e9,
      load: complex(50, 0),
      elements: [{ kind: 'part', orientation: 'series', part: p }],
    });
    expect(text).toContain('\nPRLC 1 2 R=11279.9 L=10 C=0.08\n');
  });
});

describe('qa: stress of a library part against the circuit by hand', () => {
  // A lossless fitted-only 10 pF in a 50 ohm system at 1 GHz, 1 W available: Vs = sqrt(8 * 50 * 1) = 20 V.
  const c10 = circuitPart({ type: 'C', c: 10e-12, esl: 0, esr: 0 }, [1e7, 1e10], 'C10');
  const x = -1 / (TWO_PI * 1e9 * 10e-12); // -15.9155 ohm

  it('in series on 50 ohm: |I| = 20 / |100 + jX|, V = |I| |X|', () => {
    const s = ladderStress(
      {
        z0: 50,
        frequency: 1e9,
        load: complex(50, 0),
        elements: [{ kind: 'part', orientation: 'series', part: c10 }],
      },
      1,
    )[0];
    const i = 20 / Math.hypot(100, x);
    expect(s?.iRms).toBeCloseTo(i / Math.SQRT2, 9);
    expect(s?.vPeak).toBeCloseTo(i * Math.abs(x), 9);
    expect(s?.parts).toEqual([{ part: 'C', vPeak: s?.vPeak, iRms: s?.iRms }]);
  });

  it('in shunt across 50 ohm: V = |Vs Zin / (50 + Zin)|, I = V / |X|', () => {
    const s = ladderStress(
      {
        z0: 50,
        frequency: 1e9,
        load: complex(50, 0),
        elements: [{ kind: 'part', orientation: 'shunt', part: c10 }],
      },
      1,
    )[0];
    const zin = div([1, 0], [0.02, -1 / x]);
    const v = (20 * Math.hypot(zin[0], zin[1])) / Math.hypot(50 + zin[0], zin[1]);
    expect(s?.vPeak).toBeCloseTo(v, 9);
    expect(s?.iRms).toBeCloseTo(v / Math.abs(x) / Math.SQRT2, 9);
  });
});

describe('qa: BOM text from part names that came from someone else (a share link)', () => {
  it('a part number that a spreadsheet reads as a formula is not written as one', () => {
    // libraryPartOf keeps "=HYPERLINK(...)" (printable, under 80 characters); the recipient's BOM
    // export then starts a field with "=". OWASP: prefix such a field with a quote or a blank.
    const hostile = libraryPartOf({
      manufacturer: '+cmd',
      partNumber: '=HYPERLINK("http://example.invalid","x")',
      type: 'C',
      range: [1e7, 1e10],
      circuit: { type: 'C', c: 1e-11, esl: 0, esr: 0 },
    }) as LibraryPart;
    expect(hostile).not.toBeNull();
    const r = realizeLadder(
      {
        z0: 50,
        frequency: 1e9,
        load: complex(10, 0),
        elements: [{ kind: 'part', orientation: 'shunt', part: hostile }],
      },
      { source: { kind: 'series', series: 'E24' }, scope: 'all' },
    );
    const csv = bomCsv(bomRows(r));
    const fields = (csv.split('\n')[1] as string).split(';').map((f) => f.replace(/^"/, ''));
    for (const field of fields) expect(field, field).not.toMatch(/^[=+\-@]/);
  });
});

describe('qa: an asymmetric measured two-port keeps port 1 towards the source', () => {
  it('series 50 ohm then shunt 50 ohm at port 2: S11 0.2, S21 0.4, S22 -0.2 gives ABCD [2 50; 0.02 1]', () => {
    // Port 1 terminated view: 50 + 50 || 50 = 75 ohm, S11 = 25 / 125 = 0.2; port 2: 50 || 100,
    // S22 = -0.2; S21 = 2 / (A + B / Z0 + C Z0 + D) = 2 / 5 = 0.4.
    const text = [
      '# GHZ S RI R 50',
      '1 0.2 0 0.4 0 0.4 0 -0.2 0',
      '2 0.2 0 0.4 0 0.4 0 -0.2 0',
    ].join('\n');
    const { part } = readPartFile(text, 'ASYM.s2p', 'series');
    const m = partAbcd(part, 'series', 1.5e9);
    close(m.a, 2, 0, 1e-12);
    close(m.b, 50, 0, 1e-9);
    close(m.c, 0.02, 0, 1e-14);
    close(m.d, 1, 0, 1e-12);
  });
});
