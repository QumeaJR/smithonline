import { describe, expect, it } from 'vitest';
import { usableBandwidth } from '../src/index';

const Z0 = 50;
const F0 = 100e6;

/** 50 ohm load with a series inductor of X = 20 ohm at 100 MHz: |Gamma|^2 = X^2 / (100^2 + X^2). */
function seriesL(f: number): number {
  const x = 20 * (f / F0);
  const g = Math.sqrt((x * x) / (4 * Z0 * Z0 + x * x));
  return (1 + g) / (1 - g);
}

// VSWR <= 2 <=> |Gamma| <= 1/3 <=> X^2 <= 1250 <=> X <= 35.3553 ohm <=> f <= 100 MHz * 35.3553 / 20.
const HIGH_EDGE = (F0 * Math.sqrt(1250)) / 20;

describe('qa bandwidth: search range', () => {
  it('upper edge of a series L is 176.7767 MHz, the lower side is open to centre / 8', () => {
    const bw = usableBandwidth(seriesL, F0, 2);
    expect(bw?.high).toBeCloseTo(HIGH_EDGE, -1);
    expect(bw?.highOpen).toBe(false);
    expect(bw?.low).toBe(F0 / 8);
    expect(bw?.lowOpen).toBe(true);
    expect(bw?.span).toBeCloseTo(HIGH_EDGE - F0 / 8, -1);
  });

  it('a max below the true edge reports that side open and stops at max', () => {
    const bw = usableBandwidth(seriesL, F0, 2, { max: 150e6 });
    expect(bw?.high).toBe(150e6);
    expect(bw?.highOpen).toBe(true);
  });

  it('a max above the true edge finds the edge and says closed', () => {
    const bw = usableBandwidth(seriesL, F0, 2, { max: 400e6 });
    expect(bw?.high).toBeCloseTo(HIGH_EDGE, -1);
    expect(bw?.highOpen).toBe(false);
  });

  it('a min at or above the centre, zero, negative, NaN or Infinity falls back to centre / 8', () => {
    for (const min of [F0, 2 * F0, 0, -1, NaN, Infinity]) {
      expect(usableBandwidth(() => 1.1, F0, 2, { min })?.low).toBe(F0 / 8);
    }
  });

  it('a max at or below the centre, zero, negative, NaN or Infinity falls back to centre * 8', () => {
    for (const max of [F0, F0 / 2, 0, NaN, Infinity, -5]) {
      expect(usableBandwidth(() => 1.1, F0, 2, { max })?.high).toBe(F0 * 8);
    }
  });

  it('a VSWR exactly at the limit at the centre is inside (<=)', () => {
    expect(usableBandwidth(() => 2, F0, 2)).not.toBeNull();
  });

  it('steps = 1 finds the edge; fractional steps and zero bisections are floored to 1', () => {
    const bw = usableBandwidth(seriesL, F0, 2, { steps: 1, bisections: 60 });
    expect(bw?.high).toBeCloseTo(HIGH_EDGE, -1);
    expect(usableBandwidth(seriesL, F0, 2, { steps: 0.5, bisections: 0 })).not.toBeNull();
  });

  it('a NaN steps option behaves like the default and does not claim closed edges are open', () => {
    const bw = usableBandwidth(seriesL, F0, 2, { steps: NaN });
    expect(bw?.highOpen).toBe(false);
    expect(bw?.high).toBeCloseTo(HIGH_EDGE, -1);
  });

  it('an Infinity steps option terminates (call budget 100000)', () => {
    let calls = 0;
    const f = (x: number): number => {
      calls++;
      if (calls > 100000) throw new Error('did not terminate');
      return seriesL(x);
    };
    expect(() => usableBandwidth(f, F0, 2, { steps: Infinity })).not.toThrow();
  });

  it('a stopband narrower than one coarse step (17.5 MHz above centre) is not skipped', () => {
    // Out of limit only between 120 and 125 MHz; the first edge above the centre is 120 MHz.
    const f = (x: number): number => (x >= 120e6 && x <= 125e6 ? 5 : 1.1);
    const bw = usableBandwidth(f, F0, 2);
    expect(bw?.high).toBeCloseTo(120e6, -2);
    expect(bw?.highOpen).toBe(false);
  });

  it('a NaN limit is refused; an Infinity limit runs to the ends of the range', () => {
    expect(usableBandwidth(() => 1.5, F0, NaN)).toBeNull();
    expect(usableBandwidth(() => 1.5, F0, Infinity)?.highOpen).toBe(true);
  });
});
