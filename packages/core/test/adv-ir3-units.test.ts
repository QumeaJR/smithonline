/**
 * Adversarial round 3 on 38e2242: the space-sensitive metre rule, units that are prefix
 * letters, every Field unit of the app through its display text, the 256 cap timed, and the
 * stock list against hostile pastes.
 */
import { describe, expect, it } from 'vitest';
import {
  formatEngineering,
  parseFieldValue,
  parseStockReport,
  prefixCollides,
  tryParseEngineering,
} from '../src/index';

const v = (text: string, units: readonly string[]): number | string => {
  const p = parseFieldValue(text, units);
  return p.ok ? p.value : p.reason;
};

describe('adv ir3 blanks around a lone m', () => {
  const forms = [
    '1.6 m',
    '1.6m',
    '1.6  m',
    '1.6\tm',
    '1.6 m',
    '1.6 m',
    '1.6　m',
    ' 1.6 m ',
    '1.6 m\t',
  ];
  // Corrected after round 3: "1.6m" without a blank is ambiguous in a metre field (1.6 mm with
  // the unit left out, or 1.6 m), so it is refused there rather than read as the metre.
  it.each(forms.filter((t) => t !== '1.6m'))('metre field: %j is 1.6 m', (t) => {
    expect(v(t, ['m'])).toBeCloseTo(1.6, 12);
  });
  it('metre field: "1.6m" is refused as ambiguous', () => {
    const p = parseFieldValue('1.6m', ['m']);
    expect(p).toEqual({
      ok: false,
      reason: 'ambiguous',
      unit: 'm',
      readings: ['1.6 mm', '1.6 m'],
    });
  });
  it.each(forms)('ohm field: %j is 1.6 mΩ', (t) => {
    expect(v(t, ['Ω'])).toBeCloseTo(1.6e-3, 15);
  });
  it.each(['1.6e-3 m', '1.6e-3  m', '1.6e-3\tm', '1.6e-3 m', '1.6e-3m'])(
    'metre field: %j is 1.6 mm',
    (t) => {
      expect(v(t, ['m'])).toBeCloseTo(1.6e-3, 15);
    },
  );
  it.each(['1.6 mm', '1.6mm', '1.6  mm', '1.6 mm'])('metre field: %j is 1.6 mm', (t) => {
    expect(v(t, ['m'])).toBeCloseTo(1.6e-3, 15);
  });
});

describe('adv ir3 a unit letter that is a prefix letter elsewhere', () => {
  it('farad field: "100nf" (the common lower-case entry) is 100 nF, as before 38e2242', () => {
    expect(v('100nf', ['F'])).toBeCloseTo(100e-9, 20);
  });
  it('farad field: "2.2 pf" is 2.2 pF', () => {
    expect(v('2.2 pf', ['F'])).toBeCloseTo(2.2e-12, 24);
  });
  it('current field: "2a" (lower-case amp) is not 2 aA committed silently', () => {
    const r = v('2a', ['A']);
    expect(r === 'unit' || r === 'ambiguous' || r === 2, `got ${r}`).toBe(true);
  });
  // Corrected after round 3: a unit after a prefix letter can only be the unit, so "2 ma" is
  // 2 mA; "2a" has no prefix before the a, which may be atto or the ampere, and is refused.
  it('current field: "2 ma" is 2 mA, "2a" is refused as ambiguous', () => {
    expect(v('2 ma', ['A'])).toBeCloseTo(2e-3, 15);
    expect(v('2a', ['A'])).toBe('ambiguous');
    expect(v('2 a', ['A'])).toBe('ambiguous');
  });
  it('mS field: "20m" is not 0.02 mS (20 µS) committed silently', () => {
    const r = v('20m', ['', 'mS']);
    expect(r === 20 || typeof r === 'string', `got ${r}`).toBe(true);
  });
  it('frequency field: "2.4 ghz" is read as 2.4 GHz or refused as a case problem, not "wrong unit"', () => {
    const p = parseFieldValue('2.4 ghz', ['Hz']);
    expect(p.ok ? p.value : p.reason).not.toBe('unit');
  });
  it.each([
    ['1 THz', ['Hz'], 1e12],
    ['1 GΩ', ['Ω'], 1e9],
    ['1 kHz', ['Hz'], 1e3],
    ['1 KHZ', ['Hz'], 1e3],
    ['4.7 KOHM', ['Ω'], 4.7e3],
    ['1 mohm', ['Ω'], 1e-3],
    ['3 db', ['', 'dB'], 3],
    ['-10 dbm', ['dBm'], -10],
    ['100 mw', ['W'], 0.1],
    ['5 v', ['V'], 5],
    ['1 S', ['s'], 1],
    ['45 °', ['', '°'], 45],
    ['5 %', ['', '%'], 5],
    // Corrected after round 3: another letter case of the dB/m suffix fits.
    ['0.5 db/m', ['', 'dB/m'], 0.5],
  ] as const)('%j in %j is %d', (t, units, expected) => {
    expect(v(t, units)).toBeCloseTo(expected, 12);
  });
  it.each([
    ['1 PHz', ['Hz']],
    ['1 P', ['Ω']],
    ['1e3 k', ['']],
  ] as const)('%j in %j is refused', (t, units) => {
    expect(typeof v(t, units)).toBe('string');
  });
});

describe('adv ir3 every Field unit: display text back through parseFieldValue', () => {
  // [unit, unitOutside, plain, acceptUnit]
  const FIELDS: readonly [string, boolean, boolean, string | undefined][] = [
    ['Ω', true, false, undefined],
    ['Hz', true, false, undefined],
    ['H', true, false, undefined],
    ['F', true, false, undefined],
    ['V', true, false, undefined],
    ['A', true, false, undefined],
    ['s', true, false, undefined],
    ['dB', true, true, undefined],
    ['°', true, true, undefined],
    ['m', false, false, undefined],
    ['', false, true, 'mS'],
    ['', false, true, 'dB/m'],
    ['', false, true, '%'],
    ['', false, true, '°'],
    ['', false, true, 'dB'],
    ['', false, false, undefined],
  ];
  const values: number[] = [0, -0];
  for (let e = -24; e <= 20; e++) {
    for (const m of [1, -1, 1.5, 4.7, 9.9995, 999.96]) values.push(m * 10 ** e);
  }

  it.each(FIELDS)('unit %j outside %s plain %s accept %j', (unit, outside, plain, accept) => {
    const bad: string[] = [];
    for (const val of values) {
      const full = formatEngineering(val, { unit, digits: 4, prefixes: !plain });
      // Corrected after round 3: as the Field shows it, the unit stays inside the input when the
      // prefix is the unit letter in another case ("1 fF", not "1 f" beside F), since a lone
      // "1 f" in a farad field is ambiguous.
      const shown =
        outside && unit !== '' && full.endsWith(unit) && !prefixCollides(val, unit, 4)
          ? full.slice(0, -unit.length).trimEnd()
          : full;
      const p = parseFieldValue(shown, accept !== undefined ? [unit, accept] : [unit]);
      const ok =
        p.ok && (val === 0 ? p.value === 0 : Math.abs(p.value - val) / Math.abs(val) < 1e-3);
      if (!ok) bad.push(`${val} -> ${JSON.stringify(shown)} -> ${JSON.stringify(p)}`);
    }
    expect(bad.slice(0, 5), `${bad.length} failures`).toEqual([]);
  });
});

describe('adv ir3 the 256 cap against the patterns, timed', () => {
  const hostile: string[] = [
    `1${' '.repeat(254)}!`,
    `1${' '.repeat(127)}m${' '.repeat(126)}!`,
    `1e5${' '.repeat(252)}!`,
    `1${' '.repeat(253)}mΩ!`,
    `${'1'.repeat(255)}!`,
    `.${'1'.repeat(254)}!`,
    `1${' '.repeat(254)}!`,
    `1${'\t'.repeat(254)}!`,
    `1e5${'m'.repeat(252)}!`,
    `1 ${'Ω'.repeat(253)}!`,
    `${'　'.repeat(255)}1!`,
    `${'ﷺ'.repeat(256)}`, // NFKC expands each to 18 characters
  ];
  it.each(hostile.map((h) => [h.length, h] as const))('%d chars failing at the end', (_n, text) => {
    const t0 = performance.now();
    for (let i = 0; i < 2000; i++) {
      tryParseEngineering(text);
      parseFieldValue(text, ['m', 'Ω']);
    }
    const ms = performance.now() - t0;
    expect(ms, `${ms.toFixed(0)} ms for 2000`).toBeLessThan(1000);
  });
  it('none of them parses', () => {
    for (const h of hostile) expect(tryParseEngineering(h)).toBeNull();
  });
});

describe('adv ir3 stock list against hostile pastes', () => {
  it('a resistor list in the usual mixed notation keeps 1k and 4k7 (R notation is not a unit)', () => {
    const r = parseStockReport('10R, 47R, 100R, 1k, 4k7, 10k');
    expect(r.stock.R).toEqual([10, 47, 100, 1000, 4700, 10000]);
  });
  it('"R47" (IEC 60062 for 0.47 ohm) is a resistor, not unreadable', () => {
    expect(parseStockReport('R47; 4R7').stock.R).toEqual([0.47, 4.7]);
  });
  it('a prefix-only comma list with a decimal comma does not invent 7 nF', () => {
    // "4,7n, 10n, 22n": the European 4.7n written in a comma list without units
    const r = parseStockReport('4,7n, 10n, 22n');
    expect(r.stock.C).not.toContain(7e-9);
    expect(r.stock.C).not.toContain(4);
  });
  it('a two-column spreadsheet paste (CSV lines) is not read as decimals 10.22 and 33.47', () => {
    const r = parseStockReport('10,22\n33,47');
    expect(r.stock.R).not.toContain(10.22);
    expect(r.stock.R).not.toContain(33.47);
  });
  it('multi-line list sharing a unit: "47,100 pF" on one line is not 47.1 pF', () => {
    const r = parseStockReport('10 nH, 22 nH\n47,100 pF');
    expect(r.stock.C).not.toContain(47.1e-12);
  });
  it('"1,5" alone: not 1 and 5 offered to L, C and R silently', () => {
    const r = parseStockReport('1,5');
    const silent = r.stock.L.includes(1) && r.stock.L.includes(5) && r.skipped.length === 0;
    expect(silent).toBe(false);
  });
  it('"0R" (zero-ohm link) and empty tokens are skipped without a crash', () => {
    const r = parseStockReport(',,;;\n0R,, ;');
    expect(r.stock).toEqual({ L: [], C: [], R: [] });
  });
  it('a BOM, CRLF and tabs', () => {
    const r = parseStockReport('﻿10 nH\r\n22 pF\r\n\t51 Ω\t');
    expect(r.stock).toEqual({ L: [10e-9], C: [22e-12], R: [51] });
  });
  it('a tab-separated spreadsheet row is not lost as one unreadable entry', () => {
    const r = parseStockReport('10 nH\t22 nH\t47 nH');
    expect(r.stock.L.length).toBe(3);
  });
  it('10000 tokens in under 1 s', () => {
    const text = Array.from({ length: 10000 }, (_, i) => `${(i % 900) + 1} nH`).join(', ');
    const t0 = performance.now();
    const r = parseStockReport(text);
    expect(performance.now() - t0).toBeLessThan(1000);
    expect(r.stock.L.length).toBe(900);
  });
  it('a 1 MB token with R notation digits is linear', () => {
    const t0 = performance.now();
    parseStockReport(`${'4'.repeat(1_000_000)}x`);
    parseStockReport(`${'4'.repeat(1_000_000)}R${'7'.repeat(10)}x`);
    expect(performance.now() - t0).toBeLessThan(1000);
  });
  it('a 256 character token is read, a 257 character one reported, never silently dropped', () => {
    const t256 = `4.${'7'.repeat(251)} nH`;
    expect(t256.length).toBe(256);
    expect(parseStockReport(t256).stock.L.length).toBe(1);
    const r = parseStockReport(`4.${'7'.repeat(252)} nH`);
    expect(r.stock.L.length + r.skipped.length).toBe(1);
  });
});

describe('adv ir3 stock decimal comma without units, downstream', () => {
  // Corrected after round 3: "4,7n" in a comma-only list is ambiguous (4.7 nF, or 4 and 7 nF),
  // so it is skipped and reported; the capacitor snaps to the nearest value left, never 7 nF.
  it('"4,7n, 10n, 22n" never realizes a 4.7 nF capacitor as 7 nF; 4,7n is reported', async () => {
    const { complex, parseStock, realizeLadder } = await import('../src/index');
    const ladder = {
      z0: 50,
      frequency: 100e6,
      load: complex(25, 10),
      elements: [{ kind: 'C', orientation: 'shunt', value: 4.7e-9 }],
    } as const;
    const stock = parseStock('4,7n, 10n, 22n');
    const r = realizeLadder(ladder as never, { source: { kind: 'stock', stock }, scope: 'all' });
    expect((r.ladder.elements[0] as { value: number }).value).toBe(10e-9);
    expect(parseStockReport('4,7n, 10n, 22n').skipped).toEqual([
      { text: '4,7n', reason: 'decimal comma' },
    ]);
  });
});
