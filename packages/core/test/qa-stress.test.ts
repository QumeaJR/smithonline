/**
 * QA round 1: stress.ts hand calculations for reactive parts, a two-element
 * ladder with power bookkeeping, and the limit edge cases.
 */
import { describe, expect, it } from 'vitest';
import {
  bomCsv,
  bomRows,
  complex,
  dbmToWatt,
  elementExceeds,
  ladderStress,
  partExceeds,
  realizeLadder,
  wattToDbm,
  type ElementStress,
  type Ladder,
} from '../src/index';

const F = 100e6;
const W = 2 * Math.PI * F;
/** Reactance 50 ohm at 100 MHz. */
const L50 = 50 / W;

describe('ladderStress hand values at 1 W (Vs = 20 V peak)', () => {
  it('series L of X = 50 on a 50 ohm load: I = 20/(100 + j50), |I| = 0.178885, V = 8.944 V peak', () => {
    const ladder: Ladder = {
      z0: 50,
      frequency: F,
      load: complex(50, 0),
      elements: [{ kind: 'L', orientation: 'series', value: L50 }],
    };
    const [s] = ladderStress(ladder, 1) as [ElementStress];
    // |20 / (100 + j50)| = 20 / sqrt(12500) = 0.17888544
    expect(s.iRms).toBeCloseTo(0.17888544 / Math.SQRT2, 7);
    expect(s.vPeak).toBeCloseTo(0.17888544 * 50, 6);
    expect(s.parts).toEqual([{ part: 'L', vPeak: s.vPeak, iRms: s.iRms }]);
  });

  it('shunt L of X = 50 across a 50 ohm load: Zin = 25 + j25, V = 8 + j4, I_L = V / j50', () => {
    const ladder: Ladder = {
      z0: 50,
      frequency: F,
      load: complex(50, 0),
      elements: [{ kind: 'L', orientation: 'shunt', value: L50 }],
    };
    const [s] = ladderStress(ladder, 1) as [ElementStress];
    // I = 20 / (75 + j25) = 0.24 - j0.08; V = I Zin = 8 + j4; |V| = sqrt(80).
    expect(s.vPeak).toBeCloseTo(Math.sqrt(80), 9);
    // I_L = (8 + j4) / j50 = 0.08 - j0.16, |I_L| = sqrt(0.032).
    expect(s.iRms).toBeCloseTo(Math.sqrt(0.032) / Math.SQRT2, 9);
  });

  it('series R 50 then shunt R 100 (matched): node voltages 10 V and 5 V, powers add to 1 W', () => {
    const ladder: Ladder = {
      z0: 50,
      frequency: F,
      load: complex(50, 0),
      elements: [
        { kind: 'R', orientation: 'series', value: 50 },
        { kind: 'R', orientation: 'shunt', value: 100 },
      ],
    };
    const [series, shunt] = ladderStress(ladder, 1) as [ElementStress, ElementStress];
    // Zin = 50 exactly: I = 0.2 A, Vin = 10 V. Shunt takes 0.1 A, the series branch 0.1 A, 5 V.
    expect(shunt.vPeak).toBeCloseTo(10, 9);
    expect(shunt.iRms).toBeCloseTo(0.1 / Math.SQRT2, 9);
    expect(series.vPeak).toBeCloseTo(5, 9);
    expect(series.iRms).toBeCloseTo(0.1 / Math.SQRT2, 9);
    const p = (s: ElementStress) => (s.vPeak * s.iRms * Math.SQRT2) / 2;
    // 0.5 W in the shunt, 0.25 W in the series R, 0.25 W in the load.
    expect(p(shunt) + p(series) + 0.25).toBeCloseTo(1, 9);
  });

  it('negative, NaN and infinite power give all zeros', () => {
    const ladder: Ladder = {
      z0: 50,
      frequency: F,
      load: complex(50, 0),
      elements: [{ kind: 'R', orientation: 'series', value: 50 }],
    };
    for (const p of [-1, NaN, Infinity]) {
      const [s] = ladderStress(ladder, p) as [ElementStress];
      expect(s.vPeak).toBe(0);
      expect(s.iRms).toBe(0);
    }
  });

  it('a C of value 0 does not divide by zero', () => {
    const ladder: Ladder = {
      z0: 50,
      frequency: F,
      load: complex(50, 0),
      elements: [{ kind: 'C', orientation: 'shunt', value: 0 }],
    };
    const [s] = ladderStress(ladder, 1) as [ElementStress];
    expect(Number.isFinite(s.vPeak)).toBe(true);
    expect(Number.isFinite(s.iRms)).toBe(true);
  });
});

describe('power units at the edges', () => {
  it('dBm -Infinity is 0 W; 0 W is -Infinity dBm; NaN stays NaN', () => {
    expect(dbmToWatt(-Infinity)).toBe(0);
    expect(wattToDbm(0)).toBe(-Infinity);
    expect(Number.isNaN(dbmToWatt(NaN))).toBe(true);
    expect(Number.isNaN(wattToDbm(NaN))).toBe(true);
    expect(dbmToWatt(-30)).toBeCloseTo(1e-6, 15);
  });
});

describe('limits', () => {
  const part = { part: 'C' as const, vPeak: 100, iRms: 2 };

  it('a value exactly at the limit is not over; a limit of 0, negative or NaN is no limit', () => {
    expect(partExceeds(part, { C: { vPeak: 100, iRms: 2 } })).toEqual({
      voltage: false,
      current: false,
    });
    expect(partExceeds(part, { C: { vPeak: 0, iRms: -1 } })).toEqual({
      voltage: false,
      current: false,
    });
    expect(partExceeds(part, { C: { vPeak: NaN } })).toEqual({ voltage: false, current: false });
    expect(partExceeds(part, { C: { vPeak: 99.999 } })).toEqual({ voltage: true, current: false });
  });

  it('an element with no parts is never over', () => {
    expect(
      elementExceeds({ index: 0, vPeak: 1e6, iRms: 1e6, parts: [] }, { R: { vPeak: 1 } }),
    ).toEqual({ voltage: false, current: false });
  });

  it('bomCsv without stress has 12 columns, with stress 15, and an empty flag for a part within limits', () => {
    const ladder: Ladder = {
      z0: 50,
      frequency: F,
      load: complex(50, 0),
      elements: [{ kind: 'L', orientation: 'series', value: L50 }],
    };
    const realization = realizeLadder(ladder, {
      source: { kind: 'series', series: 'E24' },
      scope: 'all',
    });
    const plain = bomCsv(bomRows(realization));
    expect(plain.split('\n')[0]!.split(';')).toHaveLength(12);
    const stress = ladderStress(realization.ladder, 1);
    const withLimits = bomCsv(
      bomRows(realization, undefined, { elements: stress, limits: { L: { vPeak: 1e3 } } }),
    );
    const header = withLimits.split('\n')[0]!.split(';');
    expect(header).toHaveLength(15);
    expect(header.slice(10, 13)).toEqual(['Peak voltage[V]', 'RMS current[A]', 'Over limit']);
    const row = withLimits.split('\n')[1]!.split(';');
    expect(row[12]).toBe('');
  });
});
