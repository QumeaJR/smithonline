import { complex } from '@smithonline/core';
import { describe, expect, it } from 'vitest';
import {
  declutterLabels,
  designFrequencyIndex,
  designPointIndex,
  labelledSweepIndices,
} from '../src/chart/sweepLabels';

describe('adv declutterLabels', () => {
  it.skip('THEORETICAL NaN position is skipped like a null position', () => {
    const r = declutterLabels([0, 1], (i) => ({ x: NaN, y: i }), 2, 1);
    expect(r).toEqual([]);
  });

  it.skip('THEORETICAL two NaN-position labels do not both survive', () => {
    const r = declutterLabels([0, 1], () => ({ x: NaN, y: NaN }), 2, 1);
    expect(r.length).toBeLessThanOrEqual(1);
  });

  it.skip('THEORETICAL NaN width or height does not switch decluttering off', () => {
    expect(declutterLabels([0, 1], () => ({ x: 0, y: 0 }), NaN, 1)).toEqual([0]);
    expect(declutterLabels([0, 1], () => ({ x: 0, y: 0 }), 1, NaN)).toEqual([0]);
  });

  it.skip('THEORETICAL a repeated index appears once in the result (width 0)', () => {
    expect(declutterLabels([3, 3, 3], () => ({ x: 0, y: 0 }), 0, 0)).toEqual([3]);
  });

  it('a repeated index appears once in the result (normal width)', () => {
    expect(declutterLabels([3, 3], () => ({ x: 0, y: 0 }), 2, 1)).toEqual([3]);
  });

  it('infinite width keeps exactly one label', () => {
    expect(
      declutterLabels([0, 1, 2], (i) => ({ x: i * 100, y: i * 100 }), Infinity, Infinity),
    ).toEqual([0]);
  });

  it('negative width: nothing collides, all kept (documented as sane)', () => {
    expect(declutterLabels([0, 1], () => ({ x: 0, y: 0 }), -1, -1)).toEqual([0, 1]);
  });

  it('is not quadratic on a long non-colliding order (20000 labels < 1 s)', () => {
    const order = Array.from({ length: 20000 }, (_, i) => i);
    const t = performance.now();
    declutterLabels(order, (i) => ({ x: i * 10, y: 0 }), 1, 1);
    const dt = performance.now() - t;
    console.log('declutter 20000 ms', dt);
    expect(dt).toBeLessThan(1000);
  });

  it('result is sorted although order is not', () => {
    expect(declutterLabels([5, 1, 3], (i) => ({ x: i * 10, y: 0 }), 1, 1)).toEqual([1, 3, 5]);
  });
});

describe('adv designPointIndex', () => {
  const pts = [
    { frequency: 1e9, z: complex(50, 0) },
    { frequency: 2e9, z: complex(60, 5) },
    { frequency: 2e9, z: complex(60, 5) },
  ];

  it('NaN design load falls back to the first at the frequency', () => {
    expect(designPointIndex(pts, 2e9, complex(NaN, NaN))).toBe(1);
  });

  it('NaN rows never match an exact load, even NaN design load', () => {
    const rows = [
      { frequency: 1e9, z: complex(NaN, NaN) },
      { frequency: 1e9, z: complex(50, 0) },
    ];
    expect(designPointIndex(rows, 1e9, complex(50, 0))).toBe(1);
    expect(designPointIndex(rows, 1e9, complex(NaN, NaN))).toBe(0);
  });

  it.skip('THEORETICAL infinite load (open) matches an infinite row', () => {
    const rows = [
      { frequency: 1e9, z: complex(1, 0) },
      { frequency: 1e9, z: complex(Infinity, 0) },
    ];
    expect(designPointIndex(rows, 1e9, complex(Infinity, 0))).toBe(1);
  });

  it.skip('THEORETICAL frequency 0 finds a point at 0 Hz', () => {
    const rows = [
      { frequency: 0, z: complex(10, 0) },
      { frequency: 1e9, z: complex(20, 0) },
    ];
    expect(designPointIndex(rows, 0, complex(10, 0))).toBe(0);
  });

  it('negative zero load matches zero row', () => {
    expect(designPointIndex([{ frequency: 1e9, z: complex(0, 0) }], 1e9, complex(-0, -0))).toBe(0);
  });

  it('duplicate matches: first wins', () => {
    expect(designPointIndex(pts, 2e9, complex(60, 5))).toBe(1);
  });

  it.skip('MISSPECIFIED same frequency, loads differ by 1e-8 ohm: exact one is picked, not first', () => {
    const rows = [
      { frequency: 1e9, z: complex(50.00000001, 0) },
      { frequency: 1e9, z: complex(50, 0) },
    ];
    expect(designPointIndex(rows, 1e9, complex(50, 0))).toBe(1);
  });

  it.skip('MISSPECIFIED a huge load tolerance is relative: 1e12 vs 1e12+1 are the same point', () => {
    const rows = [
      { frequency: 1e9, z: complex(1e12 + 5, 0) },
      { frequency: 1e9, z: complex(1e12, 0) },
    ];
    // 5 / 1e12 = 5e-12 < 1e-9 so the first is "exact"
    expect(designPointIndex(rows, 1e9, complex(1e12, 0))).toBe(1);
  });

  it('timing: 100000 rows at one frequency', () => {
    const rows = Array.from({ length: 100000 }, (_, i) => ({ frequency: 1e9, z: complex(i, 0) }));
    const t = performance.now();
    designPointIndex(rows, 1e9, complex(99999, 0));
    const dt = performance.now() - t;
    console.log('designPointIndex 100000 ms', dt);
    expect(dt).toBeLessThan(500);
  });
});

describe('adv designFrequencyIndex', () => {
  it('two points inside the tolerance of each other: nearest, not first', () => {
    expect(designFrequencyIndex([1e9 + 900, 1e9 + 100], 1e9)).toBe(1);
  });
  it('negative frequencies in the list', () => {
    expect(designFrequencyIndex([-1e9, 1e9], 1e9)).toBe(1);
  });
  it('subnormal design frequency does not divide to Infinity', () => {
    expect(designFrequencyIndex([5e-324], 5e-324)).toBe(0);
  });
});

describe('adv labelledSweepIndices', () => {
  it('keep beyond n only when n > max', () => {
    expect(labelledSweepIndices(13, 12, 12)).toContain(12);
  });
  it('max 3 with a keep in the middle gives first, keep, last', () => {
    expect(labelledSweepIndices(50, 3, 25)).toEqual([0, 25, 49]);
  });
  it('max 3 with keep at the first index', () => {
    expect(labelledSweepIndices(50, 3, 0)).toEqual([0, 49]);
  });
  it('max 3 with keep next to an end keeps at most 3', () => {
    const r = labelledSweepIndices(50, 3, 1);
    expect(r.length).toBeLessThanOrEqual(3);
    expect(r).toContain(0);
    expect(r).toContain(49);
    expect(r).toContain(1);
  });
  it('max 4 and keep near an end', () => {
    for (let keep = 0; keep < 50; keep++) {
      const r = labelledSweepIndices(50, 4, keep);
      expect(r.length).toBeLessThanOrEqual(4);
      expect(r).toContain(keep);
      expect(r).toContain(0);
      expect(r).toContain(49);
    }
  });
});
