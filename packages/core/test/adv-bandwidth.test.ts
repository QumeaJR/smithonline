/**
 * Adversarial tests for bandwidth.ts. A failing test is a defect, see the adversary report.
 */
import { describe, expect, it } from 'vitest';
import { usableBandwidth } from '../src/index';

const C = 1e9;

describe('usableBandwidth options', () => {
  it('steps: NaN must not report the whole range as inside the limit', () => {
    // A narrow notch: VSWR is 1.1 only within 2 % of the centre, 10 elsewhere.
    const v = (f: number): number => (Math.abs(f - C) < 0.02 * C ? 1.1 : 10);
    const r = usableBandwidth(v, C, 2, { steps: NaN });
    expect(r === null || (!r.lowOpen && !r.highOpen)).toBe(true);
  });

  it('steps: Infinity terminates', () => {
    let calls = 0;
    const v = (): number => {
      if (++calls > 1e6) throw new Error('did not terminate after 1e6 evaluations');
      return 1.1;
    };
    usableBandwidth(v, C, 2, { steps: Infinity });
  });

  it('bisections: NaN gives a refined edge', () => {
    const v = (f: number): number => (Math.abs(f - C) < 0.013 * C ? 1.1 : 10);
    const r = usableBandwidth(v, C, 2, { bisections: NaN });
    expect(r && Math.abs(r.high - 1.013e9)).toBeLessThan(1e3);
  });

  it.fails(
    'a search range that excludes the centre is not silently replaced by the default',
    () => {
      const seen: number[] = [];
      const v = (f: number): number => {
        seen.push(f);
        return 1.1;
      };
      // The caller asks for 2 GHz to 3 GHz around a 1 GHz centre.
      const r = usableBandwidth(v, C, 2, { min: 2e9, max: 3e9 });
      // Either refuse (null) or never evaluate outside the requested range except the centre.
      const outside = seen.filter((f) => f !== C && (f < 2e9 || f > 3e9));
      expect(r === null || outside.length === 0).toBe(true);
    },
  );

  it.fails('min above centre, max below centre, are not honoured by guessing', () => {
    const r = usableBandwidth(() => 1.1, C, 2, { min: 5e8, max: 9e8 });
    expect(r === null || r.high <= 9e8 + 1).toBe(true);
  });

  it('limit Infinity does not make an open circuit count as matched', () => {
    const r = usableBandwidth(() => Infinity, C, Infinity);
    expect(r).toBeNull();
  });
});

describe('usableBandwidth vswrAt misbehaving', () => {
  it('throwing vswrAt at the edge does not return a partial result', () => {
    const v = (f: number): number => {
      if (f > 1.5e9) throw new Error('boom');
      return 1.1;
    };
    expect(() => usableBandwidth(v, C, 2)).toThrow('boom');
  });

  it('NaN everywhere but the centre: both edges are within one bisection of the centre', () => {
    const v = (f: number): number => (f === C ? 1.1 : NaN);
    const r = usableBandwidth(v, C, 2);
    expect(r).not.toBeNull();
    expect(r?.span).toBeLessThan(1);
  });

  it.fails('a narrow out-of-band spike between coarse steps is not reported as open', () => {
    // Fails the limit only inside 1.30..1.31 GHz, inside one coarse step (2.2 % of centre).
    const v = (f: number): number => (f > 1.3e9 && f < 1.31e9 ? 50 : 1.2);
    const r = usableBandwidth(v, C, 2);
    // The honest result is a high edge at 1.3 GHz; reporting highOpen = true says VSWR is fine up to 8 GHz.
    expect(r?.highOpen).toBe(false);
  });

  it('non-monotonic: band that re-enters the limit after leaving it is bounded by the first exit', () => {
    const v = (f: number): number => (f > 1.2e9 && f < 1.6e9 ? 5 : 1.2);
    const r = usableBandwidth(v, C, 2);
    expect(r?.high).toBeLessThan(1.21e9);
  });

  it('descending VSWR beyond the edge (flat) with centre exactly at the limit', () => {
    const r = usableBandwidth(() => 2, C, 2);
    expect(r?.lowOpen).toBe(true);
    expect(r?.highOpen).toBe(true);
    expect(r?.low).toBeCloseTo(C / 8, 3);
    expect(r?.high).toBeCloseTo(C * 8, 3);
  });

  it('centre of 1e-320 (denormal) or 1e308 does not loop or return NaN', () => {
    for (const c of [1e-320, 1e308, Number.MAX_VALUE]) {
      const r = usableBandwidth(() => 1.1, c, 2);
      if (r) {
        expect(Number.isFinite(r.low)).toBe(true);
        expect(Number.isFinite(r.high)).toBe(true);
        expect(Number.isFinite(r.span)).toBe(true);
      }
    }
  });
});
