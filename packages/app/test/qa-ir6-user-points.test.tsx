// @vitest-environment jsdom
/**
 * QA, redesign phase 5: the hollow user datapoints (DPn) on a touch screen
 * (chart/SmithChart.tsx, docs/07 section 6). Markers are 12 px across on a
 * coarse pointer, and a plain tap with an armed part places it at once.
 * Design: load 20 - j12 ohm, one more user datapoint DP2 at 50 ohm (the chart
 * centre, screen point 200, 200 on the 400 px chart), shunt C 4.7 pF and
 * series L 10 nH.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyDesign, identify } from '../src/lib/design';
import { useDesignStore } from '../src/store/useDesignStore';
import { useShell } from '../src/store/useShell';

const SIZE = 400;
const realRect = Element.prototype.getBoundingClientRect;
beforeAll(() => {
  Element.prototype.getBoundingClientRect = function (this: Element): DOMRect {
    if (this instanceof SVGSVGElement && this.classList.contains('smith-chart')) {
      return {
        left: 0,
        top: 0,
        right: SIZE,
        bottom: SIZE,
        width: SIZE,
        height: SIZE,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      } as DOMRect;
    }
    return realRect.call(this);
  };
});
afterAll(() => {
  Element.prototype.getBoundingClientRect = realRect;
});

function stubs(width: number, touch: boolean): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: touch && query === '(pointer: coarse)',
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
  }));
  vi.stubGlobal('innerWidth', width);
  vi.stubGlobal('innerHeight', 900);
  // The real ResizeObserver is absent in jsdom: report the 400 px chart once, as a browser would.
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(private readonly cb: () => void) {}
      observe(): void {
        this.cb();
      }
      unobserve(): void {}
      disconnect(): void {}
    },
  );
}

beforeEach(() => {
  localStorage.clear();
  useShell.setState({ detent: 'half', held: null, holds: [], guideClosed: true });
  useDesignStore.getState().init({
    ...emptyDesign(),
    load: { re: 20, im: -12 },
    datapoints: [{ frequency: 1e9, z: { re: 50, im: 0 } }],
    startSlot: 0,
    elements: identify([
      { kind: 'C', orientation: 'shunt', value: 4.7e-12 },
      { kind: 'L', orientation: 'series', value: 10e-9 },
    ]),
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function renderApp(width: number, touch: boolean): Promise<HTMLElement> {
  stubs(width, touch);
  const { App } = await import('../src/App');
  return render(<App />).container;
}

describe('hollow user datapoints on a touch screen', () => {
  it('draw 12 px across like the chain markers: r = 6 px * 2.36 / 400 = 0.0354 chart units', async () => {
    const c = await renderApp(1000, true);
    // The chain marker TP2 (a dot) is scaled: 0.026 * (12 / 8.814) = 0.0354.
    const dot = c.querySelectorAll('.datapoints .dp')[1]?.querySelector('circle') as Element;
    expect(Number(dot.getAttribute('r'))).toBeCloseTo(0.0354, 4);
    const hollow = c.querySelector('.user-datapoints .udp circle') as Element;
    expect(Number(hollow.getAttribute('r'))).toBeCloseTo(0.0354, 4);
  });

  it('a plain tap on a hollow datapoint with a part armed places the part', async () => {
    const c = await renderApp(1000, true);
    // Corrected in the phase 5 QA fixes: a series L cannot reach the chart centre from TP3
    // (9.2 + j50.0 ohm; it only adds reactance) and is now refused there, so the part armed
    // is a series C, which can (it lands at 9.2 + j0.0 ohm).
    fireEvent.click(screen.getByRole('button', { name: /^Series C/ }));
    const udp = c.querySelector('.user-datapoints .udp') as Element;
    const ev = { pointerId: 1, pointerType: 'touch', button: 0, clientX: 200, clientY: 200 };
    fireEvent.pointerDown(udp, ev);
    fireEvent.pointerUp(udp, ev);
    fireEvent.click(udp, { clientX: 200, clientY: 200 });
    expect(useDesignStore.getState().design.elements.length).toBe(3);
    expect(useDesignStore.getState().design.startSlot ?? 0).toBe(0);
  });
});
