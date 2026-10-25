/**
 * D3: the analytic derivatives of sensitivity.ts against central finite
 * differences, for every element kind and parameter: R, L and C with and
 * without Q, packaged inductors and capacitors (Cp, ESR, ESL, pads) in
 * series and in shunt, RLC blocks of both connections in both orientations,
 * the transformer, lossless and lossy lines (length and Z0, with and without
 * a reference frequency) and open and shorted stubs (length and Z0).
 */
import { describe, expect, it } from 'vitest';
import {
  bandSensitivity,
  cabs,
  complex,
  csub,
  elementParameters,
  ladderParameters,
  lMatch,
  monteCarlo,
  parameterValue,
  reflectionTowards,
  relativeSigma,
  sensitivityAt,
  spreadShares,
  sweepPoints,
  withParameter,
  zinWith,
  type Complex,
  type Element,
  type ParameterRef,
} from '../src/index';

const Z0 = 50;
const F = 1e9;

/** Every element kind and variant the derivatives must handle. */
const KINDS: readonly { readonly name: string; readonly el: Element }[] = [
  { name: 'series R', el: { kind: 'R', orientation: 'series', value: 22 } },
  { name: 'shunt R', el: { kind: 'R', orientation: 'shunt', value: 180 } },
  { name: 'series L ideal', el: { kind: 'L', orientation: 'series', value: 6.8e-9 } },
  { name: 'shunt L with Q', el: { kind: 'L', orientation: 'shunt', value: 12e-9, q: 40 } },
  { name: 'series C with Q', el: { kind: 'C', orientation: 'series', value: 3.3e-12, q: 300 } },
  { name: 'shunt C ideal', el: { kind: 'C', orientation: 'shunt', value: 2.2e-12 } },
  {
    name: 'series L packaged (Cp, ESR, pads) with Q',
    el: {
      kind: 'L',
      orientation: 'series',
      value: 8.2e-9,
      q: 35,
      package: '0402',
      parasitics: { cp: 0.08e-12, esr: 0.3, pad: 0.03e-12 },
    },
  },
  {
    name: 'shunt L packaged wire-wound',
    el: {
      kind: 'L',
      orientation: 'shunt',
      value: 15e-9,
      package: 'wirewound',
      parasitics: { cp: 1e-12, esr: 0.1, pad: 0.3e-12 },
    },
  },
  {
    name: 'series C packaged (ESL, pads) with Q',
    el: {
      kind: 'C',
      orientation: 'series',
      value: 4.7e-12,
      q: 200,
      package: '0603',
      parasitics: { esl: 0.6e-9, pad: 0.07e-12 },
    },
  },
  {
    name: 'shunt C packaged',
    el: {
      kind: 'C',
      orientation: 'shunt',
      value: 1.5e-12,
      package: '0805',
      parasitics: { esl: 0.9e-9, pad: 0.1e-12 },
    },
  },
  {
    name: 'series RLC, parallel connection',
    el: { kind: 'RLC', orientation: 'series', connection: 'parallel', r: 400, l: 20e-9, c: 1e-12 },
  },
  {
    name: 'shunt RLC, series connection',
    el: { kind: 'RLC', orientation: 'shunt', connection: 'series', r: 5, l: 10e-9, c: 3e-12 },
  },
  {
    name: 'series RLC, series connection, no R',
    el: { kind: 'RLC', orientation: 'series', connection: 'series', l: 4e-9, c: 8e-12 },
  },
  {
    name: 'shunt RLC, parallel connection',
    el: { kind: 'RLC', orientation: 'shunt', connection: 'parallel', r: 900, l: 30e-9, c: 0.5e-12 },
  },
  { name: 'transformer', el: { kind: 'transformer', n: 1.4 } },
  { name: 'line lossless, no reference', el: { kind: 'line', z0: 70, length: 0.11 } },
  {
    name: 'line lossy on a substrate',
    el: { kind: 'line', z0: 35, length: 0.18, refFrequency: 0.8e9, er: 3.66, alphaDbPerM: 4 },
  },
  { name: 'open stub', el: { kind: 'openStub', z0: 60, length: 0.09, refFrequency: 1.1e9 } },
  { name: 'shorted stub', el: { kind: 'shortStub', z0: 45, length: 0.17 } },
];

/** A ladder with the element under test between other parts, so the product rule is exercised. */
function ladderAround(el: Element): Element[] {
  return [
    { kind: 'L', orientation: 'series', value: 3e-9, q: 60 },
    el,
    { kind: 'C', orientation: 'shunt', value: 1.2e-12 },
    { kind: 'line', z0: 55, length: 0.05, refFrequency: F },
  ];
}

const LOAD = complex(18, -27);

/** Central difference of Zin by one parameter, relative step h. */
function fdZin(elements: readonly Element[], ref: ParameterRef, f: number, h = 1e-5): Complex {
  const v = parameterValue(elements[ref.index] as Element, ref.parameter);
  const dv = Math.abs(v) * h;
  const up = zinWith(elements, ref, v + dv, LOAD, f);
  const down = zinWith(elements, ref, v - dv, LOAD, f);
  return complex((up.re - down.re) / (2 * dv), (up.im - down.im) / (2 * dv));
}

function relErr(a: Complex, b: Complex): number {
  const scale = Math.max(cabs(a), cabs(b));
  return scale === 0 ? 0 : cabs(csub(a, b)) / scale;
}

describe('sensitivity: analytic against finite differences', () => {
  let worstErr = 0;
  for (const { name, el } of KINDS) {
    it(`${name}: every parameter, three frequencies`, () => {
      const elements = ladderAround(el);
      const params = elementParameters(el);
      expect(params.length).toBeGreaterThan(0);
      for (const f of [0.7e9, 1e9, 1.45e9]) {
        const s = sensitivityAt(elements, LOAD, Z0, f);
        const refs = ladderParameters(elements);
        refs.forEach((ref, i) => {
          const fd = fdZin(elements, ref, f);
          const err = relErr(s.dZin[i] as Complex, fd);
          worstErr = Math.max(worstErr, err);
          expect(err, `${name} ${ref.index}:${ref.parameter} at ${f}`).toBeLessThan(1e-6);
          // Gamma and VSWR follow by the chain rule; checked against their own differences.
          const v = parameterValue(elements[ref.index] as Element, ref.parameter);
          const dv = Math.abs(v) * 1e-5;
          const gUp = reflectionTowards(zinWith(elements, ref, v + dv, LOAD, f), Z0);
          const gDn = reflectionTowards(zinWith(elements, ref, v - dv, LOAD, f), Z0);
          const fdG = complex((gUp.re - gDn.re) / (2 * dv), (gUp.im - gDn.im) / (2 * dv));
          expect(relErr(s.dGamma[i] as Complex, fdG)).toBeLessThan(1e-6);
          const vs = (g: Complex): number => (1 + cabs(g)) / (1 - cabs(g));
          const fdV = (vs(gUp) - vs(gDn)) / (2 * dv);
          const scale = Math.max(Math.abs(fdV), Math.abs(s.dVswr[i] as number), 1e-300);
          expect(Math.abs((s.dVswr[i] as number) - fdV) / scale).toBeLessThan(1e-6);
        });
      }
    });
  }

  it('reports the worst relative error over all kinds below 1e-6', () => {
    expect(worstErr).toBeGreaterThan(0);
    expect(worstErr).toBeLessThan(1e-6);
  });

  it('lists the parameters of each kind', () => {
    const names = (el: Element): string => elementParameters(el).join(',');
    expect(names({ kind: 'L', orientation: 'series', value: 1e-9 })).toBe('value');
    expect(names({ kind: 'L', orientation: 'series', value: 1e-9, q: 30 })).toBe('value,q');
    expect(names({ kind: 'C', orientation: 'series', value: 1e-12, q: Infinity })).toBe('value');
    expect(names({ kind: 'RLC', orientation: 'shunt', connection: 'series', l: 1e-9 })).toBe('l');
    expect(names({ kind: 'line', z0: 50, length: 0.1 })).toBe('length,z0');
    expect(names({ kind: 'openStub', z0: 50, length: 0.1 })).toBe('length,z0');
    expect(names({ kind: 'transformer', n: 2 })).toBe('n');
    expect(names({ kind: 'R', orientation: 'series', value: 0 })).toBe('');
    const el: Element = {
      kind: 'RLC',
      orientation: 'shunt',
      connection: 'series',
      r: 1,
      l: 2,
      c: 3,
    };
    expect(parameterValue(withParameter(el, 'l', 7), 'l')).toBe(7);
  });

  it('works towards a complex target', () => {
    const elements = ladderAround(KINDS[3]?.el as Element);
    const target = complex(30, 12);
    const s = sensitivityAt(elements, LOAD, Z0, F, { target });
    ladderParameters(elements).forEach((ref, i) => {
      const v = parameterValue(elements[ref.index] as Element, ref.parameter);
      const dv = Math.abs(v) * 1e-5;
      const up = reflectionTowards(zinWith(elements, ref, v + dv, LOAD, F), Z0, target);
      const dn = reflectionTowards(zinWith(elements, ref, v - dv, LOAD, F), Z0, target);
      const fd = complex((up.re - dn.re) / (2 * dv), (up.im - dn.im) / (2 * dv));
      expect(relErr(s.dGamma[i] as Complex, fd)).toBeLessThan(1e-6);
    });
  });

  it('gives dGamma but no |Gamma| derivative at a perfect match', () => {
    const [sol] = lMatch(complex(10, 5), complex(50, 0), F);
    const elements = (sol as { elements: readonly Element[] }).elements;
    const s = sensitivityAt(elements, complex(10, 5), Z0, F);
    expect(s.gammaMag).toBeLessThan(1e-9);
    for (const d of s.dGamma) expect(cabs(d)).toBeGreaterThan(1e-3);
    // At the bottom of the cone |Gamma| has no derivative; reported as 0 (or the rounding of Gamma).
    for (const d of s.dVswr) expect(Number.isFinite(d)).toBe(true);
  });
});

describe('sensitivity over a band', () => {
  const load = (f: number): Complex => complex(20 + f / 1e8, 2 * Math.PI * f * 4e-9);
  const elements: Element[] = [
    { kind: 'C', orientation: 'series', value: 6e-12 },
    { kind: 'L', orientation: 'shunt', value: 9e-9, q: 50 },
    { kind: 'C', orientation: 'series', value: 3e-12 },
  ];
  const band = sweepPoints(0.9e9, 1.1e9, 21);

  it('differentiates the worst VSWR at its frequency and the smooth power mean', () => {
    const b = bandSensitivity(elements, load, Z0, band);
    const refs = b.parameters;
    const first: ParameterRef = { index: 0, parameter: 'value' };
    const worstOf = (els: readonly Element[]): number =>
      Math.max(
        ...band.map((f) => {
          const zin = zinWith(els, first, parameterValue(els[0] as Element, 'value'), load(f), f);
          const g = cabs(reflectionTowards(zin, Z0));
          return (1 + g) / (1 - g);
        }),
      );
    const smoothOf = (els: readonly Element[]): number =>
      bandSensitivity(els, load, Z0, band).smooth.value;
    refs.forEach((ref, i) => {
      const v = parameterValue(elements[ref.index] as Element, ref.parameter);
      const dv = Math.abs(v) * 1e-6;
      const up = elements.map((el, k) =>
        k === ref.index ? withParameter(el, ref.parameter, v + dv) : el,
      );
      const dn = elements.map((el, k) =>
        k === ref.index ? withParameter(el, ref.parameter, v - dv) : el,
      );
      const fdWorst = (worstOf(up) - worstOf(dn)) / (2 * dv);
      const fdSmooth = (smoothOf(up) - smoothOf(dn)) / (2 * dv);
      const w = b.worst.dVswr[i] as number;
      const s = b.smooth.dValue[i] as number;
      expect(Math.abs(w - fdWorst) / Math.abs(fdWorst)).toBeLessThan(1e-6);
      expect(Math.abs(s - fdSmooth) / Math.abs(fdSmooth)).toBeLessThan(1e-6);
    });
    // The smooth value lies between max N^(-1/p) and the max.
    expect(b.smooth.value).toBeLessThanOrEqual(b.worst.vswr * (1 + 1e-12));
    expect(b.smooth.value).toBeGreaterThanOrEqual(b.worst.vswr * band.length ** (-1 / 32));
    const wsum = b.smooth.weights.reduce((a, c) => a + c, 0);
    expect(wsum).toBeGreaterThan(0.5);
  });
});

describe('spreadShares', () => {
  const [sol] = lMatch(complex(12, -20), complex(50, 0), F);
  const elements = (sol as { elements: readonly Element[] }).elements;
  const refs = ladderParameters(elements);
  const point = sensitivityAt(elements, complex(12, -20), Z0, F, { parameters: refs });

  it('adds up to 1 and follows the variance of each part when nothing is correlated', () => {
    const tols = refs.map((ref) => ({ ref, tolerance: 0.05 }));
    const a = spreadShares([point], [1], refs, tols, elements, 'uniform');
    expect(a.shares.reduce((s, x) => s + x.share, 0)).toBeCloseTo(1, 12);
    const v = refs.map((ref, i) => {
      const d = point.dGamma[i] as Complex;
      const p = parameterValue(elements[ref.index] as Element, ref.parameter);
      return (cabs(d) * p * relativeSigma(0.05, 'uniform')) ** 2;
    });
    const total = v.reduce((s, x) => s + x, 0);
    a.shares.forEach((sh, i) => expect(sh.share).toBeCloseTo((v[i] as number) / total, 12));
  });

  it('predicts the Monte Carlo spread of Gamma for small tolerances', () => {
    const tol = 0.01;
    const tols = refs.map((ref) => ({ ref, tolerance: tol }));
    const a = spreadShares([point], [1], refs, tols, elements, 'uniform');
    const ladder = { z0: Z0, frequency: F, load: complex(12, -20), elements };
    const r = monteCarlo(ladder, { runs: 20000, tolerance: tol, vswrLimit: 2, seed: 5 });
    let ms = 0;
    for (let k = 0; k < r.runs; k++) {
      const g = reflectionTowards(complex(r.re[k] as number, r.im[k] as number), Z0);
      ms += g.re * g.re + g.im * g.im;
    }
    const rms = Math.sqrt(ms / r.runs);
    expect(Math.abs(rms - a.rms) / a.rms).toBeLessThan(0.03);
  });

  it('spreads more when parts that act the same way drift together', () => {
    // Two series inductors in a row from one reel: their drifts add.
    const els: Element[] = [
      { kind: 'L', orientation: 'series', value: 5e-9 },
      { kind: 'L', orientation: 'series', value: 5e-9 },
    ];
    const rs = ladderParameters(els);
    const pt = sensitivityAt(els, complex(20, 0), Z0, F, { parameters: rs });
    const correlated = rs.map((ref) => ({ ref, tolerance: 0.05, group: 'L', correlation: 0.9 }));
    const free = rs.map((ref) => ({ ref, tolerance: 0.05 }));
    const c = spreadShares([pt], [1], rs, correlated, els, 'uniform');
    const u = spreadShares([pt], [1], rs, free, els, 'uniform');
    expect(c.rms).toBeGreaterThan(u.rms * 1.3);
    expect(c.shares[0]?.share).toBeCloseTo(0.5, 9);
  });

  it('gives a negative share to a part whose correlated drift offsets another', () => {
    // Two parts of one kind whose effects on Gamma point in opposite directions.
    const els: Element[] = [
      { kind: 'L', orientation: 'series', value: 1 },
      { kind: 'L', orientation: 'shunt', value: 1 },
    ];
    const rs = ladderParameters(els);
    const fake = { ...point, dGamma: [complex(1, 0), complex(-0.5, 0)] };
    const tols = rs.map((ref) => ({ ref, tolerance: 0.05, group: 'L', correlation: 0.9 }));
    const a = spreadShares([fake], [1], rs, tols, els, 'uniform');
    // a1 = s, a2 = -0.5 s: contributions s^2 (1 - 0.45) and -0.5 s^2 (0.9 - 0.5), total 0.35 s^2.
    expect(a.shares[0]?.share).toBeCloseTo(0.55 / 0.35, 12);
    expect(a.shares[1]?.share).toBeCloseTo(-0.2 / 0.35, 12);
  });
});
