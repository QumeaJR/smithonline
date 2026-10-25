// @vitest-environment jsdom
/**
 * Adversarial, phase 6 in the running App: the Fit animation interrupted (wheel, second Fit,
 * unmount, reduced motion), the file and view shortcuts under key repeat, AltGr and during a
 * marker drag. Each test asserts the correct behaviour; a failure is a defect.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('uplot', () => {
  class FakePlot {
    static pxRatio = 1;
    over = document.createElement('div');
    cursor = {};
    setCursor(): void {}
    posToIdx(): number {
      return 0;
    }
    setData(): void {}
    setSize(): void {}
    redraw(): void {}
    destroy(): void {}
  }
  return { default: FakePlot };
});
vi.mock('uplot/dist/uPlot.min.css', () => ({}));
const saved = vi.hoisted(() => ({ json: [] as string[] }));
vi.mock('../src/lib/export', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  exportJson: (_data: unknown, name: string) => saved.json.push(name),
}));

import { emptyDesign, identify } from '../src/lib/design';
import { useDesignStore } from '../src/store/useDesignStore';
import { useHelp } from '../src/store/useHelp';
import { useShell } from '../src/store/useShell';

const SIZE = 400;
const realRect = Element.prototype.getBoundingClientRect;
let reduced = false;
const D = () => useDesignStore.getState();

/** A controllable animation frame queue. */
let frames = new Map<number, FrameRequestCallback>();
let nextId = 1;
const raf = vi.fn((cb: FrameRequestCallback): number => {
  const id = nextId++;
  frames.set(id, cb);
  return id;
});
const caf = vi.fn((id: number): void => {
  frames.delete(id);
});
function flush(at: number): void {
  const now = frames;
  frames = new Map();
  act(() => {
    for (const cb of now.values()) cb(at);
  });
}

function stubs(): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: reduced && query === '(prefers-reduced-motion: reduce)',
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
  vi.stubGlobal('requestAnimationFrame', raf);
  vi.stubGlobal('cancelAnimationFrame', caf);
  vi.stubGlobal('innerWidth', 1440);
  vi.stubGlobal('innerHeight', 900);
}

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
  reduced = false;
  frames = new Map();
  nextId = 1;
  raf.mockClear();
  caf.mockClear();
  stubs();
  localStorage.clear();
  saved.json = [];
  useShell.setState({
    detent: 'half',
    held: null,
    holds: [],
    guideClosed: true,
    guideShown: false,
  });
  useHelp.getState().closeHelp();
  D().init({
    ...emptyDesign(),
    load: { re: 20, im: -12 },
    elements: identify([
      { kind: 'C', orientation: 'shunt', value: 4.7e-12 },
      { kind: 'L', orientation: 'series', value: 10e-9 },
    ]),
  });
  D().setView('chart');
  D().setMessage(null);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  stubs();
});

async function renderApp(): Promise<HTMLElement> {
  const { App } = await import('../src/App');
  return render(<App />).container;
}
const svgOf = (c: HTMLElement): SVGSVGElement =>
  c.querySelector('svg.smith-chart') as SVGSVGElement;
const vb = (c: HTMLElement): number[] =>
  (svgOf(c).getAttribute('viewBox') ?? '').split(' ').map(Number);
const wheel = (c: HTMLElement, deltaY: number): void => {
  act(() => {
    svgOf(c).dispatchEvent(
      new WheelEvent('wheel', {
        deltaY,
        clientX: 250,
        clientY: 150,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
};
const fit = (): void => void fireEvent.click(screen.getByRole('button', { name: 'Fit' }));
const key = (k: string, extra: Partial<KeyboardEventInit> = {}): KeyboardEvent => {
  const e = new KeyboardEvent('keydown', {
    key: k,
    ctrlKey: true,
    bubbles: true,
    cancelable: true,
    ...extra,
  });
  act(() => {
    window.dispatchEvent(e);
  });
  return e;
};
/** Alt+n: the view keys (Ctrl+n is the browser's tab key). */
const viewKey = (n: number): KeyboardEvent =>
  key(String(n), { ctrlKey: false, altKey: true, code: 'Digit' + n });
const HOME_VB = [-1.18, -1.18, 2.36, 2.36];
const expectHome = (c: HTMLElement): void =>
  vb(c).forEach((v, i) => expect(v).toBeCloseTo(HOME_VB[i] as number, 9));

describe('Fit animation', () => {
  it('runs from the zoomed view home over frames', async () => {
    const c = await renderApp();
    wheel(c, -500);
    const zoomed = vb(c);
    expect(zoomed[2]).toBeLessThan(2.36);
    fit();
    const t0 = performance.now();
    flush(t0 + 100);
    const mid = vb(c);
    expect(mid[2]).toBeGreaterThan(zoomed[2] as number);
    expect(mid[2]).toBeLessThan(2.36);
    flush(t0 + 1000);
    expectHome(c);
    expect(frames.size).toBe(0);
  });

  it('a wheel zoom mid-Fit stops it where it is; nothing pulls the view home later', async () => {
    const c = await renderApp();
    wheel(c, -500);
    fit();
    const t0 = performance.now();
    flush(t0 + 50);
    wheel(c, -200);
    const after = vb(c);
    flush(t0 + 1000);
    expect(vb(c)).toEqual(after);
  });

  it('interrupting a Fit cancels only its own frame: no clearTimeout with a frame id', async () => {
    const c = await renderApp();
    wheel(c, -500);
    fit();
    const t0 = performance.now();
    flush(t0 + 50);
    const frameIds = [...frames.keys()];
    expect(frameIds.length).toBe(1);
    const clear = vi.spyOn(globalThis, 'clearTimeout');
    wheel(c, -200);
    const hit = clear.mock.calls.some(([id]) => frameIds.includes(id as unknown as number));
    clear.mockRestore();
    // The frame id is not a timer id: clearing it can cancel an unrelated live timer.
    expect(hit).toBe(false);
  });

  it('a second Fit mid-Fit still ends at home', async () => {
    const c = await renderApp();
    wheel(c, -500);
    fit();
    flush(performance.now() + 50);
    fit();
    flush(performance.now() + 100);
    flush(performance.now() + 5000);
    expectHome(c);
  });

  it('switching view mid-Fit (Alt+2) unmounts the chart and leaves no frame queued', async () => {
    const c = await renderApp();
    wheel(c, -500);
    fit();
    flush(performance.now() + 50);
    viewKey(2);
    expect(D().view).toBe('response');
    expect(frames.size).toBe(0);
  });

  it('under reduced motion the first frame is home', async () => {
    reduced = true;
    stubs();
    const c = await renderApp();
    wheel(c, -500);
    fit();
    flush(performance.now() + 1);
    expectHome(c);
  });
});

describe('shortcuts', () => {
  it('Ctrl+S held down (key repeat) saves once, not once per repeat', async () => {
    await renderApp();
    key('s');
    for (let i = 0; i < 10; i++) key('s', { repeat: true });
    expect(saved.json).toHaveLength(1);
  });

  it('AltGr (Ctrl+Alt) with S, O, E, 1 leaves the key to the layout', async () => {
    await renderApp();
    for (const k of ['s', 'o', 'e', '1', '2']) {
      const e = key(k, { altKey: true });
      expect(e.defaultPrevented).toBe(false);
    }
    expect(saved.json).toHaveLength(0);
    expect(D().view).toBe('chart');
  });

  it('Alt+2 during a marker drag does not merge the next tune into the drag step', async () => {
    const c = await renderApp();
    const svg = svgOf(c);
    const g = c.querySelectorAll('.datapoints .dp')[0] as Element;
    const shape = g.querySelector('circle, rect') as Element;
    const isCircle = shape.tagName === 'circle';
    const cx = isCircle
      ? Number(shape.getAttribute('cx'))
      : Number(shape.getAttribute('x')) + Number(shape.getAttribute('width')) / 2;
    const cy = isCircle
      ? Number(shape.getAttribute('cy'))
      : Number(shape.getAttribute('y')) + Number(shape.getAttribute('height')) / 2;
    const x = ((cx + 1.18) / 2.36) * SIZE;
    const y = ((cy + 1.18) / 2.36) * SIZE;
    const steps = D().past.length;
    const m = { pointerId: 1, pointerType: 'mouse' };
    fireEvent.pointerDown(svg, { ...m, button: 0, clientX: x, clientY: y });
    fireEvent.pointerMove(svg, { ...m, clientX: x + 20, clientY: y });
    fireEvent.pointerMove(svg, { ...m, clientX: x + 30, clientY: y });
    expect(D().past.length).toBe(steps + 1);
    const dragged = D().design;
    viewKey(2); // the chart unmounts with the mouse still down
    fireEvent.pointerUp(window, { ...m, button: 0 });
    viewKey(1);
    // A slider tune of part 2 afterwards: transient moves, then the slider's commit.
    const el = D().design.elements[1]!;
    D().updateElement(1, { ...el, value: 12e-9 } as never, true);
    D().updateElement(1, { ...el, value: 13e-9 } as never, true);
    D().commit('Tuned Series L 2 to 13 nH');
    expect(D().past.length).toBe(steps + 2);
    D().undo();
    // One Undo takes back the tune only: the dragged load stays.
    expect(D().design.load).toEqual(dragged.load);
  });
});
