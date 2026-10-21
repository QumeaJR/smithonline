import { describe, expect, it } from 'vitest';
import {
  bomCsv,
  bomRows,
  complex,
  eSeriesBase,
  eSeriesValues,
  nearestInSeries,
  nearestInStock,
  parseStock,
  realizeLadder,
  seriesNeighbors,
  type Ladder,
} from '../src/index';

/** The full E24 table of IEC 60063. */
const E24 = [
  1.0, 1.1, 1.2, 1.3, 1.5, 1.6, 1.8, 2.0, 2.2, 2.4, 2.7, 3.0, 3.3, 3.6, 3.9, 4.3, 4.7, 5.1, 5.6,
  6.2, 6.8, 7.5, 8.2, 9.1,
];

/** Example 5 of Smith V4.1: 20 - j12 at 450 MHz matched with five elements. */
const example5: Ladder = {
  z0: 50,
  frequency: 450e6,
  load: complex(20, -12),
  elements: [
    { kind: 'L', orientation: 'shunt', value: 1.6033386409903585e-8 },
    { kind: 'C', orientation: 'series', value: 2.1835513398047903e-11 },
    { kind: 'L', orientation: 'shunt', value: 2.1883430954167689e-8 },
    { kind: 'C', orientation: 'series', value: 1.6e-11 },
    { kind: 'L', orientation: 'shunt', value: 2.9500000000000003e-8 },
  ],
};

describe('E series', () => {
  it('E24 matches the IEC 60063 table and E12 and E6 are its subsets', () => {
    expect(eSeriesBase('E24')).toEqual(E24);
    expect(eSeriesBase('E12')).toEqual([
      1.0, 1.2, 1.5, 1.8, 2.2, 2.7, 3.3, 3.9, 4.7, 5.6, 6.8, 8.2,
    ]);
    expect(eSeriesBase('E6')).toEqual([1.0, 1.5, 2.2, 3.3, 4.7, 6.8]);
  });

  it('E96 follows 10^(k/96) rounded to three significant digits and E48 is every second value', () => {
    const e96 = eSeriesBase('E96');
    expect(e96).toHaveLength(96);
    e96.forEach((v, k) => {
      expect(v).toBe(Number((10 ** (k / 96)).toPrecision(3)));
    });
    expect(eSeriesBase('E48')).toEqual(e96.filter((_, k) => k % 2 === 0));
  });

  it('lists values across decades without floating point noise', () => {
    expect(eSeriesValues('E6', 1e-12, 4.7e-12)).toEqual([
      1e-12, 1.5e-12, 2.2e-12, 3.3e-12, 4.7e-12,
    ]);
    expect(eSeriesValues('E12', 8.2e-9, 15e-9)).toEqual([8.2e-9, 1e-8, 1.2e-8, 1.5e-8]);
  });

  it('brackets a value with its neighbors, also across a decade edge', () => {
    expect(seriesNeighbors(16.03e-9, 'E24')).toEqual({ lower: 16e-9, upper: 18e-9 });
    expect(seriesNeighbors(9.5, 'E24')).toEqual({ lower: 9.1, upper: 10 });
    expect(seriesNeighbors(0.95, 'E24')).toEqual({ lower: 0.91, upper: 1 });
    expect(seriesNeighbors(22e-12, 'E24')).toEqual({ lower: 22e-12, upper: 22e-12 });
  });

  it('snaps in log distance, not linear distance', () => {
    expect(nearestInSeries(16.03e-9, 'E24')).toBe(16e-9);
    expect(nearestInSeries(29.5e-9, 'E24')).toBe(30e-9);
    // 3.162 is linearly nearer to 3.3 (0.138) than to 3.0 (0.162) and also nearer in log distance.
    expect(nearestInSeries(Math.sqrt(10), 'E24')).toBe(3.3);
    // 4.99 sits 1.9 % above 4.7 and 2.3 % below 5.1: linear and log both say 5.1.
    expect(nearestInSeries(4.99, 'E24')).toBe(5.1);
    // 51 ohm in E12: 47 (log 0.082) beats 56 (log 0.094).
    expect(nearestInSeries(51, 'E12')).toBe(47);
    expect(nearestInSeries(0, 'E24')).toBe(0);
  });

  it('snaps to a custom stock list', () => {
    expect(nearestInStock(16.03e-9, [10e-9, 15e-9, 18e-9])).toBe(15e-9);
    expect(nearestInStock(1, [5, 7])).toBe(5);
    expect(nearestInStock(100, [5, 7])).toBe(7);
    expect(nearestInStock(1, [])).toBeNull();
  });
});

describe('realizeLadder', () => {
  it('realizes Example 5 to E24 as 16 nH, 22 pF, 22 nH, 16 pF, 30 nH', () => {
    const r = realizeLadder(example5, { source: { kind: 'series', series: 'E24' }, scope: 'all' });
    const values = r.ladder.elements.map((e) => (e.kind === 'L' || e.kind === 'C' ? e.value : NaN));
    expect(values).toEqual([16e-9, 22e-12, 22e-9, 16e-12, 30e-9]);
    expect(r.elements[0]!.parts[0]).toMatchObject({ part: 'L', source: 'E24' });
    expect(r.elements[0]!.parts[0]!.deviation).toBeCloseTo(16 / 16.033386409903585 - 1, 9);
    expect(r.elements[3]!.parts[0]!.deviation).toBe(0);
    // The ideal network is matched to VSWR 1.002; the standard values move it a little.
    expect(r.idealResult.info[5]!.vswr).toBeCloseTo(1.0023, 3);
    const vswr = r.result.info[5]!.vswr;
    expect(vswr).toBeGreaterThan(1.0023);
    expect(vswr).toBeLessThan(1.2);
    expect(r.result.datapoints).toHaveLength(6);
    expect(r.ideal).toBe(example5);
    expect(r.sourceLabel).toBe('E24');
  });

  it('the neighbor evaluation never ends worse than the nearest snap', () => {
    const near = realizeLadder(example5, {
      source: { kind: 'series', series: 'E6' },
      scope: 'all',
      preferVswr: false,
    });
    const best = realizeLadder(example5, {
      source: { kind: 'series', series: 'E6' },
      scope: 'all',
    });
    expect(best.result.info[5]!.vswr).toBeLessThanOrEqual(near.result.info[5]!.vswr);
    // With E6 the nearest snap is 15 nH, 22 pF, 22 nH, 15 pF, 33 nH.
    expect(near.ladder.elements.map((e) => (e as { value: number }).value)).toEqual([
      15e-9, 22e-12, 22e-9, 15e-12, 33e-9,
    ]);
  });

  it('respects scope and locks', () => {
    const onlyL = realizeLadder(example5, {
      source: { kind: 'series', series: 'E24' },
      scope: 'L',
    });
    expect(onlyL.elements[1]!.parts[0]!.source).toBe('exact');
    expect(onlyL.elements[1]!.realized).toEqual(example5.elements[1]);
    expect(onlyL.elements[0]!.parts[0]!.source).toBe('E24');

    const locked = realizeLadder(example5, {
      source: { kind: 'series', series: 'E24' },
      scope: 'all',
      locked: [4],
    });
    expect(locked.elements[4]!.locked).toBe(true);
    expect(locked.elements[4]!.realized).toEqual(example5.elements[4]);
    expect(locked.elements[4]!.parts[0]!.source).toBe('exact');
    expect(locked.elements[3]!.locked).toBe(false);
  });

  it('keeps lines, stubs and transformers exact', () => {
    const ladder: Ladder = {
      z0: 50,
      frequency: 1e9,
      load: complex(25, 10),
      elements: [
        { kind: 'line', z0: 50, length: 0.123, refFrequency: 1e9 },
        { kind: 'openStub', z0: 50, length: 0.07, refFrequency: 1e9 },
        { kind: 'transformer', n: 1.7 },
        { kind: 'R', orientation: 'series', value: 51.3 },
      ],
    };
    const r = realizeLadder(ladder, { source: { kind: 'series', series: 'E24' }, scope: 'all' });
    expect(r.ladder.elements.slice(0, 3)).toEqual(ladder.elements.slice(0, 3));
    expect(r.elements[0]!.parts).toEqual([]);
    expect(r.ladder.elements[3]).toEqual({ kind: 'R', orientation: 'series', value: 51 });
  });

  it('preserves the resonance of L-C pairs and reports the detuning', () => {
    const f0 = 100e6;
    const w0 = 2 * Math.PI * f0;
    const l = 123e-9;
    const c = 1 / (w0 * w0 * l);
    const ladder: Ladder = {
      z0: 50,
      frequency: f0,
      load: complex(50, 0),
      elements: [
        { kind: 'L', orientation: 'series', value: l },
        { kind: 'C', orientation: 'series', value: c },
        { kind: 'RLC', orientation: 'shunt', connection: 'parallel', r: 1234, l, c },
      ],
    };
    const r = realizeLadder(ladder, {
      source: { kind: 'series', series: 'E24' },
      scope: 'pairs',
      preferVswr: false,
    });
    const [sl, sc, rlc] = r.ladder.elements as unknown as [
      { value: number },
      { value: number },
      { r: number; l: number; c: number },
    ];
    expect(sl.value).toBe(120e-9);
    // C is solved for the ideal resonance with L = 120 nH, then snapped to E24.
    const cTarget = 1 / (w0 * w0 * 120e-9);
    expect(sc.value).toBe(nearestInSeries(cTarget, 'E24'));
    const fres = 1 / (2 * Math.PI * Math.sqrt(sl.value * sc.value));
    expect(Math.abs(fres / f0 - 1)).toBeLessThan(0.03);
    expect(r.elements[0]!.detuning).toBeCloseTo(fres / f0 - 1, 12);
    expect(r.elements[0]!.pairWith).toBe(1);
    expect(r.elements[1]!.pairWith).toBe(0);
    // The RLC block is a pair by itself, its resistor an ordinary part.
    expect(rlc.l).toBe(120e-9);
    expect(rlc.c).toBe(sc.value);
    expect(rlc.r).toBe(1200);
    expect(r.elements[2]!.detuning).toBeCloseTo(fres / f0 - 1, 12);
    expect(r.elements[2]!.pairWith).toBeUndefined();
  });

  it('uses a custom stock per part kind and leaves parts without stock exact', () => {
    const stock = parseStock('10 nH, 15 nH; 18nH\n22 pF, 27pF\n47, 51 Ω');
    expect(stock).toEqual({
      L: [10e-9, 15e-9, 18e-9, 47],
      C: [22e-12, 27e-12, 47],
      R: [47, 51],
    });
    const r = realizeLadder(example5, { source: { kind: 'stock', stock }, scope: 'all' });
    const values = r.ladder.elements.map((e) => (e as { value: number }).value);
    expect(values[0]).toBe(15e-9);
    expect(values[1]).toBe(22e-12);
    expect(values[3]).toBe(22e-12);
    expect(r.elements[0]!.parts[0]!.source).toBe('stock');

    const empty = realizeLadder(example5, {
      source: { kind: 'stock', stock: { L: [], C: [], R: [] } },
      scope: 'all',
    });
    expect(empty.ladder.elements).toEqual(example5.elements);
    expect(empty.elements.every((e) => e.parts[0]!.source === 'exact')).toBe(true);
  });
});

describe('bill of materials', () => {
  it('lists one row per part with ideal, realized, series and deviation', () => {
    const r = realizeLadder(example5, { source: { kind: 'series', series: 'E24' }, scope: 'all' });
    const rows = bomRows(r);
    expect(rows).toHaveLength(5);
    expect(rows[0]).toMatchObject({
      position: 1,
      element: 'Shunt L',
      part: 'L',
      realized: 16e-9,
      unit: 'H',
      source: 'E24',
      locked: false,
    });
    expect(rows[0]!.deviationPercent).toBeCloseTo(-0.21, 2);
    expect(rows[4]!.deviationPercent).toBeCloseTo(1.69, 2);
    const csv = bomCsv(rows);
    const lines = csv.split('\n');
    expect(lines[0]).toBe(
      'Position;Element;Part;Ideal;Realized;Unit;Series;Deviation[%];Detuning[%];Locked;Manufacturer;Part number',
    );
    expect(lines[1]).toBe('1;Shunt L;L;16.033n;16n;H;E24;-0.21;;;;');
    expect(lines[5]).toBe('5;Shunt L;L;29.5n;30n;H;E24;1.69;;;;');
  });

  it('includes distributed elements as exact rows', () => {
    const ladder: Ladder = {
      z0: 50,
      frequency: 1e9,
      load: complex(25, 10),
      elements: [{ kind: 'line', z0: 75, length: 0.125, refFrequency: 1e9 }],
    };
    const rows = bomRows(
      realizeLadder(ladder, { source: { kind: 'series', series: 'E24' }, scope: 'all' }),
      () => 'Quarter line',
    );
    expect(rows[0]).toMatchObject({
      element: 'Quarter line',
      part: 'line',
      ideal: 0.125,
      realized: 0.125,
      unit: 'λ',
      source: 'exact',
      deviationPercent: null,
    });
  });
});
