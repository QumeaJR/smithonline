// @vitest-environment jsdom
/**
 * Adversarial, phase 5: a pinch whose fingers lift one after the other (the
 * usual way) must leave the chart as a single tap does: no hover readout left
 * behind and no grabbing cursor.
 */
import { cleanup, fireEvent, render } from '@testing-library/react';
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

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    },
  );
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query === '(pointer: coarse)',
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
  }));
  vi.stubGlobal('innerWidth', 1440);
  vi.stubGlobal('innerHeight', 900);
  localStorage.clear();
  useShell.setState({ detent: 'half', held: null, holds: [], guideClosed: true });
  useDesignStore.getState().init({
    ...emptyDesign(),
    load: { re: 20, im: -12 },
    elements: identify([{ kind: 'L', orientation: 'series', value: 10e-9 }]),
  });
  useDesignStore.getState().setMessage(null);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const ev = (id: number, x: number, y: number) => ({
  pointerId: id,
  pointerType: 'touch',
  button: 0,
  clientX: x,
  clientY: y,
});

async function renderApp(): Promise<HTMLElement> {
  const { App } = await import('../src/App');
  return render(<App />).container;
}

describe('pinch lifted one finger at a time', () => {
  it('a single tap leaves no live readout (control)', async () => {
    const c = await renderApp();
    const svg = c.querySelector('svg.smith-chart') as SVGSVGElement;
    fireEvent.pointerDown(svg, ev(1, 200, 120));
    fireEvent.pointerUp(svg, ev(1, 200, 120));
    expect(c.querySelector('footer.statusbar')?.classList.contains('live')).toBe(false);
  });

  it('after the pinch no live readout is left in the status bar', async () => {
    const c = await renderApp();
    const svg = c.querySelector('svg.smith-chart') as SVGSVGElement;
    fireEvent.pointerDown(svg, ev(1, 200, 120));
    fireEvent.pointerDown(svg, ev(2, 240, 160));
    fireEvent.pointerMove(svg, ev(2, 260, 180));
    fireEvent.pointerUp(svg, ev(1, 200, 120));
    fireEvent.pointerUp(svg, ev(2, 260, 180));
    expect(c.querySelector('footer.statusbar')?.classList.contains('live')).toBe(false);
  });

  it('after the pinch the cursor is not left at grabbing', async () => {
    const c = await renderApp();
    const svg = c.querySelector('svg.smith-chart') as SVGSVGElement;
    fireEvent.pointerDown(svg, ev(1, 200, 120));
    fireEvent.pointerDown(svg, ev(2, 240, 160));
    fireEvent.pointerUp(svg, ev(1, 200, 120));
    fireEvent.pointerUp(svg, ev(2, 240, 160));
    expect(svg.style.cursor).toBe('crosshair');
  });
});
