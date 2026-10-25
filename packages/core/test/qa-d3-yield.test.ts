/**
 * QA (D3): yield.ts and the D3 parts of montecarlo.ts beyond the existing
 * tests. The Wilson interval by hand, the correlated uniform marginal, the
 * yield estimate against the Monte Carlo pass count on the same draws, the
 * corner search above the exhaustive limit and where a corner is not the
 * worst case, and the Realize scopes of design centring.
 */
import { describe, expect, it } from 'vitest';
import {
  centreDesign,
  complex,
  lMatch,
  monteCarlo,
  realizeLadder,
  sweepPoints,
  toleranceSampler,
  wilsonInterval,
  worstCorner,
  yieldEstimate,
  type Element,
  type Ladder,
} from '../src/index';

describe('qa: Wilson interval', () => {
  it('870 of 1000: 0.8477 to 0.8894 (hand calculation)', () => {
    // p = 0.87, z^2 = 3.841459, denominator 1.0038415, centre 0.8685841,
    // half width 1.959964 sqrt(1.131e-4 + 9.6036e-7) / 1.0038415 = 0.0208521.
    const { lo, hi } = wilsonInterval(870, 1000);
    expect(lo).toBeCloseTo(0.847732, 5);
    expect(hi).toBeCloseTo(0.889436, 5);
  });

  it('no runs: the whole range; more passes than runs count as all', () => {
    expect(wilsonInterval(0, 0)).toEqual({ lo: 0, hi: 1 });
    expect(wilsonInterval(12, 10)).toEqual(wilsonInterval(10, 10));
    // 10 of 10: lo = n / (n + z^2) = 10 / 13.841459 = 0.722467, hi = 1.
    expect(wilsonInterval(10, 10).lo).toBeCloseTo(0.722467, 5);
    expect(wilsonInterval(10, 10).hi).toBeCloseTo(1, 12);
  });
});

describe('qa: correlated draws', () => {
  it('keeps the uniform marginal flat (ten bins of 10 %) at rho 0.6', () => {
    const n = 40000;
    const next = toleranceSampler(['C', 'C'], { seed: 99, correlation: { C: 0.6 } });
    const bins = new Array<number>(10).fill(0);
    for (let r = 0; r < n; r++) {
      const d = next()[0] as number;
      const k = Math.min(9, Math.floor((d + 1) * 5));
      bins[k] = (bins[k] as number) + 1;
    }
    // Each bin 0.1 of the draws, standard error sqrt(0.09 / n) = 0.0015; four of them.
    for (const b of bins) expect(Math.abs(b / n - 0.1)).toBeLessThan(0.006);
  });

  it('clamps a coefficient of 1 to 0.999: draws stay inside the band and nearly equal', () => {
    const next = toleranceSampler(['L', 'L'], { seed: 5, correlation: { L: 1 } });
    let maxDiff = 0;
    for (let r = 0; r < 2000; r++) {
      const [a, b] = next() as [number, number];
      expect(Math.abs(a)).toBeLessThanOrEqual(1);
      expect(Math.abs(b)).toBeLessThanOrEqual(1);
      maxDiff = Math.max(maxDiff, Math.abs(a - b));
    }
    // Latent correlation 2 sin(0.999 pi / 6) = 0.99895: differences stay small, not zero.
    expect(maxDiff).toBeGreaterThan(0);
    expect(maxDiff).toBeLessThan(0.3);
  });
});

describe('qa: yieldEstimate is the Monte Carlo pass count on the same draws', () => {
  const load = complex(100, -50);
  const sol = lMatch(load, complex(50, 0), 1e9).find((s) => s.description === 'shunt L + series C');
  const ladder: Ladder = {
    z0: 50,
    frequency: 1e9,
    load,
    elements: (sol as { elements: readonly Element[] }).elements,
  };
  const variants = [
    { name: 'at f0', opts: { vswrLimit: 1.05 } },
    { name: 'over a band', opts: { vswrLimit: 1.38, band: sweepPoints(0.9e9, 1.1e9, 11) } },
    { name: 'towards a target', opts: { vswrLimit: 2.2, target: complex(30, 10) } },
    {
      name: 'normal, correlated',
      opts: { vswrLimit: 1.2, distribution: 'normal' as const, correlation: { L: 0.5, C: 0.5 } },
    },
  ];
  for (const v of variants) {
    it(v.name, () => {
      const common = { tolerance: 0.05, seed: 77, ...v.opts };
      const mc = monteCarlo(ladder, { ...common, runs: 1500 });
      const y = yieldEstimate(ladder, { ...common, runs: 1500 });
      expect(y.passed).toBe(mc.passed);
      expect(y.interval).toEqual(mc.interval);
    });
  }
});

describe('qa: worstCorner', () => {
  it('stops enumerating above the exhaustive limit', () => {
    const elements: Element[] = Array.from({ length: 11 }, (_, i) =>
      i % 2 === 0
        ? { kind: 'L', orientation: 'series', value: 1e-9 }
        : { kind: 'C', orientation: 'shunt', value: 0.3e-12 },
    );
    const ladder: Ladder = { z0: 50, frequency: 1e9, load: complex(40, 10), elements };
    const c = worstCorner(ladder, { tolerance: 0.05 });
    expect(c?.slots).toHaveLength(11);
    expect(c?.exhaustive).toBe(false);
    // Two gradient corners and 17 directions at one frequency at most.
    expect(c?.evaluated).toBeLessThanOrEqual(19);
    expect(c?.worst).toBe(c?.fromSensitivity);
  });

  it('is a bound on the uniform samples also when the response peaks inside the tolerance box', () => {
    // A parallel L-C trap in series, resonant at f0, before 50 ohm, 10 % parts. Every corner
    // detunes it (L C at 1.21, 0.81 or 0.99 of nominal), but draws with L C near nominal put
    // a reactance of tens of kilohm in series: their VSWR is far above any corner's.
    const l = 10e-9;
    const c = 1 / ((2 * Math.PI * 1e9) ** 2 * l);
    const ladder: Ladder = {
      z0: 50,
      frequency: 1e9,
      load: complex(50, 0),
      elements: [{ kind: 'RLC', orientation: 'series', connection: 'parallel', l, c }],
    };
    const corner = worstCorner(ladder, { tolerance: 0.1 });
    const mc = monteCarlo(ladder, { tolerance: 0.1, runs: 3000, vswrLimit: 2, seed: 9 });
    let worstSample = 0;
    for (let i = 0; i < mc.runs; i++) worstSample = Math.max(worstSample, mc.vswr[i] as number);
    // The guide: "A uniform draw never goes past a corner".
    expect(corner?.worst.vswr).toBeGreaterThanOrEqual(worstSample);
  });
});

describe('qa: centreDesign with Realize scopes', () => {
  const f = 1e9;
  const band = sweepPoints(0.9e9, 1.1e9, 11);
  const load = complex(100, -50);
  const sol = lMatch(load, complex(50, 0), f).find((s) => s.description === 'shunt L + series C');
  const ideal: Ladder = {
    z0: 50,
    frequency: f,
    load,
    elements: (sol as { elements: readonly Element[] }).elements,
  };
  const inE24 = (el: Element): boolean => {
    const v = (el as { value: number }).value;
    const r = realizeLadder(
      { ...ideal, elements: [el] },
      { source: { kind: 'series', series: 'E24' }, scope: 'all' },
    ).ladder.elements[0] as { value: number };
    return r.value === v;
  };

  it('the pairs scope snaps every L and C, as all does', () => {
    const realize = {
      source: { kind: 'series' as const, series: 'E24' as const },
      scope: 'pairs' as const,
    };
    const real = realizeLadder(ideal, realize).ladder;
    const r = centreDesign(real, { tolerance: 0.05, vswrLimit: 1.38, band, realize });
    for (const el of r.elements) expect(inE24(el)).toBe(true);
  });

  it('a part outside the scope keeps its centred value, unsnapped', () => {
    const realize = {
      source: { kind: 'series' as const, series: 'E24' as const },
      scope: 'C' as const,
    };
    const r = centreDesign(ideal, { tolerance: 0.05, vswrLimit: 1.38, band, realize });
    const iL = r.elements.findIndex((e) => e.kind === 'L');
    const iC = r.elements.findIndex((e) => e.kind === 'C');
    expect(inE24(r.elements[iC] as Element)).toBe(true);
    expect((r.elements[iL] as { value: number }).value).toBe(
      (r.continuous?.elements[iL] as { value: number }).value,
    );
  });

  it('never ends worse than it started on its own search draws (no Realize)', () => {
    for (const limit of [1.2, 1.38, 1.6, 3]) {
      const r = centreDesign(ideal, {
        tolerance: 0.05,
        vswrLimit: limit,
        band,
        maxEvaluations: 200,
      });
      expect(r.searchAfter).toBeGreaterThanOrEqual(r.searchBefore);
    }
  });
  it('reports no improvement when every run already passes', () => {
    const r = centreDesign(ideal, { tolerance: 0.05, vswrLimit: 5, maxEvaluations: 60 });
    expect(r.before.passed).toBe(r.before.runs);
    expect(r.improved).toBe(false);
  });

  it('keeps every value within half to twice its nominal when the centre lies further out', () => {
    // The L match with both values at a third: the passing region is about three times away.
    const off: Ladder = {
      ...ideal,
      elements: ideal.elements.map((el) => ({
        ...el,
        value: (el as { value: number }).value / 3,
      })) as Element[],
    };
    const r = centreDesign(off, { tolerance: 0.05, vswrLimit: 2.5 });
    r.indices.forEach((i) => {
      const a = (off.elements[i] as { value: number }).value;
      const b = (r.elements[i] as { value: number }).value;
      expect(b / a).toBeGreaterThanOrEqual(0.5 - 1e-12);
      expect(b / a).toBeLessThanOrEqual(2 + 1e-12);
    });
  });
});
