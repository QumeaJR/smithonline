/**
 * Adversarial tests, QA round 1: hostile share-link payloads for the fields
 * this batch added (limits, stress, tolerance, user datapoints) and hostile
 * local storage for overlays and the core table.
 */
import {
  complex,
  sweepFrequency,
  sweepPoints,
  sweepResponse,
  type Ladder,
} from '@smithonline/core';
import { describe, expect, it } from 'vitest';
import { limitsOf, stressOf, toleranceOf } from '../src/lib/build';
import { emptyDesign } from '../src/lib/design';
import { MAX_OVERLAYS, parseOverlays, resample, snapshot } from '../src/lib/overlays';
import { decodeDesign, encodeDesign } from '../src/lib/share';
import { parseCores } from '../src/lib/winding';
import { userDatapoints } from '../src/lib/datapoints';

/** JSON text to a link payload; the marker becomes an overflowing literal in the JSON text. */
const encode = (obj: unknown): string =>
  Buffer.from(JSON.stringify(obj).replace('"__OVERFLOW__"', '1e999'), 'utf8').toString('base64url');

const minimal = { v: 1, elements: [] as unknown[], load: { re: 50, im: 0 } };

describe('adv: share link, new fields', () => {
  it('limits: junk entries are dropped, good ones kept, prototype keys harmless', () => {
    const d = decodeDesign(
      encode({
        ...minimal,
        limits: [
          { quantity: '__proto__', f1: 1e9, f2: 2e9, kind: 'max', value: 2 },
          { quantity: 'vswr', f1: -1, f2: 2e9, kind: 'max', value: 2 },
          { quantity: 'vswr', f1: 1e9, f2: 2e9, kind: 'both', value: 2 },
          { quantity: 'vswr', f1: 1e9, f2: 2e9, kind: 'max', value: 'x' },
          { quantity: 'vswr', f1: 1e9, f2: 2e9, kind: 'max', value: '__OVERFLOW__' },
          { quantity: 'vswr', f1: 1e9, f2: 2e9, kind: 'max', value: 2, id: { toString: 1 } },
          null,
          42,
        ],
      }),
    )!;
    expect(d).not.toBeNull();
    expect(d.limits).toHaveLength(1);
    expect(typeof d.limits![0]!.id).toBe('string');
    expect(Object.prototype.hasOwnProperty.call(Object.prototype, 'f1')).toBe(false);
  });

  it('stress and tolerance: out-of-range and prototype keys are dropped without polluting', () => {
    const d = decodeDesign(
      encode({
        ...minimal,
        stress: {
          power: -5,
          unit: 'kW',
          limits: { __proto__: { vPeak: 1 }, L: { vPeak: 'x', iRms: 2 }, Q: { vPeak: 1 } },
        },
        tolerance: {
          runs: 1e12,
          seed: NaN,
          percent: 500,
          vswrLimit: 0.5,
          overrides: { __proto__: 5, constructor: 10, abc: 101, def: 7 },
        },
      }),
    )!;
    expect(d.stress).toEqual({ power: 0, unit: 'W', limits: { L: { iRms: 2 } } });
    expect(d.tolerance).toMatchObject({ runs: 100000, seed: 1, percent: null, vswrLimit: 2 });
    expect(Object.keys(d.tolerance!.overrides)).toEqual(['constructor', 'def']);
    expect(({} as Record<string, unknown>).abc).toBeUndefined();
  });

  it('a million datapoints are cut to the limit and a huge startSlot is clamped', () => {
    const datapoints = Array.from({ length: 10000 }, (_, i) => ({
      frequency: 1e9 + i,
      z: { re: 1, im: 0 },
    }));
    const d = decodeDesign(encode({ ...minimal, datapoints, startSlot: 1e300 }))!;
    expect(userDatapoints(d)).toHaveLength(64);
    expect(d.startSlot).toBe(63);
    // And the design still encodes without the start duplicating a point.
    const again = decodeDesign(encodeDesign(d))!;
    expect(userDatapoints(again)).toHaveLength(64);
  });

  it('stressOf and toleranceOf and limitsOf take non-objects without throwing', () => {
    for (const junk of [null, undefined, 1, 'x', [], true, () => 0]) {
      expect(() => stressOf(junk)).not.toThrow();
      expect(() => toleranceOf(junk)).not.toThrow();
      expect(() => limitsOf(junk)).not.toThrow();
    }
  });

  it('a design with the new fields survives encode and decode unchanged', () => {
    const d = {
      ...emptyDesign(),
      datapoints: [{ frequency: 2e9, z: complex(30, 10) }],
      startSlot: 1,
      limits: [
        { id: 'a', quantity: 'vswr' as const, f1: 1e9, f2: 2e9, kind: 'max' as const, value: 2 },
      ],
      stress: { power: 10, unit: 'dBm' as const, limits: { C: { vPeak: 100 } } },
      tolerance: {
        runs: 500,
        seed: 7,
        distribution: 'normal' as const,
        percent: 2,
        vswrLimit: 1.5,
        overBand: true,
        overrides: { x: 1 },
      },
    };
    const back = decodeDesign(encodeDesign(d))!;
    expect(back.datapoints).toEqual(d.datapoints);
    expect(back.startSlot).toBe(1);
    expect(back.limits).toEqual(d.limits);
    expect(back.stress).toEqual(d.stress);
    expect(back.tolerance).toEqual(d.tolerance);
  });
});

describe('adv: overlays in local storage', () => {
  const ladder: Ladder = {
    z0: 50,
    frequency: 1e9,
    load: complex(20, -12),
    elements: [{ kind: 'L', orientation: 'shunt', value: 8e-9 }],
  };
  const response = sweepResponse(sweepFrequency(ladder, sweepPoints(0.5e9, 1.5e9, 11)));
  const good = snapshot('a', 'n', '#e03131', response);

  it('a column of the wrong length, a non-array frequency and a prototype key are dropped', () => {
    const bad1 = { ...good, columns: { ...good.columns, vswr: [1] } };
    const bad2 = { ...good, frequency: { length: 11 } };
    const bad3 = { ...good, id: 7 };
    const list = parseOverlays(
      JSON.stringify([bad1, bad2, bad3, good, { __proto__: { id: 'x' } }]),
    );
    expect(list).toHaveLength(1);
    expect(list[0]!.id).toBe('a');
  });

  it('more than the limit in storage keeps only the first MAX_OVERLAYS', () => {
    const many = Array.from({ length: 50 }, (_, i) => ({ ...good, id: String(i) }));
    expect(parseOverlays(JSON.stringify(many))).toHaveLength(MAX_OVERLAYS);
  });

  it('resample survives an unsorted or duplicate frequency axis without throwing', () => {
    const shuffled = { ...good, frequency: [...good.frequency].reverse() };
    expect(() => resample(shuffled, 'vswr', [0.7e9, 1e9, 1.3e9])).not.toThrow();
    const dup = { ...good, frequency: good.frequency.map(() => 1e9) };
    const out = resample(dup, 'vswr', [1e9]);
    expect(out.every((v) => v === null || Number.isFinite(v))).toBe(true);
  });
});

describe('adv: toroid core table in local storage', () => {
  it('cores with id >= od, non-positive AL or an empty name are dropped; junk falls back to the built-in table', () => {
    const list = parseCores(
      JSON.stringify([
        { name: 'bad1', al: 5, od: 10, id: 10, height: 3 },
        { name: ' ', al: 5, od: 10, id: 5, height: 3 },
        { name: 'bad3', al: 0, od: 10, id: 5, height: 3 },
        { name: 'ok', al: 5, od: 10, id: 5, height: 3 },
      ]),
    );
    expect(list.map((c) => c.name)).toEqual(['ok']);
    expect(parseCores('{"length":1e9}').length).toBeGreaterThan(5);
    expect(parseCores('[')).toHaveLength(parseCores(null).length);
  });
});
