/**
 * QA round 1: limits.ts edges. The limitCost case with an infinite margin is
 * the suspected defect: an area whose margin is -Infinity makes the cost
 * return early and skip the areas after it.
 */
import { describe, expect, it } from 'vitest';
import {
  complex,
  limitCost,
  limitScale,
  limitStatus,
  type Ladder,
  type LimitArea,
  type Response,
} from '../src/index';

function response(frequency: number[], vswr: number[], s11Db?: number[]): Response {
  const n = frequency.length;
  const zeros = () => Array.from({ length: n }, () => 0);
  return {
    frequency,
    vswr,
    s11Db: s11Db ?? zeros(),
    s21Db: zeros(),
    r: zeros(),
    x: zeros(),
    phaseDeg: zeros(),
    groupDelay: zeros(),
  };
}

function area(over: Partial<LimitArea> = {}): LimitArea {
  return { id: 'a', quantity: 'vswr', f1: 100e6, f2: 200e6, kind: 'max', value: 2, ...over };
}

describe('limitStatus edges', () => {
  it('the frequency range is inclusive at both ends', () => {
    const r = response([100e6, 150e6, 200e6], [3, 1, 3]);
    const s = limitStatus(area(), r)!;
    expect(s.samples).toBe(3);
    expect(s.worst).toBe(1);
    expect(s.frequency).toBe(100e6);
  });

  it('a value exactly at the limit is a zero violation, not a breach', () => {
    const s = limitStatus(area(), response([150e6], [2]))!;
    expect(s.worst).toBe(0);
  });

  it('a single sample that is -Infinity (perfect match on an S11 max) is reported as -Infinity', () => {
    const s = limitStatus(
      area({ quantity: 's11Db', value: -10 }),
      response([150e6], [1], [-Infinity]),
    )!;
    expect(s.worst).toBe(-Infinity);
    expect(s.frequency).toBe(150e6);
  });

  it('all NaN inside the range is null, as is an empty response', () => {
    expect(limitStatus(area(), response([150e6], [NaN]))).toBeNull();
    expect(limitStatus(area(), response([], []))).toBeNull();
  });

  it('a min limit takes the lowest sample', () => {
    const s = limitStatus(area({ kind: 'min', value: 1.5 }), response([100e6, 200e6], [3, 1.2]))!;
    expect(s.worst).toBeCloseTo(0.3, 12);
    expect(s.frequency).toBe(200e6);
  });
});

describe('limitScale', () => {
  it('scales r and x with Z0 and the rest with fixed units', () => {
    expect(limitScale('r', 75)).toBe(7.5);
    expect(limitScale('x', 75)).toBe(7.5);
    expect(limitScale('s21Db', 75)).toBe(1);
    expect(limitScale('s11Db', 75)).toBe(1);
    expect(limitScale('vswr', 75)).toBe(0.1);
    expect(limitScale('phaseDeg', 75)).toBe(10);
    expect(limitScale('groupDelay', 75)).toBe(1e-9);
  });
});

describe('limitCost', () => {
  const matched: Ladder = { z0: 50, frequency: 100e6, load: complex(50, 0), elements: [] };
  const BAND = [90e6, 100e6, 110e6];
  const s11Area = area({
    id: 's',
    quantity: 's11Db',
    f1: 90e6,
    f2: 110e6,
    kind: 'max',
    value: -10,
  });
  // VSWR is exactly 1 everywhere; "at least 2" is broken by 1, which is 10 units of 0.1.
  const vswrMin = area({ id: 'v', f1: 90e6, f2: 110e6, kind: 'min', value: 2 });

  it('a perfectly matched ladder has an infinite S11 margin and the cost of that area alone is 0', () => {
    expect(limitCost(matched, [s11Area], BAND)([])).toBe(0);
    expect(limitCost(matched, [vswrMin], BAND)([])).toBeCloseTo(10, 9);
  });

  it('the result does not depend on the order of the areas (infinite margin first)', () => {
    const vswrFirst = limitCost(matched, [vswrMin, s11Area], BAND)([]);
    const s11First = limitCost(matched, [s11Area, vswrMin], BAND)([]);
    expect(vswrFirst).toBeCloseTo(10, 9);
    expect(s11First).toBeCloseTo(10, 9);
  });

  it('is 0 when no frequency is positive and no area edge is either', () => {
    expect(limitCost(matched, [area({ f1: -1, f2: -2 })], [0, -5])([])).toBe(0);
  });

  it('an area outside the band is still sampled at its own edges', () => {
    const far = area({ f1: 5e9, f2: 5e9, kind: 'min', value: 3 });
    // VSWR 1 at 5 GHz against "at least 3": violation 2, 20 units.
    expect(limitCost(matched, [far], BAND)([])).toBeCloseTo(20, 9);
  });

  it('reads a frequency-dependent load', () => {
    // 150 ohm (VSWR 3) below 100 MHz, 50 ohm (VSWR 1) above: a max-2 area over the band is broken by 1.
    const load = (f: number) => (f < 100e6 ? complex(150, 0) : complex(50, 0));
    const cost = limitCost(matched, [area({ f1: 90e6, f2: 110e6 })], BAND, load);
    expect(cost([])).toBeCloseTo(10, 9);
  });
});
