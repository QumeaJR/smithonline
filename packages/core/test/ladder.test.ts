import { describe, expect, it } from 'vitest';
import {
  cclose,
  complex,
  evaluateLadder,
  loadedQ,
  sweepDatapoints,
  sweepFrequency,
  sweepPoints,
  sweepValues,
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

describe('evaluateLadder', () => {
  it('returns one datapoint per node with the load first', () => {
    const r = evaluateLadder(example5);
    expect(r.datapoints).toHaveLength(6);
    expect(r.datapoints[0]).toEqual(complex(20, -12));
    // The stored values carry the original's single-precision intermediates,
    // so they agree to about 1e-6 absolute, not to the last digit.
    expect(r.datapoints[1]!.re).toBeCloseTo(27.2, 9);
    expect(r.datapoints[2]!.im).toBeCloseTo(-16.19735903263091, 5);
    expect(r.datapoints[5]!.re).toBeCloseTo(50.106838552689482, 5);
    expect(r.datapoints[5]!.im).toBeCloseTo(0.04005695452864097, 5);
    expect(r.zin).toEqual(r.datapoints[5]);
  });

  it('returns derived values and arcs per node', () => {
    const r = evaluateLadder(example5, { arcSteps: 4 });
    expect(r.info).toHaveLength(6);
    expect(r.info[5]!.vswr).toBeCloseTo(1.0023, 3);
    expect(r.arcs).toHaveLength(5);
    expect(r.arcs[0]).toHaveLength(5);
    expect(cclose(r.arcs[0]![4]!, r.datapoints[1]!, 1e-9)).toBe(true);
    expect(evaluateLadder(example5, { arcSteps: 0 }).arcs[0]).toHaveLength(0);
  });

  it('the total ABCD reproduces Zin and a lossless match has S21 near 0 dB', () => {
    const r = evaluateLadder(example5);
    const { a, b, c, d } = r.abcd;
    const zl = example5.load;
    // (A ZL + B) / (C ZL + D) by hand.
    const num = complex(a.re * zl.re - a.im * zl.im + b.re, a.re * zl.im + a.im * zl.re + b.im);
    const den = complex(c.re * zl.re - c.im * zl.im + d.re, c.re * zl.im + c.im * zl.re + d.im);
    const m = den.re * den.re + den.im * den.im;
    const zin = complex(
      (num.re * den.re + num.im * den.im) / m,
      (num.im * den.re - num.re * den.im) / m,
    );
    expect(cclose(zin, r.zin, 1e-9)).toBe(true);
    // Lossless network: the only loss is the residual mismatch at the input.
    expect(r.s21.db).toBeCloseTo(-r.info[5]!.mismatchLossDb, 9);
    expect(r.s21.db).toBeLessThanOrEqual(0);
    expect(r.s21.db).toBeGreaterThan(-1e-4);
  });

  it('loaded Q is the worst |X| / R along the chain (0.6 at the load for Example 5)', () => {
    const r = evaluateLadder(example5);
    expect(r.loadedQ).toBeCloseTo(0.6, 9);
    expect(loadedQ([complex(10, 5), complex(0, 1), complex(-5, 100)])).toBe(0.5);
  });

  it('an empty ladder returns the load', () => {
    const r = evaluateLadder({ z0: 50, frequency: 1e9, load: complex(30, -40), elements: [] });
    expect(r.datapoints).toEqual([complex(30, -40)]);
    expect(r.zin).toEqual(complex(30, -40));
    expect(r.arcs).toEqual([]);
  });
});

describe('sweeps', () => {
  it('frequency sweep evaluates the same load at each frequency', () => {
    const ladder: Ladder = {
      z0: 50,
      frequency: 100e6,
      load: complex(50, 0),
      elements: [{ kind: 'L', orientation: 'series', value: 82e-9 }],
    };
    const pts = sweepFrequency(ladder, [50e6, 100e6, 200e6]);
    expect(pts).toHaveLength(3);
    expect(pts[0]!.zin.im).toBeCloseTo(2 * Math.PI * 50e6 * 82e-9, 9);
    expect(pts[2]!.zin.im).toBeCloseTo(2 * Math.PI * 200e6 * 82e-9, 9);
    expect(pts[1]!.frequency).toBe(100e6);
    expect(pts[1]!.info.q).toBeCloseTo(pts[1]!.zin.im / 50, 12);
  });

  it('datapoint sweep applies the network to each load at its own frequency', () => {
    const ladder: Ladder = {
      z0: 50,
      frequency: 145e6,
      load: complex(106.9, 41.7),
      elements: [{ kind: 'C', orientation: 'shunt', value: 10e-12 }],
    };
    const pts = sweepDatapoints(ladder, [
      { frequency: 140e6, z: complex(100.8, 24.2) },
      { frequency: 145e6, z: complex(106.9, 41.7) },
    ]);
    expect(pts).toHaveLength(2);
    expect(pts[1]!.zin.re).toBeCloseTo(80.192743559613177, 5);
    expect(pts[1]!.zin.im).toBeCloseTo(-58.7042101787265, 5);
    expect(pts[0]!.frequency).toBe(140e6);
  });

  it('sweepValues never runs past stop and lands exactly on it', () => {
    expect(sweepValues(10e6, 450e6, 10e6)).toHaveLength(45);
    expect(sweepValues(100, 200, 9.0909)).toHaveLength(12);
    expect(sweepValues(100, 200, 9.0909)[11]).toBe(200);
    expect(sweepValues(200, 100, 25)).toEqual([200, 175, 150, 125, 100]);
    expect(sweepValues(1, 2, 0)).toEqual([]);
    expect(sweepValues(1, NaN, 1)).toEqual([]);
  });

  it('sweepPoints spreads n points inclusive of both ends', () => {
    expect(sweepPoints(100, 200, 5)).toEqual([100, 125, 150, 175, 200]);
    expect(sweepPoints(100, 200, 1)).toEqual([100]);
  });
});
