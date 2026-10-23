import { complex, evaluateLadder } from '@smithonline/core';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SmithChart } from '../src/chart/SmithChart';
import { emptyDesign } from '../src/lib/design';
import { designSweep, ladderOf } from '../src/lib/files';

function renderN(n: number, withLabels: boolean): { ms: number; len: number } {
  const d0 = emptyDesign();
  const loads = Array.from({ length: n }, (_, i) => {
    const a = (2 * Math.PI * i) / n;
    return { frequency: 1e9 + i * 1e3, z: complex(50 + 20 * Math.cos(a), 20 * Math.sin(a)) };
  });
  const d = {
    ...d0,
    frequency: loads[0]!.frequency,
    load: loads[0]!.z,
    sweep: { ...d0.sweep, enabled: true, loads, mode: 'datapoints' as const },
  };
  const sweep = designSweep(d);
  const t = performance.now();
  const svg = renderToStaticMarkup(
    createElement(SmithChart, {
      result: evaluateLadder(ladderOf(d)),
      z0: d.z0,
      options: { zGrid: true, yGrid: false, density: 'normal', labels: withLabels },
      selected: null,
      sweep,
      sweepKind: 'datapoints',
      realized: null,
      realizedSweep: null,
      target: complex(50, 0),
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
      anchor: 0,
    } as never),
  );
  return { ms: performance.now() - t, len: svg.length };
}

describe('adv perf', () => {
  it('render cost for 1k, 10k, 50k points', () => {
    for (const n of [1000, 10000, 50000]) {
      const r = renderN(n, true);
      console.log('n', n, 'ms', Math.round(r.ms), 'bytes', r.len);
    }
    expect(true).toBe(true);
  });
});
