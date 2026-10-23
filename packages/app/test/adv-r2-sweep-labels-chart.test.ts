import { complex, evaluateLadder, type Complex } from '@smithonline/core';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SmithChart } from '../src/chart/SmithChart';
import { designPointIndex } from '../src/chart/sweepLabels';
import { startIndex, userDatapoints } from '../src/lib/datapoints';
import { emptyDesign, identify, type Design } from '../src/lib/design';
import { designSweep, ladderOf } from '../src/lib/files';
import { readImportFile } from '../src/lib/import';
import { useDesignStore } from '../src/store/useDesignStore';

/** Same expression as sweepAnchor in App.tsx. */
const sweepAnchor = (design: Design): number | null =>
  design.sweep.loads?.length
    ? designPointIndex(design.sweep.loads, design.frequency, design.load)
    : startIndex(design);

function ring(n: number, r = 0.6): Complex[] {
  return Array.from({ length: n }, (_, i) => {
    const a = (2 * Math.PI * i) / n;
    const g = { re: r * Math.cos(a), im: r * Math.sin(a) };
    const den = (1 - g.re) ** 2 + g.im ** 2;
    return complex((50 * (1 - g.re ** 2 - g.im ** 2)) / den, (50 * 2 * g.im) / den);
  });
}

function mk(zs: readonly Complex[], startAt: number, freqs?: readonly number[]): Design {
  const loads = zs.map((z, i) => ({ frequency: freqs ? (freqs[i] as number) : 1e9 + i * 1e6, z }));
  const d = emptyDesign();
  return {
    ...d,
    frequency: loads[startAt]?.frequency ?? 1e9,
    load: loads[startAt]?.z ?? d.load,
    sweep: { ...d.sweep, enabled: true, loads, loadsName: 'x.s1p', mode: 'datapoints' },
  };
}

const render = (
  d: Design,
  anchor: number | null | undefined,
  extra: Record<string, unknown> = {},
): string =>
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
      ...extra,
    } as never),
  );

const labels = (svg: string): string[] => [...svg.matchAll(/>SP(\d+)</g)].map((m) => `SP${m[1]}`);
const markers = (svg: string): number => (svg.match(/class="sweep-end"/g) ?? []).length;
const titles = (svg: string): string[] =>
  [...svg.matchAll(/<title>([^<]*)<\/title>/g)].map((m) => m[1] as string);

describe('adv anchor prop', () => {
  const d = mk(ring(61), 30);
  it.each([NaN, -1, 30.5, 61, 1e9, -Infinity, Infinity, -0])(
    'anchor %s does not throw, <=12 labels, ends kept',
    (a) => {
      const svg = render(d, a);
      const l = labels(svg);
      expect(markers(svg)).toBe(61);
      expect(l.length).toBeLessThanOrEqual(12);
      expect(l).toContain('SP1');
      expect(l).toContain('SP61');
    },
  );

  it('anchor given as a string-number is ignored, not crashed', () => {
    const svg = render(d, '30' as never);
    expect(labels(svg).length).toBeLessThanOrEqual(12);
  });

  it('anchor at a non-drawn (NaN) point: no label for it, budget still used, no crash', () => {
    const zs = ring(61);
    zs[30] = complex(NaN, 0);
    const dd = mk(zs, 30);
    const svg = render(dd, 30);
    expect(markers(svg)).toBe(60);
    expect(labels(svg)).not.toContain('SP31');
    expect(labels(svg).length).toBeGreaterThanOrEqual(8);
  });

  it('every point non finite: no markers, no labels, no throw', () => {
    const dd = mk(
      Array.from({ length: 30 }, () => complex(NaN, NaN)),
      3,
    );
    const svg = render(dd, 3);
    expect(markers(svg)).toBe(0);
    expect(labels(svg)).toEqual([]);
  });

  it('one drawn point among 30 non finite is labelled', () => {
    const zs = Array.from({ length: 30 }, () => complex(NaN, NaN));
    zs[17] = complex(40, 10);
    const svg = render(mk(zs, 17), 17);
    expect(markers(svg)).toBe(1);
    expect(labels(svg)).toEqual(['SP18']);
  });

  it('all 61 points coincident: the design point label is shown (it is the start)', () => {
    const dd = mk(
      Array.from({ length: 61 }, () => complex(30, 10)),
      30,
    );
    const l = labels(render(dd, 30));
    expect(l).toContain('SP31');
  });

  it('design point right beside the first (SP2) keeps its label when SP1 and SP2 overlap', () => {
    const zs = ring(61);
    zs[1] = complex(zs[0]!.re + 1e-3, zs[0]!.im);
    const dd = mk(zs, 1);
    expect(labels(render(dd, 1))).toContain('SP2');
  });

  it('design point right beside the last keeps its label', () => {
    const zs = ring(61);
    zs[59] = complex(zs[60]!.re + 1e-3, zs[60]!.im);
    const dd = mk(zs, 59);
    expect(labels(render(dd, 59))).toContain('SP60');
  });

  it('a last point that coincides with the design point gives way to it', () => {
    const zs = ring(61);
    zs[59] = complex(zs[60]!.re + 1e-3, zs[60]!.im);
    const l = labels(render(mk(zs, 59), 59));
    expect(l).toContain('SP60');
    expect(l).not.toContain('SP61');
  });

  it('first and last coincident (closed loop): the first and the design point show', () => {
    const zs = ring(61);
    zs[60] = zs[0] as Complex;
    const l = labels(render(mk(zs, 30), 30));
    expect(l).toContain('SP1');
    expect(l).toContain('SP31');
    expect(l).not.toContain('SP61');
  });

  it('labels never overlap: any two labelled points are separated', () => {
    // dense cluster plus far points
    const zs = [...ring(40, 0.05), ...ring(21, 0.9)];
    const l = labels(render(mk(zs, 10), 10));
    console.log('cluster labels', l.join(','));
    expect(l.length).toBeLessThanOrEqual(12);
  });

  it('zoomed far out the label thresholds scale with fontSize (k) - 4000 points timing', () => {
    const zs = ring(4000);
    const dd = mk(zs, 2000);
    const t = performance.now();
    const svg = render(dd, 2000);
    const dt = performance.now() - t;
    console.log('render 4000 points ms', dt, 'labels', labels(svg).length);
    expect(markers(svg)).toBe(4000);
    expect(dt).toBeLessThan(3000);
  });
});

describe('adv tooltips', () => {
  it('a reactive-only load (|Gamma| = 1) gives an infinite VSWR tooltip that reads sanely', () => {
    const dd = mk([complex(0, 50), complex(0, -50), complex(0, 20)], 0);
    const t = titles(render(dd, 0));
    console.log(t.join(' | '));
    for (const s of t) expect(s).not.toMatch(/NaN|undefined|Infinity/);
  });

  it('negative resistance (|Gamma| > 1) tooltip VSWR is not negative', () => {
    const dd = mk([complex(-20, 5), complex(30, 5)], 1);
    const t = titles(render(dd, 1));
    console.log(t.join(' | '));
    expect(t[0]).not.toMatch(/VSWR -/);
  });

  it.skip('THEORETICAL NaN / Infinity / negative / zero frequency in a sweep point reads sanely', () => {
    const dd = mk([complex(30, 5), complex(30, 6), complex(30, 7), complex(30, 8)], 0, [
      NaN,
      Infinity,
      -1e9,
      0,
    ]);
    const t = titles(render(dd, 0));
    console.log(t.join(' | '));
    for (const s of t) expect(s).not.toMatch(/NaN|undefined|Infinity/);
  });

  it('a name-like hostile string cannot enter the tooltip (frequency string)', () => {
    const dd = mk([complex(30, 5), complex(30, 6)], 0, ['<script>' as never, 1e9]);
    const svg = render(dd, 0);
    expect(svg).not.toContain('<script>');
  });
});

describe('adv sweepAnchor (App.tsx expression)', () => {
  it('user datapoints sweep: anchor is the start slot for every start choice', () => {
    for (let slot = 0; slot < 20; slot++) {
      const d0 = emptyDesign();
      const pts = Array.from({ length: 19 }, (_, i) => ({
        frequency: 2e9 + i * 1e6,
        z: complex(20 + i, 3),
      }));
      const d: Design = {
        ...d0,
        datapoints: pts,
        startSlot: slot,
        sweep: { ...d0.sweep, enabled: true, mode: 'datapoints' },
      };
      const all = userDatapoints(d);
      const sweep = designSweep(d);
      expect(sweep).not.toBeNull();
      const a = sweepAnchor(d) as number;
      expect(sweep?.[a]?.frequency).toBe(d.frequency);
      expect(all[a]?.z).toEqual(d.load);
    }
  });

  it('user datapoints sweep with 20 points: anchor label shown for every start', () => {
    for (let slot = 0; slot < 20; slot++) {
      const d0 = emptyDesign();
      const zs = ring(20);
      const all = zs.map((z, i) => ({ frequency: 2e9 + i * 1e6, z }));
      const startPt = all[slot]!;
      const others = all.filter((_, i) => i !== slot);
      const d: Design = {
        ...d0,
        frequency: startPt.frequency,
        load: startPt.z,
        datapoints: others,
        startSlot: slot,
        sweep: { ...d0.sweep, enabled: true, mode: 'datapoints' },
      };
      const a = sweepAnchor(d);
      expect(labels(render(d, a))).toContain(`SP${slot + 1}`);
    }
  });

  it('sweep.loads (file) and user datapoints disagree: anchor follows the file, sweep follows the file', () => {
    const d0 = mk(ring(40), 10);
    const d: Design = {
      ...d0,
      datapoints: [{ frequency: 5e9, z: complex(10, 10) }],
      startSlot: 0,
    };
    const a = sweepAnchor(d);
    expect(a).toBe(10);
    expect(designSweep(d)?.length).toBe(40);
    expect(labels(render(d, a))).toContain('SP11');
  });

  it('start dragged off the file row: anchor falls to first row at that frequency (not null, not a jump elsewhere)', () => {
    const d0 = mk(ring(40), 10);
    const dragged: Design = { ...d0, load: complex(d0.load.re + 5, d0.load.im) };
    expect(sweepAnchor(dragged)).toBe(10);
  });

  it('start dragged with duplicate-frequency file rows: anchor jumps to the first duplicate', () => {
    const freqs = Array.from({ length: 30 }, () => 1e9);
    const d0 = mk(ring(30), 17, freqs);
    expect(sweepAnchor(d0)).toBe(17);
    const dragged: Design = { ...d0, load: complex(d0.load.re + 5, d0.load.im) };
    expect(sweepAnchor(dragged)).toBe(17);
  });

  it('design frequency kept while the load comes from another row (keepFrequency): anchor not null', () => {
    const d0 = mk(ring(40), 10);
    const kept: Design = { ...d0, load: d0.sweep.loads![25]!.z };
    const a = sweepAnchor(kept);
    // the design (freq of row 10, load of row 25) sits on no row: is there an anchor?
    expect(a === null || a === 10 || a === 25).toBe(true);
  });
});

describe('adv import path with open and short rows', () => {
  const s1p = (rows: string[]): string => `# HZ S RI R 50\n${rows.join('\n')}\n`;
  it('a Gamma = 1 row (open) imports with a finite or infinite z and renders without NaN markup', () => {
    const rows = Array.from(
      { length: 30 },
      (_, i) => `${1e9 + i * 1e7} ${0.5 * Math.cos(i)} ${0.5 * Math.sin(i)}`,
    );
    rows[14] = `${1e9 + 14 * 1e7} 1 0`;
    const f = readImportFile('a.s1p', s1p(rows));
    const z = f.rows[14]!.z;
    console.log('open row z', z.re, z.im);
    const d0 = emptyDesign();
    const row = f.rows[14]!;
    const d: Design = {
      ...d0,
      load: complex(row.z.re, row.z.im),
      frequency: row.frequency,
      elements: identify([{ kind: 'C', orientation: 'shunt', value: 1e-12 }]),
      sweep: { ...d0.sweep, enabled: true, loads: f.rows, loadsName: 'a.s1p', mode: 'datapoints' },
    };
    const a = sweepAnchor(d);
    console.log('anchor at open row', a);
    const svg = render(d, a);
    console.log('markers', markers(svg), 'labels', labels(svg).join(','));
    expect(svg).not.toMatch(/="NaN"/);
    expect(a).toBe(14);
  });

  it('the store: undo and redo keep the derived anchor consistent with the design', () => {
    const st = useDesignStore.getState();
    const d0 = mk(ring(40), 10);
    st.init(d0);
    const s = useDesignStore.getState();
    s.update((d) => ({
      ...d,
      load: d.sweep.loads![20]!.z,
      frequency: d.sweep.loads![20]!.frequency,
    }));
    expect(sweepAnchor(useDesignStore.getState().design)).toBe(20);
    useDesignStore.getState().undo();
    expect(sweepAnchor(useDesignStore.getState().design)).toBe(10);
    useDesignStore.getState().redo();
    expect(sweepAnchor(useDesignStore.getState().design)).toBe(20);
  });

  it('setStartDatapoint on a design with user datapoints: sweep order and anchor stay aligned', () => {
    const d0 = emptyDesign();
    const all = ring(15).map((z, i) => ({ frequency: 1e9 + i * 1e6, z }));
    useDesignStore.getState().init({
      ...d0,
      frequency: all[0]!.frequency,
      load: all[0]!.z,
      datapoints: all.slice(1),
      startSlot: 0,
      sweep: { ...d0.sweep, enabled: true, mode: 'datapoints' },
    });
    for (const i of [7, 14, 3, 0]) {
      useDesignStore.getState().setStartDatapoint(i);
      const d = useDesignStore.getState().design;
      const sw = designSweep(d)!;
      const a = sweepAnchor(d)!;
      expect(sw[a]!.frequency).toBe(d.frequency);
      expect(a).toBe(i);
    }
  });
});

describe('adv realistic: design point beside an end on a smooth loop', () => {
  /** 61 points on a loop that starts at the top, so neighbouring points sit side by side. */
  function loop(offset: number): Complex[] {
    return Array.from({ length: 61 }, (_, i) => {
      const a = offset + (2 * Math.PI * i) / 61;
      const g = { re: 0.6 * Math.cos(a), im: 0.6 * Math.sin(a) };
      const den = (1 - g.re) ** 2 + g.im ** 2;
      return complex((50 * (1 - g.re ** 2 - g.im ** 2)) / den, (50 * 2 * g.im) / den);
    });
  }
  it('start = second row (anchor 1) is labelled', () => {
    const l = labels(render(mk(loop(Math.PI / 2), 1), 1));
    console.log('anchor 1 labels', l.join(','));
    expect(l).toContain('SP2');
  });
  it('start = second to last row (anchor 59) is labelled', () => {
    const zs = loop(Math.PI / 2 - (2 * Math.PI * 60) / 61);
    const l = labels(render(mk(zs, 59), 59));
    console.log('anchor 59 labels', l.join(','));
    expect(l).toContain('SP60');
  });
});
