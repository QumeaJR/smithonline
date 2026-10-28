// @vitest-environment jsdom
/**
 * docs/10 sections 4.2 and 4.3: the plot panel's head (Enlarge, Export), the
 * enlarged state with Escape, and the keys of a focused plot.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('uplot', () => {
  class FakePlot {
    static pxRatio = 1;
    over: HTMLDivElement;
    cursor: { left?: number; top?: number; idx?: number | null } = {};
    constructor(_opts: unknown, _data: unknown, el: HTMLElement) {
      this.over = document.createElement('div');
      this.over.className = 'u-over';
      el.appendChild(this.over);
    }
    setCursor(c: { left: number; top: number }): void {
      this.cursor = { ...c, idx: 1 };
    }
    posToIdx(): number {
      return 1;
    }
    posToVal(px: number): number {
      return 1e9 + px * 1e6;
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

import { PlotPanel } from '../src/response/PlotPanel';
import type { PlotProps } from '../src/response/Plot';

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
afterEach(cleanup);

const xs = [1e9, 1.1e9, 1.2e9, 1.3e9];
function plot(
  over: Partial<PlotProps> = {},
): Omit<PlotProps, 'handleRef' | 'onEnlarge' | 'gestures' | 'title'> {
  return {
    xs,
    series: [{ label: 'VSWR', color: '#2f9e44', values: [2, 1.5, 1.2, 1.8] }],
    logX: false,
    left: { format: String },
    markers: [],
    designFrequency: 1.2e9,
    themeToken: 0,
    onCursor: () => undefined,
    onClick: () => undefined,
    ...over,
  };
}

describe('PlotPanel', () => {
  it('names the plot and its frequency range for a screen reader, and takes the focus', () => {
    render(
      <PlotPanel
        title="VSWR"
        fileId="vswr"
        kind="response"
        plot={plot()}
        enlarged={false}
        onEnlarge={() => undefined}
      />,
    );
    const img = screen.getByRole('img', { name: 'VSWR plot, 1 to 1.3 GHz' });
    expect(img.getAttribute('tabindex')).toBe('0');
  });

  it('Enlarge asks to enlarge; enlarged, Back to all plots and Escape return', () => {
    const onEnlarge = vi.fn();
    const { rerender } = render(
      <PlotPanel
        title="VSWR"
        fileId="vswr"
        kind="response"
        plot={plot()}
        enlarged={false}
        onEnlarge={onEnlarge}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Enlarge VSWR' }));
    expect(onEnlarge).toHaveBeenLastCalledWith(true);
    rerender(
      <PlotPanel
        title="VSWR"
        fileId="vswr"
        kind="response"
        plot={plot()}
        enlarged
        onEnlarge={onEnlarge}
      />,
    );
    expect(document.querySelector('.plot-panel.enlarged')).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Enlarge VSWR' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Back to all plots/ }));
    expect(onEnlarge).toHaveBeenLastCalledWith(false);
    onEnlarge.mockClear();
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(onEnlarge).toHaveBeenLastCalledWith(false);
  });

  it('Export offers PNG, SVG and CSV', () => {
    render(
      <PlotPanel
        title="VSWR"
        fileId="vswr"
        kind="response"
        plot={plot()}
        enlarged={false}
        onEnlarge={() => undefined}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Export VSWR' }));
    const items = screen.getAllByRole('menuitem').map((m) => m.textContent ?? '');
    expect(items.some((t) => t.startsWith('PNG image'))).toBe(true);
    expect(items.some((t) => t.startsWith('SVG drawing'))).toBe(true);
    expect(items.some((t) => t.startsWith('CSV data'))).toBe(true);
  });

  it('keys on the focused plot: + zooms, 0 resets, E enlarges, Enter sets a marker', () => {
    const onXRange = vi.fn();
    const onEnlarge = vi.fn();
    const onClick = vi.fn();
    render(
      <PlotPanel
        title="VSWR"
        fileId="vswr"
        kind="response"
        plot={plot({ xRange: [1.1e9, 1.2e9], onXRange, onClick })}
        enlarged={false}
        onEnlarge={onEnlarge}
      />,
    );
    const img = screen.getByRole('img');
    fireEvent.keyDown(img, { key: '+' });
    const zoomed = onXRange.mock.calls.at(-1)?.[0] as [number, number];
    expect(zoomed[1] - zoomed[0]).toBeLessThan(0.1e9);
    fireEvent.keyDown(img, { key: '0' });
    expect(onXRange).toHaveBeenLastCalledWith(null);
    fireEvent.keyDown(img, { key: 'e' });
    expect(onEnlarge).toHaveBeenLastCalledWith(true);
    fireEvent.keyDown(img, { key: 'ArrowRight' });
    fireEvent.keyDown(img, { key: 'Enter' });
    expect(onClick).toHaveBeenCalledWith(1);
  });

  it('hidden while another panel is enlarged, but mounted', () => {
    render(
      <PlotPanel
        title="VSWR"
        fileId="vswr"
        kind="response"
        plot={plot()}
        enlarged={false}
        hidden
        onEnlarge={() => undefined}
      />,
    );
    const section = document.querySelector('.plot-panel') as HTMLElement;
    expect(section.hidden).toBe(true);
    expect(section.querySelector('.u-over')).not.toBeNull();
  });
});
