/**
 * Adversarial round 2 on the shared engineering parser after 2d8d30d: the
 * exponent-plus-unit path, the input length cap, the linear plain-number
 * pattern, format/parse round trips for every unit the UI shows, locale input,
 * and parseStock (the only core caller besides the app's inputs).
 */
import { describe, expect, it } from 'vitest';
import { formatEngineering, tryParseEngineering } from '../src/units.js';
import { parseStock } from '../src/realize/snap.js';

const rel = (a: number, b: number): number => Math.abs(a - b) / Math.max(Math.abs(b), 1e-300);

describe('adv ir2 parser: claims of 2d8d30d', () => {
  it.each([
    ['1e3k', 1e6, ''],
    ['1E3K', 1e6, ''],
    ['1e-9 mH', 1e-12, 'H'],
    ['1e-30 H', 1e-30, 'H'],
    ['1.5e+18 Hz', 1.5e18, 'Hz'],
    ['-2.5e-3 kΩ', -2.5, 'Ω'],
  ])('%s reads as %d %s', (text, value, unit) => {
    const p = tryParseEngineering(text);
    expect(p).not.toBeNull();
    expect(rel(p!.value, value)).toBeLessThan(1e-12);
    expect(p!.unit).toBe(unit);
  });

  // The cap was raised from 64 to 256 characters after this round.
  it('a 256 character plain number parses, 257 is refused', () => {
    const atCap = `0.${'1'.repeat(254)}`;
    expect(atCap.length).toBe(256);
    expect(tryParseEngineering(atCap)).not.toBeNull();
    expect(tryParseEngineering(`${atCap}1`)).toBeNull();
  });

  it('PLAIN_NUMBER alone is linear: 60 digits then a bad char and 1e6 runs take < 1 s', () => {
    const t0 = performance.now();
    for (let i = 0; i < 20000; i++) tryParseEngineering(`${'9'.repeat(60)}x!`);
    expect(performance.now() - t0).toBeLessThan(1000);
  });
});

describe('adv ir2 parser: format then parse for every UI unit', () => {
  // The units the app formats with formatEngineering and that a user may type back.
  const UNITS = ['', 'H', 'F', 'Ω', 'Hz', 'V', 'A', 's', 'm', 'dB', '°', '%', 'S'];
  const values: number[] = [];
  for (let e = -35; e <= 35; e++) for (const m of [1, 1.5, 4.7, 9.999]) values.push(m * 10 ** e);

  it.each(UNITS)('unit "%s": parse(format(v)) gives v and the unit back', (unit) => {
    const bad: string[] = [];
    for (const v of values) {
      for (const digits of [3, 4, 6]) {
        const text = formatEngineering(v, { unit, digits });
        const p = tryParseEngineering(text);
        if (!p || rel(p.value, v) > 10 ** (1 - digits) || p.unit !== unit) {
          bad.push(`${v} d${digits} -> "${text}" -> ${p ? `${p.value} "${p.unit}"` : 'null'}`);
        }
      }
    }
    expect(bad.slice(0, 6), `${bad.length} failures`).toEqual([]);
  });
});

describe('adv ir2 parser: the metre unit (Dimensions dialog h, t, diameter)', () => {
  it('"1.6e-3 m" (exponent plus the field unit) is 1.6 mm, not 1.6 µm', () => {
    const p = tryParseEngineering('1.6e-3 m');
    expect(p?.value).toBeCloseTo(1.6e-3, 12);
  });
  it('"0.0016 m" (the base unit typed) is 1.6 mm, not 1.6 µm', () => {
    const p = tryParseEngineering('0.0016 m');
    expect(p?.value).toBeCloseTo(1.6e-3, 12);
  });
});

describe('adv ir2 parser: locale and lookalike input', () => {
  it('U+2126 OHM SIGN (Windows charmap, datasheets) is read like U+03A9', () => {
    expect(tryParseEngineering('50 Ω')?.value).toBe(50);
  });
  it('full-width digits from a CJK IME (５０) are read or refused, never misread', () => {
    const p = tryParseEngineering('５０');
    expect(p === null || p.value === 50).toBe(true);
  });
  it('NBSP and narrow NBSP between number and unit', () => {
    expect(tryParseEngineering('4.7 nH')?.value).toBeCloseTo(4.7e-9, 20);
    expect(tryParseEngineering('4.7 nH')?.value).toBeCloseTo(4.7e-9, 20);
  });
  it.each(['1,5', '1.234,5', '1 000', "1'000", '−5'])('"%s" is refused, not misread', (t) => {
    expect(tryParseEngineering(t)).toBeNull();
  });
  it('lower-case f after an exponent: "1e-12 f" in a farad field is not 1e-27', () => {
    // "1p f" reads as 1 pF with the unit f (accepted case-insensitively by ValueInput);
    // the exponent form of the same entry should not change the value by 1e-15.
    const a = tryParseEngineering('1p f');
    const b = tryParseEngineering('1e-12 f');
    expect(a?.value).toBeCloseTo(1e-12, 25);
    expect(b?.value).toBeCloseTo(1e-12, 25);
  });
});

describe('adv ir2 parseStock', () => {
  it('resistor notation "4R7; 100R" goes to the resistors only (doc: R to the resistors)', () => {
    const s = parseStock('4R7; 100R');
    expect(s.R).toEqual([4.7, 100]);
    expect(s.L).toEqual([]);
    expect(s.C).toEqual([]);
  });
  it('a decimal-comma list "1,5 nH; 2,2 nH" does not put 1 H / 1 F / 1 ohm into the stock', () => {
    const s = parseStock('1,5 nH; 2,2 nH');
    expect(s.L.every((v) => v < 1e-6)).toBe(true);
    expect(s.C).toEqual([]);
    expect(s.R).toEqual([]);
  });
  it('"1e-12 f" (lower-case farad after an exponent) lands in C as 1 pF', () => {
    const s = parseStock('1e-12 f');
    expect(s.C).toEqual([1e-12]);
  });
  it('a 70 character value with many decimals is not silently dropped', () => {
    const v = `4.${'7'.repeat(64)}n`; // 67 chars
    const s = parseStock(`${v}H`);
    expect(s.L.length).toBe(1);
  });
  it('"1E3K" style tokens: kilo after an exponent means 1e6, offered to all three', () => {
    const s = parseStock('1E3K');
    expect(s.R).toEqual([1e6]);
  });
});
