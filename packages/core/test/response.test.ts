import { describe, expect, it } from 'vitest';
import {
  complex,
  groupDelay,
  SPEED_OF_LIGHT,
  sweepFrequency,
  sweepPoints,
  sweepPointsLog,
  sweepResponse,
  unwrapPhase,
  type Ladder,
} from '../src/index';

describe('unwrapPhase', () => {
  it('leaves a continuous column alone', () => {
    expect(unwrapPhase([10, 20, 30, 40])).toEqual([10, 20, 30, 40]);
  });

  it('removes a downward wrap at +180 to -180', () => {
    expect(unwrapPhase([150, 170, -170, -150])).toEqual([150, 170, 190, 210]);
  });

  it('removes an upward wrap at -180 to +180', () => {
    expect(unwrapPhase([-150, -170, 170, 150])).toEqual([-150, -170, -190, -210]);
  });

  it('keeps counting through several wraps', () => {
    const wrapped = [0, 120, -120, 0, 120, -120, 0];
    expect(unwrapPhase(wrapped)).toEqual([0, 120, 240, 360, 480, 600, 720]);
  });

  it('passes non-finite values through without disturbing the offset', () => {
    const out = unwrapPhase([170, NaN, -170]);
    expect(out[0]).toBe(170);
    expect(out[1]).toBeNaN();
    expect(out[2]).toBe(190);
  });

  it('handles an empty column', () => {
    expect(unwrapPhase([])).toEqual([]);
  });
});

describe('groupDelay', () => {
  it('is the negative phase slope in seconds', () => {
    // phi = -360 * f * tau with tau = 2 ns: a straight line, so every scheme is exact.
    const tau = 2e-9;
    const f = [100e6, 200e6, 300e6, 400e6];
    const phi = f.map((v) => -360 * v * tau);
    for (const d of groupDelay(f, phi)) expect(d).toBeCloseTo(tau, 15);
  });

  it('unwraps the phase before differentiating', () => {
    const tau = 5e-9;
    const f = sweepPoints(100e6, 500e6, 41);
    const wrapped = f.map((v) => {
      const p = (-360 * v * tau) % 360;
      return p < -180 ? p + 360 : p;
    });
    for (const d of groupDelay(f, wrapped)) expect(d).toBeCloseTo(tau, 15);
  });

  it('is second order in the interior for a curved phase', () => {
    // phi = -k f^2: dphi/df = -2 k f, so tau = 2 k f / 360.
    const k = 1e-15;
    const f = sweepPoints(1e6, 10e6, 10);
    const phi = f.map((v) => -k * v * v);
    const d = groupDelay(f, phi);
    // Central differences are exact for a parabola; the ends are one-sided.
    for (let i = 1; i < f.length - 1; i++) {
      expect(d[i]).toBeCloseTo((2 * k * (f[i] as number)) / 360, 20);
    }
    expect(d[0]).toBeGreaterThan(0);
  });

  it('gives NaN for fewer than two points', () => {
    expect(groupDelay([1e9], [0])).toEqual([NaN]);
    expect(groupDelay([], [])).toEqual([]);
  });
});

describe('sweepPointsLog', () => {
  it('spaces the points by a constant ratio and lands on both ends', () => {
    const f = sweepPointsLog(1e6, 1e9, 4);
    expect(f).toHaveLength(4);
    expect(f[0]).toBe(1e6);
    expect(f[1]).toBeCloseTo(1e7, 0);
    expect(f[2]).toBeCloseTo(1e8, 0);
    expect(f[3]).toBe(1e9);
  });

  it('returns the start alone for one point', () => {
    expect(sweepPointsLog(5, 10, 1)).toEqual([5]);
  });

  it('falls back to linear spacing when an end is not positive', () => {
    expect(sweepPointsLog(0, 10, 3)).toEqual([0, 5, 10]);
  });
});

describe('sweepResponse', () => {
  /** A quarter wave of 50 ohm air line at 1 GHz into a matched load. */
  const line: Ladder = {
    z0: 50,
    frequency: 1e9,
    load: complex(50, 0),
    elements: [{ kind: 'line', z0: 50, length: 0.25, refFrequency: 1e9 }],
  };

  it('reports a matched line as lossless with its physical delay', () => {
    const f = sweepPoints(500e6, 1.5e9, 11);
    const r = sweepResponse(sweepFrequency(line, f));
    expect(r.frequency).toEqual(f);
    const delay = (0.25 * (SPEED_OF_LIGHT / 1e9)) / SPEED_OF_LIGHT;
    for (let i = 0; i < f.length; i++) {
      expect(r.s21Db[i]).toBeCloseTo(0, 9);
      expect(r.s11Db[i]).toBeLessThan(-200);
      expect(r.vswr[i]).toBeCloseTo(1, 9);
      expect(r.r[i]).toBeCloseTo(50, 9);
      expect(r.x[i]).toBeCloseTo(0, 9);
      // Phase lags by 90 degrees per quarter wave: -90 at 1 GHz, continuous across the sweep.
      expect(r.phaseDeg[i]).toBeCloseTo((-90 * (f[i] as number)) / 1e9, 6);
      expect(r.groupDelay[i]).toBeCloseTo(delay, 15);
    }
  });

  it('uses the negative return loss for |S11|', () => {
    const mismatched: Ladder = { ...line, load: complex(100, 0), elements: [] };
    const r = sweepResponse(sweepFrequency(mismatched, [1e9]));
    // Gamma = 1/3: -9.54 dB, VSWR 2.
    expect(r.s11Db[0]).toBeCloseTo(20 * Math.log10(1 / 3), 9);
    expect(r.vswr[0]).toBeCloseTo(2, 9);
    expect(r.r[0]).toBe(100);
  });
});
