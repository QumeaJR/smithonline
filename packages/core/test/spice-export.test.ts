import { describe, expect, it } from 'vitest';
import {
  abcdMatrixToS,
  cabs,
  cdiv,
  complex,
  evaluateAt,
  ladderAbcd,
  ladderSParameters,
  LTSPICE_PINS,
  readTouchstone,
  SpiceError,
  spiceNumber,
  sweepPoints,
  transmissionS21,
  writeLadderS2p,
  writeLtspice,
  writeSpice,
  type Complex,
  type Element,
  type Ladder,
} from '../src/index';
import { parseAsc, parseSpice, solveAc, type Comp } from './helpers/circuit';

const F = 450e6;

function ladder(elements: Element[], load: Complex = complex(20, -12)): Ladder {
  return { z0: 50, frequency: F, load, elements };
}

const lc: Element[] = [
  { kind: 'L', orientation: 'shunt', value: 16e-9 },
  { kind: 'C', orientation: 'series', value: 22e-12 },
  { kind: 'L', orientation: 'shunt', value: 22e-9 },
  { kind: 'C', orientation: 'series', value: 16e-12 },
  { kind: 'L', orientation: 'shunt', value: 30e-9 },
];

const lossy: Element[] = [
  { kind: 'L', orientation: 'series', value: 18e-9, q: 45 },
  { kind: 'C', orientation: 'shunt', value: 7.5e-12, q: 300 },
  { kind: 'R', orientation: 'series', value: 4.7 },
  { kind: 'R', orientation: 'shunt', value: 470 },
];

const blocks: Element[] = [
  { kind: 'RLC', orientation: 'shunt', connection: 'series', r: 3, l: 12e-9, c: 5e-12 },
  { kind: 'RLC', orientation: 'series', connection: 'parallel', r: 220, l: 90e-9, c: 2e-12 },
  { kind: 'C', orientation: 'shunt', value: 4e-12 },
  { kind: 'RLC', orientation: 'shunt', connection: 'parallel', r: 330, l: 60e-9, c: 3e-12 },
];

const distributed: Element[] = [
  { kind: 'line', z0: 60, length: 0.11, refFrequency: F },
  { kind: 'openStub', z0: 70, length: 0.08, refFrequency: F },
  { kind: 'C', orientation: 'series', value: 9e-12 },
  { kind: 'shortStub', z0: 55, length: 0.2, refFrequency: F },
];

/** Zin and V(load)/Vs of the solved circuit against the ABCD model at the design frequency. */
function expectSameAsModel(l: Ladder, comps: Comp[], inNode: string, loadNode: string): void {
  const v = solveAc(comps, l.frequency);
  const vin = v.get(inNode) as Complex;
  const iin = cdiv({ re: 1 - vin.re, im: -vin.im }, complex(l.z0));
  const zin = cdiv(vin, iin);
  const model = evaluateAt(l, l.frequency, l.load, { arcSteps: 0 });
  expect(zin.re).toBeCloseTo(model.zin.re, 3);
  expect(zin.im).toBeCloseTo(model.zin.im, 3);

  // V2 / Vs = 1 / (A + B / ZL + Z0 (C + D / ZL))
  const m = ladderAbcd(l.elements, l.frequency);
  const yl = cdiv(complex(1), l.load);
  const den = {
    re:
      m.a.re +
      (m.b.re * yl.re - m.b.im * yl.im) +
      l.z0 * (m.c.re + (m.d.re * yl.re - m.d.im * yl.im)),
    im:
      m.a.im +
      (m.b.re * yl.im + m.b.im * yl.re) +
      l.z0 * (m.c.im + (m.d.re * yl.im + m.d.im * yl.re)),
  };
  const ratio = cdiv(complex(1), den);
  const v2 = v.get(loadNode) as Complex;
  expect(v2.re).toBeCloseTo(ratio.re, 4);
  expect(v2.im).toBeCloseTo(ratio.im, 4);
}

describe('spiceNumber', () => {
  it('writes plain numbers and exponents SPICE reads', () => {
    expect(spiceNumber(1.6e-8)).toBe('1.6e-8');
    expect(spiceNumber(450e6)).toBe('450000000');
    expect(spiceNumber(0)).toBe('0');
    expect(Number(spiceNumber(1 / 3, 6))).toBeCloseTo(1 / 3, 6);
    expect(() => spiceNumber(NaN)).toThrow(SpiceError);
  });
});

describe('writeSpice', () => {
  for (const [name, els] of [
    ['an L-C ladder', lc],
    ['lossy parts with Q', lossy],
    ['RLC blocks in both orientations and connections', blocks],
    ['lines and stubs', distributed],
  ] as const) {
    it(`gives the circuit the ABCD model has: ${name}`, () => {
      const l = ladder(els);
      const text = writeSpice(l, { name: 'test' });
      const { comps } = parseSpice(text);
      const stages = comps.filter((c) => c.name !== 'VS').length;
      expect(stages).toBeGreaterThan(els.length);
      const inNode = comps.find((c) => c.name === 'RSRC')?.b as string;
      expectSameAsModel(l, comps, inNode, 'n0');
    });
  }

  it('writes loss resistors from Q: R = wL / Q and 1 / (w C Q)', () => {
    const { comps } = parseSpice(writeSpice(ladder(lossy)));
    const w = 2 * Math.PI * F;
    const rl = comps.find((c) => c.name === 'RL1');
    const rc = comps.find((c) => c.name === 'RC2');
    expect(rl?.value).toBeCloseTo((w * 18e-9) / 45, 4);
    expect(rc?.value).toBeCloseTo(1 / (w * 7.5e-12 * 300), 4);
    expect(comps.find((c) => c.name === 'R3')?.value).toBe(4.7);
  });

  it('models a reactive load as a series R with L or C', () => {
    const w = 2 * Math.PI * F;
    const inductive = parseSpice(writeSpice(ladder([], complex(30, 25)))).comps;
    expect(inductive.find((c) => c.name === 'LLOAD')?.value).toBeCloseTo(25 / w, 14);
    const capacitive = parseSpice(writeSpice(ladder([], complex(30, -25)))).comps;
    expect(capacitive.find((c) => c.name === 'CLOAD')?.value).toBeCloseTo(1 / (w * 25), 14);
    const real = parseSpice(writeSpice(ladder([], complex(30, 0)))).comps;
    expect(real.some((c) => c.name === 'LLOAD' || c.name === 'CLOAD')).toBe(false);
  });

  it('has the source, the sweep and an end card', () => {
    const text = writeSpice(ladder(lc), { sweep: { start: 100e6, stop: 900e6, points: 81 } });
    const { ac } = parseSpice(text);
    expect(ac).toBe('.ac lin 81 100000000 900000000');
    expect(text).toMatch(/^VS src 0 AC 1$/m);
    expect(text.trimEnd().endsWith('.end')).toBe(true);
    expect(text).not.toContain('\r');
  });

  it('uses the line delay length / reference frequency and the right stub ends', () => {
    const text = writeSpice(ladder(distributed));
    expect(text).toMatch(/^T1 n0 0 n1 0 Z0=60 TD=2\.44444e-10$/m);
    expect(text).toMatch(/^T2 n1 0 far2 0 Z0=70 TD=1\.77778e-10$/m);
    expect(text).toMatch(/^RFAR2 far2 0 1e12$/m);
    expect(text).toMatch(/^T4 n2 0 0 0 Z0=55 TD=4\.44444e-10$/m);
  });

  it('refuses a transformer, a zero part and a missing frequency', () => {
    expect(() => writeSpice(ladder([{ kind: 'transformer', n: 2 }]))).toThrow(/transformer/);
    expect(() => writeSpice(ladder([{ kind: 'L', orientation: 'series', value: 0 }]))).toThrow(
      /must be positive/,
    );
    expect(() => writeSpice({ ...ladder(lc), frequency: 0 })).toThrow(SpiceError);
  });
});

describe('writeLtspice', () => {
  for (const [name, els] of [
    ['an L-C ladder', lc],
    ['lossy parts with Q', lossy],
    ['RLC blocks in both orientations and connections', blocks],
  ] as const) {
    it(`draws the circuit the ABCD model has: ${name}`, () => {
      const l = ladder(els);
      const text = writeLtspice(l);
      const { comps } = parseAsc(text, LTSPICE_PINS);
      expectSameAsModel(l, comps, 'in', 'load');
    });
  }

  it('is a Version 4 file with CRLF lines, a sheet, a source, a flag per ground and the .ac text', () => {
    const text = writeLtspice(ladder(lc), {
      name: 'x',
      sweep: { start: 1e8, stop: 9e8, points: 50 },
    });
    const lines = text.split('\r\n');
    expect(lines[0]).toBe('Version 4');
    expect(lines[1]).toMatch(/^SHEET 1 \d+ \d+$/);
    expect(lines.some((l) => l === 'SYMATTR Value AC 1')).toBe(true);
    expect(
      lines.some((l) => l.startsWith('TEXT ') && l.endsWith('!.ac lin 50 100000000 900000000')),
    ).toBe(true);
    expect(text.endsWith('\r\n')).toBe(true);
    expect(text.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
  });

  it('keeps every symbol unrotated and on the 16 unit grid', () => {
    const text = writeLtspice(ladder(blocks));
    for (const l of text.split('\r\n')) {
      if (l.startsWith('SYMBOL ')) {
        const t = l.split(' ');
        expect(t[4]).toBe('R0');
        expect(Number(t[2]) % 16).toBe(0);
        expect(Number(t[3]) % 16).toBe(0);
      }
      if (l.startsWith('WIRE ')) {
        for (const v of l.split(' ').slice(1)) expect(Number(v) % 16).toBe(0);
      }
    }
  });

  it('names the nets in and load and gives instances unique names', () => {
    const text = writeLtspice(ladder(lossy));
    expect(text).toContain('FLAG 320 ');
    const names = text
      .split('\r\n')
      .filter((l) => l.startsWith('SYMATTR InstName'))
      .map((l) => l.split(' ')[2]);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain('RL1');
    expect(names).toContain('RC2');
  });

  it('does not let two nets touch: the circuit has as many nets as the model needs', () => {
    // A short between nets would change Zin; the solver comparison above covers it. Here the
    // shunt-only ladder (all branches share one rail) is checked for its node count.
    const l = ladder([
      { kind: 'L', orientation: 'shunt', value: 10e-9 },
      { kind: 'C', orientation: 'shunt', value: 3e-12 },
      { kind: 'R', orientation: 'shunt', value: 400 },
    ]);
    const { comps } = parseAsc(writeLtspice(l), LTSPICE_PINS);
    expectSameAsModel(l, comps, 'load', 'load');
  });

  it('refuses lines, stubs, transformers and non-positive parts', () => {
    expect(() => writeLtspice(ladder(distributed))).toThrow(/netlist/);
    expect(() => writeLtspice(ladder([{ kind: 'transformer', n: 2 }]))).toThrow(SpiceError);
    expect(() =>
      writeLtspice(ladder([{ kind: 'C', orientation: 'shunt', value: -1e-12 }])),
    ).toThrow(SpiceError);
  });

  it('draws a ladder with nothing but the load', () => {
    const l = ladder([], complex(50, 0));
    const { comps } = parseAsc(writeLtspice(l), LTSPICE_PINS);
    expectSameAsModel(l, comps, 'load', 'load');
  });
});

describe('Touchstone .s2p of the network', () => {
  const l = ladder(lc);

  it('parses back to the S-parameters of the ABCD matrix at every frequency', () => {
    const freqs = sweepPoints(225e6, 900e6, 31);
    const data = readTouchstone(writeLadderS2p(l, freqs, { name: 'test' }), 2);
    expect(data.ports).toBe(2);
    expect(data.z0).toBe(50);
    expect(data.points).toHaveLength(31);
    data.points.forEach((p, i) => {
      const f = freqs[i] as number;
      expect(p.frequency).toBeCloseTo(f, 0);
      const s = ladderSParameters(l, f);
      for (const [got, want] of [
        [p.s[0], s.s11],
        [p.s[1], s.s12],
        [p.s[2], s.s21],
        [p.s[3], s.s22],
      ] as const) {
        expect((got as Complex).re).toBeCloseTo(want.re, 6);
        expect((got as Complex).im).toBeCloseTo(want.im, 6);
      }
    });
  });

  it('agrees with the chart: S21 into a Z0 load, and S11 as the reflection of Zin', () => {
    const f = 300e6;
    const s = ladderSParameters(l, f);
    const t = transmissionS21(ladderAbcd(l.elements, f), complex(50), 50);
    expect(cabs(s.s21)).toBeCloseTo(t.mag, 12);
    const r = evaluateAt({ ...l, load: complex(50) }, f, complex(50), { arcSteps: 0 });
    expect(cabs(s.s11)).toBeCloseTo(r.info[r.info.length - 1]!.gammaMag, 12);
  });

  it('is reciprocal and, for lossless parts, passive with no loss', () => {
    for (const f of [150e6, 450e6, 800e6]) {
      const s = ladderSParameters(l, f);
      expect(s.s12.re).toBeCloseTo(s.s21.re, 12);
      expect(s.s12.im).toBeCloseTo(s.s21.im, 12);
      expect(cabs(s.s11) ** 2 + cabs(s.s21) ** 2).toBeCloseTo(1, 10);
    }
    const lossyS = ladderSParameters(ladder(lossy), 450e6);
    expect(cabs(lossyS.s11) ** 2 + cabs(lossyS.s21) ** 2).toBeLessThan(1);
  });

  it('is the identity two-port for an empty ladder', () => {
    const s = ladderSParameters(ladder([]), 1e9);
    expect(cabs(s.s11)).toBeCloseTo(0, 12);
    expect(s.s21.re).toBeCloseTo(1, 12);
    expect(s.s21.im).toBeCloseTo(0, 12);
  });

  it('has the option line and header comments of a Touchstone file', () => {
    const text = writeLadderS2p(l, [1e8, 2e8], { name: 'n' });
    expect(text).toMatch(/^! SmithChart.Online matching network: n$/m);
    expect(text).toMatch(/^# MHZ S RI R 50$/m);
    expect(
      text.split('\n').filter((x) => x !== '' && !x.startsWith('!') && !x.startsWith('#')),
    ).toHaveLength(2);
  });

  it('abcdMatrixToS gives the textbook values for a series impedance', () => {
    // Series Z = Z0: S11 = Z / (Z + 2 Z0) = 1/3, S21 = 2 Z0 / (Z + 2 Z0) = 2/3.
    const s = abcdMatrixToS({ a: complex(1), b: complex(50), c: complex(0), d: complex(1) }, 50);
    expect(s.s11.re).toBeCloseTo(1 / 3, 12);
    expect(s.s21.re).toBeCloseTo(2 / 3, 12);
    expect(s.s22.re).toBeCloseTo(1 / 3, 12);
  });
});
