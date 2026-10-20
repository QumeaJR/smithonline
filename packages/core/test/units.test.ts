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
