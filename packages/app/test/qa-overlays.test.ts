/**
 * QA round 1: overlays at the limits: single-sample overlays, exact hits on
 * the last sample, missing neighbours, the ten-slot cap and colour recycling.
 */
import { LIMIT_QUANTITIES, type Response } from '@smithonline/core';
import { describe, expect, it } from 'vitest';
import {
  MAX_OVERLAYS,
  OVERLAY_COLORS,
  parseOverlays,
  resample,
  snapshot,
  type Overlay,
} from '../src/lib/overlays';
import { nextOverlayColor } from '../src/store/useOverlays';

function overlay(frequency: number[], vswr: (number | null)[], s21Db?: (number | null)[]): Overlay {
  const columns = {} as Record<(typeof LIMIT_QUANTITIES)[number], (number | null)[]>;
  for (const q of LIMIT_QUANTITIES) columns[q] = frequency.map(() => 0);
  columns.vswr = vswr;
  if (s21Db) columns.s21Db = s21Db;
  return { id: 'o', name: 'o', color: '#000000', frequency, columns };
}

describe('resample', () => {
  it('a single-sample overlay answers only at its own frequency', () => {
    const o = overlay([1e6], [5]);
    expect(resample(o, 'vswr', [1e6, 2e6, 0.5e6])).toEqual([5, null, null]);
  });

  it('hits the last sample exactly and is null beyond either end', () => {
    const o = overlay([1e6, 3e6], [1, 3]);
    expect(resample(o, 'vswr', [3e6, 1e6, 2e6, 0.999e6, 3.001e6])).toEqual([3, 1, 2, null, null]);
  });

  it('a missing neighbour makes the interval null but not the samples themselves', () => {
    const o = overlay([1e6, 3e6, 5e6], [1, 3, 5], [null, 3, 5]);
    expect(resample(o, 's21Db', [1e6, 2e6, 3e6, 4e6, 5e6])).toEqual([null, null, 3, 4, 5]);
  });

  it('NaN x gives null', () => {
    expect(resample(overlay([1e6, 3e6], [1, 3]), 'vswr', [NaN])).toEqual([null]);
  });
});

describe('snapshot', () => {
  it('rounds to five significant digits, nulls non-finite samples and copies the frequencies', () => {
    const frequency = [1e6];
    const r: Response = {
      frequency,
      s21Db: [-1.23456789],
      s11Db: [-Infinity],
      vswr: [NaN],
      r: [50],
      x: [-0],
      phaseDeg: [12.34567],
      groupDelay: [1.2345678e-9],
    };
    const o = snapshot('id', 'n', '#ff0000', r);
    expect(o.columns.s21Db).toEqual([-1.2346]);
    expect(o.columns.s11Db).toEqual([null]);
    expect(o.columns.vswr).toEqual([null]);
    expect(o.columns.phaseDeg).toEqual([12.346]);
    expect(o.columns.groupDelay).toEqual([1.2346e-9]);
    expect(o.frequency).toEqual([1e6]);
    expect(o.frequency).not.toBe(frequency);
  });
});

describe('parseOverlays', () => {
  it('keeps at most ten, drops non-array JSON and entries with a non-string id', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ ...overlay([1], [1]), id: `o${i}` }));
    expect(parseOverlays(JSON.stringify(many))).toHaveLength(MAX_OVERLAYS);
    expect(parseOverlays('{}')).toEqual([]);
    expect(parseOverlays('null')).toEqual([]);
    expect(parseOverlays('')).toEqual([]);
    const badId = { ...overlay([1], [1]), id: 5 };
    expect(parseOverlays(JSON.stringify([badId, overlay([1], [1])]))).toHaveLength(1);
  });

  it('drops an overlay whose frequency list holds a non-number', () => {
    const bad = { ...overlay([1, 2], [1, 2]), frequency: [1, 'x'] };
    expect(parseOverlays(JSON.stringify([bad]))).toEqual([]);
  });
});

describe('nextOverlayColor', () => {
  it('skips colours in use and wraps to the first when all ten are used', () => {
    const used = (n: number): Overlay[] =>
      OVERLAY_COLORS.slice(0, n).map((color, i) => ({ ...overlay([1], [1]), id: `o${i}`, color }));
    expect(nextOverlayColor([])).toBe(OVERLAY_COLORS[0]);
    expect(nextOverlayColor(used(3))).toBe(OVERLAY_COLORS[3]);
    expect(nextOverlayColor(used(10))).toBe(OVERLAY_COLORS[0]);
    // A gap is filled first.
    const gap = used(4).filter((o) => o.color !== OVERLAY_COLORS[1]);
    expect(nextOverlayColor(gap)).toBe(OVERLAY_COLORS[1]);
  });
});
