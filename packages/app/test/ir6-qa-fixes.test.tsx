// @vitest-environment jsdom
/**
 * Redesign phase 5 QA fixes (docs/07 sections 4 to 6): placement refused where the armed
 * part cannot reach, the touch readout of the plots, the ladder drag's auto-scroll and
 * placeholder arithmetic, the start guide tracked by design identity, drags and reorders
 * named for Undo, the readout of a dragged point, the desktop context popover's title and
 * chooser row, and the Tolerance limit as typed.
 *
 * Design: load 20 - j12 ohm, shunt C 4.7 pF, series L 10 nH at 1 GHz, Z0 50; by hand
 * TP2 = 9.161 - j12.855 ohm and TP3 = 9.161 + j49.977 ohm (qa-ir6-chart-pointer).
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Element as Part } from '@smithonline/core';
import { emptyDesign, identify } from '../src/lib/design';
import { fmtSig } from '../src/lib/format';
import { autoScrollSpeed, AUTO_SCROLL_MAX, placeholderShift } from '../src/lib/ladderDrag';
import { placement, PLACE_MIN } from '../src/lib/placement';
import { cursorAt, scrubIntent } from '../src/lib/plotTouch';
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
  vi.unstubAllGlobals();
});

async function renderApp(width: number, touch: boolean): Promise<HTMLElement> {
  stubs(width, touch);
  const { App } = await import('../src/App');
  return render(<App />).container;
}
const svgOf = (c: HTMLElement): SVGSVGElement =>
  c.querySelector('svg.smith-chart') as SVGSVGElement;
/** The screen point of chain marker `i` at the Fit view of the 400 px chart. */
function markerAt(c: HTMLElement, i: number): { x: number; y: number } {
  const shape = c.querySelectorAll('.datapoints .dp')[i]?.querySelector('circle, rect') as Element;
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
const mouse = (x: number, y: number) => ({
  pointerId: 1,
  pointerType: 'mouse',
  button: 0,
  clientX: x,
  clientY: y,
});

describe('placement where the armed part can reach', () => {
  const seriesL: Part = { kind: 'L', orientation: 'series', value: 1e-9 };
  const shuntC: Part = { kind: 'C', orientation: 'shunt', value: 1e-12 };
  const f = 1e9;

  it('a series L from the axis reaches above it; below it is refused with "aim above the axis"', () => {
    const up = placement(seriesL, { re: 50, im: 0 }, { re: 50, im: 62.83 }, f);
    expect(up.kind).toBe('ok');
    // X = w L: 62.83 ohm at 1 GHz is 10 nH.
    expect(up.kind === 'ok' && 'value' in up.element ? up.element.value : 0).toBeCloseTo(10e-9, 12);
    expect(placement(seriesL, { re: 50, im: 0 }, { re: 50, im: -10 }, f)).toEqual({
      kind: 'unreachable',
      hint: 'aim above the axis',
    });
  });

  it('a value below 1e-15 is refused (no near-zero part), as is no positive solution', () => {
    // 1e-9 ohm of reactance at 1 GHz is 1.6e-19 H.
    const tiny = placement(seriesL, { re: 50, im: 0 }, { re: 50, im: 1e-9 }, f);
    expect(tiny.kind).toBe('unreachable');
    expect(PLACE_MIN).toBe(1e-15);
    // A shunt C only adds susceptance: from 50 ohm it goes below the axis, not above.
    expect(placement(shuntC, { re: 50, im: 0 }, { re: 40, im: 20 }, f)).toEqual({
      kind: 'unreachable',
      hint: 'aim below the axis',
    });
  });

  it('in the app: the ghost is a dashed red marker, the release adds nothing and says why', async () => {
    const c = await renderApp(1440, false);
    const svg = svgOf(c);
    fireEvent.click(screen.getByRole('button', { name: /^Series L/ }));
    // The chart centre (50 ohm) lies below the reactance of TP3: a series L cannot go there.
    fireEvent.pointerMove(svg, { pointerId: 1, pointerType: 'mouse', clientX: 200, clientY: 200 });
    expect(c.querySelector('.ghost circle.marker.unreachable')).not.toBeNull();
    fireEvent.pointerDown(svg, mouse(200, 200));
    fireEvent.pointerUp(svg, mouse(200, 200));
    expect(useDesignStore.getState().design.elements).toHaveLength(2);
    expect(useDesignStore.getState().message).toBe(
      'Series L cannot reach that point; aim along the dashed line',
    );
    // Still armed: a reachable point places it.
    expect(c.querySelector('.chart-mode-bar')).not.toBeNull();
  });
});

describe('the touch readout of the plots', () => {
  it('the first movement decides: sideways scrubs, up or down scrolls, within 6 px nothing', () => {
    expect(scrubIntent(3, 2)).toBeNull();
    expect(scrubIntent(8, 3)).toBe('scrub');
    expect(scrubIntent(3, 8)).toBe('scroll');
    expect(scrubIntent(-8, 7.9)).toBe('scrub');
    expect(scrubIntent(Number.NaN, 20)).toBeNull();
  });

  it('the cursor stays inside the plotting area', () => {
    const area = { left: 10, top: 20, width: 300, height: 100 };
    expect(cursorAt(area, 60, 70)).toEqual({ left: 50, top: 50 });
    expect(cursorAt(area, -50, 500)).toEqual({ left: 0, top: 100 });
  });
});

describe('ladder drag arithmetic', () => {
  const panel = { left: 0, top: 100, right: 300, bottom: 500 };
  it('auto-scroll within 32 px of an edge, in proportion to the depth, none elsewhere', () => {
    expect(autoScrollSpeed(panel, 100, 300)).toBe(0);
    expect(autoScrollSpeed(panel, 100, 100)).toBe(-AUTO_SCROLL_MAX);
    expect(autoScrollSpeed(panel, 100, 116)).toBeCloseTo(-AUTO_SCROLL_MAX / 2, 12);
    expect(autoScrollSpeed(panel, 100, 484)).toBeCloseTo(AUTO_SCROLL_MAX / 2, 12);
    // Outside the panel the card is out of the list: no scroll.
    expect(autoScrollSpeed(panel, 100, 520)).toBe(0);
    expect(autoScrollSpeed(panel, 400, 110)).toBe(0);
  });

  it('the placeholder moves to the slot the card lands in', () => {
    const cards = [0, 1, 2, 3].map((i) => ({ top: i * 110, height: 100 }));
    expect(placeholderShift(cards, 0, 2)).toBe(220);
    expect(placeholderShift(cards, 3, 1)).toBe(-220);
    expect(placeholderShift(cards, 1, 1)).toBe(0);
  });
});

describe('the start guide follows the design created by New', () => {
  it('New then Undo hides it, Redo brings it back, an edit after New keeps it', () => {
    const store = useDesignStore.getState();
    expect(store.fresh).toBe(false); // a design with parts, opened
    store.newDesign();
    expect(useDesignStore.getState().fresh).toBe(true);
    useDesignStore.getState().setLoad({ re: 30, im: 5 });
    expect(useDesignStore.getState().fresh).toBe(true);
    useDesignStore.getState().undo();
    useDesignStore.getState().undo();
    expect(useDesignStore.getState().fresh).toBe(false);
    useDesignStore.getState().redo();
    expect(useDesignStore.getState().fresh).toBe(true);
  });
});

describe('drags and reorders are named for Undo', () => {
  it('a reorder says which part moved where, and Undo repeats it', () => {
    useDesignStore.getState().reorderElement(0, 1);
    expect(useDesignStore.getState().message).toBe('Moved Shunt C 1 to position 2');
    useDesignStore.getState().undo();
    expect(useDesignStore.getState().message).toBe('Undo: Moved Shunt C 1 to position 2');
  });

  it('a marker drag: the status bar names the point with its own impedance; the step is named', async () => {
    const c = await renderApp(1440, false);
    const svg = svgOf(c);
    const at = markerAt(c, 2); // TP3, the series L's node
    fireEvent.pointerDown(svg, mouse(at.x, at.y));
    fireEvent.pointerMove(svg, mouse(at.x, at.y - 20));
    fireEvent.pointerMove(svg, mouse(at.x + 30, at.y - 40));
    const status = c.querySelector('footer.statusbar .status-hover') as HTMLElement;
    expect(status.textContent).toMatch(/^TP3: z = /);
    // The point stays on its constant-R locus: its resistance is TP2's, 9.2 ohm.
    expect(status.textContent).toContain('Z = 9.2 + j');
    fireEvent.pointerUp(svg, mouse(at.x + 30, at.y - 40));
    expect(useDesignStore.getState().message).toMatch(/^Moved TP3: Series L 2 to \d/);
    useDesignStore.getState().undo();
    expect(useDesignStore.getState().message).toMatch(/^Undo: Moved TP3: Series L 2 to /);
  });

  it('a press on a marker without movement names nothing and records no step', async () => {
    const c = await renderApp(1440, false);
    const svg = svgOf(c);
    const at = markerAt(c, 1);
    fireEvent.pointerDown(svg, mouse(at.x, at.y));
    fireEvent.pointerUp(svg, mouse(at.x, at.y));
    expect(useDesignStore.getState().past).toHaveLength(0);
    expect(useDesignStore.getState().message).toBeNull();
  });
});

describe('the desktop context popover', () => {
  it('has a title row; the chooser row reads for a mouse and keeps the focus in the menu', async () => {
    // A 1 fH series L puts TP3 on TP2.
    initDesign(1e-15);
    useDesignStore.setState({ selected: 1 });
    const c = await renderApp(1440, false);
    const svg = svgOf(c);
    const at = markerAt(c, 1);
    fireEvent.contextMenu(svg, { clientX: at.x, clientY: at.y });
    const title = document.querySelector('.dropdown.context .dropdown-title') as HTMLElement;
    expect(title.textContent).toBe('TP2, 9.2 - j12.9 Ω');
    const chooser = screen
      .getAllByRole('menuitem')
      .find((m) => m.textContent?.startsWith('TP3 instead')) as HTMLElement;
    expect(chooser.textContent).toContain('Another point close to this one');
    fireEvent.click(chooser);
    expect(
      (document.querySelector('.dropdown.context .dropdown-title') as HTMLElement).textContent,
    ).toBe('TP3, 9.2 - j12.9 Ω');
    const first = screen.getAllByRole('menuitem')[0] as HTMLElement;
    expect(first.textContent).toMatch(/^TP2 instead/);
    expect(document.activeElement).toBe(first);
  });
});

describe('the Tolerance limit as typed', () => {
  it('four significant digits at most, no trailing zeros', () => {
    expect(fmtSig(2)).toBe('2');
    expect(fmtSig(1.255)).toBe('1.255');
    expect(fmtSig(1.23456)).toBe('1.235');
    expect(fmtSig(Infinity)).toBe('∞');
  });
});
