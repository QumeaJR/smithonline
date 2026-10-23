import { describe, expect, it } from 'vitest';
import { withPrimaryValue } from '../src/optimize.js';
import {
  complex,
  evaluateLadder,
  gammaTowards,
  lMatch,
  nearestIndex,
  nearestInSeries,
  realizableValues,
  realizeLadder,
  realizeSolutions,
  seriesWindow,
  stockWindow,
  vswrTowards,
  type Ladder,
} from '../src/index';

/** Example 5 of Smith V4.1: 20 - j12 at 450 MHz matched with five elements. */
const example5: Ladder = {
  z0: 50,
  frequency: 450e6,
  load: complex(20, -12),
  elements: [
    { kind: 'L', orientation: 'shunt', value: 1.6033386409903585e-8 },
    { kind: 'C', orientation: 'series', value: 2.1835513398047903e-11 },
    { kind: 'L', orientation: 'shunt', value: 2.1883430954167689e-8 },
    { kind: 'C', orientation: 'series', value: 1.6e-11 },
    { kind: 'L', orientation: 'shunt', value: 2.9500000000000003e-8 },
  ],
};

describe('mismatch towards a target', () => {
  it('is the ordinary VSWR for a real target', () => {
    expect(vswrTowards(complex(50, 0), complex(50, 0))).toBe(1);
    expect(vswrTowards(complex(100, 0), complex(50, 0))).toBeCloseTo(2, 12);
    expect(vswrTowards(complex(25, 0), complex(50, 0))).toBeCloseTo(2, 12);
    const r = evaluateLadder(example5);
    expect(vswrTowards(r.zin, complex(50, 0))).toBeCloseTo(r.info[r.info.length - 1]!.vswr, 12);
  });

  it('is zero mismatch exactly at a complex target and finite nearby', () => {
    expect(gammaTowards(complex(30, 20), complex(30, 20))).toBe(0);
    expect(vswrTowards(complex(30, 20), complex(30, 20))).toBe(1);
    expect(vswrTowards(complex(30, 25), complex(30, 20))).toBeGreaterThan(1);
    expect(vswrTowards(complex(30, 25), complex(30, 20))).toBeLessThan(1.2);
  });

  it('reports an infinite VSWR for a short, an open and non-finite input', () => {
    expect(vswrTowards(complex(0, 0), complex(50, 0))).toBe(Infinity);
    expect(vswrTowards(complex(Infinity, 0), complex(50, 0))).toBe(Infinity);
    expect(vswrTowards(complex(NaN, 0), complex(50, 0))).toBe(Infinity);
  });
});

describe('series and stock windows', () => {
  it('centres the E24 window on the nearest value', () => {
    expect(seriesWindow(16e-9, 'E24', 2)).toEqual([13e-9, 15e-9, 16e-9, 18e-9, 20e-9]);
    expect(seriesWindow(16.03e-9, 'E24', 2)).toEqual([13e-9, 15e-9, 16e-9, 18e-9, 20e-9]);
    expect(seriesWindow(17e-9, 'E24', 1)).toEqual([16e-9, 18e-9, 20e-9]);
  });

  it('crosses decade boundaries in both directions without float noise', () => {
    expect(seriesWindow(1e-9, 'E6', 2)).toEqual([4.7e-10, 6.8e-10, 1e-9, 1.5e-9, 2.2e-9]);
    expect(seriesWindow(9.1e-12, 'E24', 2)).toEqual([7.5e-12, 8.2e-12, 9.1e-12, 10e-12, 11e-12]);
    expect(seriesWindow(1000, 'E12', 1)).toEqual([820, 1000, 1200]);
    expect(seriesWindow(0.1, 'E6', 1)).toEqual([0.068, 0.1, 0.15]);
  });

  it('is empty for a non-positive centre and a single value for span 0', () => {
    expect(seriesWindow(0, 'E24', 3)).toEqual([]);
    expect(seriesWindow(-5, 'E24', 3)).toEqual([]);
    expect(seriesWindow(NaN, 'E24', 3)).toEqual([]);
    expect(seriesWindow(16e-9, 'E24', 0)).toEqual([16e-9]);
  });

  it('every window value is a member of its series', () => {
    for (const c of [1.234e-12, 3.3e-9, 47, 999e3, 7e6]) {
      for (const v of seriesWindow(c, 'E96', 12)) expect(nearestInSeries(v, 'E96')).toBe(v);
    }
  });

  it('clips the stock window at the ends of the list and drops junk', () => {
    const stock = [22e-9, 10e-9, 15e-9, 0, -1, NaN, 15e-9];
    expect(stockWindow(14e-9, stock, 1)).toEqual([10e-9, 15e-9, 22e-9]);
    expect(stockWindow(9e-9, stock, 1)).toEqual([10e-9, 15e-9]);
    expect(stockWindow(1, stock, 5)).toEqual([10e-9, 15e-9, 22e-9]);
    expect(stockWindow(1, [], 5)).toEqual([]);
  });

  it('realizableValues picks the series window or the stock of the part kind', () => {
    expect(realizableValues({ kind: 'series', series: 'E24' }, 'L', 16e-9, 1)).toEqual([
      15e-9, 16e-9, 18e-9,
    ]);
    const stock = { L: [10e-9, 22e-9], C: [1e-12], R: [] };
    expect(realizableValues({ kind: 'stock', stock }, 'L', 16e-9)).toEqual([10e-9, 22e-9]);
    expect(realizableValues({ kind: 'stock', stock }, 'R', 16)).toEqual([]);
  });

  it('nearestIndex uses log distance', () => {
    expect(nearestIndex([10e-9, 15e-9, 22e-9], 14e-9)).toBe(1);
    expect(nearestIndex([10e-9, 15e-9, 22e-9], 12.2e-9)).toBe(0);
    expect(nearestIndex([10e-9, 15e-9, 22e-9], 12.3e-9)).toBe(1);
    expect(nearestIndex([], 1)).toBe(0);
  });
});

describe('realizeSolutions', () => {
  const bare: Ladder = { ...example5, elements: [] };
  const target = complex(50, 0);
  const solutions = lMatch(bare.load, target, bare.frequency);

  it('snaps every added part to the series and ranks by the VSWR after snapping', () => {
    expect(solutions.length).toBeGreaterThan(1);
    const realized = realizeSolutions(bare, solutions, {
      source: { kind: 'series', series: 'E24' },
      scope: 'all',
      target,
    });
    expect(realized).toHaveLength(solutions.length);
    for (const r of realized) {
      expect(r.elements).toHaveLength(r.solution.elements.length);
      for (const el of r.elements) {
        const v = (el as { value: number }).value;
        expect(nearestInSeries(v, 'E24')).toBe(v);
      }
      expect(r.vswr).toBeCloseTo(vswrTowards(r.zin, target), 12);
      // The realized ladder is the bare ladder plus the snapped parts.
      expect(r.realization.ladder.elements).toEqual(r.elements);
    }
    for (let i = 1; i < realized.length; i++) {
      expect(realized[i]!.vswr).toBeGreaterThanOrEqual(realized[i - 1]!.vswr);
    }
    // The ideal solutions land on the target; the snapped ones miss it a little.
    expect(realized[0]!.vswr).toBeGreaterThan(1);
    expect(realized[0]!.vswr).toBeLessThan(1.3);
  });

  it('keeps the existing parts and only appends the new ones', () => {
    const realized = realizeSolutions(example5, solutions, {
      source: { kind: 'series', series: 'E24' },
      scope: 'all',
    });
    for (const r of realized) {
      expect(r.realization.ladder.elements).toHaveLength(5 + r.solution.elements.length);
      expect(r.elements).toEqual(r.realization.ladder.elements.slice(5));
    }
  });

  it('leaves parts exact when the stock has nothing for their kind', () => {
    const realized = realizeSolutions(bare, solutions, {
      source: { kind: 'stock', stock: { L: [10e-9, 15e-9, 22e-9, 33e-9], C: [], R: [] } },
      scope: 'all',
    });
    for (const r of realized) {
      r.elements.forEach((el, k) => {
        const ideal = (r.solution.elements[k] as { value: number }).value;
        const v = (el as { value: number }).value;
        if (el.kind === 'C') expect(v).toBe(ideal);
        else expect([10e-9, 15e-9, 22e-9, 33e-9]).toContain(v);
      });
    }
  });
});

describe('realizeLadder with a target', () => {
  it('gives the same answer as without one when the target is Z0', () => {
    const a = realizeLadder(example5, { source: { kind: 'series', series: 'E24' }, scope: 'all' });
    const b = realizeLadder(example5, {
      source: { kind: 'series', series: 'E24' },
      scope: 'all',
      target: complex(50, 0),
    });
    expect(b.ladder.elements).toEqual(a.ladder.elements);
  });

  it('ranks the bracketing values by the mismatch towards a complex target', () => {
    // A single series L from 20 - j12 towards 20 + j20: the ideal is 11.3 nH.
    const ladder: Ladder = {
      z0: 50,
      frequency: 450e6,
      load: complex(20, -12),
      elements: [{ kind: 'L', orientation: 'series', value: 32 / (2 * Math.PI * 450e6) }],
    };
    const target = complex(20, 20);
    const r = realizeLadder(ladder, {
      source: { kind: 'series', series: 'E6' },
      scope: 'all',
      target,
    });
    const v = (r.ladder.elements[0] as { value: number }).value;
    // E6 offers 10 nH and 15 nH; 10 nH (X = 28.3) is nearer to +j20 than 15 nH (X = 42.4).
    expect(v).toBe(10e-9);
    expect(vswrTowards(r.result.zin, target)).toBeLessThan(
      vswrTowards(
        evaluateLadder({ ...ladder, elements: [withPrimaryValue(ladder.elements[0]!, 15e-9)] }).zin,
        target,
      ),
    );
  });
});
