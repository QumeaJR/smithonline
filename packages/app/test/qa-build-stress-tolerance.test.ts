/**
 * QA round 1: payload decoders (lib/build.ts), stress helpers and tolerance
 * helpers at their limits.
 */
import { complex } from '@smithonline/core';
import { describe, expect, it } from 'vitest';
import { limitsOf, stressOf, toleranceOf } from '../src/lib/build';
import { emptyDesign, identify, type Design } from '../src/lib/design';
import { activeLimits, designStress, powerToWatt } from '../src/lib/stress';
import {
  bandFrequencies,
  cloudPath,
  defaultTolerance,
  defaultToleranceLabel,
  monteCarloOptions,
} from '../src/lib/tolerance';

describe('toleranceOf', () => {
  it('clamps runs to 1..100000 and rounds; rounds the seed; vswrLimit below 1 is 2; percent above 100 is null', () => {
    expect(toleranceOf({ runs: 0 })!.runs).toBe(1);
    expect(toleranceOf({ runs: 1e9 })!.runs).toBe(100000);
    expect(toleranceOf({ runs: 2.5 })!.runs).toBe(3);
    expect(toleranceOf({ runs: 'x' })!.runs).toBe(1000);
    expect(toleranceOf({ seed: 1.5 })!.seed).toBe(2);
    expect(toleranceOf({ seed: NaN })!.seed).toBe(1);
    expect(toleranceOf({ vswrLimit: 0.5 })!.vswrLimit).toBe(2);
    // One rule since QA round 2 (0.6.0): a limit is above 1; a stored 1 opens as 2.
    expect(toleranceOf({ vswrLimit: 1 })!.vswrLimit).toBe(2);
    expect(toleranceOf({ vswrLimit: 1.01 })!.vswrLimit).toBe(1.01);
    expect(toleranceOf({ percent: 150 })!.percent).toBeNull();
    expect(toleranceOf({ percent: 0 })!.percent).toBe(0);
    expect(toleranceOf({ percent: -1 })!.percent).toBeNull();
  });

  it('keeps only overrides between 0 and 100 percent; odd flags take their defaults; non-objects are null', () => {
    const t = toleranceOf({
      overrides: { a: 101, b: -1, c: 'x', d: 50, e: 0 },
      distribution: 'weird',
      overBand: 'yes',
    })!;
    expect(t.overrides).toEqual({ d: 50, e: 0 });
    expect(t.distribution).toBe('uniform');
    expect(t.overBand).toBe(false);
    expect(toleranceOf(null)).toBeNull();
    expect(toleranceOf('x')).toBeNull();
    expect(toleranceOf(undefined)).toBeNull();
  });
});

describe('stressOf', () => {
  it('is null when nothing is carried; a unit alone or a limit alone counts', () => {
    expect(stressOf({ power: 'x' })).toBeNull();
    expect(stressOf({ limits: { X: { vPeak: 5 } } })).toBeNull();
    expect(stressOf({ limits: { L: { vPeak: 0, iRms: -1 } } })).toBeNull();
    expect(stressOf({ power: 0, unit: 'dBm' })).toEqual({ power: 0, unit: 'dBm', limits: {} });
    expect(stressOf({ limits: { C: { vPeak: 100 } } })).toEqual({
      power: 0,
      unit: 'W',
      limits: { C: { vPeak: 100 } },
    });
    expect(stressOf({ power: -3 })).toBeNull();
    expect(stressOf({ power: Infinity })).toBeNull();
  });
});

describe('limitsOf', () => {
  it('drops zero or infinite frequencies, NaN values, unknown kinds and quantities; gives a string id', () => {
    const good = { quantity: 'vswr', f1: 1e6, f2: 2e6, kind: 'max', value: 2 };
    expect(limitsOf([{ ...good, f1: 0 }])).toEqual([]);
    expect(limitsOf([{ ...good, f2: Infinity }])).toEqual([]);
    expect(limitsOf([{ ...good, value: NaN }])).toEqual([]);
    expect(limitsOf([{ ...good, kind: 'between' }])).toEqual([]);
    expect(limitsOf([{ ...good, quantity: 'gain' }])).toEqual([]);
    const [a] = limitsOf([{ ...good, id: 5 }, null, 'x']);
    expect(limitsOf([{ ...good, id: 5 }, null, 'x'])).toHaveLength(1);
    expect(typeof a!.id).toBe('string');
    expect(a!.id.length).toBeGreaterThan(0);
    expect(limitsOf([{ ...good, id: 'keep' }])[0]!.id).toBe('keep');
  });
});

describe('stress helpers', () => {
  it('powerToWatt: 0 W is 0 (off), non-finite input is refused before any conversion, 100 dBm is 1e7 W', () => {
    expect(powerToWatt(0, 'W')).toBe(0);
    expect(powerToWatt(-Infinity, 'dBm')).toBeNull();
    expect(powerToWatt(Infinity, 'W')).toBeNull();
    expect(powerToWatt(100, 'dBm')).toBeCloseTo(1e7, 0);
  });

  it('activeLimits drops NaN, zero and negative entries and whole kinds left empty', () => {
    expect(
      activeLimits({
        power: 1,
        unit: 'W',
        limits: { L: { vPeak: NaN, iRms: 0 }, C: { vPeak: -5 }, R: { iRms: 2 } },
      }),
    ).toEqual({ R: { iRms: 2 } });
  });

  it('designStress is null without power and one row per element with it', () => {
    const d: Design = {
      ...emptyDesign(),
      frequency: 100e6,
      elements: identify([
        { kind: 'L', orientation: 'series', value: 1e-7 },
        { kind: 'line', z0: 50, length: 0.1 },
      ]),
    };
    expect(designStress(d, d.elements, null)).toBeNull();
    const rows = designStress(
      { ...d, stress: { power: 1, unit: 'W', limits: {} } },
      d.elements,
      null,
    )!;
    expect(rows).toHaveLength(2);
    expect(rows[0]!.vPeak).toBeGreaterThan(0);
    expect(rows[1]).toBeNull();
  });
});

describe('tolerance helpers', () => {
  const base: Design = {
    ...emptyDesign(),
    frequency: 100e6,
    elements: identify([
      { kind: 'L', orientation: 'series', value: 1e-7 },
      { kind: 'C', orientation: 'shunt', value: 1e-11 },
    ]),
  };

  it('bandFrequencies swaps a reversed range, clamps the count to 5..41 and refuses a zero start', () => {
    const swapped = bandFrequencies({
      ...base,
      sweep: { ...base.sweep, start: 2e9, stop: 1e9, points: 3 },
    });
    expect(swapped).toHaveLength(5);
    expect(swapped[0]).toBe(1e9);
    expect(swapped[4]).toBe(2e9);
    expect(swapped[2]).toBeCloseTo(1.5e9, 3);
    expect(
      bandFrequencies({ ...base, sweep: { ...base.sweep, start: 1e9, stop: 2e9, points: 1000 } }),
    ).toHaveLength(41);
    expect(
      bandFrequencies({ ...base, sweep: { ...base.sweep, start: 0, stop: 2e9, points: 11 } }),
    ).toEqual([]);
    expect(
      bandFrequencies({ ...base, sweep: { ...base.sweep, start: 1e9, stop: 1e9, points: 11 } }),
    ).toEqual([]);
  });

  it('defaultTolerance follows E6 (20 %) and E96 (1 %), a stock list 5 %, a typed 3 % wins', () => {
    expect(defaultTolerance({ ...base, realize: { ...base.realize, series: 'E6' } })).toBe(0.2);
    expect(defaultTolerance({ ...base, realize: { ...base.realize, series: 'E96' } })).toBe(0.01);
    expect(defaultTolerance({ ...base, realize: { ...base.realize, series: 'stock' } })).toBe(0.05);
    expect(defaultToleranceLabel({ ...base, realize: { ...base.realize, series: 'stock' } })).toBe(
      '5 % (your stock, assumed)',
    );
    const typed = {
      ...base,
      tolerance: {
        runs: 1,
        seed: 1,
        distribution: 'uniform' as const,
        percent: 3,
        vswrLimit: 2,
        overBand: false,
        overrides: {},
      },
    };
    expect(defaultTolerance(typed)).toBeCloseTo(0.03, 15);
    expect(defaultToleranceLabel(typed)).toBe('3 % typed');
  });

  it('monteCarloOptions maps ids to indices, a 0 % override stays 0, locked parts are exact, no band when off', () => {
    const [l, c] = base.elements;
    const d: Design = {
      ...base,
      elements: [l!, { ...c!, locked: true }],
      tolerance: {
        runs: 5,
        seed: 9,
        distribution: 'normal',
        percent: null,
        vswrLimit: 1.5,
        overBand: false,
        overrides: { [l!.id]: 0, zzz: 7 },
      },
    };
    const o = monteCarloOptions(d);
    expect(o).toEqual({
      runs: 5,
      seed: 9,
      distribution: 'normal',
      tolerance: 0.05,
      overrides: { 0: 0 },
      exact: [1],
      vswrLimit: 1.5,
    });
    expect('band' in o).toBe(false);
  });

  it('cloudPath: one dot per point, far points pulled in to radius 3, thinning by maxPoints', () => {
    // 50 ohm is the centre; 150 ohm is Gamma 0.5; -60 ohm is Gamma 11, pulled in to 3.
    expect(cloudPath([50], [0], 50)).toBe('M0.0000 0.0000h0');
    expect(cloudPath([150], [0], 50)).toBe('M0.5000 0.0000h0');
    expect(cloudPath([-60], [0], 50)).toBe('M3.0000 0.0000h0');
    // 50 + j50: Gamma = j50 / (100 + j50) = (j50)(100 - j50) / 12500 = 0.2 + j0.4; the chart y axis points down.
    expect(cloudPath([50], [50], 50)).toBe('M0.2000 -0.4000h0');
    expect(cloudPath([50, 150, 50], [0, 0, 0], 50, 1)).toBe('M0.0000 0.0000h0');
    expect(cloudPath([NaN, 150], [0, 0], 50)).toBe('M0.5000 0.0000h0');
    expect(cloudPath([], [], 50)).toBe('');
    expect(cloudPath([50, 150], [0], 50)).toBe('M0.0000 0.0000h0');
  });

  it('a complex import stays in use', () => {
    expect(complex(0, 0)).toEqual({ re: 0, im: 0 });
  });
});
