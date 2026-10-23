import { complex, evaluateLadder } from '@smithonline/core';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SmithChart } from '../src/chart/SmithChart';
import {
  designFrequencyIndex,
  labelledSweepIndices,
  MAX_SWEEP_LABELS,
} from '../src/chart/sweepLabels';
import { emptyDesign, type Design } from '../src/lib/design';
import { designSweep, ladderOf } from '../src/lib/files';

describe('labelledSweepIndices', () => {
  it('labels every point of a short sweep', () => {
    expect(labelledSweepIndices(0)).toEqual([]);
    expect(labelledSweepIndices(1)).toEqual([0]);
    expect(labelledSweepIndices(5)).toEqual([0, 1, 2, 3, 4]);
    expect(labelledSweepIndices(MAX_SWEEP_LABELS)).toHaveLength(MAX_SWEEP_LABELS);
    expect(labelledSweepIndices(30, 30)).toHaveLength(30);
  });

  it('thins 61 points to at most 12 labels, first and last included, in order', () => {
    const idx = labelledSweepIndices(61);
    expect(idx.length).toBeLessThanOrEqual(12);
    expect(idx.length).toBeGreaterThanOrEqual(8);
    expect(idx[0]).toBe(0);
    expect(idx[idx.length - 1]).toBe(60);
    expect(idx).toEqual([...idx].sort((a, b) => a - b));
    expect(new Set(idx).size).toBe(idx.length);
  });

  it('keeps the design frequency point and still stays within the limit', () => {
    for (const keep of [0, 1, 17, 30, 59, 60]) {
      const idx = labelledSweepIndices(61, 12, keep);
      expect(idx).toContain(keep);
      expect(idx).toContain(0);
      expect(idx).toContain(60);
      expect(idx.length).toBeLessThanOrEqual(12);
    }
    // A kept index outside the sweep is ignored.
    expect(labelledSweepIndices(61, 12, 99)).toEqual(labelledSweepIndices(61, 12, null));
  });

  it('holds the limit for any count and limit', () => {
    for (let n = 0; n <= 400; n += 7) {
      for (const max of [3, 4, 5, 12, 20]) {
        for (const keep of [null, 0, Math.floor(n / 2), n - 1]) {
          const idx = labelledSweepIndices(n, max, keep);
          expect(idx.length).toBeLessThanOrEqual(max);
          if (n > 0) {
            expect(idx[0]).toBe(0);
            expect(idx[idx.length - 1]).toBe(n - 1);
          }
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
    expect(designFrequencyIndex(f, 0)).toBeNull();
    expect(designFrequencyIndex([], 1e9)).toBeNull();
  });
});

/** A design with a datapoint sweep over `count` loads from 1 to 2 GHz, the design frequency in the middle. */
function sweepDesign(count: number): Design {
  const loads = Array.from({ length: count }, (_, i) => ({
    frequency: 1e9 + (i * 1e9) / (count - 1),
    z: complex(40 + i * 0.5, -20 + i * 0.7),
  }));
  const d = emptyDesign();
  return {
    ...d,
    frequency: loads[Math.floor(count / 2)]?.frequency ?? 1.5e9,
    sweep: { ...d.sweep, enabled: true, loads, loadsName: 'test.s1p' },
  };
}

const drawn = (d: Design, withFrequency: boolean): string => {
  const sweep = designSweep(d);
  return renderToStaticMarkup(
    createElement(SmithChart, {
      result: evaluateLadder(ladderOf(d)),
      z0: d.z0,
      options: { zGrid: true, yGrid: false, density: 'normal', labels: true },
      selected: null,
      sweep,
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
      ...(withFrequency ? { designFrequency: d.frequency } : {}),
    } as never),
  );
};

const spLabels = (svg: string): string[] => [...svg.matchAll(/>SP(\d+)</g)].map((m) => `SP${m[1]}`);
const markers = (svg: string): number => (svg.match(/class="sweep-end"/g) ?? []).length;

describe('SP labels on the chart', () => {
  it('a 61 point sweep keeps 61 markers and shows at most 12 labels, with SP1, SP61 and the design point', () => {
    const d = sweepDesign(61);
    const svg = drawn(d, true);
    const labels = spLabels(svg);
    expect(markers(svg)).toBe(61);
    expect(labels.length).toBeLessThanOrEqual(12);
    expect(labels).toContain('SP1');
    expect(labels).toContain('SP61');
    expect(labels).toContain('SP31');
  });

  it('a short sweep is labelled in full', () => {
    const svg = drawn(sweepDesign(8), true);
    expect(markers(svg)).toBe(8);
    expect(spLabels(svg)).toEqual(['SP1', 'SP2', 'SP3', 'SP4', 'SP5', 'SP6', 'SP7', 'SP8']);
  });
});
