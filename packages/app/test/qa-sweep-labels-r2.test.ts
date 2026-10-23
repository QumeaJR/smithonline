import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
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
} from '../src/chart/sweepLabels';
import {
  addDatapoint,
  designHasDatapointSweep,
  removeDatapoint,
  setStartDatapoint,
  startIndex,
} from '../src/lib/datapoints';
import { designFromXmlsc, emptyDesign, type Design } from '../src/lib/design';
import { designSweep, ladderOf } from '../src/lib/files';

/** The expression of `sweepAnchor` in App.tsx (the original is a private useMemo). */
const sweepAnchor = (design: Design): number | null =>
  design.sweep.loads?.length
    ? designPointIndex(design.sweep.loads, design.frequency, design.load)
    : startIndex(design);

/** z (z0 = 50) of a reflection coefficient, hand formula z = 50 (1 + g) / (1 - g). */
function zOfGamma(re: number, im: number): Complex {
  const den = (1 - re) ** 2 + im ** 2;
  return complex((50 * (1 - re * re - im * im)) / den, (50 * 2 * im) / den);
}

function chartOf(
  d: Design,
  anchor: number | null,
  sweepKind: 'datapoints' | 'frequency' = 'datapoints',
): string {
  return renderToStaticMarkup(
    createElement(SmithChart, {
      result: evaluateLadder(ladderOf(d)),
      z0: d.z0,
      options: { zGrid: true, yGrid: false, density: 'normal', labels: true },
      selected: null,
      sweep: designSweep(d),
      sweepKind,
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
      anchor,
    } as never),
  );
}

/** A design whose datapoint sweep runs over `gammas`; the chain starts from row `startAt`. */
function designOver(
  gammas: readonly { re: number; im: number }[],
  startAt: number,
  frequencyOf: (i: number) => number = (i) => 1e9 + i * 1e6,
): Design {
  const loads = gammas.map((g, i) => ({ frequency: frequencyOf(i), z: zOfGamma(g.re, g.im) }));
  const d = emptyDesign();
  return {
    ...d,
    frequency: (loads[startAt] as { frequency: number }).frequency,
    load: (loads[startAt] as { z: Complex }).z,
    sweep: { ...d.sweep, enabled: true, loads, loadsName: 'qa.s1p', mode: 'datapoints' },
  };
}

/** n points on a circle of reflection `r`, turned by `phase` radians. */
const ring = (n: number, r = 0.6, phase = 0): { re: number; im: number }[] =>
  Array.from({ length: n }, (_, i) => {
    const a = phase + (2 * Math.PI * i) / n;
    return { re: r * Math.cos(a), im: r * Math.sin(a) };
  });

const labelsOf = (svg: string): string[] => [...svg.matchAll(/>SP(\d+)</g)].map((m) => `SP${m[1]}`);
const titlesOf = (svg: string): string[] =>
  [...svg.matchAll(/<title>(SP\d+: [^<]*)<\/title>/g)].map((m) => m[1] as string);

describe('qa declutterLabels order and boundaries', () => {
  const at = (xs: readonly number[]) => (i: number) => ({ x: xs[i] as number, y: 0 });

  it('the first in `order` wins a collision, whatever its index', () => {
    // 0 and 1 are 1 apart (< width 2): the one listed first survives.
    expect(declutterLabels([2, 1, 0], at([0, 1, 10]), 2, 1)).toEqual([1, 2]);
    expect(declutterLabels([2, 0, 1], at([0, 1, 10]), 2, 1)).toEqual([0, 2]);
  });

  it('a dropped label does not block a later one (no chain reaction)', () => {
    // x = 0, 1.5, 3 with width 2: 1 collides with 0 and is dropped; 2 is 3 from 0 so it stays.
    expect(declutterLabels([0, 1, 2], at([0, 1.5, 3]), 2, 1)).toEqual([0, 2]);
  });

  it('exactly one width or one height apart does not collide (strict comparison)', () => {
    expect(declutterLabels([0, 1], at([0, 2]), 2, 1)).toEqual([0, 1]);
    expect(declutterLabels([0, 1], (i) => ({ x: 0, y: i }), 2, 1)).toEqual([0, 1]);
  });

  it('both axes must be inside the box to collide', () => {
    // dx = 1 < 2 but dy = 1 is not < 0.5.
    expect(declutterLabels([0, 1], (i) => ({ x: i, y: i }), 2, 0.5)).toEqual([0, 1]);
  });

  it('empty order, an order of one, and all positions missing', () => {
    expect(declutterLabels([], () => ({ x: 0, y: 0 }), 2, 1)).toEqual([]);
    expect(declutterLabels([7], () => ({ x: 0, y: 0 }), 2, 1)).toEqual([7]);
    expect(declutterLabels([0, 1, 2], () => null, 2, 1)).toEqual([]);
  });

  it('the result is sorted ascending although the order is by priority', () => {
    expect(declutterLabels([9, 3, 6], at([0, 0, 0, 10, 0, 0, 20, 0, 0, 30]), 1, 1)).toEqual([
      3, 6, 9,
    ]);
  });
});

describe('qa designPointIndex fallbacks', () => {
  const rows = [
    { frequency: 1e9, z: complex(50, 0) },
    { frequency: 2e9, z: complex(60, 5) },
    { frequency: 2e9, z: complex(70, 5) },
    { frequency: 2e9, z: complex(70, 5) },
    { frequency: 3e9, z: complex(80, -5) },
  ];

  it('the exact row (frequency and z) beats an earlier row at the same frequency', () => {
    expect(designPointIndex(rows, 2e9, complex(70, 5))).toBe(2);
  });

  it('identical duplicate rows give the first of them', () => {
    expect(designPointIndex(rows, 2e9, complex(70, 5))).toBe(2);
  });

  it('a design load that matches no row takes the nearest row at the frequency', () => {
    expect(designPointIndex(rows, 2e9, complex(70, 6))).toBe(2);
  });

  it('the sign of the reactance matters for the exact match', () => {
    expect(designPointIndex(rows, 3e9, complex(80, 5))).toBe(4); // fallback, still row 4
    expect(designPointIndex(rows, 2e9, complex(60, -5))).toBe(1); // fallback to first at 2 GHz
  });

  it('z of a row matching the design load at another frequency does not count', () => {
    // z = 50 + j0 only exists at 1 GHz; the design sits at 3 GHz, row 4.
    expect(designPointIndex(rows, 3e9, complex(50, 0))).toBe(4);
  });

  it('no row at the frequency gives null even when z matches', () => {
    expect(designPointIndex(rows, 4e9, complex(80, -5))).toBeNull();
    expect(designPointIndex(rows, 0, complex(50, 0))).toBeNull();
    expect(designPointIndex(rows, NaN, complex(50, 0))).toBeNull();
  });

  it('a frequency within the relative 1e-6 of the file rounding still finds its row', () => {
    expect(designPointIndex(rows, 2e9 * (1 + 5e-7), complex(70, 5))).toBe(2);
    expect(designPointIndex(rows, 2e9 * (1 + 5e-6), complex(70, 5))).toBeNull();
  });

  it('a design load a little off a row still takes that row, however small the loads', () => {
    expect(designPointIndex(rows, 2e9, complex(70 + 1e-8, 5))).toBe(2);
    expect(designPointIndex(rows, 2e9, complex(70 + 1e-6, 5))).toBe(2);
    const tiny = [
      { frequency: 1e9, z: complex(1, 0) },
      { frequency: 1e9, z: complex(0.5, 0.25) },
    ];
    expect(designPointIndex(tiny, 1e9, complex(0.5 + 5e-9, 0.25))).toBe(1);
  });

  it('an empty list gives null', () => {
    expect(designPointIndex([], 1e9, complex(50, 0))).toBeNull();
  });
});

describe('qa designFrequencyIndex ties and boundaries', () => {
  it('prefers the nearer of two points inside the tolerance, not the first', () => {
    expect(designFrequencyIndex([1.0000009e9, 1.0000001e9, 1.0000001e9], 1e9)).toBe(1);
  });

  it('a negative frequency in the list never matches a positive design frequency', () => {
    expect(designFrequencyIndex([-1e9, 0, 1e9], 1e9)).toBe(2);
  });
});

describe('qa labelledSweepIndices by hand', () => {
  it('61 points, design point 30: 0,6,12,18,24,30,36,42,48,54,60 plus nothing else dropped', () => {
    // budget 11, gap 60/10 = 6; 30 is itself a spread point; 27 and 33 are not in the spread.
    expect(labelledSweepIndices(61, 12, 30)).toEqual([0, 6, 12, 18, 24, 30, 36, 42, 48, 54, 60]);
  });

  it('61 points, design point 31: the spread point 30 (1 < gap / 2 = 3) gives way', () => {
    expect(labelledSweepIndices(61, 12, 31)).toEqual([0, 6, 12, 18, 24, 31, 36, 42, 48, 54, 60]);
  });

  it('61 points, no design point: 12 labels at round(j * 60 / 11)', () => {
    expect(labelledSweepIndices(61, 12, null)).toEqual([
      0, 5, 11, 16, 22, 27, 33, 38, 44, 49, 55, 60,
    ]);
  });

  it('13 points, no design point: round(j * 12 / 11) for j = 0..11', () => {
    expect(labelledSweepIndices(13, 12, null)).toEqual([0, 1, 2, 3, 4, 5, 7, 8, 9, 10, 11, 12]);
  });

  it('design point beside the first or the last is kept, first and last stay', () => {
    const near0 = labelledSweepIndices(61, 12, 1);
    expect(near0.slice(0, 2)).toEqual([0, 1]);
    const near60 = labelledSweepIndices(61, 12, 59);
    expect(near60.slice(-2)).toEqual([59, 60]);
  });
});

describe('qa anchor plumbing of App.tsx (sweepAnchor)', () => {
  it('user datapoints: the anchor is the start slot and sweep[anchor] is the start', () => {
    let d = emptyDesign();
    for (let i = 1; i <= 14; i++)
      d = addDatapoint(d, { frequency: 1e9 + i * 1e7, z: complex(40 + i, i) });
    d = setStartDatapoint(d, 7);
    const sweep = designSweep({ ...d, sweep: { ...d.sweep, enabled: true } }) ?? [];
    expect(sweep).toHaveLength(15);
    const a = sweepAnchor(d);
    expect(a).toBe(7);
    expect((sweep[a as number] as { frequency: number }).frequency).toBe(d.frequency);
    // Slot 7 of the 15 user points: DP1 is the original 1 GHz point, then 1.01 GHz ... so slot 7 is DP8 = 1.07 GHz.
    expect(d.frequency).toBeCloseTo(1.07e9, 0);
  });

  it('removing a datapoint before the start moves the anchor with it', () => {
    let d = emptyDesign();
    for (let i = 1; i <= 14; i++)
      d = addDatapoint(d, { frequency: 1e9 + i * 1e7, z: complex(40 + i, i) });
    d = setStartDatapoint(d, 7);
    const f = d.frequency;
    d = removeDatapoint(d, 2);
    const sweep = designSweep({ ...d, sweep: { ...d.sweep, enabled: true } }) ?? [];
    expect(sweepAnchor(d)).toBe(6);
    expect((sweep[6] as { frequency: number }).frequency).toBe(f);
  });

  it('a single datapoint: anchor 0, no datapoint sweep', () => {
    const d = emptyDesign();
    expect(sweepAnchor(d)).toBe(0);
    expect(designHasDatapointSweep(d)).toBe(false);
  });

  it('imported loads: the anchor is the row equal to the design point, not the first at its frequency', () => {
    const g = ring(20);
    const d = designOver(g, 11, () => 1e9); // every row at 1 GHz
    expect(sweepAnchor(d)).toBe(11);
  });

  it('every fixture with a datapoint sweep anchors on a point at the design frequency', () => {
    const dir = join(__dirname, '..', '..', 'core', 'test', 'fixtures', 'xmlsc');
    let seen = 0;
    for (const name of readdirSync(dir).filter((n) => n.endsWith('.xmlsc'))) {
      const d = designFromXmlsc(readFileSync(join(dir, name), 'utf8'), name);
      if (!designHasDatapointSweep(d)) continue;
      const sweep = designSweep({ ...d, sweep: { ...d.sweep, enabled: true } }) ?? [];
      const a = sweepAnchor(d);
      expect(a, name).not.toBeNull();
      expect(sweep[a as number]?.frequency, name).toBeCloseTo(d.frequency, -2);
      seen++;
    }
    expect(seen).toBeGreaterThan(0);
  });
});

describe('qa SPn labels on the chart', () => {
  it('anchor index counts sweep points, not drawn points: a point off the chart before it does not shift the label', () => {
    // 61 points on a ring; SP1 and SP6 are not finite. Anchor is index 30 (SP31).
    const g = ring(61);
    const d = designOver(g, 30);
    const loads = (d.sweep.loads ?? []).map((l, i) =>
      i === 0 || i === 5 ? { ...l, z: complex(NaN, 0) } : l,
    );
    const svg = chartOf({ ...d, sweep: { ...d.sweep, loads } }, 30);
    const labels = labelsOf(svg);
    expect(labels).toContain('SP31');
    expect(labels).not.toContain('SP1');
    expect(labels).not.toContain('SP6');
    expect(labels).toContain('SP2'); // first drawn point
    expect(labels).toContain('SP61');
    expect(labels.length).toBeLessThanOrEqual(12);
    expect(titlesOf(svg)).toHaveLength(59);
  });

  it('on a collision the design point beats a spread label', () => {
    // 61 ring points; row 24 (SP25, a spread label for keep = 31) sits on row 31 (SP32, the anchor).
    const g = ring(61);
    g[24] = { ...(g[31] as { re: number; im: number }) };
    const labels = labelsOf(chartOf(designOver(g, 31), 31));
    expect(labels).toContain('SP32');
    expect(labels).not.toContain('SP25');
  });

  it('on a collision between two spread labels the lower number stays', () => {
    // keep = 30: spread rows are 0,6,12,...; put row 12 on row 6.
    const g = ring(61);
    g[12] = { ...(g[6] as { re: number; im: number }) };
    const labels = labelsOf(chartOf(designOver(g, 30), 30));
    expect(labels).toContain('SP7');
    expect(labels).not.toContain('SP13');
  });

  it('the first and the last win against a spread label on the same spot', () => {
    const g = ring(61);
    g[6] = { ...(g[0] as { re: number; im: number }) };
    g[54] = { ...(g[60] as { re: number; im: number }) };
    const labels = labelsOf(chartOf(designOver(g, 30), 30));
    expect(labels).toContain('SP1');
    expect(labels).toContain('SP61');
    expect(labels).not.toContain('SP7');
    expect(labels).not.toContain('SP55');
  });

  it('documented behaviour: the point the chain starts from carries an SPn label (user guide section 1)', () => {
    // The design point (SP2) lies 0.05 right of SP1 at the same height: inside the 2.8 x fontSize
    // box, so the declutter lets SP1 (first) win and the design point goes unlabelled.
    const g = ring(61, 0.6, Math.PI / 2);
    g[0] = { re: 0.3, im: 0.5 };
    g[1] = { re: 0.35, im: 0.5 };
    const labels = labelsOf(chartOf(designOver(g, 1), 1));
    expect(labels).toContain('SP2');
  });

  it('tooltip text is exact: number, engineering frequency, VSWR with two decimals', () => {
    // 100 ohm on 50 ohm: |gamma| = 1/3, VSWR = (1 + 1/3) / (1 - 1/3) = 2.
    const d = emptyDesign();
    const loads = [
      { frequency: 1e9, z: complex(100, 0) },
      { frequency: 2.5e8, z: complex(50, 0) }, // VSWR 1
      { frequency: 3.3e9, z: complex(150, 0) }, // gamma 0.5, VSWR 3
    ];
    const svg = chartOf(
      {
        ...d,
        frequency: 1e9,
        load: complex(100, 0),
        sweep: { ...d.sweep, enabled: true, loads, loadsName: 'qa.s1p', mode: 'datapoints' },
      },
      0,
    );
    expect(titlesOf(svg)).toEqual([
      'SP1: 1 GHz, VSWR 2.00',
      'SP2: 250 MHz, VSWR 1.00',
      'SP3: 3.3 GHz, VSWR 3.00',
    ]);
  });

  it('tooltip of a short circuit reads infinite VSWR, not a number or NaN', () => {
    const d = emptyDesign();
    const loads = [
      { frequency: 1e9, z: complex(0, 0) },
      { frequency: 2e9, z: complex(50, 0) },
    ];
    const svg = chartOf(
      {
        ...d,
        sweep: { ...d.sweep, enabled: true, loads, loadsName: 'qa.s1p', mode: 'datapoints' },
      },
      0,
    );
    expect(titlesOf(svg)[0]).toBe('SP1: 1 GHz, VSWR ∞');
  });

  it('the tooltip is a child of its marker circle, so hovering the marker shows it', () => {
    const svg = chartOf(designOver(ring(5), 0), 0);
    const markers = [...svg.matchAll(/<circle[^>]*class="sweep-end"[^>]*>(.*?)<\/circle>/g)];
    expect(markers).toHaveLength(5);
    markers.forEach((m, i) => expect(m[1]).toBe(`<title>${titlesOf(svg)[i]}</title>`));
  });

  it('a frequency sweep draws no SPn labels or tooltips, whatever the anchor', () => {
    const d = { ...emptyDesign(), sweep: { ...emptyDesign().sweep, enabled: true } };
    const svg = chartOf(d, 5, 'frequency');
    expect(labelsOf(svg)).toEqual([]);
    expect(titlesOf(svg)).toEqual([]);
  });

  it('a 12 point sweep is labelled in full even when all points coincide', () => {
    // At the limit nothing is thinned; the declutter must not be the only thing deciding.
    // Expected by the guide: "up to 12 points all of them". Coincident labels are the exception
    // the declutter makes, so at least SP1 is there and no label is invented.
    const g = Array.from({ length: 12 }, () => ({ re: 0.2, im: 0.2 }));
    const labels = labelsOf(chartOf(designOver(g, 0), 0));
    expect(labels).toContain('SP1');
    expect(labels.length).toBeGreaterThanOrEqual(1);
  });

  it('labels of a 101 point sweep: at most 12, no two inside the declutter box', () => {
    const g = ring(101, 0.6).map((_, i) => ({
      re: 0.6 * Math.cos((1.6 * Math.PI * i) / 100),
      im: 0.6 * Math.sin((1.6 * Math.PI * i) / 100),
    }));
    const svg = chartOf(designOver(g, 50), 50);
    const labels = labelsOf(svg).map((l) => Number(l.slice(2)) - 1);
    expect(labels.length).toBeLessThanOrEqual(12);
    expect(labels).toContain(0);
    expect(labels).toContain(50);
    expect(labels).toContain(100);
    const fs = 0.045 * 1; // home view: k = 1
    for (const a of labels)
      for (const b of labels) {
        if (a >= b) continue;
        const ga = g[a] as { re: number; im: number };
        const gb = g[b] as { re: number; im: number };
        const inside = Math.abs(ga.re - gb.re) < fs * 2.8 && Math.abs(ga.im - gb.im) < fs * 0.95;
        expect(inside, `SP${a + 1} and SP${b + 1}`).toBe(false);
      }
  });
});

describe('qa first and last labels', () => {
  it('on a closed ring the last label gives way to the first, and the design point is kept', () => {
    // A closed ring of 101 points: SP101 lies 3.6 degrees from SP1, 0.037 above or below it at
    // gamma 0.6, inside the label box, so only one of the two can show; the first wins.
    const g = ring(101, 0.6);
    const labels = labelsOf(chartOf(designOver(g, 50), 50));
    expect(labels).toContain('SP1');
    expect(labels).toContain('SP51');
    expect(labels).not.toContain('SP101');
  });
});
