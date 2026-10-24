import { describe, expect, it } from 'vitest';
import {
  formatEngineering,
  parseEngineering,
  splitEngineering,
  tryParseEngineering,
} from '../src/index';

describe('parseEngineering', () => {
  it.each([
    ['3n9', 3.9e-9],
    ['2.2p', 2.2e-12],
    ['1k5', 1500],
    ['1K5', 1500],
    ['0.25', 0.25],
    ['.5', 0.5],
    ['47', 47],
    ['-12', -12],
    ['1e-9', 1e-9],
    ['1.5E3', 1500],
    ['2M2', 2.2e6],
    ['2m2', 2.2e-3],
    ['10u', 1e-5],
    ['10µ', 1e-5],
    ['10μ', 1e-5],
    ['4.7 nH', 4.7e-9],
    ['4.7nH', 4.7e-9],
    ['3n9F', 3.9e-9],
    ['50 ohm', 50],
    ['50R', 50],
    ['1R5', 1.5],
    ['5H', 5],
    ['0.1 µF', 1e-7],
    ['22pF', 22e-12],
    ['-3n3', -3.3e-9],
    ['1G', 1e9],
    ['1T', 1e12],
    ['1f', 1e-15],
    ['1a', 1e-18],
    [' 100 ', 100],
  ])('parses %s as %d', (text, expected) => {
    expect(parseEngineering(text)).toBe(expected);
  });

  it('returns the trailing unit text', () => {
    expect(tryParseEngineering('4.7 nH')).toEqual({ value: 4.7e-9, unit: 'H' });
    expect(tryParseEngineering('5H')?.unit).toBe('H');
    expect(tryParseEngineering('50 ohm')?.unit).toBe('ohm');
    expect(tryParseEngineering('3n9')?.unit).toBe('');
  });

  it.each(['', 'abc', 'n', '3.9n9', '3..9', 'n9', '--1', '1 2'])('rejects %j', (text) => {
    expect(tryParseEngineering(text)).toBeNull();
    expect(() => parseEngineering(text)).toThrow(/Cannot parse/);
  });
});

describe('formatEngineering', () => {
  it.each([
    [3.9e-9, 'H', '3.9 nH'],
    [2.2e-12, 'F', '2.2 pF'],
    [1500, '', '1.5k'],
    [0.25, '', '250m'],
    [50, 'Ω', '50 Ω'],
    [1e-15, 'F', '1 fF'],
    [0, 'F', '0 F'],
    [-4.7e-6, 'H', '-4.7 µH'],
    [123456, 'Hz', '123.5 kHz'],
    [2.5e9, 'Hz', '2.5 GHz'],
    [1e13, 'Hz', '10 THz'],
    [1e-20, 'F', '0.01 aF'],
  ])('formats %d %s as %s', (value, unit, expected) => {
    expect(formatEngineering(value, { unit })).toBe(expected);
  });

  it('carries rounding into the next prefix', () => {
    expect(formatEngineering(999.99e-12, { unit: 'F', digits: 3 })).toBe('1 nF');
    expect(formatEngineering(999.99e-12, { unit: 'F', digits: 6 })).toBe('999.99 pF');
  });

  it('can format without prefixes', () => {
    expect(formatEngineering(0.25, { prefixes: false })).toBe('0.25');
    expect(formatEngineering(1500, { prefixes: false })).toBe('1500');
    expect(formatEngineering(0.123456, { prefixes: false, digits: 3 })).toBe('0.123');
  });

  it('honours the number of significant digits', () => {
    expect(formatEngineering(Math.PI * 1e-9, { unit: 'H', digits: 6 })).toBe('3.14159 nH');
    expect(formatEngineering(Math.PI * 1e-9, { unit: 'H', digits: 2 })).toBe('3.1 nH');
  });

  it('splits into mantissa, prefix and exponent', () => {
    expect(splitEngineering(4.7e-9)).toEqual({ mantissa: '4.7', prefix: 'n', exponent: -9 });
  });

  it('round-trips through the parser', () => {
    for (const v of [3.9e-9, 1500, 0.25, 2.2e-12, 47, 1e6, 3.3e-3]) {
      expect(parseEngineering(formatEngineering(v, { digits: 10 }))).toBeCloseTo(v, 20);
    }
  });
});

describe('engineering notation outside the prefix range (QA round 1)', () => {
  it('falls back to exponent notation where a prefix would need a mantissa out of range', () => {
    expect(formatEngineering(1e-30, { unit: 'H' })).toBe('1e-30 H');
    expect(formatEngineering(1e30)).toBe('1e+30');
    expect(formatEngineering(1.5e18, { unit: 'Ω' })).toBe('1.5e+18 Ω');
    // Still in range: 0.01 a and 1000 T keep their prefix.
    expect(formatEngineering(1e-20, { unit: 'F' })).toBe('0.01 aF');
    expect(formatEngineering(1e15, { unit: 'Ω' })).toBe('1000 TΩ');
  });

  it('what it shows parses back, with and without the unit', () => {
    for (const v of [1e-30, -2.5e-25, 1e30, 7.7e19, 1e-20, 1e15]) {
      for (const unit of ['', 'H', 'Ω']) {
        const text = formatEngineering(v, { unit, digits: 6 });
        const parsed = tryParseEngineering(text);
        expect(parsed?.value, text).toBeCloseTo(v, 30);
        expect(Math.abs((parsed?.value ?? 0) / v - 1), text).toBeLessThan(1e-9);
        expect(parsed?.unit, text).toBe(unit);
      }
    }
  });

  it('shows -0 as 0', () => {
    expect(formatEngineering(-0, { unit: 'H' })).toBe('0 H');
  });
});

describe('parser robustness (QA round 1)', () => {
  it('a long digit run that fails at its end returns at once', () => {
    const t0 = performance.now();
    expect(tryParseEngineering(`${'1'.repeat(30000)}!`)).toBeNull();
    expect(tryParseEngineering(`${'1'.repeat(30000)}`)).toBeNull();
    expect(performance.now() - t0).toBeLessThan(50);
  });

  it('the plain number pattern is linear even below the length cap', () => {
    const t0 = performance.now();
    for (let i = 0; i < 2000; i++) tryParseEngineering(`${'9'.repeat(60)}x`);
    expect(performance.now() - t0).toBeLessThan(500);
  });

  it('reports the trailing unit, so a caller can refuse a foreign one', () => {
    expect(tryParseEngineering('1e')).toEqual({ value: 1, unit: 'e' });
    expect(tryParseEngineering('22nHH')).toEqual({ value: 22e-9, unit: 'HH' });
    expect(tryParseEngineering('5 F')).toEqual({ value: 5, unit: 'F' });
    expect(tryParseEngineering('1e-9 H')).toEqual({ value: 1e-9, unit: 'H' });
    // A prefix after the exponent is a prefix, as in every other form.
    expect(tryParseEngineering('1e3k')).toEqual({ value: 1e6, unit: '' });
    expect(tryParseEngineering('1e-6 mH')?.unit).toBe('H');
  });
});
