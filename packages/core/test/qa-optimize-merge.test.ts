/**
 * QA round 1: the merge resolution of optimize.ts (custom cost, target,
 * maxEvaluations) and worstVswr with a target.
 */
import { describe, expect, it } from 'vitest';
import {
  complex,
  optimizeBand,
  OPTIMIZE_FAIL,
  parameterBound,
  sweepPoints,
  worstVswr,
  type Element,
  type Ladder,
} from '../src/index';

const F = 100e6;
const BAND = sweepPoints(90e6, 110e6, 5);
const ladder: Ladder = {
  z0: 50,
  frequency: F,
  load: complex(50, 0),
  elements: [{ kind: 'L', orientation: 'series', value: 1e-7 }],
};
const valueOf = (els: readonly Element[]) => (els[0] as { value: number }).value;

describe('worstVswr with a target', () => {
  it('a real target equal to Z0 gives the ordinary VSWR', () => {
    const plain = worstVswr(ladder.elements, ladder.load, 50, BAND);
    const towards = worstVswr(ladder.elements, ladder.load, 50, BAND, complex(50, 0));
    expect(towards).toBeCloseTo(plain, 12);
    expect(plain).toBeGreaterThan(1);
  });

  it('a target equal to the input impedance gives 1 at that frequency', () => {
    // At 100 MHz: Zin = 50 + j 2 pi 1e8 1e-7 = 50 + j62.831853.
    const zin = complex(50, 2 * Math.PI * F * 1e-7);
    expect(worstVswr(ladder.elements, ladder.load, 50, [F], zin)).toBeCloseTo(1, 9);
  });

  it('a target that is the negative conjugate of Zin is a total reflection and fails', () => {
    // z + conj(t) = 0 for t = -conj(z): gammaTowards returns 1.
    const zin = complex(50, 2 * Math.PI * F * 1e-7);
    expect(worstVswr(ladder.elements, ladder.load, 50, [F], complex(-50, zin.im))).toBe(
      OPTIMIZE_FAIL,
    );
  });
});

describe('optimizeBand options', () => {
  it('maxEvaluations 1 leaves the ladder as it is and reports a single evaluation', () => {
    const r = optimizeBand(ladder, BAND, { maxEvaluations: 1, seed: 1 });
    expect(r.evaluations).toBe(1);
    expect(r.after).toBe(r.before);
    expect(valueOf(r.elements)).toBe(1e-7);
  });

  it('maxEvaluations bounds the evaluations spent', () => {
    const r = optimizeBand(ladder, BAND, { maxEvaluations: 40, seed: 1, restarts: 50 });
    expect(r.evaluations).toBeLessThanOrEqual(40);
    expect(r.evaluations).toBeGreaterThan(1);
  });

  it('a custom cost replaces the VSWR: minimizing the inductance drives it to its lower bound', () => {
    const cost = (els: readonly Element[]) => valueOf(els) * 1e9;
    const r = optimizeBand(ladder, BAND, { cost, restarts: 3, iterations: 60, seed: 2 });
    expect(r.before).toBe(100);
    expect(r.after).toBeLessThan(r.before);
    const bound = parameterBound(ladder.elements[0]!, 50, F)!;
    // Lower bound: X = Z0/25 = 2 ohm at band centre, L = 2 / (2 pi 1e8) = 3.183 nH.
    expect(bound.lo).toBeCloseTo(2 / (2 * Math.PI * F), 15);
    expect(valueOf(r.elements)).toBeGreaterThanOrEqual(bound.lo - 1e-15);
    expect(r.after).toBeLessThan(5);
    expect(r.after).toBeCloseTo(valueOf(r.elements) * 1e9, 9);
  });

  it('a custom cost that is already 0 returns the ladder unchanged', () => {
    const r = optimizeBand(ladder, BAND, { cost: () => 0, restarts: 2, iterations: 10 });
    expect(r.before).toBe(0);
    expect(r.after).toBe(0);
    expect(r.elements).toEqual(ladder.elements);
  });

  it('with a target the before value is the VSWR towards it', () => {
    const r = optimizeBand(ladder, [F], {
      target: complex(50, 2 * Math.PI * F * 1e-7),
      restarts: 1,
    });
    expect(r.before).toBeCloseTo(1, 9);
    expect(r.after).toBeCloseTo(1, 9);
  });
});
