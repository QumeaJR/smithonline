// @vitest-environment jsdom
/**
 * Redesign phase 5: the chart's pointer handling in the App (docs/07 section
 * 6). A marker press without movement records no undo step and a drag one; a
 * long press opens the context menu with the marker pulsing; a double tap on
 * empty chart does nothing while one on a marker asks for suggestions; a
 * plain tap with an armed part places it at once; two fingers pinch about
 * their midpoint; the empty chart's context sheet starts with "Suggest a match
 * to here", and the context menu title names the pressed point.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyDesign, identify } from '../src/lib/design';
import { useDesignStore } from '../src/store/useDesignStore';
import { useShell } from '../src/store/useShell';

const SIZE = 400;
const realRect = Element.prototype.getBoundingClientRect;
let coarse = false;

beforeAll(() => {
  // The chart draws at 400 x 400 px from the top left corner of the page.
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

/** The screen point of chain marker `i` on the 400 px chart at the home view. */
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

const svgOf = (container: HTMLElement): SVGSVGElement =>
  container.querySelector('svg.smith-chart') as SVGSVGElement;

type Kind = 'mouse' | 'touch';
function press(el: Element, x: number, y: number, kind: Kind, id = 1): void {
  fireEvent.pointerDown(el, {
    pointerId: id,
    pointerType: kind,
    button: 0,
    clientX: x,
    clientY: y,
  });
}
function move(el: Element, x: number, y: number, kind: Kind, id = 1): void {
  fireEvent.pointerMove(el, { pointerId: id, pointerType: kind, clientX: x, clientY: y });
}
function lift(el: Element, x: number, y: number, kind: Kind, id = 1): void {
  fireEvent.pointerUp(el, { pointerId: id, pointerType: kind, button: 0, clientX: x, clientY: y });
}

async function renderApp(width: number, touch: boolean): Promise<HTMLElement> {
  setup(width, touch);
  const { App } = await import('../src/App');
  const { container } = render(<App />);
  return container;
}

describe('marker drag', () => {
  it('a press without movement selects the point and records no step', async () => {
    const container = await renderApp(1440, false);
    const svg = svgOf(container);
    const steps = useDesignStore.getState().past.length;
    const design = useDesignStore.getState().design;
    const at = markerAt(container, 2);
    press(svg, at.x + 2, at.y + 1, 'mouse');
    lift(svg, at.x + 2, at.y + 1, 'mouse');
    expect(useDesignStore.getState().selected).toBe(2);
    expect(useDesignStore.getState().past.length).toBe(steps);
    expect(useDesignStore.getState().design).toBe(design);
  });

  it('a drag records one step however many moves it makes', async () => {
    const container = await renderApp(1440, false);
    const svg = svgOf(container);
    const steps = useDesignStore.getState().past.length;
    const before = JSON.stringify(useDesignStore.getState().design.elements[1]);
    const at = markerAt(container, 2);
    press(svg, at.x, at.y, 'mouse');
    for (let i = 1; i <= 6; i++) move(svg, at.x + i * 4, at.y + i * 3, 'mouse');
    lift(svg, at.x + 24, at.y + 18, 'mouse');
    expect(useDesignStore.getState().past.length).toBe(steps + 1);
    expect(JSON.stringify(useDesignStore.getState().design.elements[1])).not.toBe(before);
  });

  it('a touch picks the nearest centre within 22 px, and the finger keeps its offset', async () => {
    const container = await renderApp(390, true);
    const svg = svgOf(container);
    const at = markerAt(container, 0);
    // 15 px off the load marker: inside its halo, outside its drawn square.
    press(svg, at.x + 15, at.y, 'touch');
    expect(useDesignStore.getState().selected).toBe(0);
    // The readout band names the picked point the instant the finger lands.
    expect(container.querySelector('.readout-band')?.textContent).toMatch(/^DP1/);
    // A small move within the slop does not move the load.
    const load = useDesignStore.getState().design.load;
    move(svg, at.x + 20, at.y, 'touch');
    expect(useDesignStore.getState().design.load).toBe(load);
    lift(svg, at.x + 20, at.y, 'touch');
    expect(container.querySelector('.readout-band')).toBeNull();
  });
});

describe('long press, double tap and the context sheet', () => {
  it('a long press on a marker opens the context menu titled with the point; it pulses', async () => {
    const container = await renderApp(390, true);
    const svg = svgOf(container);
    const at = markerAt(container, 2);
    press(svg, at.x, at.y, 'touch');
    await act(() => new Promise((r) => setTimeout(r, 450)));
    const sheet = screen.getByRole('dialog');
    const z = useDesignStore.getState().design;
    expect(sheet.textContent).toContain('TP3, ');
    expect(z.elements.length).toBe(2);
    expect(container.querySelectorAll('.datapoints .dp')[2]?.classList.contains('pulse')).toBe(
      true,
    );
    lift(svg, at.x, at.y, 'touch');
    // The release after the long press neither drags nor deselects.
    expect(useDesignStore.getState().selected).toBe(2);
  });

  it('a long press on empty chart offers "Suggest a match to here" first', async () => {
    const container = await renderApp(390, true);
    const svg = svgOf(container);
    press(svg, 200, 120, 'touch');
    await act(() => new Promise((r) => setTimeout(r, 450)));
    lift(svg, 200, 120, 'touch');
    const items = screen.getAllByRole('menuitem');
    expect(items[0]?.textContent).toMatch(/^Suggest a match to here/);
    fireEvent.click(items[0] as HTMLElement);
    expect(screen.getByRole('dialog', { name: 'Match suggestions' })).toBeTruthy();
  });

  it('movement beyond 10 px cancels the long press', async () => {
    const container = await renderApp(390, true);
    const svg = svgOf(container);
    press(svg, 200, 120, 'touch');
    move(svg, 212, 120, 'touch');
    await act(() => new Promise((r) => setTimeout(r, 450)));
    lift(svg, 212, 120, 'touch');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('a double tap on empty chart does nothing; on a marker it opens suggestions', async () => {
    const container = await renderApp(390, true);
    const svg = svgOf(container);
    press(svg, 200, 120, 'touch', 1);
    lift(svg, 200, 120, 'touch', 1);
    press(svg, 200, 120, 'touch', 2);
    lift(svg, 200, 120, 'touch', 2);
    expect(screen.queryByRole('dialog')).toBeNull();
    const at = markerAt(container, 2);
    press(svg, at.x, at.y, 'touch', 3);
    lift(svg, at.x, at.y, 'touch', 3);
    press(svg, at.x + 2, at.y, 'touch', 4);
    lift(svg, at.x + 2, at.y, 'touch', 4);
    expect(screen.getByRole('dialog', { name: 'Match suggestions' })).toBeTruthy();
  });

  it('the touch screen has no browser context menu or double-click of its own', async () => {
    const container = await renderApp(390, true);
    const svg = svgOf(container);
    press(svg, 200, 120, 'touch');
    lift(svg, 200, 120, 'touch');
    fireEvent.contextMenu(svg, { clientX: 200, clientY: 120 });
    fireEvent.doubleClick(svg, { clientX: 200, clientY: 120 });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('placing an armed part', () => {
  it('a plain tap places at once, with no timer', async () => {
    const container = await renderApp(1440, true);
    const svg = svgOf(container);
    fireEvent.click(screen.getByRole('button', { name: /^Series L/ }));
    expect(useDesignStore.getState().design.elements.length).toBe(2);
    press(svg, 260, 150, 'touch');
    lift(svg, 260, 150, 'touch');
    expect(useDesignStore.getState().design.elements.length).toBe(3);
    expect(useDesignStore.getState().message).toMatch(/^Added Series L 3/);
  });

  it('press, drag to aim and release places where it was let go; two fingers still pan', async () => {
    const container = await renderApp(1440, true);
    const svg = svgOf(container);
    // Phase 5 QA: a series L cannot reach the release point (its reactance lies below TP3's)
    // and is refused there now; a series C can.
    fireEvent.click(screen.getByRole('button', { name: /^Series C/ }));
    const before = svg.getAttribute('viewBox');
    // Two fingers: a pan, no placement.
    press(svg, 150, 150, 'touch', 1);
    press(svg, 250, 150, 'touch', 2);
    move(svg, 170, 170, 'touch', 1);
    move(svg, 270, 170, 'touch', 2);
    lift(svg, 170, 170, 'touch', 1);
    lift(svg, 270, 170, 'touch', 2);
    expect(svg.getAttribute('viewBox')).not.toBe(before);
    expect(useDesignStore.getState().design.elements.length).toBe(2);
    // One finger aims and places.
    press(svg, 200, 120, 'touch', 3);
    move(svg, 230, 130, 'touch', 3);
    lift(svg, 240, 140, 'touch', 3);
    expect(useDesignStore.getState().design.elements.length).toBe(3);
  });
});

describe('pinch', () => {
  it('zooms about the midpoint of the fingers', async () => {
    const container = await renderApp(390, true);
    const svg = svgOf(container);
    const view = (): number[] => (svg.getAttribute('viewBox') ?? '').split(' ').map(Number);
    const under = (x: number, y: number): [number, number] => {
      const [vx, vy, w] = view() as [number, number, number];
      return [vx + (x * w) / SIZE, vy + (y * w) / SIZE];
    };
    const before = under(200, 280);
    press(svg, 180, 280, 'touch', 1);
    press(svg, 220, 280, 'touch', 2);
    move(svg, 160, 280, 'touch', 1);
    move(svg, 240, 280, 'touch', 2);
    expect(view()[2]).toBeCloseTo(2.36 / 2, 9);
    const after = under(200, 280);
    expect(after[0]).toBeCloseTo(before[0], 9);
    expect(after[1]).toBeCloseTo(before[1], 9);
    lift(svg, 160, 280, 'touch', 1);
    lift(svg, 240, 280, 'touch', 2);
  });

  it('a second finger cancels the long press', async () => {
    const container = await renderApp(390, true);
    const svg = svgOf(container);
    press(svg, 200, 120, 'touch', 1);
    press(svg, 240, 120, 'touch', 2);
    await act(() => new Promise((r) => setTimeout(r, 450)));
    lift(svg, 200, 120, 'touch', 1);
    lift(svg, 240, 120, 'touch', 2);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
