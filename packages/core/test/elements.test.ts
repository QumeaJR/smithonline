import { describe, expect, it } from 'vitest';
import {
  applyElement,
  branchImpedance,
  cabs,
  cascade,
  cclose,
  complex,
  csub,
  elementAbcd,
  elementArc,
  IDENTITY,
  isShunt,
  ladderAbcd,
  lineAttenuationNp,
  physicalLength,
  seriesAbcd,
  shuntAbcd,
  throughAbcd,
  transmissionS21,
  zToGamma,
  type Element,
  type LineElement,
} from '../src/index';

const F = 100e6;
const W = 2 * Math.PI * F;

describe('abcd', () => {
  it('cascades with the identity', () => {
    const m = seriesAbcd(complex(1, 2));
    expect(cascade(IDENTITY, m)).toEqual(m);
    expect(cascade(m, IDENTITY)).toEqual(m);
  });

  it('a series Z then a shunt Y gives Zin = 1 / (Y + 1 / (Z + ZL))', () => {
    const z = complex(0, 30);
    const y = complex(0, 0.01);
    const m = cascade(shuntAbcd(y), seriesAbcd(z));
    const zl = complex(50, 0);
    const zin = throughAbcd(m, zl);
    // By hand: Y1 = 1 / (50 + j30) = (50 - j30) / 3400, Y = Y1 + j0.01, Zin = 1 / Y.
    const yin = complex(50 / 3400, -30 / 3400 + 0.01);
    const d = yin.re * yin.re + yin.im * yin.im;
    expect(cclose(zin, complex(yin.re / d, -yin.im / d), 1e-9)).toBe(true);
  });

  it('S21 of a bare Z0 load is 0 dB and of a short is -Infinity', () => {
    expect(transmissionS21(IDENTITY, complex(50, 0), 50).db).toBeCloseTo(0, 12);
    expect(transmissionS21(IDENTITY, complex(0, 0), 50).db).toBe(-Infinity);
  });

  it('S21 through a 3 dB series resistor pad into 50 ohm', () => {
    // Series 50 ohm into a 50 ohm load from a 50 ohm source: V2 = Vs / 3,
    // S21 = 2 V2 / Vs = 2/3 = -3.52 dB.
    const m = seriesAbcd(complex(50, 0));
    expect(transmissionS21(m, complex(50, 0), 50).db).toBeCloseTo(20 * Math.log10(2 / 3), 10);
  });
});

describe('lumped elements', () => {
  it('series L of 2.39 nH at 2 GHz adds +30.03 ohm (Example 13)', () => {
    const z = applyElement(
      { kind: 'L', orientation: 'series', value: 2.39e-9 },
      complex(50, 0),
      2e9,
    );
    expect(z.re).toBeCloseTo(50, 12);
    expect(z.im).toBeCloseTo(30.033625768318426, 9);
  });

  it('series C of 39.2 pF at 150 MHz adds -27.07 ohm (Example 1)', () => {
    const z = applyElement(
      { kind: 'C', orientation: 'series', value: 39.2e-12 },
      complex(50, 0),
      150e6,
    );
    expect(z.im).toBeCloseTo(-1 / (2 * Math.PI * 150e6 * 39.2e-12), 9);
    expect(z.im).toBeCloseTo(-27.07, 2);
  });

  it('a shunt element adds admittance', () => {
    const el: Element = { kind: 'C', orientation: 'shunt', value: 10e-12 };
    const z = applyElement(el, complex(100, 0), F);
    const y = complex(1 / 100, W * 10e-12);
    expect(
      cclose(
        z,
        complex(
          (1 / (y.re * y.re + y.im * y.im)) * y.re,
          -(1 / (y.re * y.re + y.im * y.im)) * y.im,
        ),
        1e-9,
      ),
    ).toBe(true);
    expect(isShunt(el)).toBe(true);
    expect(isShunt({ kind: 'C', orientation: 'series', value: 1e-12 })).toBe(false);
  });

  it('series and shunt resistors', () => {
    expect(
      applyElement({ kind: 'R', orientation: 'series', value: 25 }, complex(50, 10), F),
    ).toEqual({
      re: 75,
      im: 10,
    });
    const z = applyElement({ kind: 'R', orientation: 'shunt', value: 50 }, complex(50, 0), F);
    expect(cclose(z, complex(25, 0))).toBe(true);
  });

  it('finite Q adds a series loss resistance', () => {
    const ideal = branchImpedance({ kind: 'L', orientation: 'series', value: 100e-9 }, W);
    const lossy = branchImpedance({ kind: 'L', orientation: 'series', value: 100e-9, q: 50 }, W);
    expect(ideal.re).toBe(0);
    expect(lossy.im).toBe(ideal.im);
    expect(lossy.re).toBeCloseTo(ideal.im / 50, 12);
    const cap = branchImpedance({ kind: 'C', orientation: 'series', value: 10e-12, q: 100 }, W);
    expect(cap.re).toBeCloseTo(Math.abs(cap.im) / 100, 12);
    expect(cap.re).toBeGreaterThan(0);
  });

  it('treats Q of 0 or Infinity as ideal', () => {
    expect(branchImpedance({ kind: 'L', orientation: 'series', value: 1e-9, q: 0 }, W).re).toBe(0);
    expect(
      branchImpedance({ kind: 'C', orientation: 'series', value: 1e-12, q: Infinity }, W).re,
    ).toBe(0);
  });

  it('zero-valued L and C behave as near-short and near-open', () => {
    expect(branchImpedance({ kind: 'L', orientation: 'series', value: 0 }, W).im).toBeCloseTo(0, 6);
    expect(
      Math.abs(branchImpedance({ kind: 'C', orientation: 'series', value: 0 }, W).im),
    ).toBeGreaterThan(1e5);
  });

  it('series-connected RLC: R + j(wL - 1/wC), resonant at 1/(2 pi sqrt(LC))', () => {
    const l = 100e-9;
    const c = 25.33e-12;
    const f0 = 1 / (2 * Math.PI * Math.sqrt(l * c));
    const el: Element = { kind: 'RLC', orientation: 'shunt', connection: 'series', r: 5, l, c };
    const z = branchImpedance(el, 2 * Math.PI * f0);
    expect(z.re).toBe(5);
    expect(z.im).toBeCloseTo(0, 6);
    // In shunt at resonance the branch is 5 ohm across the load.
    const zin = applyElement(el, complex(50, 0), f0);
    expect(zin.re).toBeCloseTo((50 * 5) / 55, 6);
  });

  it('parallel-connected RLC: Y = 1/R + j(wC - 1/wL), open at resonance except for R', () => {
    const l = 100e-9;
    const c = 25.33e-12;
    const f0 = 1 / (2 * Math.PI * Math.sqrt(l * c));
    const el: Element = {
      kind: 'RLC',
      orientation: 'series',
      connection: 'parallel',
      r: 1000,
      l,
      c,
    };
    const z = branchImpedance(el, 2 * Math.PI * f0);
    expect(z.re).toBeCloseTo(1000, 3);
    expect(Math.abs(z.im)).toBeLessThan(1e-3);
    expect(applyElement(el, complex(50, 0), f0).re).toBeCloseTo(1050, 3);
  });

  it('omitted RLC parts contribute nothing', () => {
    const series = branchImpedance(
      { kind: 'RLC', orientation: 'series', connection: 'series', r: 10 },
      W,
    );
    expect(series).toEqual({ re: 10, im: 0 });
    const parallel = branchImpedance(
      { kind: 'RLC', orientation: 'series', connection: 'parallel', l: 10e-9 },
      W,
    );
    expect(parallel.re).toBeCloseTo(0, 12);
    expect(parallel.im).toBeCloseTo(W * 10e-9, 12);
  });
});

describe('transformer', () => {
  it('scales the impedance by n squared', () => {
    const z = applyElement({ kind: 'transformer', n: 2 }, complex(12.5, -5), F);
    expect(cclose(z, complex(50, -20), 1e-12)).toBe(true);
    const m = elementAbcd({ kind: 'transformer', n: 0.5 }, F);
    expect(cclose(throughAbcd(m, complex(200, 0)), complex(50, 0), 1e-12)).toBe(true);
  });
});

describe('transmission lines and stubs', () => {
  it('quarter wave 50 ohm line inverts 25 ohm to 100 ohm', () => {
    const el: Element = { kind: 'line', z0: 50, length: 0.25 };
    const z = applyElement(el, complex(25, 0), F);
    expect(cclose(z, complex(100, 0), 1e-9)).toBe(true);
  });

  it('half wave line is transparent', () => {
    const z = applyElement({ kind: 'line', z0: 75, length: 0.5 }, complex(30, -40), F);
    expect(cclose(z, complex(30, -40), 1e-9)).toBe(true);
  });

  it('lossless 0.2081 wavelength line transforms 30 - j40 to 21.40 + j24.67 (Example 8)', () => {
    const z = applyElement(
      { kind: 'line', z0: 50, length: 0.2081, refFrequency: 430e6 },
      complex(30, -40),
      430e6,
    );
    expect(z.re).toBeCloseTo(21.397549065173276, 9);
    expect(z.im).toBeCloseTo(24.66582801230037, 9);
  });

  it('electrical length scales with frequency through refFrequency', () => {
    const el: Element = { kind: 'line', z0: 50, length: 0.125, refFrequency: F };
    const atDouble = applyElement(el, complex(25, 0), 2 * F);
    const quarter = applyElement({ kind: 'line', z0: 50, length: 0.25 }, complex(25, 0), F);
    expect(cclose(atDouble, quarter, 1e-9)).toBe(true);
  });

  it('lossy line: physical length and attenuation follow the Dellsperger model', () => {
    const el: LineElement = {
      kind: 'line',
      z0: 50,
      length: 2.006,
      refFrequency: 500e6,
      er: 2.1,
      alphaDbPerM: 2,
    };
    const lambda0 = 299792458 / 500e6;
    expect(physicalLength(el, 500e6)).toBeCloseTo((2.006 * lambda0) / Math.sqrt(2.1), 12);
    const np = lineAttenuationNp(el, 500e6);
    expect(np).toBeCloseTo((2 * physicalLength(el, 500e6)) / (20 * Math.LOG10E), 12);
    // Away from the design frequency the attenuation scales with sqrt(f / f0).
    expect(lineAttenuationNp(el, 2e9)).toBeCloseTo(np * 2, 12);
  });

  it('lossy line: Example 15 to the stored precision, and a matched line loses exactly its attenuation', () => {
    const el: LineElement = {
      kind: 'line',
      z0: 50,
      length: 2.006,
      refFrequency: 500e6,
      er: 2.1,
      alphaDbPerM: 2,
    };
    const z = applyElement(el, complex(23.7, -101), 500e6);
    expect(z.re).toBeCloseTo(50.69, 0);
    expect(z.im).toBeCloseTo(-69.78, 0);
    const matched: Element = {
      kind: 'line',
      z0: 50,
      length: 1,
      refFrequency: F,
      er: 1,
      alphaDbPerM: 3,
    };
    expect(cclose(applyElement(matched, complex(50, 0), F), complex(50, 0), 1e-9)).toBe(true);
    const s21 = transmissionS21(elementAbcd(matched, F), complex(50, 0), 50);
    expect(s21.db).toBeCloseTo(-3 * physicalLength(matched, F), 9);
  });

  it('open stub Y = j Y0 tan(bl), shorted stub Y = -j Y0 cot(bl)', () => {
    const open: Element = { kind: 'openStub', z0: 50, length: 0.125 };
    const short: Element = { kind: 'shortStub', z0: 50, length: 0.125 };
    // An eighth wave open stub is a shunt -j50; across 50 ohm that is 25 - j25.
    expect(cclose(applyElement(open, complex(50, 0), F), complex(25, -25), 1e-9)).toBe(true);
    expect(cclose(applyElement(short, complex(50, 0), F), complex(25, 25), 1e-9)).toBe(true);
    expect(isShunt(open)).toBe(true);
  });

  it('open stub of 0.1365 wavelengths matches 21.40 + j24.67 (Example 9)', () => {
    const z = applyElement(
      { kind: 'openStub', z0: 50, length: 0.13654032872444805, refFrequency: 430e6 },
      complex(21.397549065173276, 24.66582801230037),
      430e6,
    );
    // The original computed the stored value from single-precision inputs,
    // hence 1e-5 rather than 1e-9 here.
    expect(z.re).toBeCloseTo(49.830857318586162, 5);
    expect(z.im).toBeCloseTo(0, 5);
  });
});

describe('element arcs', () => {
  it('start at the input node and end at the output node', () => {
    const els: Element[] = [
      { kind: 'L', orientation: 'series', value: 20e-9 },
      { kind: 'C', orientation: 'shunt', value: 20e-12 },
      { kind: 'line', z0: 50, length: 0.2 },
      { kind: 'shortStub', z0: 50, length: 0.1 },
      { kind: 'transformer', n: 3 },
      { kind: 'RLC', orientation: 'series', connection: 'parallel', r: 100, l: 10e-9, c: 10e-12 },
    ];
    const z = complex(30, -40);
    for (const el of els) {
      const arc = elementArc(el, z, F, 8);
      expect(arc).toHaveLength(9);
      expect(cclose(arc[0]!, z, 1e-9)).toBe(true);
      expect(cclose(arc[8]!, applyElement(el, z, F), 1e-9)).toBe(true);
    }
  });

  it('a series reactance keeps R constant and a shunt susceptance keeps G constant', () => {
    const z = complex(30, -40);
    for (const p of elementArc({ kind: 'L', orientation: 'series', value: 20e-9 }, z, F, 10)) {
      expect(p.re).toBeCloseTo(30, 12);
    }
    const g = 30 / (30 * 30 + 40 * 40);
    for (const p of elementArc({ kind: 'C', orientation: 'shunt', value: 20e-12 }, z, F, 10)) {
      expect(1 / p.re === 0 ? 0 : p.re / (p.re * p.re + p.im * p.im)).toBeCloseTo(g, 12);
    }
  });

  it('a lossless line keeps |Gamma| constant', () => {
    const z = complex(30, -40);
    const g0 = cabs(zToGamma(z, 50));
    for (const p of elementArc({ kind: 'line', z0: 50, length: 0.3 }, z, F, 16)) {
      expect(cabs(zToGamma(p, 50))).toBeCloseTo(g0, 9);
    }
  });
});

describe('ladderAbcd', () => {
  it('equals the cascade of the element matrices, load side first', () => {
    const a: Element = { kind: 'L', orientation: 'series', value: 20e-9 };
    const b: Element = { kind: 'C', orientation: 'shunt', value: 20e-12 };
    const total = ladderAbcd([a, b], F);
    const manual = cascade(elementAbcd(b, F), elementAbcd(a, F));
    for (const key of ['a', 'b', 'c', 'd'] as const) {
      expect(cabs(csub(total[key], manual[key]))).toBeLessThan(1e-12);
    }
  });
});
