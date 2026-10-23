/**
 * QA round 1: montecarlo.ts edges: histogram binning at the cap and the last
 * edge, the clamp of a tolerance above 100 percent, override precedence, and
 * the single-run statistics.
 */
import { describe, expect, it } from 'vitest';
import { complex, monteCarlo, vswrHistogram, type Ladder } from '../src/index';

const series100: Ladder = {
  z0: 50,
  frequency: 100e6,
  load: complex(50, 0),
  elements: [{ kind: 'R', orientation: 'series', value: 100 }],
};

describe('vswrHistogram', () => {
  it('caps the top edge at 10: [1, 2, 50] in 2 bins has edges 1, 5.5, 10 and 50 overflows', () => {
    const h = vswrHistogram([1, 2, 50], 2);
    expect(h.edges).toEqual([1, 5.5, 10]);
    expect(h.counts).toEqual([2, 1]);
    expect(h.overflow).toBe(1);
  });

  it('a value exactly on the last edge lands in the last bin without overflow', () => {
    const h = vswrHistogram([1, 3], 2);
    expect(h.edges).toEqual([1, 2, 3]);
    expect(h.counts).toEqual([1, 1]);
    expect(h.overflow).toBe(0);
  });

  it('only infinite values: edges span 1 to 1.01 and every value overflows into the last bin', () => {
    const h = vswrHistogram([Infinity, Infinity], 3);
    expect(h.edges[0]).toBe(1);
    expect(h.edges[3]).toBeCloseTo(1.01, 12);
    expect(h.counts).toEqual([0, 0, 2]);
    expect(h.overflow).toBe(2);
  });

  it('bins of 0, 1.9 or NaN still give at least one bin that holds every value, without throwing', () => {
    for (const bins of [0, 1.9, NaN]) {
      const h = vswrHistogram([1.5], bins);
      expect(h.counts.length).toBeGreaterThanOrEqual(1);
      expect(h.edges).toHaveLength(h.counts.length + 1);
      expect(h.counts.reduce((a, b) => a + b, 0)).toBe(1);
    }
  });

  it('a custom cap below the data: cap 2 with values up to 4 puts 3 and 4 in the overflow', () => {
    const h = vswrHistogram([1.5, 3, 4], 2, 2);
    expect(h.edges).toEqual([1, 1.5, 2]);
    expect(h.overflow).toBe(2);
    expect(h.counts).toEqual([0, 3]);
  });
});

describe('monteCarlo', () => {
  it('a tolerance of 200 % cannot make a part negative: the factor is clamped at 0.001', () => {
    const r = monteCarlo(series100, { runs: 300, tolerance: 2, vswrLimit: 2, seed: 3 });
    for (const re of r.re) {
      expect(re).toBeGreaterThanOrEqual(50 + 0.1 - 1e-9);
      expect(re).toBeLessThan(350);
    }
  });

  it('exact wins over an override; a NaN or negative override keeps the part exact', () => {
    const base = { runs: 20, tolerance: 0.1, vswrLimit: 2 };
    const a = monteCarlo(series100, { ...base, exact: [0], overrides: { 0: 0.5 } });
    expect(Array.from(a.re).every((v) => v === 150)).toBe(true);
    const b = monteCarlo(series100, { ...base, overrides: { 0: NaN } });
    expect(Array.from(b.re).every((v) => v === 150)).toBe(true);
    const c = monteCarlo(series100, { ...base, overrides: { 0: -0.1 } });
    expect(Array.from(c.re).every((v) => v === 150)).toBe(true);
  });

  it('a single exact run: min, max, median and p95 are all the nominal VSWR 3', () => {
    const r = monteCarlo(series100, { runs: 1, tolerance: 0, vswrLimit: 2 });
    expect(r.runs).toBe(1);
    expect(r.stats).toEqual({ min: 3, max: 3, mean: 3, median: 3, p95: 3 });
    expect(r.nominal.vswr).toBe(3);
    expect(r.yield).toBe(0);
    expect(r.passed).toBe(0);
  });

  it('without a band the worst array is empty and nominal.worst is null; with one they are filled', () => {
    const none = monteCarlo(series100, { runs: 3, tolerance: 0, vswrLimit: 2 });
    expect(none.worst).toHaveLength(0);
    expect(none.nominal.worst).toBeNull();
    const band = monteCarlo(series100, {
      runs: 3,
      tolerance: 0,
      vswrLimit: 2,
      band: [50e6, 150e6],
    });
    expect(band.worst).toHaveLength(3);
    expect(band.nominal.worst).toBe(3);
    expect(Array.from(band.worst)).toEqual([3, 3, 3]);
    // An empty band counts as no band.
    expect(
      monteCarlo(series100, { runs: 3, tolerance: 0, vswrLimit: 2, band: [] }).worst,
    ).toHaveLength(0);
  });

  it('the pass test is "at or below": limit 3 passes the exact VSWR 3', () => {
    const r = monteCarlo(series100, { runs: 4, tolerance: 0, vswrLimit: 3 });
    expect(r.passed).toBe(4);
    expect(r.yield).toBe(1);
  });

  it('a NaN VSWR limit passes nothing', () => {
    expect(monteCarlo(series100, { runs: 4, tolerance: 0, vswrLimit: NaN }).passed).toBe(0);
  });

  it('runs 2.9 is floored to 2 and fractional seeds are accepted', () => {
    const r = monteCarlo(series100, { runs: 2.9, tolerance: 0.1, vswrLimit: 2, seed: 1.5 });
    expect(r.runs).toBe(2);
    expect(r.re).toHaveLength(2);
  });
});
