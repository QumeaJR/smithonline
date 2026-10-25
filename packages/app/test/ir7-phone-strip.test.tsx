// @vitest-environment jsdom
/**
 * iPhone pass after 0.2.0 (docs/07 sections 4 and 5): the schematic strip
 * shows the value each part has in the network (the realized one with a snap
 * marker when Realize is on, the package after it, Z0 and the electrical
 * length of a line, the ratio of a transformer) and Zin and VSWR at its Zin
 * terminal; on the phone it is pinned between the chart and the sheet on
 * every segment, and the Network segment no longer repeats it.
 */
import { complex, evaluateLadder, type Element as Part } from '@smithonline/core';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Schematic, SCHEMATIC_H_COMPACT } from '../src/components/Schematic';
import { emptyDesign, identify } from '../src/lib/design';
import { ladderOf } from '../src/lib/files';
import { HALF_FLOOR, PEEK_H, PINNED_STRIP_H, sheetHeights, TOP_BAR_H } from '../src/lib/layout';
import { effectiveElements, realizeDesign } from '../src/lib/realize';
import {
  labelWidth,
  stripLabel,
  terminalLines,
  terminalWidth,
  valueWidth,
  CELL_PAD,
  SNAP_W,
} from '../src/lib/schematicCells';
import { useDesignStore, type View } from '../src/store/useDesignStore';
import { useJobs } from '../src/store/useJobs';
import { useShell, type Pane } from '../src/store/useShell';

beforeAll(() => {
  const ctx: Record<string | symbol, unknown> = new Proxy(
    {},
    {
      get: (_t, key) =>
        key === 'measureText'
          ? () => ({ width: 0 })
          : key === 'canvas'
            ? document.createElement('canvas')
            : () => undefined,
      set: () => true,
    },
  );
  vi.stubGlobal(
    'Path2D',
    class {
      moveTo(): void {}
      lineTo(): void {}
      rect(): void {}
      arc(): void {}
      closePath(): void {}
      bezierCurveTo(): void {}
      addPath(): void {}
    },
  );
  HTMLCanvasElement.prototype.getContext = (() =>
    ctx) as unknown as HTMLCanvasElement['getContext'];
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
  }));
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    },
  );
});

function setWidth(width: number, height = 844): void {
  vi.stubGlobal('innerWidth', width);
  vi.stubGlobal('innerHeight', height);
  window.dispatchEvent(new Event('resize'));
}

const C33: Part = { kind: 'C', orientation: 'shunt', value: 32.4e-12 };

beforeEach(() => {
  localStorage.clear();
  useShell.setState({
    pane: 'network',
    paneBefore: 'network',
    toolPushed: false,
    detent: 'half',
    held: null,
    guideClosed: true,
  });
  useJobs.setState({ jobs: {} });
  useDesignStore.getState().init({
    ...emptyDesign(),
    load: { re: 20, im: -12 },
    elements: identify([C33, { kind: 'L', orientation: 'series', value: 10e-9 }]),
  });
  useDesignStore.getState().setMessage(null);
});
afterEach(() => {
  cleanup();
  useDesignStore.getState().setView('chart');
  setWidth(1024, 768);
  vi.restoreAllMocks();
});

/** The strip of the design in the store, with the realization when Realize is on. */
function drawStrip(props: { compactEmpty?: boolean } = {}): SVGSVGElement {
  const d = useDesignStore.getState().design;
  const result = evaluateLadder(ladderOf(d));
  const realization = realizeDesign(d, effectiveElements(d));
  const { container } = render(<Schematic result={result} realization={realization} {...props} />);
  return container.querySelector('svg') as SVGSVGElement;
}
const cellOf = (svg: SVGSVGElement, i: number | string): SVGGElement | null =>
  svg.querySelector<SVGGElement>(`[data-cell="${i}"]`);
const valueIn = (svg: SVGSVGElement, i: number): string =>
  (svg.querySelector(`[data-cell="${i}"] .value`)?.textContent ?? '').trim();

describe('the strip labels: the value the network uses', () => {
  it('ideal: three significant digits with SI prefix and unit, no snap marker', () => {
    expect(stripLabel(C33)).toEqual({ text: '32.4 pF', snapped: false });
    const svg = drawStrip();
    expect(valueIn(svg, 1)).toBe('32.4 pF');
    expect(svg.querySelector('.snap-mark')).toBeNull();
  });

  it('realized: the E24 value with a snap marker, the ideal value in the title', () => {
    useDesignStore.getState().setRealize({ enabled: true, series: 'E24', scope: 'all' });
    const svg = drawStrip();
    // E24 brackets 32.4 pF with 30 and 33 pF; Realize takes the one that matches better.
    const shown = valueIn(svg, 1);
    expect(shown).toMatch(/^(30|33) pF$/);
    const d = useDesignStore.getState().design;
    const realized = realizeDesign(d, effectiveElements(d))?.elements[0]?.realized;
    expect(shown).toBe(stripLabel(realized as Part).text);
    const cell = svg.querySelector('[data-cell="1"]') as SVGGElement;
    expect(cell.querySelector('.snap-mark')).not.toBeNull();
    const title = cell.querySelector('title')?.textContent ?? '';
    expect(title).toContain(`E24: ${shown}`);
    expect(title).toMatch(/ideal 32\.4 pF/);
  });

  it('a value Realize leaves exact (locked) has no marker', () => {
    const d = useDesignStore.getState().design;
    useDesignStore.getState().init({
      ...d,
      elements: d.elements.map((el, i) => (i === 0 ? { ...el, locked: true } : el)),
    });
    useDesignStore.getState().setRealize({ enabled: true, series: 'E24', scope: 'all' });
    const svg = drawStrip();
    expect(valueIn(svg, 1)).toBe('32.4 pF');
    expect(svg.querySelector('[data-cell="1"] .snap-mark')).toBeNull();
  });

  it('a package follows the value: "33 pF 0402", WW for a wire-wound coil', () => {
    useDesignStore.getState().setPackage(0, '0402');
    useDesignStore.getState().setPackage(1, 'wirewound');
    useDesignStore.getState().setRealize({ enabled: true, series: 'E24', scope: 'all' });
    const svg = drawStrip();
    expect(valueIn(svg, 1)).toMatch(/^(30|33) pF 0402$/);
    expect(valueIn(svg, 2)).toMatch(/ nH WW$/);
    expect(stripLabel({ ...C33, package: '0603' })).toEqual({
      text: '32.4 pF 0603',
      snapped: false,
    });
  });

  it('lines and stubs show Z0 and the electrical length, a transformer its ratio', () => {
    expect(stripLabel({ kind: 'line', z0: 50, length: 0.125 }).text).toBe('50 Ω 0.125 λ');
    expect(stripLabel({ kind: 'openStub', z0: 75, length: 0.0625 }).text).toBe('75 Ω 0.0625 λ');
    expect(stripLabel({ kind: 'shortStub', z0: 35.4, length: 0.25 }).text).toBe('35.4 Ω 0.25 λ');
    expect(stripLabel({ kind: 'transformer', n: 1.4142 }).text).toBe('n = 1.41');
    useDesignStore.getState().init({
      ...emptyDesign(),
      elements: identify([
        { kind: 'line', z0: 50, length: 0.125 },
        { kind: 'transformer', n: 2 },
      ]),
    });
    const svg = drawStrip();
    expect(valueIn(svg, 1)).toBe('50 Ω 0.125 λ');
    expect(valueIn(svg, 2)).toBe('n = 2');
  });

  it('cells grow to fit value, package and marker, so labels never collide', () => {
    const label = { text: '33 pF 0402', snapped: true };
    expect(labelWidth(label)).toBeGreaterThanOrEqual(valueWidth(label.text) + SNAP_W + CELL_PAD);
    useDesignStore.getState().setPackage(0, '0402');
    useDesignStore.getState().setRealize({ enabled: true, series: 'E24', scope: 'all' });
    const svg = drawStrip();
    const [, , w] = (svg.getAttribute('viewBox') ?? '').split(' ').map(Number);
    // The drawing is as wide as its cells: it scrolls in the strip instead of shrinking.
    expect(Number(svg.getAttribute('width'))).toBe(w);
  });
});

describe('Zin and VSWR at the Zin terminal', () => {
  it('two short lines: "Zin 51.1 - j0.1 Ω" and "VSWR 1.022"', () => {
    expect(terminalLines(complex(51.1, -0.1), 1.0219)).toEqual(['Zin 51.1 - j0.1 Ω', 'VSWR 1.022']);
    expect(terminalLines(complex(50, 0), undefined)[1]).toBe('VSWR ·');
    expect(terminalWidth(['Zin 51.1 - j0.1 Ω', 'VSWR 1.022'])).toBeGreaterThanOrEqual(
      valueWidth('Zin 51.1 - j0.1 Ω'),
    );
  });

  it('the strip draws them at its source end, from the network as evaluated', () => {
    const d = useDesignStore.getState().design;
    const result = evaluateLadder(ladderOf(d));
    const svg = drawStrip();
    const lines = [...(cellOf(svg, 'zin')?.querySelectorAll('.terminal-text') ?? [])].map((t) =>
      t.textContent?.trim(),
    );
    expect(lines).toEqual([
      ...terminalLines(result.zin, result.info[result.info.length - 1]?.vswr),
    ]);
    expect(lines[0]).toMatch(/^Zin -?[\d.]+ [+-] j[\d.]+ Ω$/);
    expect(lines[1]).toMatch(/^VSWR \d+\.\d{3}$/);
  });

  it('an empty ladder draws the compact 56 high strip with ZL and Zin only', () => {
    useDesignStore.getState().init({ ...emptyDesign(), load: { re: 20, im: -12 } });
    const svg = drawStrip({ compactEmpty: true });
    expect(svg.getAttribute('viewBox')?.endsWith(` ${SCHEMATIC_H_COMPACT}`)).toBe(true);
    expect(svg.getAttribute('height')).toBe(String(SCHEMATIC_H_COMPACT));
    expect(svg.querySelectorAll('.terminal-text')).toHaveLength(2);
  });

  it('with Realize on it shows the network as built, the ideal Zin in the title', () => {
    useDesignStore.getState().setRealize({ enabled: true, series: 'E24', scope: 'all' });
    const d = useDesignStore.getState().design;
    const result = evaluateLadder(ladderOf(d));
    const realization = realizeDesign(d, effectiveElements(d));
    if (!realization) throw new Error('Realize is on');
    const built = { result: realization.result, label: 'realized values' };
    const { container } = render(
      <Schematic result={result} realization={realization} built={built} />,
    );
    const zin = container.querySelector('[data-cell="zin"]') as SVGGElement;
    const lines = [...zin.querySelectorAll('.terminal-text')].map((t) => t.textContent);
    const r = realization.result;
    expect(lines).toEqual([...terminalLines(r.zin, r.info[r.info.length - 1]?.vswr)]);
    expect(zin.querySelector('title')?.textContent).toMatch(
      /with the realized values; with the ideal values Zin /,
    );
  });
});

describe('the detents with the pinned strip: nothing overlaps', () => {
  for (const [vw, vh] of [
    [375, 667],
    [375, 812],
    [390, 844],
    [430, 932],
    [375, 553],
  ] as const) {
    it(`${vw} x ${vh}: chart, strip and half sheet stack without a gap or an overlap`, () => {
      const bar = TOP_BAR_H;
      const hero = Math.min(vw, vh - bar - PINNED_STRIP_H - PEEK_H - HALF_FLOOR);
      const stripBottom = bar + hero + PINNED_STRIP_H;
      const h = sheetHeights(vh, stripBottom, bar + PINNED_STRIP_H);
      expect(hero).toBeGreaterThan(0);
      expect(vh - h.half).toBe(stripBottom);
      expect(h.half).toBeGreaterThanOrEqual(h.peek + HALF_FLOOR);
      // At full the strip sits under the top bar and the sheet under the strip.
      expect(h.full).toBe(vh - bar - PINNED_STRIP_H);
    });
  }
});

describe('the phone: the strip pinned under the chart', () => {
  it('is on show on every sheet segment, and Network no longer repeats it', async () => {
    setWidth(390, 844);
    const { App } = await import('../src/App');
    const { container } = render(<App />);
    for (const pane of ['network', 'numbers', 'tool'] as Pane[]) {
      act(() => useShell.getState().setPane(pane));
      const strip = container.querySelector('.pinned-strip');
      expect(strip, pane).not.toBeNull();
      expect(strip?.querySelector('.schematic'), pane).not.toBeNull();
      // Between the chart hero and the sheet, outside the sheet.
      expect(strip?.previousElementSibling?.tagName, pane).toBe('MAIN');
      expect(strip?.closest('.panel-sheet'), pane).toBeNull();
      expect(container.querySelectorAll('.schematic'), pane).toHaveLength(1);
      expect(container.querySelector('[data-pane="network"] .schematic'), pane).toBeNull();
    }
    // At full the strip lifts under the top bar instead of going under the sheet.
    act(() => useShell.getState().setDetent('full'));
    expect(container.querySelector('.pinned-strip')?.className).toContain('lifted');
    // The live strip of the sheet is not repeated where the schematic strip shows Zin.
    expect(container.querySelector('.live-strip')).toBeNull();
  });

  it('is in the Chart view only: Response and S-Plot keep their pages', async () => {
    setWidth(375, 667);
    const { App } = await import('../src/App');
    const { container } = render(<App />);
    for (const view of ['response', 'splot'] as View[]) {
      act(() => useDesignStore.getState().setView(view));
      expect(container.querySelector('.pinned-strip'), view).toBeNull();
    }
    act(() => useDesignStore.getState().setView('chart'));
    expect(container.querySelector('.pinned-strip')).not.toBeNull();
  });

  it('a tap on a part in the strip selects it', async () => {
    setWidth(390, 844);
    const { App } = await import('../src/App');
    const { container } = render(<App />);
    const cell = container.querySelector('.pinned-strip [data-cell="2"]') as SVGGElement;
    fireEvent.click(cell);
    expect(useDesignStore.getState().selected).toBe(2);
  });

  it('no readout chip on the lower rim of the chart', async () => {
    setWidth(375, 812);
    const { App } = await import('../src/App');
    const { container } = render(<App />);
    expect(container.querySelector('.readout-chip')).toBeNull();
    expect(container.querySelector('.pinned-strip .terminal-text')?.textContent).toMatch(/^Zin /);
  });
});
