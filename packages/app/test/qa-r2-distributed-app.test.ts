/**
 * QA round 2 on distributed synthesis, app side: appendDistributed,
 * atDesignFrequency, the SolutionList titles and what the two tools render.
 * Expected values come from the documented behaviour, worked by hand.
 */
import type { LineElement, MatchSolution, StubElement } from '@smithonline/core';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { beforeEach, describe, expect, it } from 'vitest';
import { StubFilterTool, TransformerTool } from '../src/components/DistributedTools';
import { SolutionList } from '../src/components/SolutionList';
import { emptyDesign, type Design } from '../src/lib/design';
import { appendDistributed, atDesignFrequency } from '../src/lib/distributed';
import { useDesignStore } from '../src/store/useDesignStore';

const store = useDesignStore;
const line = (z0: number, length: number, refFrequency?: number): LineElement => ({
  kind: 'line',
  z0,
  length,
  er: 1,
  alphaDbPerM: 0,
  ...(refFrequency !== undefined ? { refFrequency } : {}),
});
const stub = (z0: number): StubElement => ({
  kind: 'openStub',
  z0,
  length: 0.125,
  refFrequency: 2e9,
});

beforeEach(() => {
  store.getState().init(emptyDesign());
  store.setState({ twoPortFiles: {}, selected: null, message: null });
});

describe('qa r2: atDesignFrequency', () => {
  it('rescales the electrical length to the design frequency and keeps the physical length', () => {
    // A quarter wave at 2 GHz is an eighth wave at 1 GHz.
    const [a, b] = atDesignFrequency([line(70, 0.25, 2e9), stub(40)], 1e9);
    expect(a!.length).toBeCloseTo(0.125, 15);
    expect(a!.refFrequency).toBe(1e9);
    expect(a!.z0).toBe(70);
    expect(b!.length).toBeCloseTo(0.0625, 15);
    expect(b!.kind).toBe('openStub');
  });

  it('a line without a reference frequency keeps its length and gains the design frequency', () => {
    const [a] = atDesignFrequency([line(50, 0.3)], 5e8);
    expect(a!.length).toBe(0.3);
    expect(a!.refFrequency).toBe(5e8);
  });

  it('an empty list stays empty', () => {
    expect(atDesignFrequency([], 1e9)).toEqual([]);
  });
});

describe('qa r2: appendDistributed', () => {
  it('appends in one undo step and switches an off sweep on with at least 201 points', () => {
    const before = store.getState().design;
    const text = appendDistributed([line(70, 0.25, 1e9), line(60, 0.25, 1e9)], 2.5e8, 1.75e9);
    const d = store.getState().design;
    expect(d.elements).toHaveLength(2);
    expect(d.sweep.enabled).toBe(true);
    expect(d.sweep.start).toBe(2.5e8);
    expect(d.sweep.stop).toBe(1.75e9);
    expect(d.sweep.points).toBe(201);
    expect(text.startsWith('; sweep set to ')).toBe(true);
    store.getState().undo();
    expect(store.getState().design).toEqual(before);
  });

  it('keeps a sweep that is already on as it is and says nothing about it', () => {
    const on: Design = {
      ...emptyDesign(),
      sweep: { enabled: true, start: 1e6, stop: 2e6, points: 11 },
    };
    store.getState().init(on);
    const text = appendDistributed([line(70, 0.25, 1e9)], 2.5e8, 1.75e9);
    expect(text).toBe('');
    expect(store.getState().design.sweep).toEqual(on.sweep);
    expect(store.getState().design.elements).toHaveLength(1);
  });

  it('a range that is not finite and positive leaves an off sweep off', () => {
    for (const [start, stop] of [
      [0, 1e9],
      [-1, 1e9],
      [1e9, 1e9],
      [2e9, 1e9],
      [1e8, Infinity],
      [Number.NaN, 1e9],
      [1e8, Number.NaN],
    ] as const) {
      store.getState().init(emptyDesign());
      expect(appendDistributed([line(70, 0.25, 1e9)], start, stop)).toBe('');
      expect(store.getState().design.sweep.enabled).toBe(false);
      expect(store.getState().design.elements).toHaveLength(1);
    }
  });

  it('keeps more than 201 points, and with datapoints switches to a frequency sweep and counts them', () => {
    const loads = [
      { frequency: 1e8, z: { re: 100, im: 0 } },
      { frequency: 2e8, z: { re: 50, im: 50 } },
      { frequency: 3e8, z: { re: 25, im: -25 } },
    ];
    store.getState().init({
      ...emptyDesign(),
      sweep: { enabled: false, start: 1e6, stop: 2e6, points: 501, loads, mode: 'datapoints' },
    });
    const text = appendDistributed([line(70, 0.25, 1e9)], 1e8, 3e9);
    const s = store.getState().design.sweep;
    expect(s.points).toBe(501);
    expect(s.mode).toBe('frequency');
    expect(s.loads).toEqual(loads);
    expect(text).toContain('switched to a frequency sweep');
    expect(text).toContain('the 3 datapoints are kept');
  });

  it('appending nothing still records the sweep change only when one is made', () => {
    const text = appendDistributed([], 1e8, 1e9);
    expect(store.getState().design.elements).toHaveLength(0);
    expect(store.getState().design.sweep.enabled).toBe(true);
    expect(text.startsWith('; sweep set to ')).toBe(true);
  });
});

describe('qa r2: SolutionList titles', () => {
  const sol = (z0: number): MatchSolution => ({
    elements: [line(z0, 0.25, 1e9)],
    q: 1.5,
    result: { re: 50, im: 0 },
    description: 'x',
  });
  const render = (titles?: readonly string[]): string =>
    renderToString(
      createElement(SolutionList, {
        solutions: [sol(70), sol(60)],
        empty: 'none',
        titles,
        labels: ['L0', 'L1'],
        onPreview: () => undefined,
        onApply: () => undefined,
      }),
    );

  it('a title replaces the part list of its row; a missing title falls back to the parts', () => {
    const withTitles = render(['First row title']);
    expect(withTitles).toContain('First row title');
    // The second row has no title: its parts are listed; the first row's are not.
    expect(withTitles).toContain('60');
    expect(withTitles).not.toContain('70');
    const without = render();
    expect(without).toContain('70');
    expect(without).toContain('60');
    expect(without).not.toContain('First row title');
  });

  it('shows the empty text when there is nothing to list', () => {
    const html = renderToString(
      createElement(SolutionList, {
        solutions: [],
        empty: 'Nothing here',
        onPreview: () => undefined,
        onApply: () => undefined,
      }),
    );
    expect(html).toContain('Nothing here');
  });
});

describe('qa r2: the tools as rendered', () => {
  const noop = (): void => undefined;

  it('Stub filter: the row title counts stubs and lines (default Butterworth N = 3)', () => {
    // Server rendering reads the store's initial design (Z0 50 ohm) and the default settings.
    const html = renderToString(
      createElement(StubFilterTool, {
        zin: { re: 50, im: 0 },
        target: { re: 50, im: 0 },
        onPreview: noop,
        onClose: noop,
      }),
    );
    expect(html).toContain('3 stubs, 2 lines');
  });

  it('Transformer: a step already inside the limit does not claim an f0 ripple for Chebyshev', () => {
    // 52 to 50 ohm at |Gamma| 0.05: the Chebyshev now takes the binomial split, matched at f0.
    const html = renderToString(
      createElement(TransformerTool, {
        zin: { re: 52, im: 0 },
        target: { re: 50, im: 0 },
        onPreview: noop,
        onClose: noop,
      }),
    );
    expect(html).toContain('whole band');
    expect(html).not.toContain('ripples at f0');
  });
});
