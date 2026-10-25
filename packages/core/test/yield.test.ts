/**
 * D3: correlated tolerances, the Wilson interval, worst-case corners and
 * design centring.
 */
import { describe, expect, it } from 'vitest';
import {
  centreDesign,
  complex,
  lMatch,
  monteCarlo,
  normalCdf,
  realizeLadder,
  sweepPoints,
  toleranceSampler,
  wilsonInterval,
  worstCorner,
  yieldEstimate,
  type Element,
  type Ladder,
  type PartKind,
} from '../src/index';

const pearson = (a: readonly number[], b: readonly number[]): number => {
  const n = a.length;
  const ma = a.reduce((s, v) => s + v, 0) / n;
  const mb = b.reduce((s, v) => s + v, 0) / n;
  let sab = 0;
  let saa = 0;
  let sbb = 0;
  for (let i = 0; i < n; i++) {
    const x = (a[i] as number) - ma;
    const y = (b[i] as number) - mb;
    sab += x * y;
    saa += x * x;
    sbb += y * y;
  }
  return sab / Math.sqrt(saa * sbb);
};

describe('normalCdf', () => {
  it('matches tabulated values', () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 7);
    expect(normalCdf(1)).toBeCloseTo(0.8413447461, 6);
    expect(normalCdf(-1.959963985)).toBeCloseTo(0.025, 6);
    expect(normalCdf(3)).toBeCloseTo(0.998650102, 6);
  });
});

describe('correlated draws', () => {
  const kinds: (PartKind | null)[] = ['L', 'L', 'C', 'C', 'R', null, 'L'];
  const runs = 20000;
  const collect = (distribution: 'uniform' | 'normal', correlation: Record<string, number>) => {
    const next = toleranceSampler(kinds, { seed: 11, distribution, correlation });
    const cols: number[][] = kinds.map(() => []);
    for (let r = 0; r < runs; r++) next().forEach((d, i) => (cols[i] as number[]).push(d));
    return cols;
  };
  // Four standard errors of a sample correlation, (1 - rho^2) / sqrt(n).
  const within = (rho: number): number => 4 * ((1 - rho * rho) / Math.sqrt(runs)) + 1e-3;

  for (const distribution of ['uniform', 'normal'] as const) {
    it(`reproduces the requested coefficient per kind (${distribution})`, () => {
      const cols = collect(distribution, { L: 0.8, C: 0.3 });
      const r = (i: number, j: number): number => pearson(cols[i] as number[], cols[j] as number[]);
      expect(Math.abs(r(0, 1) - 0.8)).toBeLessThan(within(0.8));
      expect(Math.abs(r(0, 6) - 0.8)).toBeLessThan(within(0.8));
      expect(Math.abs(r(2, 3) - 0.3)).toBeLessThan(within(0.3));
      // Across kinds, and the uncorrelated kinds, stay independent.
      expect(Math.abs(r(0, 2))).toBeLessThan(within(0));
      expect(Math.abs(r(4, 5))).toBeLessThan(within(0));
      expect(Math.abs(r(1, 4))).toBeLessThan(within(0));
    });

    it(`keeps the marginal distribution (${distribution})`, () => {
      const cols = collect(distribution, { L: 0.8 });
      const d = cols[0] as number[];
      const mean = d.reduce((s, v) => s + v, 0) / runs;
      const variance = d.reduce((s, v) => s + (v - mean) ** 2, 0) / runs;
      expect(Math.abs(mean)).toBeLessThan(0.01);
      if (distribution === 'uniform') {
        expect(Math.min(...d)).toBeGreaterThanOrEqual(-1);
        expect(Math.max(...d)).toBeLessThanOrEqual(1);
        expect(variance).toBeCloseTo(1 / 3, 2);
      } else {
        expect(variance).toBeCloseTo(1 / 9, 2);
      }
    });
  }

  it('draws exactly as before when nothing is correlated', () => {
    const a = toleranceSampler(kinds, { seed: 3 });
    const b = toleranceSampler(kinds, { seed: 3, correlation: { L: 0, C: 0, R: 0 } });
    for (let r = 0; r < 50; r++) expect(a()).toEqual(b());
  });

  it('widens the spread of a network whose parts of one kind act the same way', () => {
    const ladder: Ladder = {
      z0: 50,
      frequency: 1e9,
      load: complex(50, 0),
      elements: [
        { kind: 'L', orientation: 'series', value: 2e-9 },
        { kind: 'L', orientation: 'series', value: 2e-9 },
      ],
    };
    const base = { runs: 4000, tolerance: 0.1, vswrLimit: 1.5, seed: 2 };
    const free = monteCarlo(ladder, base);
    const reel = monteCarlo(ladder, { ...base, correlation: { L: 0.95 } });
    const sd = (x: Float64Array): number => {
      const m = x.reduce((s, v) => s + v, 0) / x.length;
      return Math.sqrt(x.reduce((s, v) => s + (v - m) ** 2, 0) / x.length);
    };
    // Var of the sum: 2 s^2 (1 + rho), so the ratio of the spreads is sqrt(1.95) for rho 0.95.
    expect(sd(reel.im) / sd(free.im)).toBeCloseTo(Math.sqrt(1.95), 1);
  });
});

describe('wilsonInterval', () => {
  it('gives the published intervals for known counts', () => {
    // 0 of 10 and 5 of 10 at 95 %: [0, 0.2775] and [0.2366, 0.7634] (Wilson 1927; Newcombe 1998).
    const a = wilsonInterval(0, 10);
    expect(a.lo).toBe(0);
    expect(a.hi).toBeCloseTo(0.2775, 4);
    const b = wilsonInterval(5, 10);
    expect(b.lo).toBeCloseTo(0.2366, 4);
    expect(b.hi).toBeCloseTo(0.7634, 4);
    // Newcombe (1998), table I: 81 of 263, 0.2553 to 0.3662.
    const c = wilsonInterval(81, 263);
    expect(c.lo).toBeCloseTo(0.2553, 4);
    expect(c.hi).toBeCloseTo(0.3662, 4);
  });

  it('solves (p - p_hat)^2 = z^2 p (1 - p) / n at both ends and mirrors', () => {
    const z = 1.959963984540054;
    for (const [x, n] of [
      [3, 40],
      [870, 1000],
      [999, 1000],
      [17, 17],
    ] as const) {
      const { lo, hi } = wilsonInterval(x, n);
      const ph = x / n;
      for (const p of [lo, hi]) {
        if (p === 0 || p === 1) continue;
        expect((p - ph) ** 2).toBeCloseTo((z * z * p * (1 - p)) / n, 12);
      }
      const m = wilsonInterval(n - x, n);
      expect(m.lo).toBeCloseTo(1 - hi, 12);
      expect(m.hi).toBeCloseTo(1 - lo, 12);
    }
  });

  it('comes with every Monte Carlo result', () => {
    const r = monteCarlo(
      {
        z0: 50,
        frequency: 1e9,
        load: complex(50, 0),
        elements: [{ kind: 'R', orientation: 'series', value: 30 }],
      },
      { runs: 400, tolerance: 0.5, vswrLimit: 1.6, seed: 4 },
    );
    expect(r.interval).toEqual(wilsonInterval(r.passed, r.runs));
    expect(r.interval.lo).toBeLessThanOrEqual(r.yield);
    expect(r.interval.hi).toBeGreaterThanOrEqual(r.yield);
  });
});

/** Reference networks for the corners: a point match, a band match, lines, an RLC block. */
function referenceCases(): { name: string; ladder: Ladder; band?: number[] }[] {
  const f = 1e9;
  const load = complex(12, -18);
  const sols = lMatch(load, complex(50, 0), f);
  const out: { name: string; ladder: Ladder; band?: number[] }[] = sols.map((s) => ({
    name: `L match ${s.description} at f0`,
    ladder: { z0: 50, frequency: f, load, elements: s.elements },
  }));
  out.push({
    name: `L match ${sols[0]?.description} over a 20 % band`,
    ladder: {
      z0: 50,
      frequency: f,
      load,
      elements: (sols[0] as { elements: readonly Element[] }).elements,
    },
    band: sweepPoints(0.9e9, 1.1e9, 11),
  });
  out.push({
    name: 'three parts and an RLC trap with a line',
    ladder: {
      z0: 50,
      frequency: f,
      load: complex(30, 25),
      elements: [
        { kind: 'C', orientation: 'series', value: 4e-12 },
        { kind: 'L', orientation: 'shunt', value: 10e-9, q: 60 },
        { kind: 'RLC', orientation: 'shunt', connection: 'series', r: 2, l: 5e-9, c: 1.2e-12 },
        { kind: 'line', z0: 60, length: 0.08, refFrequency: f },
      ],
    },
    band: sweepPoints(0.95e9, 1.05e9, 7),
  });
  return out;
}

describe('worstCorner', () => {
  for (const c of referenceCases()) {
    it(`is at least as bad as every Monte Carlo sample: ${c.name}`, () => {
      const opts = {
        tolerance: 0.05,
        overrides: c.ladder.elements.some((e) => e.kind === 'line') ? { 3: 0.02 } : {},
        ...(c.band ? { band: c.band } : {}),
      };
      const corner = worstCorner(c.ladder, opts);
      expect(corner).not.toBeNull();
      const k = corner as NonNullable<typeof corner>;
      expect(k.exhaustive).toBe(true);
      const mc = monteCarlo(c.ladder, { ...opts, runs: 3000, vswrLimit: 10, seed: 9 });
      const sample = (i: number): number =>
        c.band ? Math.max(mc.vswr[i] as number, mc.worst[i] as number) : (mc.vswr[i] as number);
      let worstSample = 0;
      for (let i = 0; i < mc.runs; i++) worstSample = Math.max(worstSample, sample(i));
      expect(k.worst.vswr).toBeGreaterThanOrEqual(worstSample);
      expect(k.worst.vswr).toBeGreaterThan(k.nominal);
      // The sensitivities find the worst corner, or one within 1 percent of it.
      expect(k.fromSensitivity.vswr).toBeGreaterThanOrEqual(k.worst.vswr * 0.99);
    });
  }

  it('is null when nothing varies', () => {
    const c = referenceCases()[0] as { ladder: Ladder };
    expect(worstCorner(c.ladder, { tolerance: 0 })).toBeNull();
  });
});

describe('centreDesign', () => {
  const f = 1e9;
  const band = sweepPoints(0.9e9, 1.1e9, 11);
  const e24 = {
    source: { kind: 'series' as const, series: 'E24' as const },
    scope: 'all' as const,
  };
  /** The reference L-networks: a tight VSWR limit over a 20 % band, 5 % parts. */
  const cases = [
    { load: complex(100, -50), shape: 'shunt L + series C', limit: 1.38 },
    { load: complex(12, -18), shape: 'series C + shunt L', limit: 1.31 },
  ];
  for (const c of cases) {
    const sol = lMatch(c.load, complex(50, 0), f).find((s) => s.description === c.shape);
    const ideal: Ladder = {
      z0: 50,
      frequency: f,
      load: c.load,
      elements: (sol as { elements: readonly Element[] }).elements,
    };

    it(`raises the yield of the ideal values: ${c.shape} on ${c.load.re}${c.load.im}j`, () => {
      const r = centreDesign(ideal, { tolerance: 0.05, vswrLimit: c.limit, band });
      expect(r.improved).toBe(true);
      expect(r.after.interval.lo).toBeGreaterThan(r.before.interval.hi);
      // Every value stays within half to twice its nominal.
      r.indices.forEach((i) => {
        const a = (ideal.elements[i] as { value: number }).value;
        const b = (r.elements[i] as { value: number }).value;
        expect(b / a).toBeGreaterThanOrEqual(0.5);
        expect(b / a).toBeLessThanOrEqual(2);
      });
      // The check is reproducible.
      const again = centreDesign(ideal, { tolerance: 0.05, vswrLimit: c.limit, band });
      expect(again.after).toEqual(r.after);
    });

    it(`raises the yield with E24 parts: ${c.shape} on ${c.load.re}${c.load.im}j`, () => {
      const real = realizeLadder(ideal, e24).ladder;
      const r = centreDesign(real, { tolerance: 0.05, vswrLimit: c.limit, band, realize: e24 });
      expect(r.improved).toBe(true);
      expect(r.after.interval.lo).toBeGreaterThan(r.before.interval.hi);
      // The result is in E24 and re-measured: its yield is the check of those values.
      for (const el of r.elements) {
        const v = (el as { value: number }).value;
        const realized = realizeLadder({ ...real, elements: [el] }, e24).ladder.elements[0];
        expect((realized as { value: number }).value).toBe(v);
      }
      const check = yieldEstimate(
        { ...real, elements: r.elements },
        { tolerance: 0.05, vswrLimit: c.limit, band, runs: 2000, seed: 20261025 + 7919 },
      );
      expect(check.passed).toBe(r.after.passed);
      expect(r.continuous?.yield.yield).toBeGreaterThanOrEqual(r.after.yield - 0.02);
    });
  }

  it('leaves locked parts and RLC blocks alone', () => {
    const ladder: Ladder = {
      z0: 50,
      frequency: f,
      load: complex(30, 25),
      elements: [
        { kind: 'C', orientation: 'series', value: 4e-12 },
        { kind: 'RLC', orientation: 'shunt', connection: 'series', r: 2, l: 5e-9, c: 1.2e-12 },
        { kind: 'L', orientation: 'shunt', value: 10e-9 },
      ],
    };
    const r = centreDesign(ladder, {
      tolerance: 0.05,
      vswrLimit: 1.5,
      exact: [2],
      maxEvaluations: 60,
    });
    expect(r.indices).toEqual([0]);
    expect(r.elements[1]).toBe(ladder.elements[1]);
    expect(r.elements[2]).toBe(ladder.elements[2]);
  });
});
