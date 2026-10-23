import { describe, expect, it } from 'vitest';
import {
  complex,
  lMatch,
  monteCarlo,
  sweepPoints,
  vswrHistogram,
  type Element,
  type Ladder,
} from '../src/index';

const series100: Ladder = {
  z0: 50,
  frequency: 100e6,
  load: complex(50, 0),
  elements: [{ kind: 'R', orientation: 'series', value: 100 }],
};

const mean = (a: ArrayLike<number>): number => Array.from(a).reduce((s, v) => s + v, 0) / a.length;

describe('monteCarlo', () => {
  it('is reproducible for a seed and different for another', () => {
    const o = { runs: 500, tolerance: 0.05, vswrLimit: 2, seed: 7 };
    const a = monteCarlo(series100, o);
    const b = monteCarlo(series100, o);
    expect(Array.from(a.re)).toEqual(Array.from(b.re));
    const c = monteCarlo(series100, { ...o, seed: 8 });
    expect(Array.from(c.re)).not.toEqual(Array.from(a.re));
  });

  it('keeps every run at the nominal value with no tolerance', () => {
    const r = monteCarlo(series100, { runs: 50, tolerance: 0, vswrLimit: 3 });
    for (const z of r.re) expect(z).toBeCloseTo(150, 9);
    expect(r.nominal.zin.re).toBeCloseTo(150, 9);
    expect(r.nominal.vswr).toBeCloseTo(3, 9);
    expect(r.yield).toBe(1);
  });

  it('spreads a uniform tolerance over the band and nothing beyond it', () => {
    const r = monteCarlo(series100, { runs: 20000, tolerance: 0.1, vswrLimit: 3, seed: 1 });
    expect(Math.min(...r.re)).toBeGreaterThanOrEqual(140);
    expect(Math.max(...r.re)).toBeLessThanOrEqual(160);
    expect(Math.min(...r.re)).toBeLessThan(140.1);
    expect(Math.max(...r.re)).toBeGreaterThan(159.9);
    expect(mean(r.re)).toBeCloseTo(150, 0);
    for (const x of r.im) expect(x).toBeCloseTo(0, 9);
  });

  it('draws a normal tolerance with the band as three standard deviations', () => {
    const r = monteCarlo(series100, {
      runs: 20000,
      tolerance: 0.1,
      distribution: 'normal',
      vswrLimit: 3,
      seed: 3,
    });
    const m = mean(r.re);
    const sd = Math.sqrt(Array.from(r.re).reduce((s, v) => s + (v - m) ** 2, 0) / r.re.length);
    expect(m).toBeCloseTo(150, 0);
    expect(sd).toBeGreaterThan(3.333 * 0.95);
    expect(sd).toBeLessThan(3.333 * 1.05);
  });

  it('gives the analytic yield: half the runs have R(1 + d) at or below 100', () => {
    // Zin = 50 + R(1 + d), VSWR = Zin / 50 <= 3 exactly when d <= 0.
    const r = monteCarlo(series100, { runs: 20000, tolerance: 0.1, vswrLimit: 3, seed: 5 });
    expect(r.yield).toBeGreaterThan(0.48);
    expect(r.yield).toBeLessThan(0.52);
    expect(r.passed / r.runs).toBe(r.yield);
    expect(monteCarlo(series100, { runs: 2000, tolerance: 0.1, vswrLimit: 3.3 }).yield).toBe(1);
    expect(monteCarlo(series100, { runs: 2000, tolerance: 0.1, vswrLimit: 2.5 }).yield).toBe(0);
  });

  it('keeps exact elements exact and takes per-element overrides', () => {
    const two: Ladder = {
      ...series100,
      elements: [
        { kind: 'R', orientation: 'series', value: 100 },
        { kind: 'R', orientation: 'series', value: 20 },
      ],
    };
    const exact = monteCarlo(two, { runs: 500, tolerance: 0.1, vswrLimit: 9, exact: [0], seed: 2 });
    // Only the 20 ohm resistor varies: Zin = 170 +- 2.
    expect(Math.min(...exact.re)).toBeGreaterThanOrEqual(168);
    expect(Math.max(...exact.re)).toBeLessThanOrEqual(172);
    const over = monteCarlo(two, {
      runs: 500,
      tolerance: 0.1,
      vswrLimit: 9,
      overrides: { 0: 0.01 },
      exact: [1],
      seed: 2,
    });
    expect(Math.min(...over.re)).toBeGreaterThanOrEqual(169);
    expect(Math.max(...over.re)).toBeLessThanOrEqual(171);
    const zero = monteCarlo(two, {
      runs: 20,
      tolerance: 0.1,
      vswrLimit: 9,
      overrides: { 0: 0, 1: 0 },
    });
    for (const z of zero.re) expect(z).toBeCloseTo(170, 9);
  });

  it('varies lines and transformers only when they are given a tolerance', () => {
    const els: Element[] = [
      { kind: 'line', z0: 50, length: 0.1, refFrequency: 100e6 },
      { kind: 'transformer', n: 2 },
    ];
    const l: Ladder = { ...series100, load: complex(30, 10), elements: els };
    const still = monteCarlo(l, { runs: 20, tolerance: 0.05, vswrLimit: 9 });
    for (let i = 0; i < 20; i++) expect(still.re[i]).toBeCloseTo(still.nominal.zin.re, 9);
    const moves = monteCarlo(l, {
      runs: 20,
      tolerance: 0.05,
      vswrLimit: 9,
      overrides: { 0: 0.02 },
    });
    expect(new Set(Array.from(moves.re)).size).toBeGreaterThan(10);
  });

  it('varies the parts of an RLC block independently', () => {
    const l: Ladder = {
      ...series100,
      elements: [
        { kind: 'RLC', orientation: 'shunt', connection: 'series', r: 5, l: 20e-9, c: 10e-12 },
      ],
    };
    const r = monteCarlo(l, { runs: 300, tolerance: 0.05, vswrLimit: 9, seed: 4 });
    expect(new Set(Array.from(r.im).map((x) => x.toFixed(6))).size).toBeGreaterThan(250);
  });

  it('judges the worst VSWR over a band when one is given', () => {
    const l: Ladder = {
      z0: 50,
      frequency: 140e6,
      load: complex(25, -18),
      elements: lMatch(complex(25, -18), complex(50, 0), 140e6)[0]!.elements.slice(),
    };
    const band = sweepPoints(126e6, 154e6, 15);
    const a = monteCarlo(l, { runs: 400, tolerance: 0.02, vswrLimit: 1.3, seed: 6 });
    const b = monteCarlo(l, { runs: 400, tolerance: 0.02, vswrLimit: 1.3, seed: 6, band });
    expect(b.worst).toHaveLength(400);
    expect(a.worst).toHaveLength(0);
    for (let i = 0; i < 400; i++) expect(b.worst[i]).toBeGreaterThanOrEqual(b.vswr[i] as number);
    expect(b.yield).toBeLessThanOrEqual(a.yield);
    expect(b.nominal.worst).toBeGreaterThan(1.05);
    expect(a.nominal.worst).toBeNull();
    // The cloud and the histogram are those of the design frequency in both cases.
    expect(Array.from(b.vswr)).toEqual(Array.from(a.vswr));
  });

  it('reports statistics, a histogram that counts every run, and progress', () => {
    const seen: number[] = [];
    const r = monteCarlo(series100, {
      runs: 1000,
      tolerance: 0.1,
      vswrLimit: 3,
      bins: 10,
      onProgress: (done, total) => {
        expect(total).toBe(1000);
        seen.push(done);
      },
    });
    expect(r.histogram.counts).toHaveLength(10);
    expect(r.histogram.counts.reduce((a, b) => a + b, 0)).toBe(1000);
    expect(r.histogram.edges[0]).toBe(1);
    expect(r.stats.min).toBeLessThanOrEqual(r.stats.median);
    expect(r.stats.median).toBeLessThanOrEqual(r.stats.p95);
    expect(r.stats.p95).toBeLessThanOrEqual(r.stats.max);
    expect(seen[seen.length - 1]).toBe(1000);
  });

  it('copes with a total reflection and clamps silly run counts', () => {
    const open: Ladder = { ...series100, load: complex(0, 30), elements: [] };
    const r = monteCarlo(open, { runs: 5, tolerance: 0.1, vswrLimit: 2 });
    expect(r.yield).toBe(0);
    expect(r.vswr[0]).toBeGreaterThan(1e6);
    expect(monteCarlo(series100, { runs: 0, tolerance: 0.1, vswrLimit: 2 }).runs).toBe(1);
    expect(monteCarlo(series100, { runs: NaN, tolerance: NaN, vswrLimit: 2 }).runs).toBe(1);
  });
});

describe('vswrHistogram', () => {
  it('bins between 1 and the largest value, with the overflow in the last bin', () => {
    const h = vswrHistogram([1, 1.5, 2, 2.5, 3, 50, Infinity], 4, 3);
    expect(h.edges).toEqual([1, 1.5, 2, 2.5, 3]);
    expect(h.counts.reduce((a, b) => a + b, 0)).toBe(7);
    expect(h.overflow).toBe(2);
    expect(h.counts[3]).toBe(4); // 2.5, 3, 50, Infinity
  });

  it('survives identical values and an empty list', () => {
    expect(vswrHistogram([1, 1, 1], 5).counts.reduce((a, b) => a + b, 0)).toBe(3);
    expect(vswrHistogram([], 5).counts).toEqual([0, 0, 0, 0, 0]);
  });
});
