import { describe, expect, it } from 'vitest';
import { cabs, complex, usableBandwidth, vswr, zToGamma } from '../src/index';

const Z0 = 50;

/** VSWR of a series R-L-C load of 50 ohm in a 50 ohm system. */
function seriesRlc(l: number, c: number): (f: number) => number {
  return (f) => {
    const w = 2 * Math.PI * f;
    const z = complex(Z0, w * l - 1 / (w * c));
    return vswr(cabs(zToGamma(z, Z0)));
  };
}

describe('usableBandwidth', () => {
  const f0 = 100e6;
  const w0 = 2 * Math.PI * f0;
  const l = 100 / w0; // X = 100 ohm at resonance, so loaded Q is 2
  const c = 1 / (w0 * 100);

  it('finds the closed-form edges of a series resonance', () => {
    const limit = 2;
    // |Gamma| = (s - 1) / (s + 1); |X| / Z0 = 2 |Gamma| / sqrt(1 - |Gamma|^2)
    const g = (limit - 1) / (limit + 1);
    const x0 = (Z0 * 2 * g) / Math.sqrt(1 - g * g);
    const root = (x: number): number =>
      (x * c + Math.sqrt(x * x * c * c + 4 * l * c)) / (2 * l * c) / (2 * Math.PI);
    const bw = usableBandwidth(seriesRlc(l, c), f0, limit);
    expect(bw).not.toBeNull();
    expect(bw?.high).toBeCloseTo(root(x0), -1); // within 10 Hz of 100 MHz
    expect(bw?.low).toBeCloseTo(root(-x0), -1);
    expect(bw?.span).toBeCloseTo(root(x0) - root(-x0), -1);
    expect(bw?.lowOpen).toBe(false);
    expect(bw?.highOpen).toBe(false);
  });

  it('a tighter limit gives a narrower band that sits inside the wider one', () => {
    const wide = usableBandwidth(seriesRlc(l, c), f0, 2);
    const tight = usableBandwidth(seriesRlc(l, c), f0, 1.5);
    expect(tight?.span).toBeLessThan(wide?.span ?? 0);
    expect(tight?.low).toBeGreaterThan(wide?.low ?? Infinity);
    expect(tight?.high).toBeLessThan(wide?.high ?? 0);
  });

  it('is null when the centre frequency is already outside the limit', () => {
    expect(usableBandwidth(() => 3, f0, 2)).toBeNull();
    expect(usableBandwidth(() => NaN, f0, 2)).toBeNull();
  });

  it('is null for a limit that is not above 1 or a centre that is not a frequency', () => {
    expect(usableBandwidth(() => 1, f0, 1)).toBeNull();
    expect(usableBandwidth(() => 1, f0, 0.5)).toBeNull();
    expect(usableBandwidth(() => 1, 0, 2)).toBeNull();
    expect(usableBandwidth(() => 1, -5, 2)).toBeNull();
    expect(usableBandwidth(() => 1, NaN, 2)).toBeNull();
  });

  it('a network that never breaks the limit runs into the ends of the range and says so', () => {
    const bw = usableBandwidth(() => 1.1, f0, 2);
    expect(bw?.low).toBe(f0 / 8);
    expect(bw?.high).toBe(f0 * 8);
    expect(bw?.lowOpen).toBe(true);
    expect(bw?.highOpen).toBe(true);
  });

  it('the search range can be narrowed', () => {
    const bw = usableBandwidth(() => 1.1, f0, 2, { min: 90e6, max: 130e6 });
    expect(bw).toMatchObject({ low: 90e6, high: 130e6, span: 40e6 });
  });

  it('a range that does not enclose the centre falls back to the default range', () => {
    const bw = usableBandwidth(() => 1.1, f0, 2, { min: 200e6, max: 50e6 });
    expect(bw?.low).toBe(f0 / 8);
    expect(bw?.high).toBe(f0 * 8);
  });

  it('a non-finite VSWR counts as outside the limit', () => {
    const bw = usableBandwidth((f) => (f > 110e6 ? Infinity : f < 95e6 ? NaN : 1.2), f0, 2);
    expect(bw?.high).toBeGreaterThan(109e6);
    expect(bw?.high).toBeLessThanOrEqual(110e6);
    expect(bw?.low).toBeGreaterThanOrEqual(95e6);
    expect(bw?.low).toBeLessThan(96e6);
  });
});
