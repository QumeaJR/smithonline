import { complex, evaluateLadder, type Complex } from '@smithonline/core';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SmithChart } from '../src/chart/SmithChart';
import {
  declutterLabels,
  designFrequencyIndex,
  designPointIndex,
  labelledSweepIndices,
  MAX_SWEEP_LABELS,
  sweepAnchorIndex,
} from '../src/chart/sweepLabels';
import { emptyDesign, type Design } from '../src/lib/design';
import { designSweep, ladderOf } from '../src/lib/files';

describe('labelledSweepIndices', () => {
  it('labels every point of a short sweep, up to and including the limit', () => {
    expect(MAX_SWEEP_LABELS).toBe(12);
    expect(labelledSweepIndices(0)).toEqual([]);
    expect(labelledSweepIndices(1)).toEqual([0]);
    expect(labelledSweepIndices(5)).toEqual([0, 1, 2, 3, 4]);
    expect(labelledSweepIndices(12)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(labelledSweepIndices(30, 30)).toHaveLength(30);
    expect(labelledSweepIndices(5, 12, 2)).toEqual([0, 1, 2, 3, 4]);
  });

  it('thins 61 points to at most 12 labels, first and last included, in order', () => {
    const idx = labelledSweepIndices(61);
    expect(idx).toHaveLength(12);
    expect(idx[0]).toBe(0);
    expect(idx[idx.length - 1]).toBe(60);
    expect(idx).toEqual([...idx].sort((a, b) => a - b));
    expect(new Set(idx).size).toBe(idx.length);
  });

  it('has no cliff just past the limit: 13 points still show 12 labels', () => {
    expect(labelledSweepIndices(13)).toHaveLength(12);
    expect(labelledSweepIndices(14)).toHaveLength(12);
  });

  it('keeps the design point and still stays within the limit', () => {
    for (const keep of [0, 1, 17, 30, 59, 60]) {
      const idx = labelledSweepIndices(61, 12, keep);
      expect(idx).toContain(keep);
      expect(idx).toContain(0);
      expect(idx).toContain(60);
      expect(idx.length).toBeLessThanOrEqual(12);
    }
  });

  it('drops a spread label that would crowd the design point', () => {
    const plain = labelledSweepIndices(61, 12, null);
    const near = (plain[5] as number) + 1;
    const idx = labelledSweepIndices(61, 12, near);
    expect(idx).toContain(near);
    expect(idx).not.toContain(plain[5]);
  });

  it('ignores a keep that is negative, fractional, beyond the sweep or not a number', () => {
    const base = labelledSweepIndices(61, 12, null);
    for (const keep of [-1, 5.5, 61, 99, NaN, Infinity, -Infinity])
      expect(labelledSweepIndices(61, 12, keep)).toEqual(base);
  });

  it('survives hostile counts and limits', () => {
    expect(labelledSweepIndices(NaN)).toEqual([]);
    expect(labelledSweepIndices(Infinity)).toEqual([]);
    expect(labelledSweepIndices(-Infinity)).toEqual([]);
    expect(labelledSweepIndices(-5)).toEqual([]);
    expect(labelledSweepIndices(0.9)).toEqual([]);
    expect(labelledSweepIndices(5.9)).toEqual([0, 1, 2, 3, 4]);
    expect(labelledSweepIndices(61, NaN)).toEqual(labelledSweepIndices(61, 12));
    expect(labelledSweepIndices(500, Infinity)).toHaveLength(500);
    expect(labelledSweepIndices(61, 4.5, 30).length).toBeLessThanOrEqual(4);
  });

  it('never exceeds a limit below 3: first and last, then the first, then nothing', () => {
    expect(labelledSweepIndices(10, 2, 4)).toEqual([0, 9]);
    expect(labelledSweepIndices(10, 1, 4)).toEqual([0]);
    expect(labelledSweepIndices(10, 0, 4)).toEqual([]);
    expect(labelledSweepIndices(10, -3)).toEqual([]);
    expect(labelledSweepIndices(3, 1)).toEqual([0]);
  });

  it('copes with a huge sweep without building it', () => {
    const idx = labelledSweepIndices(1e9, 12, 54321);
    expect(idx.length).toBeLessThanOrEqual(12);
    expect(idx[idx.length - 1]).toBe(1e9 - 1);
    expect(idx).toContain(54321);
  });

  it('exhaustive: sorted, unique, integers in range, within limit, first, last, keep', () => {
    for (let n = 0; n <= 300; n++) {
      for (const max of [3, 4, 6, 12, 20]) {
        for (const keep of [null, 0, 1, Math.floor(n / 3), n - 2, n - 1]) {
          const idx = labelledSweepIndices(n, max, keep);
          expect(idx.length).toBeLessThanOrEqual(max);
          expect(new Set(idx).size).toBe(idx.length);
          idx.forEach((v, j) => {
            expect(Number.isInteger(v) && v >= 0 && v < n).toBe(true);
            if (j > 0) expect(v).toBeGreaterThan(idx[j - 1] as number);
          });
          if (n > 0) {
            expect(idx[0]).toBe(0);
            expect(idx[idx.length - 1]).toBe(n - 1);
          }
          if (keep !== null && keep >= 0 && keep < n) expect(idx).toContain(keep);
        }
      }
    }
  });
});

describe('designFrequencyIndex', () => {
  it('finds the point at the design frequency and nothing otherwise', () => {
    const f = [1e9, 1.5e9, 2e9, 2.5e9];
    expect(designFrequencyIndex(f, 2e9)).toBe(2);
    expect(designFrequencyIndex(f, 2.0000001e9)).toBe(2);
    expect(designFrequencyIndex(f, 1.7e9)).toBeNull();
    expect(designFrequencyIndex([], 1e9)).toBeNull();
  });

  it('rejects a design frequency that is not a positive finite number', () => {
    for (const fd of [0, -0, -1e9, NaN, Infinity, -Infinity])
      expect(designFrequencyIndex([1e9, 2e9], fd)).toBeNull();
  });

  it('tolerance is a relative 1e-6 either way, and the nearest point wins', () => {
    expect(designFrequencyIndex([1.0000005e9], 1e9)).toBe(0);
    expect(designFrequencyIndex([0.9999995e9], 1e9)).toBe(0);
    expect(designFrequencyIndex([1.000002e9], 1e9)).toBeNull();
    expect(designFrequencyIndex([1.0000008e9, 1.0000002e9], 1e9)).toBe(1);
  });

  it('the first of several equal frequencies wins', () => {
    expect(designFrequencyIndex([1e9, 1e9, 1e9], 1e9)).toBe(0);
  });

  it('skips NaN and infinite entries and searches an unsorted list in full', () => {
    expect(designFrequencyIndex([NaN, Infinity, -Infinity, 3e9], 3e9)).toBe(3);
    expect(designFrequencyIndex([NaN, Infinity], 3e9)).toBeNull();
    expect(designFrequencyIndex([3e9, 1e9, 2e9], 2e9)).toBe(2);
  });
});

describe('designPointIndex', () => {
  const pts = (n: number): { frequency: number; z: Complex }[] =>
    Array.from({ length: n }, (_, i) => ({ frequency: 1e9, z: complex(30 + i, 5) }));

  it('picks the point with the design load among several at the design frequency', () => {
    expect(designPointIndex(pts(20), 1e9, complex(37, 5))).toBe(7);
  });

  it('takes the nearest load at the design frequency, and nothing without one', () => {
    expect(designPointIndex(pts(20), 1e9, complex(99, 99))).toBe(19);
    expect(designPointIndex(pts(20), 1e9, complex(30, 99))).toBe(0);
    // a start dragged a little off its row stays on that row
    expect(designPointIndex(pts(20), 1e9, complex(47.4, 7))).toBe(17);
    expect(designPointIndex(pts(20), 2e9, complex(30, 5))).toBeNull();
    expect(designPointIndex([], 1e9, complex(30, 5))).toBeNull();
  });
});

describe('declutterLabels', () => {
  const pos = (xs: readonly number[]) => (i: number) => ({ x: xs[i] as number, y: 0 });

  it('keeps the earlier of two labels that collide and all that clear each other', () => {
    expect(declutterLabels([0, 1, 2], pos([0, 1, 5]), 2, 1)).toEqual([0, 2]);
    expect(declutterLabels([1, 0, 2], pos([0, 1, 5]), 2, 1)).toEqual([1, 2]);
    expect(declutterLabels([0, 1, 2], pos([0, 3, 6]), 2, 1)).toEqual([0, 1, 2]);
  });

  it('separates two labels on the same x by their y', () => {
    const at = (i: number) => ({ x: 0, y: i * 2 });
    expect(declutterLabels([0, 1, 2], at, 2, 1)).toEqual([0, 1, 2]);
    expect(declutterLabels([0, 1], () => ({ x: 0, y: 0 }), 2, 1)).toEqual([0]);
  });

  it('skips an index without a position', () => {
    expect(declutterLabels([0, 1], (i) => (i === 0 ? null : { x: 0, y: 0 }), 2, 1)).toEqual([1]);
  });
});

/** A design whose sweep loads sit on a circle of reflection 0.6, so neighbouring labels have room. */
function ringDesign(
  frequencies: readonly number[],
  startAt: number,
  zOf?: (i: number) => Complex,
): Design {
  const n = frequencies.length;
  const loads = frequencies.map((frequency, i) => {
    const a = (2 * Math.PI * i) / Math.max(n, 1);
    const g = { re: 0.6 * Math.cos(a), im: 0.6 * Math.sin(a) };
    const den = (1 - g.re) ** 2 + g.im ** 2;
    const z = complex((50 * (1 - g.re ** 2 - g.im ** 2)) / den, (50 * 2 * g.im) / den);
    return { frequency, z: zOf ? zOf(i) : z };
  });
  const d = emptyDesign();
  return {
    ...d,
    frequency: frequencies[startAt] ?? 1e9,
    load: (loads[startAt] ?? loads[0] ?? { z: d.load }).z,
    sweep: { ...d.sweep, enabled: true, loads, loadsName: 'test.s1p' },
  };
}

const ramp = (count: number): number[] =>
  Array.from({ length: count }, (_, i) => 1e9 + (i * 1e9) / Math.max(1, count - 1));

const drawn = (d: Design, anchor: number | null | undefined): string =>
  renderToStaticMarkup(
    createElement(SmithChart, {
      result: evaluateLadder(ladderOf(d)),
      z0: d.z0,
      options: { zGrid: true, yGrid: false, density: 'normal', labels: true },
      selected: null,
      sweep: designSweep(d),
      sweepKind: 'datapoints',
      realized: null,
      realizedSweep: null,
      target: complex(d.z0, 0),
      vswrCircles: [],
      qContours: [],
      deviceCircles: [],
      arcColors: [],
      onSelect: () => undefined,
      onHover: () => undefined,
      onDragDatapoint: () => undefined,
      onDragEnd: () => undefined,
      ghost: null,
      onPlace: null,
      onSuggest: () => undefined,
      fitKey: 0,
      onContextMenu: () => undefined,
      svgRef: { current: null },
      ...(anchor === undefined ? {} : { anchor }),
    } as never),
  );

const spLabels = (svg: string): string[] => [...svg.matchAll(/>SP(\d+)</g)].map((m) => `SP${m[1]}`);
const markers = (svg: string): number => (svg.match(/class="sweep-end"/g) ?? []).length;

describe('SP labels on the chart', () => {
  it('a 61 point sweep keeps 61 markers and at most 12 labels, with SP1, SP61 and the anchor', () => {
    const svg = drawn(ringDesign(ramp(61), 30), 30);
    const labels = spLabels(svg);
    expect(markers(svg)).toBe(61);
    expect(labels.length).toBeLessThanOrEqual(12);
    expect(labels.length).toBeGreaterThanOrEqual(6);
    expect(labels).toContain('SP1');
    expect(labels).toContain('SP31');
    expect(labels).toContain('SP61');
  });

  it('every marker has a tooltip naming its point, labelled or not', () => {
    const svg = drawn(ringDesign(ramp(61), 30), 30);
    const titles = [...svg.matchAll(/<title>(SP\d+): ([^<]*)<\/title>/g)];
    expect(titles).toHaveLength(61);
    expect(titles[20]?.[1]).toBe('SP21');
    expect(titles[20]?.[2]).toContain('VSWR');
  });

  it('a short sweep is labelled in full, however the anchor is set', () => {
    for (const anchor of [undefined, null, 3, 99]) {
      const svg = drawn(ringDesign(ramp(8), 3), anchor);
      expect(markers(svg)).toBe(8);
      expect(spLabels(svg)).toHaveLength(8);
    }
  });

  it('1 and 2 points are labelled in full', () => {
    expect(spLabels(drawn(ringDesign([1e9], 0), 0))).toEqual(['SP1']);
    expect(spLabels(drawn(ringDesign([1e9, 2e9], 1), 1))).toEqual(['SP1', 'SP2']);
  });

  it('the anchor point is labelled when every point shares the design frequency', () => {
    const svg = drawn(
      ringDesign(
        Array.from({ length: 20 }, () => 1e9),
        7,
      ),
      7,
    );
    expect(markers(svg)).toBe(20);
    expect(spLabels(svg)).toContain('SP8');
  });

  it('points off the chart take no marker and no label, and the rest still show the ends', () => {
    const d = ringDesign(ramp(61), 30, (i) =>
      i === 0 || i === 30 || i === 60 ? complex(NaN, 0) : complex(50 + i, 10 + (i % 7)),
    );
    const svg = drawn(d, 30);
    const labels = spLabels(svg);
    expect(markers(svg)).toBe(58);
    expect(labels).not.toContain('SP1');
    expect(labels).not.toContain('SP31');
    expect(labels).not.toContain('SP61');
    expect(labels.length).toBeLessThanOrEqual(12);
    expect(labels).toContain('SP2');
    expect(labels).toContain('SP60');
  });

  it('survives an empty, a one point and a hostile anchor', () => {
    for (const anchor of [NaN, -1, 1e9, undefined])
      expect(() => drawn(ringDesign(ramp(61), 30), anchor as number)).not.toThrow();
  });

  it('labels that would sit on each other are dropped, the anchor kept', () => {
    // Every point at almost the same place: only the ends and the anchor can show.
    const d = ringDesign(ramp(61), 30, (i) => complex(50 + i * 1e-4, 10));
    const labels = spLabels(drawn(d, 30));
    expect(markers(drawn(d, 30))).toBe(61);
    expect(labels).toContain('SP31');
    expect(labels.length).toBeLessThanOrEqual(3);
  });
});

describe('sweepAnchorIndex', () => {
  it('is the start slot for a sweep over user datapoints and follows a changed start', () => {
    const d = emptyDesign();
    const more = Array.from({ length: 5 }, (_, i) => ({
      frequency: 1e9 + i,
      z: complex(30 + i, 2),
    }));
    expect(sweepAnchorIndex({ ...d, datapoints: more, startSlot: 3 })).toBe(3);
    expect(sweepAnchorIndex({ ...d, datapoints: more, startSlot: 0 })).toBe(0);
  });

  it('is the row with the design frequency and load for an imported sweep, null without one', () => {
    const d = ringDesign(ramp(20), 7);
    expect(sweepAnchorIndex(d)).toBe(7);
    expect(sweepAnchorIndex({ ...d, frequency: 5e9 })).toBeNull();
  });
});
