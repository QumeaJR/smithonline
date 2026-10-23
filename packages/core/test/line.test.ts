import { describe, expect, it } from 'vitest';
import {
  coaxRatio,
  coaxZ0,
  lengthFromWavelengths,
  lineDimensions,
  microstripEeff,
  microstripWidth,
  microstripZ0,
  physicalLength,
  SPEED_OF_LIGHT,
  wavelengthsFromLength,
} from '../src/index';

/**
 * The substrates line.js names, with the 50 ohm width a datasheet or a
 * microstrip calculator gives (rounded, mm) and the value the ported model
 * returns. The datasheet figure is checked to 2.5 % (Hammerstad is good to
 * about 1 %, and the published figures use slightly different models); the
 * golden value is the port's own output, pinned so a change is noticed.
 */
const SUBSTRATES = [
  { name: 'FR-4, er 4.3, 1.6 mm', er: 4.3, h: 1.6, published: 3.1, golden: 3.1331493 },
  { name: 'FR-4, er 4.4, 1.6 mm', er: 4.4, h: 1.6, published: 3.06, golden: 3.079385 },
  { name: 'RO4350B, er 3.66, 0.508 mm', er: 3.66, h: 0.508, published: 1.1, golden: 1.1195692 },
  {
    name: 'RT/duroid 5880, er 2.2, 0.787 mm',
    er: 2.2,
    h: 0.787,
    published: 2.4,
    golden: 2.4425929,
  },
  { name: 'Alumina, er 9.8, 0.635 mm', er: 9.8, h: 0.635, published: 0.61, golden: 0.6135466 },
] as const;

describe('microstrip', () => {
  for (const s of SUBSTRATES) {
    it(`50 ohm width on ${s.name}`, () => {
      const { wOverH } = microstripWidth(50, s.er);
      const widthMm = wOverH * s.h;
      expect(widthMm).toBeCloseTo(s.golden, 6);
      expect(Math.abs(widthMm - s.published) / s.published).toBeLessThan(0.025);
    });
  }

  it('effective permittivity of 50 ohm FR-4 and RO4350B', () => {
    expect(microstripWidth(50, 4.3).eeff).toBeCloseTo(3.268016, 5);
    expect(microstripWidth(50, 3.66).eeff).toBeCloseTo(2.853892, 5);
  });

  it('round trip: the width returns the impedance asked for', () => {
    for (const er of [1, 2.2, 3.66, 4.4, 9.8, 12.9]) {
      for (const z0 of [10, 25, 50, 75, 100, 150]) {
        const { wOverH } = microstripWidth(z0, er);
        expect(microstripZ0(wOverH, er)).toBeCloseTo(z0, 9);
      }
    }
  });

  it('the line is wider for lower impedance and for lower permittivity', () => {
    expect(microstripWidth(25, 4.3).wOverH).toBeGreaterThan(microstripWidth(50, 4.3).wOverH);
    expect(microstripWidth(50, 2.2).wOverH).toBeGreaterThan(microstripWidth(50, 9.8).wOverH);
  });

  it('eeff lies between 1 and er and grows with width', () => {
    let last = 1;
    for (const u of [0.05, 0.2, 0.5, 1, 2, 5, 20]) {
      const e = microstripEeff(u, 4.3);
      expect(e).toBeGreaterThan(last);
      expect(e).toBeLessThan(4.3);
      last = e;
    }
  });

  it('the two Hammerstad branches meet at W/h = 1 within 0.6 % and never step upward', () => {
    // A known property of the model (inherited from line.js): the narrow and wide forms are
    // fitted separately, so the curve has a small downward step; Z0 stays monotonic.
    const below = microstripZ0(1 - 1e-9, 4.3);
    const above = microstripZ0(1 + 1e-9, 4.3);
    expect(below).toBeGreaterThanOrEqual(above);
    expect((below - above) / below).toBeLessThan(0.006);
  });

  it('a thick conductor widens the track electrically: same width, lower Z0', () => {
    const bare = microstripZ0(1.9, 4.3);
    const thick = microstripZ0(1.9, 4.3, 0.035 / 1.6);
    expect(thick).toBeLessThan(bare);
    expect(bare - thick).toBeLessThan(3);
  });

  it('thickness keeps the exact round trip and needs a narrower track', () => {
    const tOverH = 0.035 / 1.6;
    const bare = microstripWidth(50, 4.3);
    const thick = microstripWidth(50, 4.3, tOverH);
    expect(thick.wOverH).toBeLessThan(bare.wOverH);
    expect(microstripZ0(thick.wOverH, 4.3, tOverH)).toBeCloseTo(50, 9);
  });

  it('Z0 falls monotonically with width, with or without thickness', () => {
    for (const t of [0, 0.02, 0.1]) {
      let last = Infinity;
      for (let u = 0.01; u < 100; u *= 1.1) {
        const z = microstripZ0(u, 4.3, t);
        expect(z).toBeLessThan(last);
        last = z;
      }
    }
  });
});

describe('coax', () => {
  it('50 ohm air line has ratio 2.3023', () => {
    expect(coaxRatio(50, 1).ratio).toBeCloseTo(2.302304, 5);
  });

  it('50 ohm in er 2.1 (PTFE) has ratio 3.348', () => {
    expect(coaxRatio(50, 2.1).ratio).toBeCloseTo(3.348293, 5);
  });

  it('round trip is exact', () => {
    for (const er of [1, 2.1, 2.3, 4.5]) {
      for (const z0 of [25, 50, 75, 93]) {
        expect(coaxZ0(coaxRatio(z0, er).ratio, er)).toBeCloseTo(z0, 10);
      }
    }
  });

  it('a fully filled line sees er itself', () => {
    expect(coaxRatio(50, 2.1).eeff).toBe(2.1);
  });
});

describe('lineDimensions', () => {
  const f = 1e9;

  it('microstrip: width and length for a quarter wave 50 ohm line on FR-4', () => {
    const d = lineDimensions({ medium: 'microstrip', er: 4.3, h: 1.6e-3 }, 50, 0.25, f);
    expect(d).not.toBeNull();
    expect((d?.width ?? 0) * 1e3).toBeCloseTo(3.1331493, 6);
    expect(d?.eeff).toBeCloseTo(3.268016, 5);
    // lambda0 / 4 / sqrt(eeff)
    expect((d?.length ?? 0) * 1e3).toBeCloseTo(
      (SPEED_OF_LIGHT / f / 4 / Math.sqrt(3.268016)) * 1e3,
      4,
    );
  });

  it('the length equals the line element physicalLength when er = eeff', () => {
    const d = lineDimensions({ medium: 'microstrip', er: 3.66, h: 0.508e-3 }, 50, 0.1, 2.4e9);
    const er = d?.eeff ?? 1;
    const el = { kind: 'line', z0: 50, length: 0.1, refFrequency: 2.4e9, er } as const;
    expect(d?.length).toBeCloseTo(physicalLength(el, 2.4e9), 12);
  });

  it('length and wavelengths invert each other', () => {
    const m = lengthFromWavelengths(0.137, 433e6, 2.7);
    expect(wavelengthsFromLength(m, 433e6, 2.7)).toBeCloseTo(0.137, 12);
  });

  it('coax: the diameter not given follows from the ratio', () => {
    const outer = lineDimensions(
      { medium: 'coax', er: 2.1, given: 'outer', diameter: 4.6e-3 },
      50,
      0.25,
      f,
    );
    expect((outer?.inner ?? 0) * 1e3).toBeCloseTo(4.6 / 3.348293, 5);
    const inner = lineDimensions(
      { medium: 'coax', er: 2.1, given: 'inner', diameter: 1.37e-3 },
      50,
      0.25,
      f,
    );
    expect((inner?.outer ?? 0) * 1e3).toBeCloseTo(1.37 * 3.348293, 5);
    expect(outer?.eeff).toBe(2.1);
  });

  it('refuses unusable input', () => {
    const ms = { medium: 'microstrip', er: 4.3, h: 1.6e-3 } as const;
    expect(lineDimensions(ms, 0, 0.25, f)).toBeNull();
    expect(lineDimensions(ms, 50, -1, f)).toBeNull();
    expect(lineDimensions(ms, 50, 0.25, 0)).toBeNull();
    expect(lineDimensions({ ...ms, er: 0 }, 50, 0.25, f)).toBeNull();
    expect(lineDimensions({ ...ms, h: NaN }, 50, 0.25, f)).toBeNull();
    expect(lineDimensions({ ...ms, t: -1e-6 }, 50, 0.25, f)).toBeNull();
    expect(
      lineDimensions({ medium: 'coax', er: 2, given: 'inner', diameter: 0 }, 50, 0.25, f),
    ).toBeNull();
  });
});
