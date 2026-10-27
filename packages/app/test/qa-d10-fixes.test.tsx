// @vitest-environment jsdom
/**
 * docs/10 QA round 1 fixes: the box zoom (uPlot clears its select box in place,
 * so the hook must copy it first), a drag that stays on its own plot, a
 * double click or double tap that resets without adding or removing a marker,
 * the zoom chip in the head of a plot with its own zoom, the SVG legend that
 * names every curve, and ticks chosen for the export's size. uPlot is a
 * stand-in that keeps the options and the select box as uPlot does.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

interface Select {
  left: number;
  top: number;
  width: number;
  height: number;
}
interface FakeOpts {
  hooks: { setSelect: ((u: unknown) => void)[] };
  cursor: { sync: { filters?: { pub?: (type: string) => boolean } } };
}
const plots: { opts: FakeOpts; u: FakePlotShape }[] = [];
interface FakePlotShape {
  over: HTMLDivElement;
  select: Select;
  scales: Record<string, { min?: number; max?: number }>;
}

vi.mock('uplot', () => {
  class FakePlot {
    static pxRatio = 1;
    over: HTMLDivElement;
    cursor: { left?: number; top?: number; idx?: number | null } = {};
    select: Select = { left: 0, top: 0, width: 0, height: 0 };
    scales: Record<string, { min?: number; max?: number }> = {
      x: { min: 1e9, max: 2e9 },
      y: { min: 0, max: 10 },
    };
    constructor(opts: FakeOpts, _data: unknown, el: HTMLElement) {
      this.over = document.createElement('div');
      this.over.className = 'u-over';
      Object.defineProperty(this.over, 'clientWidth', { value: 300 });
      Object.defineProperty(this.over, 'clientHeight', { value: 100 });
      this.over.getBoundingClientRect = () =>
        ({ left: 0, top: 0, width: 300, height: 100, right: 300, bottom: 100 }) as DOMRect;
      el.appendChild(this.over);
      plots.push({ opts, u: this as unknown as FakePlotShape });
    }
    /** As uPlot does: the fields are written into the same object. */
    setSelect(s: Select): void {
      Object.assign(this.select, s);
    }
    setScale(key: string, r: { min: number; max: number }): void {
      this.scales[key] = { ...r };
    }
    setCursor(c: { left: number; top: number }): void {
      this.cursor = { ...c, idx: Math.round(c.left / 100) };
    }
    posToIdx(left: number): number {
      return Math.round(left / 100);
    }
    /** x: 1 GHz at 0 px to 2 GHz at 300 px; y: 10 at the top to 0 at the bottom. */
    posToVal(px: number, scale: string): number {
      return scale === 'x' ? 1e9 + (px / 300) * 1e9 : 10 - (px / 100) * 10;
    }
    valToPos(): number {
      return 10;
    }
    setData(): void {}
    setSize(): void {}
    redraw(): void {}
    destroy(): void {}
  }
  return { default: FakePlot };
});
vi.mock('uplot/dist/uPlot.min.css', () => ({}));

import { Plot, type PlotProps } from '../src/response/Plot';
import { PlotPanel } from '../src/response/PlotPanel';
import { plotSvg } from '../src/response/plotSvg';

beforeAll(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(): void {}
      disconnect(): void {}
    },
  );
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: false,
    media: q,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
  }));
});
afterEach(() => {
  cleanup();
  plots.length = 0;
});

const xs = [1e9, 1.333e9, 1.667e9, 2e9];
function props(over: Partial<PlotProps> = {}): PlotProps {
  return {
    xs,
    series: [{ label: 'VSWR', color: '#2f9e44', values: [2, 1.5, 1.2, 1.8] }],
    logX: false,
    left: { format: String },
    markers: [],
    designFrequency: 1.5e9,
    themeToken: 0,
    onCursor: () => undefined,
    onClick: () => undefined,
    title: 'VSWR',
    ...over,
  };
}

/** A drag as uPlot ends it: the select box set, then the setSelect hook. */
function drag(i: number, box: Select): void {
  const p = plots[i];
  if (!p) throw new Error('no plot');
  p.u.select = { ...box };
  for (const h of p.opts.hooks.setSelect) h(p.u);
}

describe('box zoom (blocker)', () => {
  it('a box zooms frequency to its edges and fixes y; the select box is cleared', () => {
    const onXRange = vi.fn();
    render(<Plot {...props({ onXRange })} />);
    drag(0, { left: 60, top: 20, width: 120, height: 50 });
    expect(onXRange).toHaveBeenCalledTimes(1);
    const [range] = onXRange.mock.calls[0] as [[number, number]];
    expect(range[0]).toBeCloseTo(1.2e9, -3);
    expect(range[1]).toBeCloseTo(1.6e9, -3);
    expect(plots[0]?.u.scales.y).toEqual({ min: 3, max: 8 });
    expect(plots[0]?.u.select).toEqual({ left: 0, top: 0, width: 0, height: 0 });
  });

  it('a box of y only (full width) keeps the frequencies and still reports a zoom, for the chip', () => {
    const onXRange = vi.fn();
    render(<Plot {...props({ onXRange })} />);
    drag(0, { left: 0, top: 10, width: 300, height: 40 });
    expect(onXRange).toHaveBeenCalledWith([1e9, 2e9]);
    expect(plots[0]?.u.scales.y).toEqual({ min: 5, max: 9 });
  });

  it('a box under 4 px, or a plot without zoom, changes nothing', () => {
    const onXRange = vi.fn();
    render(<Plot {...props({ onXRange })} />);
    drag(0, { left: 60, top: 20, width: 3, height: 2 });
    expect(onXRange).not.toHaveBeenCalled();
    cleanup();
    plots.length = 0;
    render(<Plot {...props()} />);
    drag(0, { left: 60, top: 20, width: 120, height: 50 });
    expect(plots[0]?.u.scales.y).toEqual({ min: 0, max: 10 });
  });

  it('a drag is not passed to the other plots of the sync group; the cursor is', () => {
    render(<Plot {...props()} />);
    const pub = plots[0]?.opts.cursor.sync.filters?.pub;
    expect(pub?.('mousedown')).toBe(false);
    expect(pub?.('mouseup')).toBe(false);
    expect(pub?.('mousemove')).toBe(true);
  });
});

describe('double click and double tap reset without touching the markers (major 3)', () => {
  /** A marker list like the store's: add returns how to take it back when it added one. */
  function markerList(start: number[] = []) {
    const markers = [...start];
    const onClick = (idx: number): void | (() => void) => {
      const f = xs[idx] as number;
      if (markers.includes(f)) return undefined;
      markers.push(f);
      return () => {
        const at = markers.indexOf(f);
        if (at >= 0) markers.splice(at, 1);
      };
    };
    return { markers, onClick };
  }
  function click(over: HTMLElement, x: number, t: number, pointerType = 'mouse'): void {
    const init = { clientX: x, clientY: 50, pointerType, pointerId: 1, timeStamp: t };
    fireEvent(over, Object.assign(new MouseEvent('pointerdown', init), { pointerType }));
    fireEvent(over, Object.assign(new MouseEvent('pointerup', init), { pointerType }));
  }

  it('a double click on an empty frequency adds no marker and resets the zoom', () => {
    const list = markerList([2e9]);
    const onXRange = vi.fn();
    render(<Plot {...props({ onClick: list.onClick, onXRange, xRange: [1.2e9, 1.6e9] })} />);
    const over = plots[0]?.u.over as HTMLDivElement;
    click(over, 100, 1000);
    click(over, 100, 1200);
    fireEvent.dblClick(over);
    expect(list.markers).toEqual([2e9]);
    expect(onXRange).toHaveBeenLastCalledWith(null);
  });

  it('a double click on an existing marker keeps it', () => {
    const list = markerList([xs[1] as number]);
    render(<Plot {...props({ onClick: list.onClick, onXRange: vi.fn() })} />);
    const over = plots[0]?.u.over as HTMLDivElement;
    click(over, 100, 1000);
    click(over, 100, 1200);
    fireEvent.dblClick(over);
    expect(list.markers).toEqual([xs[1]]);
  });

  it('a single click still sets a marker', () => {
    const list = markerList();
    render(<Plot {...props({ onClick: list.onClick, onXRange: vi.fn() })} />);
    click(plots[0]?.u.over as HTMLDivElement, 200, 1000);
    expect(list.markers).toEqual([xs[2]]);
  });
});

describe('the zoom chip of a plot with its own zoom (major 2)', () => {
  it('shows the range, its Reset clears the zoom, and the hint names the gestures', () => {
    const onXRange = vi.fn();
    render(
      <PlotPanel
        title="Magnitude"
        fileId="splot_mag"
        kind="splot"
        ownZoom
        enlarged={false}
        onEnlarge={() => undefined}
        plot={{ ...props({ onXRange, xRange: [1.2e9, 1.6e9] }), title: undefined } as never}
      />,
    );
    const chip = screen.getByRole('status');
    expect(chip.textContent).toContain('Zoomed to 1.2 to 1.6 GHz');
    expect(chip.getAttribute('title')).toBe(
      'Drag to zoom, double-click to reset, Ctrl or Cmd wheel, E to enlarge',
    );
    act(() => fireEvent.click(screen.getByRole('button', { name: 'Reset' })));
    expect(onXRange).toHaveBeenCalledWith(null);
  });
});

describe('the exported picture (major 4)', () => {
  const base = {
    title: 'Gain and return loss, dB',
    xs: [1e9, 2e9],
    left: { format: String, unit: 'dB' },
    logX: false,
    xRange: [1e9, 2e9] as [number, number],
    yRange: [-40, 0] as [number, number],
    markers: [],
    designFrequency: 0,
    footer: 'antenna, 2026-10-27, Smith Online',
  };

  it('the legend wraps so every curve drawn is named, and the plot area moves down', () => {
    const series = Array.from({ length: 14 }, (_, i) => ({
      label: `stored curve number ${i + 1} |S21|`,
      color: '#123456',
      values: [-i, -i - 1],
    }));
    const svg = plotSvg({ ...base, series });
    for (const s of series) expect(svg).toContain(`>${s.label}</text>`);
    const clip = /<clipPath id="plot-area"><rect x="70" y="(\d+)"/.exec(svg);
    expect(Number(clip?.[1])).toBeGreaterThan(58);
    expect(svg).toContain('Gain and return loss, dB');
  });

  it('a flat range (all zero) is widened, so nothing is NaN', () => {
    const svg = plotSvg({
      ...base,
      series: [{ label: 'delay', color: '#111', values: [0, 0], scale: 'd' }],
      right: { format: String },
      dRange: [0, 0],
      yRange: [0, 0],
    });
    expect(svg).not.toMatch(/NaN|Infinity/);
  });
});
