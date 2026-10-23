import {
  complex,
  sweepFrequency,
  sweepPoints,
  sweepResponse,
  type Ladder,
} from '@smithonline/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MAX_OVERLAYS, OVERLAY_KEY, parseOverlays, resample, snapshot } from '../src/lib/overlays';
import { useOverlays } from '../src/store/useOverlays';

const ladder: Ladder = {
  z0: 50,
  frequency: 1e9,
  load: complex(20, -12),
  elements: [
    { kind: 'L', orientation: 'shunt', value: 8e-9 },
    { kind: 'C', orientation: 'series', value: 3e-12 },
  ],
};
const response = sweepResponse(sweepFrequency(ladder, sweepPoints(0.5e9, 1.5e9, 21)));

describe('snapshot and resample', () => {
  it('keeps the curves to five digits and the frequencies exactly', () => {
    const o = snapshot('a', 'before', '#e03131', response);
    expect(o.frequency).toEqual(response.frequency);
    expect(o.columns.vswr[3]).toBeCloseTo(response.vswr[3] as number, 4);
    expect(String(o.columns.vswr[3]).replace(/\D/g, '').length).toBeLessThanOrEqual(7);
  });

  it('turns non-finite samples into null so they survive JSON', () => {
    const o = snapshot('a', 'x', '#000', {
      ...response,
      s11Db: response.s11Db.map((v, i) => (i === 2 ? -Infinity : v)),
    });
    expect(o.columns.s11Db[2]).toBeNull();
    expect(JSON.parse(JSON.stringify(o)).columns.s11Db[2]).toBeNull();
  });

  it('is exact on its own grid and interpolates between samples', () => {
    const o = snapshot('a', 'x', '#000', response);
    const own = resample(o, 'vswr', response.frequency);
    own.forEach((v, i) => expect(v).toBeCloseTo(response.vswr[i] as number, 3));
    const mid = (response.frequency[4]! + response.frequency[5]!) / 2;
    const y = resample(o, 'vswr', [mid])[0] as number;
    const lo = Math.min(o.columns.vswr[4]!, o.columns.vswr[5]!);
    const hi = Math.max(o.columns.vswr[4]!, o.columns.vswr[5]!);
    expect(y).toBeGreaterThanOrEqual(lo - 1e-9);
    expect(y).toBeLessThanOrEqual(hi + 1e-9);
    expect(y).toBeCloseTo((o.columns.vswr[4]! + o.columns.vswr[5]!) / 2, 9);
  });

  it('is null outside the stored range and next to a missing sample', () => {
    const o = snapshot('a', 'x', '#000', {
      ...response,
      vswr: response.vswr.map((v, i) => (i === 5 ? Infinity : v)),
    });
    expect(resample(o, 'vswr', [0.4e9, 1.6e9])).toEqual([null, null]);
    const f = response.frequency;
    expect(resample(o, 'vswr', [(f[4]! + f[5]!) / 2, (f[5]! + f[6]!) / 2])).toEqual([null, null]);
    expect(resample(o, 'vswr', [f[5]!])).toEqual([null]);
    // The last point is on the grid.
    expect(resample(o, 'vswr', [f[f.length - 1]!])[0]).not.toBeNull();
  });

  it('copes with an empty overlay', () => {
    const empty = snapshot('a', 'x', '#000', {
      frequency: [],
      s21Db: [],
      s11Db: [],
      vswr: [],
      r: [],
      x: [],
      phaseDeg: [],
      groupDelay: [],
    });
    expect(resample(empty, 'vswr', [1e9])).toEqual([null]);
  });
});

describe('parseOverlays', () => {
  it('reads what was stored and drops malformed entries and bad JSON', () => {
    const good = snapshot('a', 'x', '#000', response);
    const text = JSON.stringify([good, { id: 'b' }, 7, null]);
    expect(parseOverlays(text).map((o) => o.id)).toEqual(['a']);
    expect(parseOverlays('{not json')).toEqual([]);
    expect(parseOverlays(null)).toEqual([]);
    expect(parseOverlays('{}')).toEqual([]);
  });

  it('rejects a column of the wrong length', () => {
    const good = snapshot('a', 'x', '#000', response);
    const bad = { ...good, columns: { ...good.columns, vswr: [1, 2] } };
    expect(parseOverlays(JSON.stringify([bad]))).toEqual([]);
  });
});

describe('overlay store', () => {
  const kept = new Map<string, string>();
  const g = globalThis as { localStorage?: unknown };
  const before = g.localStorage;
  beforeEach(() => {
    kept.clear();
    g.localStorage = {
      getItem: (k: string) => kept.get(k) ?? null,
      setItem: (k: string, v: string) => void kept.set(k, v),
    };
    useOverlays.getState().clear();
  });
  afterEach(() => {
    g.localStorage = before;
  });

  it('stores, persists and removes, up to ten', () => {
    const { store, remove } = useOverlays.getState();
    expect(store('one', '#111', response)).toBe(true);
    expect(parseOverlays(kept.get(OVERLAY_KEY) ?? null)).toHaveLength(1);
    for (let i = 1; i < MAX_OVERLAYS; i++) store(`n${i}`, '#222', response);
    expect(useOverlays.getState().overlays).toHaveLength(MAX_OVERLAYS);
    expect(store('eleventh', '#333', response)).toBe(false);
    const first = useOverlays.getState().overlays[0]!.id;
    remove(first);
    expect(useOverlays.getState().overlays).toHaveLength(MAX_OVERLAYS - 1);
    expect(parseOverlays(kept.get(OVERLAY_KEY) ?? null)).toHaveLength(MAX_OVERLAYS - 1);
  });

  it('keeps working in memory when storage refuses', () => {
    g.localStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota');
      },
    };
    expect(useOverlays.getState().store('a', '#111', response)).toBe(true);
    expect(useOverlays.getState().overlays).toHaveLength(1);
    expect(useOverlays.getState().unsaved).toBe(true);
  });
});
