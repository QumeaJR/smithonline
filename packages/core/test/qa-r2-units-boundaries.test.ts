/**
 * QA round 2 (interaction redesign): the input length cap (raised from 64 to 256 characters after this round) and the exponent fallback
 * of splitEngineering at its boundaries. Expected values are hand calculations.
 */
import { describe, expect, it } from 'vitest';
import { formatEngineering, splitEngineering, tryParseEngineering } from '../src/units.js';
import { parseStock } from '../src/realize/snap.js';

const fmt = (v: number, digits = 4): string => {
  const p = splitEngineering(v, digits);
  return p.mantissa + p.prefix;
};

describe('input length cap', () => {
  it('256 characters are read, 257 are refused', () => {
    // "1." followed by 254 zeros is 256 characters and the value 1.
    const at = `1.${'0'.repeat(254)}`;
    expect(at.length).toBe(256);
    expect(tryParseEngineering(at)?.value).toBe(1);
    expect(tryParseEngineering(`${at}0`)).toBeNull();
  });

  it('the cap counts the trimmed text: surrounding blanks do not count', () => {
    const at = `1.${'0'.repeat(254)}`;
    expect(tryParseEngineering(`   ${at}\n\t `)?.value).toBe(1);
  });

  it('the cap also holds for the prefix and unit forms', () => {
    // 254 digits + "nH" = 256 characters: 1e253 * 1e-9 = 1e244 (finite).
    const at = `1${'0'.repeat(253)}nH`;
    expect(at.length).toBe(256);
    expect((tryParseEngineering(at)?.value ?? 0) / 1e244).toBeCloseTo(1, 12);
    expect(tryParseEngineering(`1${'0'.repeat(254)}nH`)).toBeNull();
  });

  it('the longest number a person copies from a full-precision readout is far below the cap', () => {
    // 17 significant digits, sign, exponent and a unit: 27 characters.
    const text = '-1.2345678901234567e-300 H';
    expect(tryParseEngineering(text)?.value).toBe(Number('-1.2345678901234567e-300'));
    expect(tryParseEngineering(text)?.unit).toBe('H');
  });

  it('a pasted stock list is split before the cap applies: only an over-long token is skipped', () => {
    const long = `1${'0'.repeat(300)}`;
    const stock = parseStock(`10 nH, ${long}, 2.2 pF; 50 ohm`);
    expect(stock.L).toEqual([10e-9]);
    expect(stock.C).toEqual([2.2e-12]);
    expect(stock.R).toEqual([50]);
  });
});

describe('splitEngineering at the prefix range limits', () => {
  it('0.01 is 10 milli', () => {
    expect(fmt(0.01)).toBe('10m');
    expect(fmt(-0.01)).toBe('-10m');
  });

  it('1e-20 is the smallest prefixed value, 0.01 atto', () => {
    expect(fmt(1e-20)).toBe('0.01a');
    expect(fmt(-1e-20)).toBe('-0.01a');
  });

  it('a value that rounds up to 0.01 atto keeps the prefix', () => {
    // 9.9999e-21 / 1e-18 = 0.0099999 -> 4 digits -> 0.01000
    expect(fmt(9.9999e-21)).toBe('0.01a');
  });

  it('a value that stays below 0.01 atto after rounding falls back to exponent notation', () => {
    // 0.00999949 -> 4 digits -> 0.009999 < 0.01 -> 9.999e-21
    expect(fmt(9.99949e-21)).toBe('9.999e-21');
    expect(fmt(-9.99949e-21)).toBe('-9.999e-21');
    expect(fmt(1e-30)).toBe('1e-30');
  });

  it('9999.4 tera keeps the prefix', () => {
    expect(fmt(9999.4e12)).toBe('9999T');
    expect(fmt(-9999.4e12)).toBe('-9999T');
  });

  it('9999.5 tera rounds to 10000 and falls back to exponent notation', () => {
    // 9999.5 -> 4 digits -> 1.000e4 = 10000 >= 10000 -> 9.9995e15 -> 4 digits -> 1.000e16
    expect(fmt(9999.5e12)).toBe('1e+16');
    expect(fmt(-9999.5e12)).toBe('-1e+16');
  });

  it('rounding carries into the next prefix below tera: 999.95 giga is 1 tera', () => {
    expect(fmt(999.95e9)).toBe('1T');
    expect(fmt(999.95)).toBe('1k');
    // -0.99996 / 1e-3 = -999.96 -> 4 digits -> -1000 -> carry -> -1 (0.99995 itself is stored just below .99995)
    expect(fmt(-0.99996)).toBe('-1');
  });

  it('1e15 is 1000 tera (no carry beyond tera)', () => {
    expect(fmt(1e15)).toBe('1000T');
  });

  it('the fallback respects the digits', () => {
    // 1.23456e-22 at 3 digits: 1.23e-22
    expect(fmt(1.23456e-22, 3)).toBe('1.23e-22');
    // 1.23456e20 at 3 digits: 1.23e+20
    expect(fmt(1.23456e20, 3)).toBe('1.23e+20');
  });

  it('every boundary result parses back to the rounded value', () => {
    const cases: readonly [number, number][] = [
      [9.99949e-21, 9.999e-21],
      [9.9995e15, 1e16],
      [-9.9995e15, -1e16],
      [1e-20, 1e-20],
      [9999.4e12, 9999e12],
    ];
    for (const [v, rounded] of cases) {
      const back = tryParseEngineering(fmt(v))?.value;
      expect(back).toBeDefined();
      expect(back! / rounded).toBeCloseTo(1, 12);
    }
  });

  it('the fallback with a unit parses back for the units the app uses (H, F, Hz, Ω, s)', () => {
    for (const unit of ['H', 'F', 'Hz', 'Ω', 's']) {
      const text = formatEngineering(1e-30, { unit });
      expect(text).toBe(`1e-30 ${unit}`);
      expect(tryParseEngineering(text)?.value).toBe(1e-30);
      expect(tryParseEngineering(text)?.unit).toBe(unit);
    }
  });

  // Fixed in QA round 2: a lone m after an exponent and a blank is the metre.
  it('the fallback with the metre unit parses back (1e+16 m is 1e16)', () => {
    const text = formatEngineering(1e16, { unit: 'm' });
    expect(text).toBe('1e+16 m');
    expect(tryParseEngineering(text)?.value).toBe(1e16);
  });
});
