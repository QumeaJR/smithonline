// @vitest-environment jsdom
/**
 * Redesign phase 5 QA fixes: a finger on a Response or S-Plot graph (response/Plot.tsx,
 * docs/07 section 5). uPlot listens to the mouse only, so the plot drives its cursor from
 * pointer events: a sideways drag moves it and fills the readout row under the plot, a
 * vertical swipe leaves the page to scroll, a tap sets a marker. uPlot itself is replaced by
 * a stand-in whose plotting area is 300 x 100 px with a sample every 10 px.
 */
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const cursorCalls: { left: number; top: number }[] = [];

vi.mock('uplot', () => {
  class FakePlot {
    static pxRatio = 1;
    over: HTMLDivElement;
    cursor: { left?: number; top?: number; idx?: number | null } = {};
    constructor(_opts: unknown, _data: unknown, el: HTMLElement) {
      this.over = document.createElement('div');
      this.over.className = 'u-over';
      this.over.getBoundingClientRect = () =>
        ({ left: 0, top: 0, width: 300, height: 100, right: 300, bottom: 100 }) as DOMRect;
      el.appendChild(this.over);
    }
    setCursor(c: { left: number; top: number }): void {
      cursorCalls.push(c);
      this.cursor = { ...c, idx: Math.round(c.left / 10) };
    }
    posToIdx(left: number): number {
      return Math.round(left / 10);
    }
    setData(): void {}
    setSize(): void {}
    redraw(): void {}
    destroy(): void {}
  }
  return { default: FakePlot };
});
vi.mock('uplot/dist/uPlot.min.css', () => ({}));

const xs = Array.from({ length: 31 }, (_, i) => 1e9 + i * 1e7);
const values = xs.map((_, i) => -i / 2);

function stubs(touch: boolean): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: touch && query === '(pointer: coarse)',
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
}

beforeEach(() => {
  cursorCalls.length = 0;
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function renderPlot(touch: boolean, onClick = vi.fn()) {
  stubs(touch);
  const { Plot } = await import('../src/response/Plot');
  const view = render(
    <Plot
      xs={xs}
      series={[{ label: '|S21|', color: '#000', values, format: (v) => `${v.toFixed(2)} dB` }]}
      logX={false}
      left={{ format: (v) => `${v}` }}
      markers={[]}
      designFrequency={1.1e9}
      themeToken={0}
      onCursor={() => undefined}
      onClick={onClick}
    />,
  );
  const over = view.container.querySelector('.u-over') as HTMLElement;
  const row = (): string => view.container.querySelector('.plot-readout')?.textContent ?? '';
  return { over, row, onClick, container: view.container };
}
const finger = (x: number, y: number, id = 1) => ({
  pointerId: id,
  pointerType: 'touch',
  button: 0,
  clientX: x,
  clientY: y,
});

describe('a finger on a plot', () => {
  it('a sideways drag moves the cursor and the readout row under the plot follows', async () => {
    const { over, row } = await renderPlot(true);
    expect(row()).toBe('Drag sideways on the plot for a readout');
    fireEvent.pointerDown(over, finger(50, 50));
    fireEvent.pointerMove(over, finger(60, 51));
    fireEvent.pointerMove(over, finger(80, 52));
    expect(cursorCalls.at(-1)).toEqual({ left: 80, top: 52 });
    // Sample 8: 1.08 GHz, -4.00 dB.
    expect(row()).toContain('f 1.08 GHz');
    expect(row()).toContain('|S21| -4.00 dB');
    fireEvent.pointerUp(over, finger(80, 52));
  });

  it('a vertical swipe leaves the cursor alone (the page scrolls)', async () => {
    const { over, row } = await renderPlot(true);
    fireEvent.pointerDown(over, finger(50, 20));
    fireEvent.pointerMove(over, finger(51, 30));
    fireEvent.pointerMove(over, finger(70, 60));
    expect(cursorCalls).toEqual([]);
    expect(row()).toBe('Drag sideways on the plot for a readout');
  });

  it('a tap sets a marker at the sample under it and shows its readout', async () => {
    const { over, row, onClick } = await renderPlot(true);
    fireEvent.pointerDown(over, finger(120, 40));
    fireEvent.pointerUp(over, finger(121, 40));
    expect(onClick).toHaveBeenCalledWith(12);
    expect(row()).toContain('|S21| -6.00 dB');
  });

  it('with a mouse there is no readout row and the plot does not drive the cursor', async () => {
    const { over, container } = await renderPlot(false);
    expect(container.querySelector('.plot-readout')).toBeNull();
    fireEvent.pointerDown(over, { ...finger(50, 50), pointerType: 'mouse' });
    fireEvent.pointerMove(over, { ...finger(90, 50), pointerType: 'mouse' });
    expect(cursorCalls).toEqual([]);
  });
});
