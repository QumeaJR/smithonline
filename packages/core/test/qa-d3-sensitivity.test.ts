/**
 * QA (D3): sensitivity.ts beyond the existing finite-difference sweep. Hand
 * derivatives of single elements, a negative characteristic impedance (the
 * element models use |Z0|), total reflection, the band options, and
 * spreadShares with groups, unequal and clamped correlations and the normal
 * distribution, each against a hand calculation.
 */
import { describe, expect, it } from 'vitest';
import {
  bandSensitivity,
  cabs,
  complex,
  csub,
  ladderParameters,
  parameterValue,
  reflectionTowards,
  relativeSigma,
  sensitivityAt,
  spreadShares,
  zinWith,
  type Complex,
  type Element,
  type ParameterRef,
  type PointSensitivity,
} from '../src/index';

const Z0 = 50;
const F = 1e9;
const W = 2 * Math.PI * F;

function relErr(a: Complex, b: Complex): number {
  const scale = Math.max(cabs(a), cabs(b));
  return scale === 0 ? 0 : cabs(csub(a, b)) / scale;
}

describe('qa: single-element derivatives by hand', () => {
  it('series R before 50 ohm: Gamma = R / (R + 100), dGamma/dR = 100 / (R + 100)^2', () => {
    const els: Element[] = [{ kind: 'R', orientation: 'series', value: 50 }];
    const s = sensitivityAt(els, complex(50, 0), Z0, F);
    // R = 50: Gamma = 1/3, dGamma/dR = 100 / 150^2 = 0.0044444.
    expect(s.gamma.re).toBeCloseTo(1 / 3, 12);
    expect(s.dGamma[0]?.re).toBeCloseTo(100 / 22500, 12);
    expect(s.dGamma[0]?.im).toBeCloseTo(0, 12);
    // VSWR = 2, dVSWR/dR = 2 dG / (1 - G)^2 = 2 * 0.0044444 / (4/9) = 0.02 (VSWR = Zin / 50).
    expect(s.vswr).toBeCloseTo(2, 12);
    expect(s.dVswr[0]).toBeCloseTo(0.02, 12);
  });

  it('transformer: Zin = n^2 ZL, dZin/dn = 2 n ZL', () => {
    const els: Element[] = [{ kind: 'transformer', n: 2 }];
    const s = sensitivityAt(els, complex(10, 5), Z0, F);
    expect(s.zin.re).toBeCloseTo(40, 10);
    expect(s.zin.im).toBeCloseTo(20, 10);
    expect(s.dZin[0]?.re).toBeCloseTo(40, 10);
    expect(s.dZin[0]?.im).toBeCloseTo(20, 10);
  });

  it('shunt C on ZL: dZin/dC = -j w Zin^2', () => {
    const c = 2e-12;
    const zl = complex(30, 20);
    const els: Element[] = [{ kind: 'C', orientation: 'shunt', value: c }];
    const s = sensitivityAt(els, zl, Z0, F);
    // Y = 1/ZL + j w C.
    const y = complex(30 / 1300 + 0, -20 / 1300 + W * c);
    const m = y.re * y.re + y.im * y.im;
    const zin = complex(y.re / m, -y.im / m);
    const z2 = complex(zin.re * zin.re - zin.im * zin.im, 2 * zin.re * zin.im);
    const expected = complex(W * z2.im, -W * z2.re);
    expect(relErr(s.dZin[0] as Complex, expected)).toBeLessThan(1e-12);
  });

  it('series L with Q: dZ/dL = w / Q + j w', () => {
    const els: Element[] = [{ kind: 'L', orientation: 'series', value: 10e-9, q: 25 }];
    const s = sensitivityAt(els, complex(50, 0), Z0, F);
    expect(relErr(s.dZin[0] as Complex, complex(W / 25, W))).toBeLessThan(1e-12);
    // dZ/dQ = -w L / Q^2.
    expect(relErr(s.dZin[1] as Complex, complex((-W * 10e-9) / 625, 0))).toBeLessThan(1e-12);
  });
});

describe('qa: a negative characteristic impedance (the models use |Z0|)', () => {
  const load = complex(18, -27);
  const cases: { name: string; el: Element }[] = [
    { name: 'line', el: { kind: 'line', z0: -70, length: 0.11 } },
    { name: 'open stub', el: { kind: 'openStub', z0: -60, length: 0.09 } },
    { name: 'shorted stub', el: { kind: 'shortStub', z0: -45, length: 0.17 } },
  ];
  for (const { name, el } of cases) {
    it(`${name}: d/dZ0 agrees with a central difference`, () => {
      const els: Element[] = [{ kind: 'C', orientation: 'shunt', value: 1.2e-12 }, el];
      const ref: ParameterRef = { index: 1, parameter: 'z0' };
      const s = sensitivityAt(els, load, Z0, F, { parameters: [ref] });
      const v = parameterValue(el, 'z0');
      const h = Math.abs(v) * 1e-6;
      const up = zinWith(els, ref, v + h, load, F);
      const dn = zinWith(els, ref, v - h, load, F);
      const fd = complex((up.re - dn.re) / (2 * h), (up.im - dn.im) / (2 * h));
      expect(relErr(s.dZin[0] as Complex, fd)).toBeLessThan(1e-6);
    });
  }
});

describe('qa: total reflection and degenerate bands', () => {
  it('reports VSWR Infinity and dVSWR NaN for |Gamma| >= 1 (an active load)', () => {
    // ZL = -10 ohm behind a negligible series L: |Gamma| = 60 / 40 = 1.5.
    const els: Element[] = [{ kind: 'L', orientation: 'series', value: 1e-12 }];
    const s = sensitivityAt(els, complex(-10, 0), Z0, F);
    expect(s.gammaMag).toBeGreaterThan(1);
    expect(s.vswr).toBe(Infinity);
    expect(Number.isNaN(s.dVswr[0] as number)).toBe(true);
  });

  it('an empty band gives NaN for the worst case and the power mean', () => {
    const els: Element[] = [{ kind: 'L', orientation: 'series', value: 5e-9 }];
    const b = bandSensitivity(els, complex(25, 0), Z0, []);
    expect(b.points).toHaveLength(0);
    expect(Number.isNaN(b.worst.vswr)).toBe(true);
    expect(Number.isNaN(b.smooth.value)).toBe(true);
    expect(Number.isNaN(b.smooth.dValue[0] as number)).toBe(true);
  });

  it('order 1 is the arithmetic mean, weights 1/N; an order below 1 falls back to 32', () => {
    const els: Element[] = [{ kind: 'L', orientation: 'series', value: 5e-9 }];
    const freqs = [0.8e9, 1e9, 1.2e9];
    const b = bandSensitivity(els, complex(25, 0), Z0, freqs, { order: 1 });
    const mean = b.points.reduce((s, p) => s + p.vswr, 0) / 3;
    const dmean = b.points.reduce((s, p) => s + (p.dVswr[0] as number), 0) / 3;
    expect(Math.abs(b.smooth.value / mean - 1)).toBeLessThan(1e-12);
    expect(Math.abs((b.smooth.dValue[0] as number) / dmean - 1)).toBeLessThan(1e-12);
    for (const w of b.smooth.weights) expect(w).toBeCloseTo(1 / 3, 12);
    expect(bandSensitivity(els, complex(25, 0), Z0, freqs, { order: 0.5 }).smooth.order).toBe(32);
  });
});

describe('qa: spreadShares by hand', () => {
  // Two parts of value 1 with chosen dGamma, so a_i = dGamma_i * sigma.
  const els: Element[] = [
    { kind: 'L', orientation: 'series', value: 1 },
    { kind: 'C', orientation: 'series', value: 1 },
  ];
  const refs = ladderParameters(els);
  const base = sensitivityAt(els, complex(50, 0), Z0, F, { parameters: refs });
  const fake = (d: Complex[]): PointSensitivity => ({ ...base, dGamma: d });
  const s = relativeSigma(0.05, 'uniform'); // 0.05 / sqrt(3) = 0.0288675

  it('parts in different groups stay independent whatever their coefficients', () => {
    const tols = [
      { ref: refs[0] as ParameterRef, tolerance: 0.05, group: 'L', correlation: 0.9 },
      { ref: refs[1] as ParameterRef, tolerance: 0.05, group: 'C', correlation: 0.9 },
    ];
    const a = spreadShares(
      [fake([complex(1, 0), complex(-0.5, 0)])],
      [1],
      refs,
      tols,
      els,
      'uniform',
    );
    // Variances s^2 and 0.25 s^2: shares 0.8 and 0.2, RMS s sqrt(1.25).
    expect(a.shares[0]?.share).toBeCloseTo(0.8, 12);
    expect(a.shares[1]?.share).toBeCloseTo(0.2, 12);
    expect(a.rms).toBeCloseTo(s * Math.sqrt(1.25), 12);
  });

  it('two coefficients in one group: the smaller one is used', () => {
    const tols = [
      { ref: refs[0] as ParameterRef, tolerance: 0.05, group: 'X', correlation: 0.9 },
      { ref: refs[1] as ParameterRef, tolerance: 0.05, group: 'X', correlation: 0.3 },
    ];
    const a = spreadShares([fake([complex(1, 0), complex(1, 0)])], [1], refs, tols, els, 'uniform');
    // Var = s^2 (1 + 1 + 2 * 0.3) = 2.6 s^2.
    expect(a.rms).toBeCloseTo(s * Math.sqrt(2.6), 12);
  });

  it('a coefficient above 1 counts as 1', () => {
    const tols = refs.map((ref) => ({ ref, tolerance: 0.05, group: 'X', correlation: 1.5 }));
    const a = spreadShares([fake([complex(1, 0), complex(1, 0)])], [1], refs, tols, els, 'uniform');
    // Var = s^2 (2 + 2 * 1) = 4 s^2.
    expect(a.rms).toBeCloseTo(2 * s, 12);
  });

  it('uses a third of the band as sigma for the normal distribution', () => {
    const tols = [{ ref: refs[0] as ParameterRef, tolerance: 0.06 }];
    const a = spreadShares([fake([complex(0, 1), complex(0, 0)])], [1], refs, tols, els, 'normal');
    expect(a.rms).toBeCloseTo(0.02, 12);
    const u = spreadShares([fake([complex(0, 1), complex(0, 0)])], [1], refs, tols, els, 'uniform');
    expect(u.rms).toBeCloseTo(0.06 / Math.sqrt(3), 12);
    expect(a.shares[0]?.share).toBe(1);
  });

  it('skips parts without a tolerance, unknown parameters and frequencies without weight', () => {
    const tols = [
      { ref: refs[0] as ParameterRef, tolerance: 0.05 },
      { ref: refs[1] as ParameterRef, tolerance: 0 },
      { ref: { index: 7, parameter: 'value' } as ParameterRef, tolerance: 0.05 },
    ];
    const p1 = fake([complex(1, 0), complex(5, 0)]);
    const p2 = fake([complex(100, 0), complex(100, 0)]);
    const a = spreadShares([p1, p2], [1, 0], refs, tols, els, 'uniform');
    expect(a.shares).toHaveLength(1);
    expect(a.shares[0]?.share).toBe(1);
    expect(a.rms).toBeCloseTo(s, 12);
  });

  it('gives zero shares and RMS when nothing moves Gamma', () => {
    const tols = refs.map((ref) => ({ ref, tolerance: 0.05 }));
    const a = spreadShares([fake([complex(0, 0), complex(0, 0)])], [1], refs, tols, els, 'uniform');
    expect(a.rms).toBe(0);
    for (const sh of a.shares) expect(sh.share).toBe(0);
  });

  it('the shares add up to 1 with correlation, negative shares included', () => {
    const tols = refs.map((ref) => ({ ref, tolerance: 0.05, group: 'X', correlation: 0.7 }));
    const a = spreadShares(
      [fake([complex(1, 0.3), complex(-0.5, 0)])],
      [1],
      refs,
      tols,
      els,
      'uniform',
    );
    // Re(a1 conj a2) = -0.5 s^2: contributions (1.09 - 0.35) s^2 and (0.25 - 0.35) s^2.
    expect(a.shares.reduce((t, x) => t + x.share, 0)).toBeCloseTo(1, 12);
    expect(a.shares[0]?.share).toBeCloseTo(0.74 / 0.64, 12);
    expect(a.shares[1]?.share).toBeCloseTo(-0.1 / 0.64, 12);
  });

  it('reflectionTowards is the ordinary Gamma for the real Z0', () => {
    const g = reflectionTowards(complex(100, 0), 50);
    expect(g.re).toBeCloseTo(1 / 3, 15);
  });
});
