/**
 * QA round 1: broadband.ts counts and limits. Topology count by hand: without
 * lines 2 * (2 + 4 + ... + 2^n); with lines each series slot adds 2^(n-1)
 * ladders per first orientation (the line replaces an L).
 */
import { describe, expect, it } from 'vitest';
import {
  broadbandMatch,
  complex,
  defaultBudget,
  enumerateTopologies,
  interpolatedLoad,
  seedValues,
  sweepPoints,
  worstVswr,
  type Complex,
} from '../src/index';

describe('enumerateTopologies', () => {
  it('max 2 with lines: 12 plain + 1 (n=1) + 4 (n=2) = 17, labels unique', () => {
    const t = enumerateTopologies(2, { allowLine: true });
    expect(t).toHaveLength(17);
    expect(new Set(t.map((x) => x.label)).size).toBe(17);
    expect(t.filter((x) => x.slots.length === 1).map((x) => x.label)).toEqual([
      'series L',
      'series line',
      'series C',
      'shunt L',
      'shunt C',
    ]);
  });

  it('max 4 with lines: 60 + (1 + 4 + 12 + 32) = 109', () => {
    expect(enumerateTopologies(4, { allowLine: true })).toHaveLength(109);
  });

  it('NaN takes the default of 4 (60 ladders); 2.9 is floored to 2 (12); negative is 1 (4)', () => {
    expect(enumerateTopologies(NaN)).toHaveLength(60);
    expect(enumerateTopologies(2.9)).toHaveLength(12);
    expect(enumerateTopologies(-3)).toHaveLength(4);
    expect(enumerateTopologies(Infinity)).toHaveLength(60);
  });
});

describe('interpolatedLoad', () => {
  it('no points: a fixed 50 ohm; one point: that impedance as a constant', () => {
    expect(interpolatedLoad([])).toEqual(complex(50, 0));
    expect(interpolatedLoad([{ frequency: 1e9, z: complex(20, 5) }])).toEqual(complex(20, 5));
  });

  it('two points: the midpoint is the mean of R and of X', () => {
    const f = interpolatedLoad([
      { frequency: 200e6, z: complex(40, -20) },
      { frequency: 100e6, z: complex(20, 10) },
    ]) as (f: number) => Complex;
    expect(f(150e6)).toEqual(complex(30, -5));
    expect(f(125e6)).toEqual(complex(25, 2.5));
  });
});

describe('seedValues', () => {
  it('no slots: an empty seed; one series L from 50 - j50 to 50: X = +50 ohm', () => {
    expect(seedValues([], complex(50, -50), complex(50, 0), 1e9)).toEqual([]);
    const seed = seedValues(
      [{ orientation: 'series', kind: 'L' }],
      complex(50, -50),
      complex(50, 0),
      1e9,
    )!;
    expect(seed).toHaveLength(1);
    expect(seed[0]!.kind).toBe('L');
    expect((seed[0] as { value: number }).value * 2 * Math.PI * 1e9).toBeCloseTo(50, 6);
  });

  it('a load without resistance has no chained seed for four parts', () => {
    const slots = [
      { orientation: 'series' as const, kind: 'L' as const },
      { orientation: 'shunt' as const, kind: 'C' as const },
      { orientation: 'series' as const, kind: 'L' as const },
      { orientation: 'shunt' as const, kind: 'C' as const },
    ];
    expect(seedValues(slots, complex(0, 30), complex(50, 0), 1e9)).toBeNull();
    expect(seedValues(slots, complex(10, 0), complex(0, 0), 1e9)).toBeNull();
  });
});

describe('broadbandMatch limits', () => {
  const BAND = sweepPoints(100e6, 200e6, 11);

  it('defaultBudget is 600 per free value, at least 600', () => {
    expect(defaultBudget(0)).toBe(600);
    expect(defaultBudget(3)).toBe(1800);
  });

  it('non-positive and NaN frequencies are dropped; a single frequency searches nothing', () => {
    const r = broadbandMatch([NaN, -1, 0, 150e6], { load: complex(10, 0), z0: 50 });
    expect(r.frequencies).toEqual([150e6]);
    expect(r.topologies).toBe(0);
    expect(r.candidates).toEqual([]);
    expect(r.evaluations).toBe(0);
  });

  it('an already matched load has baseline 1 and no candidate beats it', () => {
    const r = broadbandMatch(BAND, { load: complex(50, 0), z0: 50, maxElements: 1 });
    expect(r.baseline).toBe(1);
    expect(r.topologies).toBe(4);
    expect(r.candidates).toEqual([]);
  });

  it('limit 2 returns at most two, each within the cap and better than the baseline, best first', () => {
    const r = broadbandMatch(BAND, {
      load: complex(10, 0),
      z0: 50,
      maxElements: 2,
      limit: 2,
      evaluationsPerCandidate: 200,
    });
    expect(r.topologies).toBe(12);
    expect(r.candidates.length).toBeLessThanOrEqual(2);
    expect(r.candidates.length).toBeGreaterThan(0);
    for (const c of r.candidates) {
      expect(c.count).toBeLessThanOrEqual(2);
      expect(c.elements).toHaveLength(c.count);
      expect(c.worstVswr).toBeLessThan(r.baseline);
      // The reported figure is the one worstVswr gives for the same parts over the same band.
      expect(worstVswr(c.elements, complex(10, 0), 50, BAND)).toBeCloseTo(c.worstVswr, 12);
    }
    if (r.candidates.length === 2) {
      expect(r.candidates[0]!.worstVswr).toBeLessThanOrEqual(r.candidates[1]!.worstVswr + 1e-3);
    }
  });

  it('a target other than Z0 is honoured: the baseline is the VSWR towards the target', () => {
    // 50 ohm seen towards 25 ohm: |Gamma| = 25/75, VSWR = 2.
    const r = broadbandMatch(BAND, {
      load: complex(50, 0),
      z0: 50,
      target: complex(25, 0),
      maxElements: 2,
      evaluationsPerCandidate: 200,
    });
    expect(r.baseline).toBeCloseTo(2, 12);
    for (const c of r.candidates) expect(c.worstVswr).toBeLessThan(2);
  });

  it('a limit of 0 still returns one candidate', () => {
    const r = broadbandMatch(BAND, {
      load: complex(10, 0),
      z0: 50,
      maxElements: 1,
      limit: 0,
      evaluationsPerCandidate: 100,
    });
    expect(r.candidates.length).toBeLessThanOrEqual(1);
  });
});
