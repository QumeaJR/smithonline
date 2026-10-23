import { monteCarlo } from '@smithonline/core';
import { describe, expect, it } from 'vitest';
import { toleranceOf } from '../src/lib/build';
import { emptyDesign, identify, type Design } from '../src/lib/design';
import { exportLadderOf } from '../src/lib/simexport';
import { decodeDesign, encodeDesign } from '../src/lib/share';
import {
  bandFrequencies,
  cloudPath,
  defaultTolerance,
  defaultToleranceLabel,
  monteCarloOptions,
} from '../src/lib/tolerance';
import { useDesignStore } from '../src/store/useDesignStore';

const base: Design = {
  ...emptyDesign(),
  frequency: 450e6,
  load: { re: 20, im: -12 },
  elements: identify([
    { kind: 'L', orientation: 'shunt', value: 16e-9 },
    { kind: 'C', orientation: 'series', value: 22e-12 },
  ]),
  sweep: { enabled: true, start: 225e6, stop: 900e6, points: 91 },
};

describe('default tolerance', () => {
  it('follows the series of the Realize setting', () => {
    expect(defaultTolerance(base)).toBe(0.05);
    expect(defaultTolerance({ ...base, realize: { ...base.realize, series: 'E12' } })).toBe(0.1);
    expect(defaultTolerance({ ...base, realize: { ...base.realize, series: 'E96' } })).toBe(0.01);
    expect(defaultTolerance({ ...base, realize: { ...base.realize, series: 'stock' } })).toBe(0.05);
    expect(defaultToleranceLabel(base)).toBe('5 % from E24');
  });

  it('is replaced by a typed percentage', () => {
    const d: Design = {
      ...base,
      tolerance: { ...monteCarloSettings(), percent: 2 },
    };
    expect(defaultTolerance(d)).toBe(0.02);
    expect(defaultToleranceLabel(d)).toBe('2 % typed');
  });
});

function monteCarloSettings(): NonNullable<Design['tolerance']> {
  return {
    runs: 1000,
    seed: 1,
    distribution: 'uniform',
    percent: null,
    vswrLimit: 2,
    overBand: false,
    overrides: {},
  };
}

describe('options from the design', () => {
  it('map element ids to indices, lock to exact, and add the band on request', () => {
    const [a, b] = base.elements;
    const d: Design = {
      ...base,
      elements: [{ ...a!, locked: true }, b!],
      tolerance: { ...monteCarloSettings(), overrides: { [b!.id]: 1 }, overBand: true, runs: 50 },
    };
    const o = monteCarloOptions(d);
    expect(o.runs).toBe(50);
    expect(o.exact).toEqual([0]);
    expect(o.overrides).toEqual({ 1: 0.01 });
    expect(o.tolerance).toBe(0.05);
    expect(o.band).toHaveLength(41);
    expect(monteCarloOptions(base).band).toBeUndefined();
  });

  it('has no band without a usable sweep range', () => {
    expect(bandFrequencies({ ...base, sweep: { ...base.sweep, start: 0, stop: 0 } })).toEqual([]);
  });

  it('run on the network the design shows', () => {
    const r = monteCarlo(exportLadderOf(base, null), { ...monteCarloOptions(base), runs: 200 });
    expect(r.runs).toBe(200);
    expect(r.nominal.vswr).toBeGreaterThan(1);
  });
});

describe('cloud path', () => {
  it('is one zero-length segment per point in chart coordinates', () => {
    const d = cloudPath([50, 100], [0, 50], 50);
    expect(d).toBe('M0.0000 0.0000h0M0.4000 -0.2000h0');
  });

  it('thins a big cloud, skips non-finite points and pulls far points in', () => {
    const n = 50000;
    const re = new Float64Array(n).fill(50);
    const im = new Float64Array(n);
    expect(cloudPath(re, im, 50, 1000).split('M').length - 1).toBeLessThanOrEqual(1000);
    expect(cloudPath([NaN], [0], 50)).toBe('');
    const far = cloudPath([1e-9], [1e9], 50);
    const [x, y] = far.slice(1, far.indexOf('h')).split(' ').map(Number);
    expect(Math.hypot(x!, y!)).toBeLessThanOrEqual(3.0001);
  });
});

describe('tolerance settings in the design', () => {
  it('survive a share link and are absent from an old one', () => {
    const d: Design = {
      ...emptyDesign(),
      tolerance: {
        ...monteCarloSettings(),
        runs: 250,
        distribution: 'normal',
        overrides: { x: 2 },
      },
    };
    expect(decodeDesign(encodeDesign(d))?.tolerance).toEqual(d.tolerance);
    expect(decodeDesign(encodeDesign(emptyDesign()))?.tolerance).toBeUndefined();
  });

  it('are put in range when decoded', () => {
    expect(toleranceOf(null)).toBeNull();
    const t = toleranceOf({
      runs: 1e9,
      seed: 3.7,
      distribution: 'weird',
      percent: -4,
      vswrLimit: 0.5,
      overBand: 'yes',
      overrides: { a: 5, b: -1, c: 'x', d: 400 },
    })!;
    expect(t).toEqual({
      runs: 100000,
      seed: 4,
      distribution: 'uniform',
      percent: null,
      vswrLimit: 2,
      overBand: false,
      overrides: { a: 5 },
    });
  });

  it('are set through the store in one history step', () => {
    useDesignStore.getState().init(emptyDesign());
    useDesignStore.getState().setTolerance({ runs: 77 });
    expect(useDesignStore.getState().design.tolerance?.runs).toBe(77);
    expect(useDesignStore.getState().design.tolerance?.vswrLimit).toBe(2);
    useDesignStore.getState().undo();
    expect(useDesignStore.getState().design.tolerance).toBeUndefined();
  });
});
