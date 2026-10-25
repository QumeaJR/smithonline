import { describe, expect, it } from 'vitest';
import {
  broadbandMatch,
  complex,
  defaultBudget,
  enumerateTopologies,
  interpolatedLoad,
  lMatch,
  seedValues,
  sweepPoints,
  worstVswr,
  type BroadbandResult,
} from '../src/index';

const LOAD = complex(10, 0);
const BAND = sweepPoints(100e6, 200e6, 21);
const F0 = 150e6;

describe('enumerateTopologies', () => {
  it('lists both orders and both part kinds per slot, alternating series and shunt', () => {
    const t = enumerateTopologies(3);
    // 2 first orientations x 2^n kinds, for n = 1, 2, 3.
    expect(t).toHaveLength(2 * (2 + 4 + 8));
    for (const topo of t) {
      topo.slots.forEach((s, i) => {
        if (i > 0) expect(s.orientation).not.toBe(topo.slots[i - 1]!.orientation);
        expect(['L', 'C']).toContain(s.kind);
      });
    }
    const labels = new Set(t.map((x) => x.label));
    expect(labels.size).toBe(t.length);
    expect(labels.has('series L + shunt C')).toBe(true);
    expect(labels.has('shunt C + series L')).toBe(true);
  });

  it('clamps the cap to 1 to 8', () => {
    expect(enumerateTopologies(0).every((t) => t.slots.length === 1)).toBe(true);
    expect(Math.max(...enumerateTopologies(50, {}).map((t) => t.slots.length))).toBe(8);
  });

  it('adds ladders with one series line when asked', () => {
    const plain = enumerateTopologies(3);
    const lined = enumerateTopologies(3, { allowLine: true });
    const withLine = lined.filter((t) => t.slots.some((s) => s.kind === 'line'));
    expect(withLine.length).toBeGreaterThan(0);
    expect(lined.length).toBe(plain.length + withLine.length);
    for (const t of withLine) {
      expect(t.slots.filter((s) => s.kind === 'line')).toHaveLength(1);
      expect(t.slots.find((s) => s.kind === 'line')!.orientation).toBe('series');
    }
  });
});

describe('seedValues', () => {
  it('reproduces the exact L-match for a two-part shape', () => {
    const sol = lMatch(LOAD, complex(50, 0), F0)[0]!;
    const slots = sol.elements.map((e) => ({
      orientation: (e as { orientation: 'series' | 'shunt' }).orientation,
      kind: e.kind as 'L' | 'C',
    }));
    const seed = seedValues(slots, LOAD, complex(50, 0), F0)!;
    expect(seed).toEqual(sol.elements);
  });

  it('chains sections for four parts and lands on the target at band centre', () => {
    const [topo] = enumerateTopologies(4).filter((t) => t.slots.length === 4);
    // Some four-part shapes have no exact chain; at least one does.
    const seeded = enumerateTopologies(4)
      .filter((t) => t.slots.length === 4)
      .map((t) => ({ t, seed: seedValues(t.slots, LOAD, complex(50, 0), F0) }))
      .filter((x) => x.seed !== null);
    expect(topo).toBeDefined();
    expect(seeded.length).toBeGreaterThan(0);
    for (const { seed } of seeded) {
      expect(worstVswr(seed!, LOAD, 50, [F0])).toBeLessThan(1.0001);
    }
  });

  it('has no seed for a ladder with a line', () => {
    expect(
      seedValues(
        [
          { orientation: 'series', kind: 'line' },
          { orientation: 'shunt', kind: 'C' },
        ],
        LOAD,
        complex(50, 0),
        F0,
      ),
    ).toBeNull();
  });
});

describe('interpolatedLoad', () => {
  const load = interpolatedLoad([
    { frequency: 140e6, z: complex(40, 10) },
    { frequency: 150e6, z: complex(60, -10) },
    { frequency: 145e6, z: complex(50, 0) },
  ]);
  it('interpolates between the points whatever their order and holds the ends', () => {
    if (typeof load !== 'function') throw new Error('expected a function');
    expect(load(145e6)).toEqual(complex(50, 0));
    expect(load(147.5e6).re).toBeCloseTo(55, 9);
    expect(load(147.5e6).im).toBeCloseTo(-5, 9);
    expect(load(100e6)).toEqual(complex(40, 10));
    expect(load(200e6)).toEqual(complex(60, -10));
  });
});

describe('broadbandMatch, 10 ohm over 100 to 200 MHz', () => {
  const run = (maxElements: number, extra = {}): BroadbandResult =>
    broadbandMatch(BAND, { load: LOAD, z0: 50, maxElements, ...extra });

  const four = run(4);
  const two = run(2);

  it('finds a four-part network that beats the best two-part one', () => {
    const best4 = four.candidates[0]!;
    const best2 = two.candidates[0]!;
    expect(best4.count).toBeLessThanOrEqual(4);
    expect(best4.worstVswr).toBeLessThan(best2.worstVswr - 0.1);
    // The reported number is what the ladder shows when the parts are applied, on the dense
    // scoring grid (which holds the band points, so it is never below their worst).
    expect(worstVswr(best4.elements, LOAD, 50, four.scoringFrequencies)).toBeCloseTo(
      best4.worstVswr,
      9,
    );
    expect(best4.worstVswr).toBeGreaterThanOrEqual(worstVswr(best4.elements, LOAD, 50, BAND));
  });

  it('with a cap of 2 returns only two-part results', () => {
    expect(two.candidates.length).toBeGreaterThan(0);
    expect(two.candidates.every((c) => c.count === 2)).toBe(true);
    expect(two.maxElements).toBe(2);
    // One part cannot beat the bare load (VSWR 5), so none is listed.
    expect(two.baseline).toBeCloseTo(5, 6);
  });

  it('ranks by worst VSWR, then by number of parts', () => {
    const c = four.candidates;
    for (let i = 1; i < c.length; i++) {
      const a = Math.round(c[i - 1]!.worstVswr * 1000);
      const b = Math.round(c[i]!.worstVswr * 1000);
      expect(a).toBeLessThanOrEqual(b);
      if (a === b) expect(c[i - 1]!.count).toBeLessThanOrEqual(c[i]!.count);
    }
  });

  it('is deterministic and reports the evaluations it spent within the budget', () => {
    const again = run(4);
    expect(again.candidates.map((c) => [c.topology.label, c.worstVswr])).toEqual(
      four.candidates.map((c) => [c.topology.label, c.worstVswr]),
    );
    expect(again.evaluations).toBe(four.evaluations);
    expect(four.topologies).toBe(60);
    expect(four.evaluations).toBeGreaterThan(0);
    expect(four.evaluations).toBeLessThanOrEqual(
      enumerateTopologies(4).reduce((s, t) => s + defaultBudget(t.slots.length), 0),
    );
  });

  it('respects a small evaluation budget per candidate', () => {
    const tiny = run(3, { evaluationsPerCandidate: 40 });
    expect(tiny.evaluations).toBeLessThanOrEqual(enumerateTopologies(3).length * 41);
  });

  it('has no Bode-Fano floor for a fixed load', () => {
    expect(four.floor).toBeNull();
  });

  it('keeps existing parts as a prefix and improves on them', () => {
    const prefix = two.candidates[0]!.elements;
    const withPrefix = run(2, { prefix });
    expect(withPrefix.baseline).toBeCloseTo(two.candidates[0]!.worstVswr, 6);
    const best = withPrefix.candidates[0]!;
    expect(best.worstVswr).toBeLessThan(withPrefix.baseline);
    expect(
      worstVswr([...prefix, ...best.elements], LOAD, 50, withPrefix.scoringFrequencies),
    ).toBeCloseTo(best.worstVswr, 9);
  });

  it('reports progress per topology', () => {
    const seen: number[] = [];
    broadbandMatch(BAND, {
      load: LOAD,
      z0: 50,
      maxElements: 2,
      evaluationsPerCandidate: 100,
      onProgress: (p) => seen.push(p.done),
    });
    expect(seen).toHaveLength(enumerateTopologies(2).length);
    expect(seen[seen.length - 1]).toBe(seen.length);
  });
});

describe('broadbandMatch with a load that has a bandwidth', () => {
  // 50 ohm in parallel with 20 pF: a load with a real Q.
  const rc = (f: number) => {
    const y = complex(1 / 50, 2 * Math.PI * f * 20e-12);
    const d = y.re * y.re + y.im * y.im;
    return complex(y.re / d, -y.im / d);
  };
  const band = sweepPoints(140e6, 150e6, 21);

  it('reports the Bode-Fano floor and no candidate sits below it', () => {
    const res = broadbandMatch(band, { load: rc, z0: 50, maxElements: 2 });
    expect(res.floor).not.toBeNull();
    expect(res.floor!.floor).toBeGreaterThanOrEqual(1);
    expect(res.candidates.length).toBeGreaterThan(0);
    expect(res.candidates[0]!.worstVswr).toBeGreaterThanOrEqual(res.floor!.floor - 1e-6);
  });

  it('returns nothing for an empty band and sorts a reversed one', () => {
    expect(broadbandMatch([], { load: rc, z0: 50 }).candidates).toEqual([]);
    const reversed = broadbandMatch([200e6, 150e6, 100e6], {
      load: rc,
      z0: 50,
      maxElements: 1,
      evaluationsPerCandidate: 50,
    });
    expect(reversed.frequencies).toEqual([100e6, 150e6, 200e6]);
  });
});
