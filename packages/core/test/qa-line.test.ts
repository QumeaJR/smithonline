import { describe, expect, it } from 'vitest';
import {
  coaxRatio,
  coaxZ0,
  lengthFromWavelengths,
  lineDimensions,
  microstripEeff,
  microstripWidth,
  microstripZ0,
  velocityFactor,
  wavelengthsFromLength,
} from '../src/index';

type Width = { readonly wOverH: number; readonly eeff: number };
/** In-range synthesis: a refusal (null) would fail the test through NaN. */
const width = (z0: number, er: number, t = 0): Width =>
  (microstripWidth(z0, er, t) as Width | null) ?? { wOverH: NaN, eeff: NaN };
/** Out-of-range synthesis: null (refused) or an object. */
const rawWidth = (z0: number, er: number, t = 0): Width | null =>
  microstripWidth(z0, er, t) as Width | null;

// All expected values below are hand calculations from Hammerstad's formulas
// (eta0 = 376.730313668 ohm), not output of the code under test.

describe('qa line: microstrip closed forms by hand', () => {
  it('eeff at W/h = 0.5 on er 4.3 is exactly 2.9965 (narrow branch: f = 0.2 + 0.04 * 0.25)', () => {
    // (1 + 12 / 0.5)^-0.5 = 0.2; + 0.04 * 0.5^2 = 0.21; 2.65 + 1.65 * 0.21
    expect(microstripEeff(0.5, 4.3)).toBeCloseTo(2.9965, 12);
  });

  it('eeff at W/h = 1 on er 4.3 is 2.65 + 1.65 / sqrt(13)', () => {
    expect(microstripEeff(1, 4.3)).toBeCloseTo(2.65 + 1.65 / Math.sqrt(13), 12);
  });

  it('eeff tends to er for a very wide track and stays between (er+1)/2 and 2.8 for a very narrow one', () => {
    expect(microstripEeff(1e6, 4.3)).toBeCloseTo(4.3, 2);
    expect(microstripEeff(1e-3, 4.3)).toBeGreaterThan(2.65);
    expect(microstripEeff(1e-3, 4.3)).toBeLessThan(2.8);
  });

  it('eeff of er = 1 is 1 for every width (air)', () => {
    for (const u of [0.01, 0.5, 1, 3, 100]) expect(microstripEeff(u, 1)).toBeCloseTo(1, 12);
  });

  it('Z0 at W/h = 1 on er 4.3 is 71.77 ohm (narrow branch, hand value)', () => {
    // 376.7303 / (2 pi sqrt(3.10763)) * ln(8.25) = 71.773
    expect(microstripZ0(1, 4.3)).toBeCloseTo(71.773, 2);
  });

  it('Z0 at W/h = 1.9 on er 4.3 is 50.915 ohm (wide branch, hand value)', () => {
    expect(microstripZ0(1.9, 4.3)).toBeCloseTo(50.915, 2);
  });

  it('thickness t/h = 0.021875 at W/h = 1.9: extension 0.02846, Z0 50.461 ohm', () => {
    // x = sqrt(6.517 * 1.9) = 3.5188, coth^2 x = 1.00353
    // du1 = t/pi ln(1 + 4e / (t coth^2 x)) = 0.0069632 * ln(496.3) = 0.043222
    // dur = 0.5 (1 + 1 / cosh sqrt(3.3)) du1 = 0.65838 * 0.043222 = 0.028459
    // eeff(1.928459) = 3.26395, Z0 = 376.7303 / (1.80664 * 4.1323) = 50.461
    expect(microstripZ0(1.9, 4.3, 0.021875)).toBeCloseTo(50.461, 1);
  });

  it('t = 0, omitted, negative or NaN are the same', () => {
    expect(microstripZ0(1.9, 4.3, 0)).toBe(microstripZ0(1.9, 4.3));
    expect(microstripZ0(1.9, 4.3, -1)).toBe(microstripZ0(1.9, 4.3));
    expect(microstripZ0(1.9, 4.3, NaN)).toBe(microstripZ0(1.9, 4.3));
  });
});

describe('qa line: thickness correction limits', () => {
  it('stays finite, positive and monotonic in t for thick conductors (t/h up to 10)', () => {
    let last = Infinity;
    for (const t of [0, 0.01, 0.1, 0.5, 1, 3, 10]) {
      const z = microstripZ0(1, 4.3, t);
      expect(Number.isFinite(z)).toBe(true);
      expect(z).toBeGreaterThan(0);
      expect(z).toBeLessThan(last);
      last = z;
    }
  });

  it('keeps the exact round trip for thick conductors', () => {
    for (const t of [0.05, 0.5, 2]) {
      for (const z0 of [20, 50, 90]) {
        const { wOverH } = width(z0, 4.3, t);
        expect(microstripZ0(wOverH, 4.3, t)).toBeCloseTo(z0, 8);
      }
    }
  });

  it('er = 1 (air): sqrt(er - 1) = 0 gives cosh 0 = 1 and a finite, lower Z0', () => {
    const z = microstripZ0(2, 1, 0.05);
    expect(Number.isFinite(z)).toBe(true);
    expect(z).toBeLessThan(microstripZ0(2, 1));
  });

  it('the width needed at 50 ohm shrinks with t by about the extension 0.028 of W/h', () => {
    const bare = width(50, 4.3).wOverH;
    const thick = width(50, 4.3, 0.021875).wOverH;
    expect(thick).toBeLessThan(bare);
    expect(bare - thick).toBeCloseTo(0.0284, 2);
  });
});

describe('qa line: microstripWidth bracket 1e-3 .. 1e3', () => {
  it('450 ohm on er 4.3 (above the ~326 ohm of W/h = 1e-3) is refused or exact, never clamped', () => {
    const w = rawWidth(450, 4.3);
    if (w !== null) expect(microstripZ0(w.wOverH, 4.3)).toBeCloseTo(450, 3);
  });

  it('0.05 ohm on er 4.3 (below the ~0.18 ohm of W/h = 1e3) is refused or exact, never clamped', () => {
    const w = rawWidth(0.05, 4.3);
    if (w !== null) expect(microstripZ0(w.wOverH, 4.3)).toBeCloseTo(0.05, 3);
  });

  it('lineDimensions refuses 450 ohm on FR-4 or returns a width that really is 450 ohm', () => {
    const d = lineDimensions({ medium: 'microstrip', er: 4.3, h: 1.6e-3 }, 450, 0.25, 1e9);
    if (d !== null) {
      expect(microstripZ0(d.wOverH as number, 4.3)).toBeCloseTo(450, 3);
    }
  });

  it('the ends of the usable range round trip: 5 ohm and 200 ohm on er 4.3', () => {
    for (const z0 of [5, 200]) {
      expect(microstripZ0(width(z0, 4.3).wOverH, 4.3)).toBeCloseTo(z0, 8);
    }
  });
});

describe('qa line: lengths and coax by hand', () => {
  it('a quarter wave in air at 1 GHz is 0.25 * 299792458 / 1e9 = 74.9481145 mm', () => {
    expect(lengthFromWavelengths(0.25, 1e9, 1)).toBeCloseTo(0.0749481145, 12);
  });

  it('eeff 4 halves the length; velocity factor of eeff 4 is 0.5', () => {
    expect(lengthFromWavelengths(0.25, 1e9, 4)).toBeCloseTo(0.0749481145 / 2, 12);
    expect(velocityFactor(4)).toBe(0.5);
    expect(velocityFactor(1)).toBe(1);
  });

  it('0.299792458 m at 1 GHz in air is exactly 1 wavelength', () => {
    expect(wavelengthsFromLength(0.299792458, 1e9, 1)).toBeCloseTo(1, 12);
  });

  it('zero wavelengths give a zero length, not null', () => {
    const d = lineDimensions({ medium: 'microstrip', er: 4.3, h: 1.6e-3 }, 50, 0, 1e9);
    expect(d).not.toBeNull();
    expect(d?.length).toBe(0);
  });

  it('coax Z0 at ratio 1 is 0, and 50 ohm air needs ln r = 50 * 2 pi / eta0', () => {
    expect(coaxZ0(1, 2.1)).toBe(0);
    expect(coaxRatio(50, 1).ratio).toBeCloseTo(Math.exp((50 * 2 * Math.PI) / 376.730313668), 12);
  });

  it('coax with a huge impedance returns finite diameters or null, not 0 and Infinity', () => {
    const d = lineDimensions(
      { medium: 'coax', er: 2.1, given: 'outer', diameter: 4.6e-3 },
      1e5,
      0.25,
      1e9,
    );
    if (d !== null) {
      expect(Number.isFinite(d.ratio)).toBe(true);
      expect(d.inner).toBeGreaterThan(0);
    }
  });

  it('coax given inner: outer = inner * ratio; given outer: inner = outer / ratio', () => {
    const r = Math.exp((75 * 2 * Math.PI) / 376.730313668);
    const a = lineDimensions(
      { medium: 'coax', er: 1, given: 'inner', diameter: 1e-3 },
      75,
      0.1,
      1e8,
    );
    const b = lineDimensions(
      { medium: 'coax', er: 1, given: 'outer', diameter: 1e-3 },
      75,
      0.1,
      1e8,
    );
    expect(a?.outer).toBeCloseTo(1e-3 * r, 12);
    expect(a?.inner).toBe(1e-3);
    expect(b?.inner).toBeCloseTo(1e-3 / r, 12);
    expect(b?.outer).toBe(1e-3);
  });

  it('refuses Infinity and NaN in every numeric input', () => {
    const ms = { medium: 'microstrip', er: 4.3, h: 1.6e-3 } as const;
    expect(lineDimensions(ms, Infinity, 0.25, 1e9)).toBeNull();
    expect(lineDimensions(ms, 50, Infinity, 1e9)).toBeNull();
    expect(lineDimensions(ms, 50, NaN, 1e9)).toBeNull();
    expect(lineDimensions(ms, 50, 0.25, Infinity)).toBeNull();
    expect(lineDimensions({ ...ms, er: Infinity }, 50, 0.25, 1e9)).toBeNull();
    expect(lineDimensions({ ...ms, h: -1e-3 }, 50, 0.25, 1e9)).toBeNull();
    expect(lineDimensions({ ...ms, t: Infinity }, 50, 0.25, 1e9)).toBeNull();
    expect(lineDimensions({ ...ms, t: NaN }, 50, 0.25, 1e9)).toBeNull();
    expect(
      lineDimensions({ medium: 'coax', er: 2, given: 'outer', diameter: NaN }, 50, 0.25, 1e9),
    ).toBeNull();
  });

  it('thickness reaches the result through lineDimensions: narrower track with t', () => {
    const bare = lineDimensions({ medium: 'microstrip', er: 4.3, h: 1.6e-3 }, 50, 0.25, 1e9);
    const thick = lineDimensions(
      { medium: 'microstrip', er: 4.3, h: 1.6e-3, t: 35e-6 },
      50,
      0.25,
      1e9,
    );
    expect(thick?.width).toBeLessThan(bare?.width ?? 0);
    expect(thick?.width).toBeGreaterThan((bare?.width ?? 0) - 0.1e-3);
  });
});
