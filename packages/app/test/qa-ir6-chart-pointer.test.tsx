// @vitest-environment jsdom
/**
 * QA, redesign phase 5: the chart's pointer state machine in the App beyond
 * the ir6 tests (docs/07 section 6, user guide section 3). A mouse never long
 * presses; a cancelled pointer opens nothing; a fired long press holds the
 * chart; a long press in the margin; a third finger during a pinch; the pick
 * at the zoom limits 0.05 and 4; the double-tap window at 300 ms and 24 px on
 * the screen; the context menu title and the chooser row for crowded points;
 * an armed part released outside the disc or cancelled.
 *
 * Design: load 20 - j12 ohm, shunt C 4.7 pF, series L 10 nH at 1 GHz, Z0 50.
 * By hand: Y(load) = (20 + j12) / 544 = 0.036765 + j0.022059 S; the shunt C adds
 * j * 2 pi 1e9 * 4.7e-12 = j0.029531 S, so Y1 = 0.036765 + j0.051590 S and
 * TP2 = 1 / Y1 = 9.161 - j12.855 ohm; the series L adds j62.832 ohm, so
 * TP3 = 9.161 + j49.977 ohm, shown with one decimal as "9.2 + j50.0".
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
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
  vi.stubGlobal('innerHeight', 844);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    },
  );
}

function initDesign(lValue = 10e-9): void {
  useDesignStore.getState().init({
    ...emptyDesign(),
    load: { re: 20, im: -12 },
    elements: identify([
      { kind: 'C', orientation: 'shunt', value: 4.7e-12 },
      { kind: 'L', orientation: 'series', value: lValue },
    ]),
  });
  useDesignStore.getState().setMessage(null);
}

beforeEach(() => {
  localStorage.clear();
  useShell.setState({ detent: 'half', held: null, holds: [], guideClosed: true });
  initDesign();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function renderApp(width: number, touch: boolean): Promise<HTMLElement> {
  stubs(width, touch);
  const { App } = await import('../src/App');
  return render(<App />).container;
}

const svgOf = (c: HTMLElement): SVGSVGElement =>
  c.querySelector('svg.smith-chart') as SVGSVGElement;
const viewBox = (svg: SVGSVGElement): number[] =>
  (svg.getAttribute('viewBox') ?? '').split(' ').map(Number);

/** The centre of chain marker `i` in chart units, read from its drawn shape. */
function markerChart(c: HTMLElement, i: number): { x: number; y: number } {
  const shape = c.querySelectorAll('.datapoints .dp')[i]?.querySelector('circle, rect') as Element;
  if (shape.tagName === 'circle') {
    return { x: Number(shape.getAttribute('cx')), y: Number(shape.getAttribute('cy')) };
  }
  return {
    x: Number(shape.getAttribute('x')) + Number(shape.getAttribute('width')) / 2,
    y: Number(shape.getAttribute('y')) + Number(shape.getAttribute('height')) / 2,
  };
}
/** Its screen point at the current view of the 400 px chart. */
function markerScreen(c: HTMLElement, i: number): { x: number; y: number } {
  const [vx, vy, w] = viewBox(svgOf(c)) as [number, number, number];
  const m = markerChart(c, i);
  return { x: ((m.x - vx) / w) * SIZE, y: ((m.y - vy) / w) * SIZE };
}

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
const cancel = (el: Element, kind: Kind, id = 1): void =>
  void fireEvent.pointerCancel(el, { pointerId: id, pointerType: kind });
const wait = (ms: number): Promise<void> => act(() => new Promise<void>((r) => setTimeout(r, ms)));

describe('long press state machine in the chart', () => {
  it('a mouse held still for 450 ms opens no menu', async () => {
    const c = await renderApp(1440, false);
    const svg = svgOf(c);
    press(svg, 200, 120, 'mouse');
    await wait(450);
    lift(svg, 200, 120, 'mouse');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('a pointercancel while the press is pending opens nothing and keeps the selection', async () => {
    const c = await renderApp(390, true);
    const svg = svgOf(c);
    const at = markerScreen(c, 1);
    press(svg, at.x, at.y, 'touch');
    expect(useDesignStore.getState().selected).toBe(1);
    cancel(svg, 'touch');
    await wait(450);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(useDesignStore.getState().selected).toBe(1);
  });

  it('after the long press fired on a marker, moving the finger drags nothing and pans nothing', async () => {
    const c = await renderApp(390, true);
    const svg = svgOf(c);
    const at = markerScreen(c, 2);
    const design = useDesignStore.getState().design;
    const steps = useDesignStore.getState().past.length;
    const before = svg.getAttribute('viewBox');
    press(svg, at.x, at.y, 'touch');
    await wait(450);
    move(svg, at.x + 60, at.y + 40, 'touch');
    lift(svg, at.x + 60, at.y + 40, 'touch');
    expect(useDesignStore.getState().design).toBe(design);
    expect(useDesignStore.getState().past.length).toBe(steps);
    expect(svg.getAttribute('viewBox')).toBe(before);
  });

  it('a long press in the margin outside the disc opens nothing and leaves the finger free to pan', async () => {
    const c = await renderApp(390, true);
    const svg = svgOf(c);
    // (8, 8) px is chart (-1.1328, -1.1328), |Gamma| = 1.60: outside the disc.
    press(svg, 8, 8, 'touch');
    await wait(450);
    expect(screen.queryByRole('dialog')).toBeNull();
    const before = viewBox(svg);
    move(svg, 108, 8, 'touch');
    // A 100 px pan at 2.36 / 400 units per px moves the view 0.59 units to the left.
    expect(viewBox(svg)[0]).toBeCloseTo((before[0] as number) - 0.59, 6);
    lift(svg, 108, 8, 'touch');
  });
});

describe('pinch with more fingers', () => {
  it('a third finger that lifts does not end the pinch of the other two', async () => {
    const c = await renderApp(390, true);
    const svg = svgOf(c);
    press(svg, 180, 280, 'touch', 1);
    press(svg, 220, 280, 'touch', 2);
    press(svg, 300, 100, 'touch', 3);
    lift(svg, 300, 100, 'touch', 3);
    // The two fingers spread from 40 to 80 px: the view halves, 2.36 -> 1.18 wide.
    move(svg, 160, 280, 'touch', 1);
    move(svg, 240, 280, 'touch', 2);
    expect(viewBox(svg)[2]).toBeCloseTo(1.18, 9);
    lift(svg, 160, 280, 'touch', 1);
    lift(svg, 240, 280, 'touch', 2);
  });

  it('the finger left after a pinch does nothing; a new finger after both lifted pans', async () => {
    const c = await renderApp(390, true);
    const svg = svgOf(c);
    press(svg, 180, 280, 'touch', 1);
    press(svg, 220, 280, 'touch', 2);
    lift(svg, 220, 280, 'touch', 2);
    const held = svg.getAttribute('viewBox');
    move(svg, 100, 200, 'touch', 1);
    expect(svg.getAttribute('viewBox')).toBe(held);
    lift(svg, 100, 200, 'touch', 1);
    press(svg, 200, 300, 'touch', 3);
    move(svg, 240, 300, 'touch', 3);
    expect(svg.getAttribute('viewBox')).not.toBe(held);
    lift(svg, 240, 300, 'touch', 3);
  });
});

describe('pick at the zoom limits', () => {
  /** Zoom with the wheel about marker `i` until the limit. */
  function wheelTo(c: HTMLElement, i: number, deltaY: number): void {
    const at = markerScreen(c, i);
    fireEvent.wheel(svgOf(c), { deltaY, clientX: at.x, clientY: at.y });
  }

  it('deep zoom (half 0.05): the mouse halo is still 10 px on the screen', async () => {
    const c = await renderApp(1440, false);
    const svg = svgOf(c);
    wheelTo(c, 2, -5000);
    expect(viewBox(svg)[2]).toBeCloseTo(0.1, 12);
    useDesignStore.getState().select(null);
    let at = markerScreen(c, 2);
    press(svg, at.x, at.y - 9, 'mouse');
    lift(svg, at.x, at.y - 9, 'mouse');
    expect(useDesignStore.getState().selected).toBe(2);
    useDesignStore.getState().select(null);
    at = markerScreen(c, 2);
    press(svg, at.x, at.y - 11, 'mouse');
    lift(svg, at.x, at.y - 11, 'mouse');
    expect(useDesignStore.getState().selected).toBeNull();
  });

  it('far out (half 4): the touch halo is still 22 px on the screen', async () => {
    const c = await renderApp(390, true);
    const svg = svgOf(c);
    wheelTo(c, 2, 5000);
    expect(viewBox(svg)[2]).toBeCloseTo(8, 12);
    useDesignStore.getState().select(null);
    let at = markerScreen(c, 2);
    press(svg, at.x, at.y - 21, 'touch', 1);
    lift(svg, at.x, at.y - 21, 'touch', 1);
    expect(useDesignStore.getState().selected).toBe(2);
    useDesignStore.getState().select(null);
    at = markerScreen(c, 2);
    press(svg, at.x, at.y - 23, 'touch', 2);
    lift(svg, at.x, at.y - 23, 'touch', 2);
    expect(useDesignStore.getState().selected).toBeNull();
  });
});

describe('double tap window on the screen', () => {
  /** Two taps on marker 2, `dt` ms and `dx` px apart. */
  async function twoTaps(dt: number, dx: number): Promise<boolean> {
    const c = await renderApp(390, true);
    const svg = svgOf(c);
    const at = markerScreen(c, 2);
    const now = vi.spyOn(Date, 'now');
    now.mockReturnValue(100_000);
    press(svg, at.x - 12, at.y, 'touch', 1);
    lift(svg, at.x - 12, at.y, 'touch', 1);
    now.mockReturnValue(100_000 + dt);
    press(svg, at.x - 12 + dx, at.y, 'touch', 2);
    lift(svg, at.x - 12 + dx, at.y, 'touch', 2);
    now.mockRestore();
    return screen.queryByRole('dialog', { name: 'Match suggestions' }) !== null;
  }

  it('300 ms apart opens suggestions', async () => {
    expect(await twoTaps(300, 0)).toBe(true);
  });
  it('301 ms apart does not', async () => {
    expect(await twoTaps(301, 0)).toBe(false);
  });
  it('24 px apart (both inside the halo) opens suggestions', async () => {
    expect(await twoTaps(100, 24)).toBe(true);
  });
  it('25 px apart does not', async () => {
    expect(await twoTaps(100, 25)).toBe(false);
  });
});

describe('context menu title and the chooser row', () => {
  it('a long press on TP3 titles the sheet with TP3 and its own impedance, 9.2 + j50.0 ohm', async () => {
    const c = await renderApp(390, true);
    const svg = svgOf(c);
    const at = markerScreen(c, 2);
    press(svg, at.x, at.y, 'touch');
    await wait(450);
    lift(svg, at.x, at.y, 'touch');
    const sheet = screen.getByRole('dialog');
    expect(sheet.textContent).toContain('TP3, 9.2 + j50.0 Ω');
    expect(sheet.textContent).toContain('Remove TP3: Series L');
  });

  it('a long press on DP1 titles the sheet with the load, 20.0 - j12.0 ohm (the point 0 branch)', async () => {
    const c = await renderApp(390, true);
    const svg = svgOf(c);
    const at = markerScreen(c, 0);
    press(svg, at.x, at.y, 'touch');
    await wait(450);
    lift(svg, at.x, at.y, 'touch');
    expect(screen.getByRole('dialog').textContent).toContain('DP1, 20.0 - j12.0 Ω');
  });

  it('two points on one spot get a chooser row that moves the menu to the other', async () => {
    // A 1 fH series L adds j6.3e-6 ohm: TP3 lies on TP2 (9.161 - j12.855 ohm).
    initDesign(1e-15);
    useDesignStore.setState({ selected: null });
    const c = await renderApp(390, true);
    const svg = svgOf(c);
    const at = markerScreen(c, 1);
    press(svg, at.x, at.y, 'touch');
    await wait(450);
    lift(svg, at.x, at.y, 'touch');
    const first = screen.getAllByRole('menuitem').map((m) => m.textContent ?? '');
    const picked = useDesignStore.getState().selected;
    const other = picked === 1 ? 'TP3' : 'TP2';
    expect(first.some((t) => t.startsWith(`${other} instead`))).toBe(true);
    fireEvent.click(
      screen
        .getAllByRole('menuitem')
        .find((m) => m.textContent?.startsWith(`${other} instead`)) as HTMLElement,
    );
    const sheet = screen.getByRole('dialog');
    expect(sheet.textContent).toContain(`${other}, 9.2 - j12.9 Ω`);
    const back = picked === 1 ? 'TP2' : 'TP3';
    expect(
      screen.getAllByRole('menuitem').some((m) => m.textContent?.startsWith(`${back} instead`)),
    ).toBe(true);
  });
});

describe('placing an armed part: releases that do not place', () => {
  it('released outside the disc, or cancelled by the browser, places nothing', async () => {
    const c = await renderApp(1440, true);
    const svg = svgOf(c);
    // Corrected in the phase 5 QA fixes: (200, 120) is Z = 31.8 + j38.6 ohm, below the
    // reactance of TP3 (9.2 + j50.0 ohm), which a series L cannot reach (it is refused now);
    // a series C can, so it is the part armed.
    fireEvent.click(screen.getByRole('button', { name: /^Series C/ }));
    press(svg, 8, 8, 'touch', 1);
    lift(svg, 8, 8, 'touch', 1);
    expect(useDesignStore.getState().design.elements.length).toBe(2);
    press(svg, 200, 120, 'touch', 2);
    move(svg, 210, 125, 'touch', 2);
    cancel(svg, 'touch', 2);
    expect(useDesignStore.getState().design.elements.length).toBe(2);
    // The part stays armed: a tap now places it.
    press(svg, 200, 120, 'touch', 3);
    lift(svg, 200, 120, 'touch', 3);
    expect(useDesignStore.getState().design.elements.length).toBe(3);
  });
});

describe('readout on a touch tablet (guide section 3, Readout row)', () => {
  it('a finger down on a 1000 px touch tablet shows the readout in the status bar, with no band', async () => {
    const c = await renderApp(1000, true);
    const svg = svgOf(c);
    press(svg, 200, 200, 'touch');
    expect(c.querySelector('.readout-band')).toBeNull();
    const status = c.querySelector('footer.statusbar') as HTMLElement;
    expect(status.classList.contains('live')).toBe(true);
    // The centre of the chart is z = 1: Z = 50 ohm.
    expect(status.textContent).toContain('Z = 50.0 + j0.0 Ω');
    lift(svg, 200, 200, 'touch');
  });
});
