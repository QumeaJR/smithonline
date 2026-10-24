/**
 * QA round 3: parseFieldValue against the units the app's fields pass, and parseStockReport
 * on realistic pasted lists. Expected values are worked by hand from the rules in units.ts,
 * snap.ts, docs/07-interaction-redesign.md and docs/06-user-guide.md. it.fails marks a
 * finding: the test states the expected behaviour and fails on the current code.
 */
import { describe, expect, it } from 'vitest';
import {
  complex,
  parseFieldValue,
  parseStock,
  parseStockReport,
  realizeLadder,
  type Ladder,
} from '../src/index';

const value = (text: string, units: readonly string[]): number | string => {
  const p = parseFieldValue(text, units);
  return p.ok ? p.value : p.reason;
};

describe('qa r3 parseFieldValue: lower-case units after a prefix', () => {
  // "22nh" is accepted (another letter case of H). After a prefix letter the unit letter
  // cannot be a second prefix, so "22pf" can only be 22 pF; round 1 accepted it.
  it.each([
    ['22pf', 22e-12],
    ['100nf', 100e-9],
    ['4.7uf', 4.7e-6],
    ['1 µf', 1e-6],
  ])('%s in a farad field is %d', (text, expected) => {
    const v = value(text, ['F']);
    expect(typeof v).toBe('number');
    expect(v as number).toBeCloseTo(expected, 20);
  });

  it('"2.4 ghz" in a hertz field is not refused as a wrong unit (hz is the field unit)', () => {
    expect(value('2.4 ghz', ['Hz'])).not.toBe('unit');
  });

  it('"0.5 db/m" in a dB/m field: another letter case of the suffix fits', () => {
    expect(value('0.5 db/m', ['', 'dB/m'])).toBe(0.5);
  });

  it('"50 ω" (lower-case omega, listed as a loose spelling of Ω) is 50 ohm', () => {
    expect(value('50 ω', ['Ω'])).toBe(50);
  });
});

describe('qa r3 parseFieldValue: branches', () => {
  it('the own unit after a number that overflows is refused as not a number', () => {
    expect(value('1e400 H', ['H'])).toBe('number');
    expect(value('1e400', [''])).toBe('number');
  });

  it('a lone m after an exponent and a blank is milli outside a metre field: 1e-3 m ohm = 1 µΩ', () => {
    expect(value('1e-3 m', ['Ω']) as number).toBeCloseTo(1e-6, 20);
  });

  it('a lone m after a blank in a metre field is the metre', () => {
    expect(value('10 m', ['m'])).toBe(10);
  });

  it('an unfinished exponent in capitals, "1E", is not a number', () => {
    const p = parseFieldValue('1E', ['']);
    expect(p).toEqual({ ok: false, reason: 'number', unit: 'E' });
  });

  it('NFKC: ohm sign, full-width digits and no-break spaces', () => {
    expect(value('50 Ω', ['Ω'])).toBe(50);
    expect(value('１００ MHz', ['Hz'])).toBe(100e6);
    expect(value(' 50 Ω ', ['Ω'])).toBe(50);
  });

  it('suffixes verbatim: degrees, percent, dB', () => {
    expect(value('-45°', ['', '°'])).toBe(-45);
    expect(value('5 %', ['', '%'])).toBe(5);
    expect(value('3dB', ['dB'])).toBe(3);
  });

  it('the cap counts the trimmed text: 256 characters with blanks around are read', () => {
    const n = `0.${'5'.repeat(254)}`;
    expect(n).toHaveLength(256);
    expect(value(`   ${n}   `, [''])).toBeCloseTo(5 / 9, 12);
    expect(value(`${n}5`, [''])).toBe('number');
  });

  it('a 256-character failing text costs well under a millisecond per parse', () => {
    const inputs = [
      `1${' '.repeat(254)}!`,
      `1${' '.repeat(127)}k${' '.repeat(126)}!`,
      `${'1'.repeat(255)}!`,
      `1${'a'.repeat(254)}!`,
      `1e5${' '.repeat(252)}!`,
    ];
    for (const s of inputs) expect(s).toHaveLength(256);
    const t0 = performance.now();
    for (let i = 0; i < 200; i++) {
      for (const s of inputs) {
        expect(parseFieldValue(s, ['H', 'dB/m']).ok).toBe(false);
        parseStockReport(s);
      }
    }
    // 1000 parses of each kind; a backtracking blow-up would take seconds.
    expect(performance.now() - t0).toBeLessThan(1000);
  });

  it('2400 Mhz is mega, 2400 kHZ is kilo: only lower-case m before hz is ambiguous', () => {
    expect(value('2400 Mhz', ['Hz'])).toBe(2.4e9);
    expect(value('2400 kHZ', ['Hz'])).toBe(2.4e6);
  });

  it('a foreign unit in an ampere field is refused', () => {
    expect(value('5 V', ['A'])).toBe('unit');
  });
});

describe('qa r3 parseStockReport: realistic lists', () => {
  it('a distributor CSV column with its header, µ and u', () => {
    const r = parseStockReport(
      'Capacitance\r\n10pF\r\n22pF\r\n100pF\r\n1nF\r\n4.7nF\r\n0.1µF\r\n1uF\r\n',
    );
    expect(r.stock.L).toEqual([]);
    expect(r.stock.R).toEqual([]);
    const expected = [10e-12, 22e-12, 100e-12, 1e-9, 4.7e-9, 0.1e-6, 1e-6];
    expect(r.stock.C).toHaveLength(expected.length);
    r.stock.C.forEach((c, i) => expect(c).toBeCloseTo(expected[i]!, 20));
    expect(r.skipped).toEqual([{ text: 'Capacitance', reason: 'unreadable' }]);
  });

  // Corrected after round 3: 4k7 is an IEC 60062 resistor code and goes to the resistors;
  // the values beside the decimal comma are reported as one entry, as typed.
  it('a mixed comma list with E-series values, units and one decimal comma', () => {
    const r = parseStockReport('4k7, 10 nH, 2.2pF, 47R, 1,5 nH');
    expect(r.stock).toEqual({ L: [10e-9], C: [2.2e-12], R: [47, 4700] });
    expect(r.skipped).toEqual([{ text: '1,5 nH', reason: 'decimal comma' }]);
  });

  it('prefix as decimal point with units, µ and the Greek mu', () => {
    const r = parseStockReport('2u2H; 4.7 µH; 1 μF; 10 mF');
    expect(r.stock.L).toHaveLength(2);
    expect(r.stock.L[0]).toBeCloseTo(2.2e-6, 20);
    expect(r.stock.L[1]).toBeCloseTo(4.7e-6, 20);
    expect(r.stock.C).toEqual([1e-6, 10e-3]);
    expect(r.skipped).toEqual([]);
  });

  // Corrected after round 3: a value with an M and no unit is an IEC 60062 resistor code.
  it('kilo-ohm spellings go to the resistors, and so does a bare 1M', () => {
    const r = parseStockReport('4.7kΩ\n10kΩ\n47 kohm\n1M');
    expect(r.stock).toEqual({ L: [], C: [], R: [4700, 10000, 47000, 1e6] });
    expect(r.skipped).toEqual([]);
  });

  it('duplicates in different spellings are kept once', () => {
    expect(parseStockReport('10nH; 10 nH; 1e-8 H; 0.01uH').stock.L).toEqual([1e-8]);
  });

  it('zero, negative and empty entries', () => {
    const r = parseStockReport('0 nH; -1 pF;;  ;\n');
    expect(r.stock).toEqual({ L: [], C: [], R: [] });
    expect(r.skipped).toEqual([
      { text: '0 nH', reason: 'unreadable' },
      { text: '-1 pF', reason: 'unreadable' },
    ]);
    expect(parseStockReport('')).toEqual({ stock: { L: [], C: [], R: [] }, skipped: [] });
  });

  it('a frequency pasted into the list is a foreign unit, not an inductor', () => {
    const r = parseStockReport('100 MHz; 10 nH');
    expect(r.stock.L).toEqual([10e-9]);
    expect(r.skipped).toEqual([{ text: '100 MHz', reason: 'unit' }]);
  });

  it('a length in feet is a foreign unit, not a capacitor; fF is a capacitor', () => {
    const r = parseStockReport('22 ft; 10 fF');
    expect(r.stock.C).toEqual([1e-14]);
    expect(r.skipped).toEqual([{ text: '22 ft', reason: 'unit' }]);
  });
});

describe('qa r3 resistor codes and prefixed suffixes', () => {
  const ladder: Ladder = {
    z0: 50,
    frequency: 1e9,
    load: complex(25, 10),
    elements: [
      { kind: 'L', orientation: 'series', value: 10e-9 },
      { kind: 'C', orientation: 'shunt', value: 2.2e-12 },
      { kind: 'R', orientation: 'series', value: 4.3e3 },
    ],
  };

  // IEC 60062 writes 4k7 as 4R7 is written; round 2 sends 4R7 to the resistors only, but a
  // list of k codes still lands in the inductor and capacitor stock as henries and farads.
  it('a resistor list in k notation leaves L and C exact, as 4R7 does', () => {
    const stock = parseStock('1k, 2k2, 4k7, 10k');
    const r = realizeLadder(ladder, {
      source: { kind: 'stock', stock },
      scope: 'all',
      preferVswr: false,
    });
    const [l, c, res] = r.ladder.elements as readonly { value: number }[];
    // 4.3k lies nearest 4k7 in log distance: log(4.7/4.3) = 0.039, log(4.3/2.2) = 0.29.
    expect(res!.value).toBe(4700);
    expect(l!.value).toBe(10e-9);
    expect(c!.value).toBe(2.2e-12);
  });

  it('"R47" (IEC 60062, 0.47 ohm) is a resistor', () => {
    expect(parseStockReport('R47; 4R7').stock.R).toEqual([0.47, 4.7]);
  });

  // Corrected after round 3: "20m" beside mS has two readings (20 mmS, or 20 mS with the S
  // left out) and is refused as ambiguous rather than read either way.
  it('"20m" in a field whose suffix is mS is refused as ambiguous, not 0.02 mS', () => {
    expect(parseFieldValue('20m', ['', 'mS'])).toEqual({
      ok: false,
      reason: 'ambiguous',
      unit: 'm',
      readings: ['20 mmS', '20 mS'],
    });
  });
});

describe('qa r3 the stock list rules decided after round 3', () => {
  it('a comma before exactly three digits is reported in every list', () => {
    expect(parseStockReport('1,000 pF; 10 nH').skipped).toEqual([
      { text: '1,000 pF', reason: 'thousands' },
    ]);
    expect(parseStockReport('1,000 pF, 10 nH').skipped).toEqual([
      { text: '1,000 pF', reason: 'thousands' },
    ]);
    // four digits after the comma: a decimal comma in a semicolon list with units
    expect(parseStockReport('1,0000 pF; 10 nH').stock.C).toEqual([1e-12]);
  });

  it('"1,5" alone is reported as one entry', () => {
    expect(parseStockReport('1,5')).toEqual({
      stock: { L: [], C: [], R: [] },
      skipped: [{ text: '1,5', reason: 'decimal comma' }],
    });
  });

  it('a line-break list whose commas also separate values does not read decimals', () => {
    const r = parseStockReport('10 nH, 22 nH\n4,7 pF');
    expect(r.stock).toEqual({ L: [10e-9, 22e-9], C: [], R: [] });
    expect(r.skipped).toEqual([{ text: '4,7 pF', reason: 'decimal comma' }]);
  });

  it('a two-column paste without units is reported line by line', () => {
    expect(parseStockReport('10,22\n33,47').skipped).toEqual([
      { text: '10,22', reason: 'decimal comma' },
      { text: '33,47', reason: 'decimal comma' },
    ]);
  });

  it('tabs separate, and units other than H, F and ohm are foreign', () => {
    const r = parseStockReport('10 nH\t5 Hz\t100 MHz\t2 fH');
    expect(r.stock.L).toEqual([2e-15, 10e-9]);
    expect(r.skipped).toEqual([
      { text: '5 Hz', reason: 'unit' },
      { text: '100 MHz', reason: 'unit' },
    ]);
  });

  it('resistor codes go to the resistors only and are no unit for the bare-number rule', () => {
    const r = parseStockReport('1k5; R22; 2M2; 47');
    expect(r.stock).toEqual({ L: [47], C: [47], R: [0.22, 47, 1500, 2.2e6] });
    expect(r.skipped).toEqual([]);
  });
});
