/**
 * QA round 2 fixes: parseFieldValue (the field's own unit wins, letter case, the metre) and
 * parseStockReport (R notation, decimal commas, bare numbers, the skipped entries).
 */
import { describe, expect, it } from 'vitest';
import { parseFieldValue, parseStockReport, tryParseEngineering } from '../src/index';

const value = (text: string, units: readonly string[]): number | string => {
  const p = parseFieldValue(text, units);
  return p.ok ? p.value : p.reason;
};

describe('parseFieldValue', () => {
  it.each([
    ['20 mS', ['', 'mS'], 20],
    ['0.5 dB/m', ['', 'dB/m'], 0.5],
    ['1.6e-3 m', ['m'], 1.6e-3],
    ['0.0016 m', ['m'], 0.0016],
    ['1.5 m', ['m'], 1.5],
    ['1.5m', ['m'], 1.5],
    ['1.6 mm', ['m'], 1.6e-3],
    ['10 m', ['Ω'], 10e-3],
    ['75 Ω', ['Ω'], 75],
    ['75 ohms', ['Ω'], 75],
    ['10 mΩ', ['Ω'], 10e-3],
    ['2.4 GHZ', ['Hz'], 2.4e9],
    ['2400 MHz', ['Hz'], 2.4e9],
    ['2400 hz', ['Hz'], 2400],
    ['22nh', ['H'], 22e-9],
    ['20 dBm', ['dBm'], 20],
    ['2w', ['W'], 2],
    ['５０', [''], 50],
  ])('%s in a field of %j is %d', (text, units, expected) => {
    const v = value(text, units);
    expect(typeof v).toBe('number');
    expect(v as number).toBeCloseTo(expected, 15);
  });

  it.each([
    ['2400 mhz', ['Hz'], 'ambiguous'],
    ['2e-12 f', ['F'], 'unit'],
    ['1p f', ['F'], 'unit'],
    ['5 F', ['Hz'], 'unit'],
    ['1e', [''], 'number'],
    ['1,5', [''], 'number'],
    ['abc', ['H'], 'number'],
    ['', ['H'], 'number'],
  ])('%s in a field of %j is refused: %s', (text, units, reason) => {
    expect(value(text, units)).toBe(reason);
  });

  it('a 256 character number is read, a longer one refused', () => {
    expect(value(`0.${'5'.repeat(254)}`, [''])).toBeCloseTo(5 / 9, 12);
    expect(value(`0.${'5'.repeat(255)}`, [''])).toBe('number');
  });

  it('tryParseEngineering: a lone m after a blank is the metre, together it is milli', () => {
    expect(tryParseEngineering('1.5 m')).toEqual({ value: 1.5, unit: 'm' });
    expect(tryParseEngineering('1.5m')).toEqual({ value: 1.5e-3, unit: '' });
    expect(tryParseEngineering('1e-3m')).toEqual({ value: 1e-6, unit: '' });
    expect(tryParseEngineering('1e-3 m')).toEqual({ value: 1e-3, unit: 'm' });
  });
});

describe('parseStockReport', () => {
  it('R notation goes to the resistors only, with or without other units', () => {
    expect(parseStockReport('4R7, 10R, 47R, 100R').stock).toEqual({
      L: [],
      C: [],
      R: [4.7, 10, 47, 100],
    });
    expect(parseStockReport('4R7; 10 nH').stock).toEqual({ L: [10e-9], C: [], R: [4.7] });
  });

  it('with semicolons a comma between digits is a decimal comma', () => {
    expect(parseStockReport('8,2 nH; 12 nH\n4,7 pF').stock).toEqual({
      L: [8.2e-9, 12e-9],
      C: [4.7e-12],
      R: [],
    });
  });

  it('a comma-only list with units skips the values beside a digit-comma-digit', () => {
    const r = parseStockReport('1,5 nH, 2,2 nH, 10 nH');
    expect(r.stock).toEqual({ L: [10e-9], C: [], R: [] });
    expect(r.skipped.map((s) => [s.text, s.reason])).toEqual([
      ['1', 'decimal comma'],
      ['5 nH', 'decimal comma'],
      ['2', 'decimal comma'],
      ['2 nH', 'decimal comma'],
    ]);
  });

  it('a list without any unit offers every value to all three kinds', () => {
    expect(parseStockReport('10,22,47').stock).toEqual({
      L: [10, 22, 47],
      C: [10, 22, 47],
      R: [10, 22, 47],
    });
  });

  it('a bare number in a list with units is skipped and reported, as are bad entries', () => {
    const r = parseStockReport('10 nH; 47; abc; 5 V; 2.2 pF');
    expect(r.stock).toEqual({ L: [10e-9], C: [2.2e-12], R: [] });
    expect(r.skipped).toEqual([
      { text: '47', reason: 'no unit' },
      { text: 'abc', reason: 'unreadable' },
      { text: '5 V', reason: 'unit' },
    ]);
  });
});
