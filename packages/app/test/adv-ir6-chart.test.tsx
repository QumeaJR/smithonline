// @vitest-environment jsdom
/**
 * Adversarial, phase 5 chart pointers: a third finger, pointercancel mid-pinch,
 * pointerup without pointerdown, the design changing under a marker drag,
 * placement with a second finger and Escape during press-drag. Each test
 * asserts the correct behaviour; a failure is a defect.
 */
import { act, cleanup, createEvent, fireEvent, render, screen } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyDesign, identify } from '../src/lib/design';
import { useDesignStore } from '../src/store/useDesignStore';
import { useShell } from '../src/store/useShell';

const SIZE = 400;
const realRect = Element.prototype.getBoundingClientRect;
let coarse = false;

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
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    },
  );
});
afterAll(() => {
  Element.prototype.getBoundingClientRect = realRect;
});

function setup(width: number, touch: boolean): void {
  coarse = touch;
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: coarse && query === '(pointer: coarse)',
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
  }));
  vi.stubGlobal('innerWidth', width);
  vi.stubGlobal('innerHeight', 844);
}

beforeEach(() => {
  localStorage.clear();
  useShell.setState({ detent: 'half', held: null, holds: [], guideClosed: true });
  useDesignStore.getState().init({
    ...emptyDesign(),
    load: { re: 20, im: -12 },
    elements: identify([
      { kind: 'C', orientation: 'shunt', value: 4.7e-12 },
      { kind: 'L', orientation: 'series', value: 10e-9 },
      { kind: 'C', orientation: 'series', value: 2.2e-12 },
    ]),
  });
  useDesignStore.getState().setMessage(null);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    },
  );
});

function markerAt(container: HTMLElement, i: number): { x: number; y: number } {
  const g = container.querySelectorAll('.datapoints .dp')[i] as Element;
  const shape = g.querySelector('circle, rect') as Element;
  const cx =
    shape.tagName === 'circle'
      ? Number(shape.getAttribute('cx'))
      : Number(shape.getAttribute('x')) + Number(shape.getAttribute('width')) / 2;
  const cy =
    shape.tagName === 'circle'
      ? Number(shape.getAttribute('cy'))
      : Number(shape.getAttribute('y')) + Number(shape.getAttribute('height')) / 2;
  return { x: ((cx + 1.18) / 2.36) * SIZE, y: ((cy + 1.18) / 2.36) * SIZE };
}
const svgOf = (c: HTMLElement): SVGSVGElement =>
  c.querySelector('svg.smith-chart') as SVGSVGElement;
type Kind = 'mouse' | 'touch';
const press = (el: Element, x: number, y: number, kind: Kind, id = 1): void =>
  void fireEvent.pointerDown(el, {
    pointerId: id,
    pointerType: kind,
    button: 0,
    clientX: x,
    clientY: y,
  });
const move = (el: Element, x: number, y: number, kind: Kind, id = 1): void =>
  void fireEvent.pointerMove(el, { pointerId: id, pointerType: kind, clientX: x, clientY: y });
const lift = (el: Element, x: number, y: number, kind: Kind, id = 1): void =>
  void fireEvent.pointerUp(el, {
    pointerId: id,
    pointerType: kind,
    button: 0,
    clientX: x,
    clientY: y,
  });

/**
 * A tap at a fixed time stamp (as ir6-chart-pointer.test.tsx does): the double-tap window is
 * measured from the event time, so a slow parallel run cannot stretch two taps apart.
 */
function tapAt(el: Element, x: number, y: number, id: number, t: number): void {
  const init = { pointerId: id, pointerType: 'touch', button: 0, clientX: x, clientY: y };
  for (const make of [createEvent.pointerDown, createEvent.pointerUp]) {
    const ev = make(el, init);
    Object.defineProperty(ev, 'timeStamp', { value: t });
    fireEvent(el, ev);
  }
}

async function renderApp(width: number, touch: boolean): Promise<HTMLElement> {
  setup(width, touch);
  const { App } = await import('../src/App');
  return render(<App />).container;
}

describe('multi-touch', () => {
  it('a third finger that lands and lifts does not end the pinch of the other two', async () => {
    const container = await renderApp(390, true);
    const svg = svgOf(container);
    press(svg, 180, 280, 'touch', 1);
    press(svg, 220, 280, 'touch', 2);
    move(svg, 170, 280, 'touch', 1);
    press(svg, 50, 50, 'touch', 3); // a palm or a third finger
    lift(svg, 50, 50, 'touch', 3);
    const before = svg.getAttribute('viewBox');
    move(svg, 120, 280, 'touch', 1);
    move(svg, 280, 280, 'touch', 2);
    expect(svg.getAttribute('viewBox')).not.toBe(before);
    lift(svg, 120, 280, 'touch', 1);
    lift(svg, 280, 280, 'touch', 2);
  });

  it('pointercancel mid-pinch then the finger back: the pinch resumes', async () => {
    const container = await renderApp(390, true);
    const svg = svgOf(container);
    press(svg, 180, 280, 'touch', 1);
    press(svg, 220, 280, 'touch', 2);
    fireEvent.pointerCancel(svg, { pointerId: 2, pointerType: 'touch' });
    press(svg, 220, 280, 'touch', 4);
    const before = svg.getAttribute('viewBox');
    move(svg, 280, 280, 'touch', 4);
    expect(svg.getAttribute('viewBox')).not.toBe(before);
    lift(svg, 180, 280, 'touch', 1);
    lift(svg, 280, 280, 'touch', 4);
  });

  it('pointerup and pointermove without a pointerdown do nothing', async () => {
    const container = await renderApp(390, true);
    const svg = svgOf(container);
    const design = useDesignStore.getState().design;
    const vb = svg.getAttribute('viewBox');
    move(svg, 10, 10, 'touch', 77);
    lift(svg, 10, 10, 'touch', 77);
    fireEvent.pointerCancel(svg, { pointerId: 78, pointerType: 'touch' });
    expect(useDesignStore.getState().design).toBe(design);
    expect(svg.getAttribute('viewBox')).toBe(vb);
    // And a normal tap still works afterwards.
    const at = markerAt(container, 1);
    press(svg, at.x, at.y, 'touch', 2);
    lift(svg, at.x, at.y, 'touch', 2);
    expect(useDesignStore.getState().selected).toBe(1);
  });

  it('a marker drag interrupted by a pinch records exactly one step', async () => {
    const container = await renderApp(390, true);
    const svg = svgOf(container);
    const steps = useDesignStore.getState().past.length;
    const at = markerAt(container, 0);
    press(svg, at.x, at.y, 'touch', 1);
    move(svg, at.x + 20, at.y, 'touch', 1);
    move(svg, at.x + 30, at.y, 'touch', 1);
    press(svg, 300, 300, 'touch', 2);
    const load = useDesignStore.getState().design.load;
    move(svg, at.x + 60, at.y, 'touch', 1);
    lift(svg, at.x + 60, at.y, 'touch', 1);
    lift(svg, 300, 300, 'touch', 2);
    expect(useDesignStore.getState().design.load).toBe(load);
    expect(useDesignStore.getState().past.length).toBe(steps + 1);
  });
});

describe('marker drag: the design changes under it', () => {
  it('Delete of the dragged part mid-drag: further moves do not retune another part', async () => {
    const container = await renderApp(1440, false);
    const svg = svgOf(container);
    const at = markerAt(container, 2); // output of element 1 (series L)
    press(svg, at.x, at.y, 'mouse');
    move(svg, at.x + 10, at.y + 5, 'mouse');
    expect(useDesignStore.getState().selected).toBe(2);
    fireEvent.keyDown(window, { key: 'Delete' });
    const after = useDesignStore.getState().design.elements;
    expect(after.map((e) => e.kind)).toEqual(['C', 'C']);
    const seriesC = JSON.stringify(after[1]);
    move(svg, at.x + 40, at.y + 30, 'mouse');
    move(svg, at.x + 60, at.y + 40, 'mouse');
    lift(svg, at.x + 60, at.y + 40, 'mouse');
    // Correct: the series C 2.2 pF that nobody touched keeps its value.
    expect(JSON.stringify(useDesignStore.getState().design.elements[1])).toBe(seriesC);
  });

  it('removing the last part under a drag of its marker does not throw', async () => {
    const container = await renderApp(1440, false);
    const svg = svgOf(container);
    const at = markerAt(container, 3);
    press(svg, at.x, at.y, 'mouse');
    move(svg, at.x + 10, at.y + 5, 'mouse');
    act(() => useDesignStore.getState().removeElement(2));
    expect(() => {
      move(svg, at.x + 40, at.y + 30, 'mouse');
      lift(svg, at.x + 40, at.y + 30, 'mouse');
    }).not.toThrow();
  });

  it('a drag released far outside the chart keeps a finite load and one step', async () => {
    const container = await renderApp(1440, false);
    const svg = svgOf(container);
    const steps = useDesignStore.getState().past.length;
    const at = markerAt(container, 0);
    press(svg, at.x, at.y, 'mouse');
    move(svg, at.x + 10, at.y, 'mouse');
    move(svg, -5000, 99999, 'mouse');
    lift(svg, -5000, 99999, 'mouse');
    const { load } = useDesignStore.getState().design;
    expect(Number.isFinite(load.re) && Number.isFinite(load.im)).toBe(true);
    expect(load.re).toBeGreaterThanOrEqual(0);
    expect(useDesignStore.getState().past.length).toBe(steps + 1);
  });
});

describe('placement', () => {
  it('a second finger after the press pans and places nothing; the part stays armed', async () => {
    const container = await renderApp(1440, true);
    const svg = svgOf(container);
    fireEvent.click(screen.getByRole('button', { name: /^Series L/ }));
    press(svg, 200, 120, 'touch', 1);
    move(svg, 210, 125, 'touch', 1);
    press(svg, 260, 160, 'touch', 2);
    move(svg, 230, 140, 'touch', 1);
    lift(svg, 230, 140, 'touch', 1);
    lift(svg, 260, 160, 'touch', 2);
    expect(useDesignStore.getState().design.elements.length).toBe(3);
    press(svg, 200, 120, 'touch', 3);
    lift(svg, 200, 120, 'touch', 3);
    expect(useDesignStore.getState().design.elements.length).toBe(4);
  });

  it('Escape during press-drag cancels the arm and the release places nothing', async () => {
    const container = await renderApp(1440, false);
    const svg = svgOf(container);
    fireEvent.click(screen.getByRole('button', { name: /^Series L/ }));
    press(svg, 200, 120, 'mouse');
    move(svg, 220, 130, 'mouse');
    fireEvent.keyDown(window, { key: 'Escape' });
    move(svg, 230, 140, 'mouse');
    lift(svg, 230, 140, 'mouse');
    expect(useDesignStore.getState().design.elements.length).toBe(3);
  });

  it('Cancel on the banner mid-drag: the release places nothing', async () => {
    const container = await renderApp(1440, true);
    const svg = svgOf(container);
    fireEvent.click(screen.getByRole('button', { name: /^Series L/ }));
    press(svg, 200, 120, 'touch', 1);
    move(svg, 220, 130, 'touch', 1);
    const bar = container.querySelector('.chart-mode-bar') as HTMLElement;
    const cancel = [...bar.querySelectorAll('button')].find((b) =>
      /Cancel/.test(b.textContent ?? ''),
    );
    expect(cancel).toBeTruthy();
    fireEvent.click(cancel as HTMLElement);
    lift(svg, 230, 140, 'touch', 1);
    expect(useDesignStore.getState().design.elements.length).toBe(3);
  });
});

describe('double tap', () => {
  it('a tap on marker 1 then on marker 2 within the time is not a double tap', async () => {
    const container = await renderApp(390, true);
    const svg = svgOf(container);
    const a = markerAt(container, 1);
    const b = markerAt(container, 2);
    press(svg, a.x, a.y, 'touch', 1);
    lift(svg, a.x, a.y, 'touch', 1);
    press(svg, b.x, b.y, 'touch', 2);
    lift(svg, b.x, b.y, 'touch', 2);
    expect(screen.queryByRole('dialog', { name: 'Match suggestions' })).toBeNull();
  });

  it('three taps on a marker open the suggestions once, not twice', async () => {
    const container = await renderApp(390, true);
    const svg = svgOf(container);
    const a = markerAt(container, 2);
    for (let id = 1; id <= 3; id++) tapAt(svg, a.x, a.y, id, 1000 + id * 100);
    expect(screen.queryAllByRole('dialog', { name: 'Match suggestions' }).length).toBe(1);
  });

  it('a long press with sub-pixel jitter still opens the menu', async () => {
    const container = await renderApp(390, true);
    const svg = svgOf(container);
    press(svg, 200, 120, 'touch');
    for (let i = 0; i < 30; i++) move(svg, 200 + (i % 2) * 0.4, 120 + (i % 3) * 0.3, 'touch');
    await act(() => new Promise((r) => setTimeout(r, 450)));
    lift(svg, 200.4, 120.3, 'touch');
    expect(screen.queryAllByRole('menuitem').length).toBeGreaterThan(0);
  });
});
