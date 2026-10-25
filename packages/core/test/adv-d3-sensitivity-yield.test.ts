/**
 * Adversarial QA of depth phase D3 (sensitivity, corners, centring) in core.
 * Tests named "DEFECT" fail on f110a69 and document a kept failure; the rest
 * are attacks the code survived.
 */
import { describe, expect, it } from 'vitest';
import {
  bandSensitivity,
  cabs,
  centreDesign,
  complex,
  csub,
  elementTolerances,
  monteCarlo,
  reflectionTowards,
  sensitivityAt,
  spreadShares,
  sweepPoints,
  toleranceSampler,
  toleranceSlots,
  worstCorner,
  yieldEstimate,
  zinWith,
  type Complex,
  type Element,
  type Ladder,
  type LoadModel,
  type ParameterRef,
} from '../src/index';

/** The spread analysis exactly as the app's ladderSpread builds it. */
function spreadOf(
  ladder: Ladder,
  band: readonly number[],
  tol: number,
  load: LoadModel = ladder.load,
) {
  const tols = elementTolerances(ladder.elements, { tolerance: tol });
  const slots = toleranceSlots(ladder.elements, tols);
  const refs = slots.map((s) => s.ref);
  const f0 = ladder.frequency;
  const freqs = [f0, ...band.filter((f) => f !== f0)];
  const loadAt = (f: number): Complex =>
    f === f0 ? ladder.load : typeof load === 'function' ? load(f) : load;
  const sens = bandSensitivity(ladder.elements, loadAt, ladder.z0, freqs, { parameters: refs });
  const weights = band.length ? sens.smooth.weights.map((w) => (Number.isFinite(w) ? w : 0)) : [1];
  const pts = band.length ? sens.points : [sens.points[0] as (typeof sens.points)[number]];
  return spreadShares(
    pts,
    weights,
    refs,
    slots.map((s) => ({
      ref: s.ref,
      tolerance: s.tolerance,
      ...(s.kind ? { group: s.kind, correlation: 0 } : {}),
    })),
    ladder.elements,
    'uniform',
  );
}

const L_MATCH: Element[] = [
  { kind: 'L', orientation: 'shunt', value: 12e-9 },
  { kind: 'C', orientation: 'series', value: 2.7e-12 },
];
const REF: Ladder = { z0: 50, frequency: 1e9, load: complex(100, -50), elements: L_MATCH };

describe('spread shares at singular points', () => {
  it('DEFECT: a shunt C typed as 0 F wipes the shares of every other part and makes the RMS NaN', () => {
    const ladder: Ladder = {
      ...REF,
      elements: [{ kind: 'C', orientation: 'shunt', value: 0 }, ...L_MATCH],
    };
    const sp = spreadOf(ladder, [], 0.05);
    // The 0 F part changes nothing (5 % of 0 is 0); the other two parts carry the whole spread.
    const others = sp.shares.filter((s) => s.ref.index > 0).reduce((a, s) => a + s.share, 0);
    expect(Number.isFinite(sp.rms)).toBe(true);
    expect(others).toBeCloseTo(1, 6);
  });

  it('DEFECT: one band point at total reflection (|Gamma| >= 1) zeroes every share and the RMS', () => {
    // A measured load whose top row is slightly active (|S11| > 1, VNA noise) at the band edge.
    const band = sweepPoints(0.9e9, 1.1e9, 5);
    const load = (f: number): Complex => (f >= 1.1e9 ? complex(-0.5, 10) : complex(100, -50));
    const sp = spreadOf(REF, band, 0.05, load);
    const total = sp.shares.reduce((a, s) => a + s.share, 0);
    expect(sp.rms).toBeGreaterThan(0);
    expect(total).toBeCloseTo(1, 6);
  });

  it('survives: a transformer at n = 1e-10 gives finite derivatives', () => {
    const els: Element[] = [{ kind: 'transformer', n: 1e-10 } as Element, L_MATCH[1] as Element];
    const pt = sensitivityAt(els, REF.load, 50, 1e9);
    expect(pt.dGamma.every((d) => Number.isFinite(d.re) && Number.isFinite(d.im))).toBe(true);
  });

  it('survives: perfect match (dGamma exact, d|Gamma| and dVSWR 0, all finite)', () => {
    const pt = sensitivityAt(
      [
        { kind: 'L', orientation: 'series', value: 5e-9 },
        { kind: 'C', orientation: 'shunt', value: 1e-12 },
      ],
      complex(50, 0),
      50,
      1e9,
    );
    expect(pt.dGamma.every((d) => Number.isFinite(d.re) && Number.isFinite(d.im))).toBe(true);
    expect(pt.dVswr.every((d) => Number.isFinite(d))).toBe(true);
  });

  it('survives: Q of 1e9, a transformer at n = 0.01, a zero-length line, a negative-Z0 line (finite differences)', () => {
    const load = complex(100, -50);
    const cases: [Element[], ParameterRef, number][] = [
      [
        [{ kind: 'L', orientation: 'shunt', value: 12e-9, q: 1e9 }, L_MATCH[1] as Element],
        { index: 0, parameter: 'value' },
        12e-9,
      ],
      [
        [{ kind: 'transformer', n: 0.01 } as Element, L_MATCH[1] as Element],
        { index: 0, parameter: 'n' },
        0.01,
      ],
      [
        [{ kind: 'line', z0: 50, length: 0 } as Element, L_MATCH[1] as Element],
        { index: 0, parameter: 'z0' },
        50,
      ],
      [
        [{ kind: 'line', z0: -75, length: 0.1 } as Element, L_MATCH[1] as Element],
        { index: 0, parameter: 'z0' },
        -75,
      ],
    ];
    for (const [els, ref, v] of cases) {
      const pt = sensitivityAt(els, load, 50, 1e9, { parameters: [ref] });
      const h = Math.abs(v) * 1e-5;
      const g = (x: number): Complex => reflectionTowards(zinWith(els, ref, x, load, 1e9), 50);
      const fd = csub(g(v + h), g(v - h));
      const an = pt.dGamma[0] as Complex;
      const err = cabs(csub(complex(fd.re / (2 * h), fd.im / (2 * h)), an));
      expect(err).toBeLessThanOrEqual(1e-5 * Math.max(cabs(an), 1e-12));
    }
  });
});

describe('worst-case corner', () => {
  it('DEFECT: the "worst-case corner" is better than the nominal network and every Monte Carlo sample', () => {
    // A 100 ohm line, a quarter wave long, on a 50 ohm load, length tolerance 5 % (uniform).
    const ladder: Ladder = {
      z0: 50,
      frequency: 1e9,
      load: complex(50, 0),
      elements: [{ kind: 'line', z0: 100, length: 0.25 } as Element],
    };
    const opts = { tolerance: 0.05, overrides: { 0: 0.05 }, vswrLimit: 2, runs: 2000, seed: 1 };
    const corner = worstCorner(ladder, opts);
    const mc = monteCarlo(ladder, opts);
    expect(corner?.nominal).toBeCloseTo(4, 9);
    expect(corner?.worst.vswr ?? 0).toBeGreaterThanOrEqual(mc.stats.max);
    expect(corner?.worst.vswr ?? 0).toBeGreaterThanOrEqual(corner?.nominal ?? Infinity);
  });

  it('DEFECT: lumped parts only (low-Q L and C, a series R, 24 % tolerance): Monte Carlo beats the corner', () => {
    const ladder: Ladder = {
      z0: 50,
      frequency: 1e9,
      load: complex(9.68548103235662, -137.9726893734187),
      elements: [
        { kind: 'L', orientation: 'shunt', value: 2.3696526118933158e-8, q: 11.19047633651644 },
        { kind: 'R', orientation: 'series', value: 312.36498279960523 },
        { kind: 'C', orientation: 'series', value: 1.571968215922174e-11, q: 12.152605567127466 },
      ],
    };
    const opts = { tolerance: 0.2383270461112261, vswrLimit: 2, runs: 2000, seed: 1435 };
    const corner = worstCorner(ladder, opts);
    const mc = monteCarlo(ladder, opts);
    expect(corner?.worst.vswr ?? 0).toBeGreaterThanOrEqual(mc.stats.max);
  });

  it('survives: lossless L/C networks, 300 random cases, the corner is never beaten by 3000 uniform samples', () => {
    let s = 99;
    const r = (): number => {
      s ^= s << 13;
      s >>>= 0;
      s ^= s >>> 17;
      s ^= s << 5;
      s >>>= 0;
      return s / 4294967296;
    };
    const w = 2 * Math.PI * 1e9;
    for (let trial = 0; trial < 300; trial++) {
      const els: Element[] = [];
      for (let i = 0, n = 2 + Math.floor(r() * 3); i < n; i++) {
        const o = r() < 0.5 ? 'series' : 'shunt';
        const x = 5 * Math.pow(100, r());
        els.push(
          r() < 0.5
            ? { kind: 'L', orientation: o, value: x / w }
            : { kind: 'C', orientation: o, value: 1 / (w * x) },
        );
      }
      const ladder: Ladder = {
        z0: 50,
        frequency: 1e9,
        load: complex(5 + r() * 200, -150 + r() * 300),
        elements: els,
      };
      const tolerance = 0.1 + r() * 0.3;
      const band = r() < 0.5 ? { band: sweepPoints(0.9e9, 1.1e9, 5) } : {};
      const opts = { tolerance, vswrLimit: 2, runs: 3000, seed: trial + 1, ...band };
      const mc = monteCarlo(ladder, opts);
      let max = 0;
      for (let i = 0; i < mc.runs; i++)
        max = Math.max(max, mc.vswr[i] as number, mc.worst.length ? (mc.worst[i] as number) : 0);
      expect(worstCorner(ladder, opts)?.worst.vswr ?? 0).toBeGreaterThanOrEqual(max * (1 - 1e-9));
    }
  }, 60000);
});

describe('correlation and tolerances', () => {
  it('survives: correlation 1, -1, 0.999999, 0, NaN, Infinity, 2 give finite draws inside the band', () => {
    for (const rho of [1, -1, 0.999999, 0, NaN, Infinity, 2]) {
      const next = toleranceSampler(['L', 'L', 'C'], { seed: 3, correlation: { L: rho } });
      for (let i = 0; i < 2000; i++)
        for (const d of next()) expect(Number.isFinite(d) && Math.abs(d) <= 1).toBe(true);
    }
  });

  it('survives: tolerance 0, negative and 100 % (no throw, yields in [0, 1], centring stays half to twice)', () => {
    const band = sweepPoints(0.9e9, 1.1e9, 11);
    for (const tolerance of [0, -0.05, 1]) {
      const y = yieldEstimate(REF, { tolerance, vswrLimit: 1.5, runs: 200, band });
      expect(y.yield).toBeGreaterThanOrEqual(0);
      const c = centreDesign(REF, { tolerance, vswrLimit: 1.5, band });
      c.elements.forEach((el, i) => {
        const k = (el as { value: number }).value / (L_MATCH[i] as { value: number }).value;
        expect(k).toBeGreaterThanOrEqual(0.5 - 1e-12);
        expect(k).toBeLessThanOrEqual(2 + 1e-12);
      });
    }
  });
});

describe('design centring edge cases', () => {
  const band = sweepPoints(0.9e9, 1.1e9, 11);
  it('survives: yield 0, yield 100 %, a single part, locked parts only, a stock of one value per kind', () => {
    const cases: [Ladder, Parameters<typeof centreDesign>[1]][] = [
      [REF, { tolerance: 0.05, vswrLimit: 1.01, band }],
      [REF, { tolerance: 0.01, vswrLimit: 10, band }],
      [
        { ...REF, elements: [{ kind: 'L', orientation: 'series', value: 5e-9 }] },
        { tolerance: 0.05, vswrLimit: 1.5 },
      ],
      [REF, { tolerance: 0.05, vswrLimit: 1.5, band, exact: [0, 1] }],
      [
        REF,
        {
          tolerance: 0.05,
          vswrLimit: 1.5,
          band,
          realize: {
            source: { kind: 'stock', stock: { L: [10e-9], C: [3.3e-12], R: [] } },
            scope: 'all',
          },
        },
      ],
    ];
    for (const [ladder, options] of cases) {
      const t0 = performance.now();
      const res = centreDesign(ladder, options);
      expect(performance.now() - t0).toBeLessThan(2000);
      expect(Number.isFinite(res.after.interval.lo) && Number.isFinite(res.after.interval.hi)).toBe(
        true,
      );
    }
    expect(
      centreDesign(REF, { tolerance: 0.05, vswrLimit: 1.5, band, exact: [0, 1] }).elements,
    ).toEqual(L_MATCH);
  });

  it('survives: seeded runs reproduce; the centring check equals yieldEstimate; Monte Carlo equals yieldEstimate', () => {
    const opts = { tolerance: 0.05, vswrLimit: 1.38, band, correlation: { L: 0.7 } };
    const a = centreDesign(REF, { ...opts, seed: 5 });
    const b = centreDesign(REF, { ...opts, seed: 5 });
    expect(a.elements).toEqual(b.elements);
    expect(a.before).toEqual(yieldEstimate(REF, { ...opts, runs: 2000, seed: 5 + 7919 }));
    const mc = monteCarlo(REF, { ...opts, runs: 500, seed: 9 });
    expect(yieldEstimate(REF, { ...opts, runs: 500, seed: 9 }).passed).toBe(mc.passed);
  });
});
