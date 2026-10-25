// @vitest-environment jsdom
/**
 * Redesign phase 5: the ladder reorders by pointer events on a card's grip
 * (HTML5 drag never fires on iOS), and a card dragged out of the list and
 * released there removes its part with an Undo message naming it; released
 * back inside it cancels (docs/07 section 4, Ladder card; section 8 item 11).
 */
import { act, cleanup, fireEvent, render, within } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyDesign, identify } from '../src/lib/design';
import { useDesignStore } from '../src/store/useDesignStore';
import { useShell } from '../src/store/useShell';

const realRect = Element.prototype.getBoundingClientRect;
const rect = (left: number, top: number, width: number, height: number): DOMRect =>
  ({
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON: () => ({}),
  }) as DOMRect;

beforeAll(() => {
  // The ladder is 300 px wide from the top of the page to 1000 px; its element cards are
  // 100 px tall with a 10 px gap, the first at 300 px.
  Element.prototype.getBoundingClientRect = function (this: Element): DOMRect {
    if (this instanceof HTMLElement && this.classList.contains('ladder')) {
      return rect(0, 0, 300, 1000);
    }
    const i = this instanceof HTMLElement ? this.dataset.elementIndex : undefined;
    if (i !== undefined) return rect(0, 300 + Number(i) * 110, 300, 100);
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

function setup(touch: boolean): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: touch && query === '(pointer: coarse)',
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
  }));
  vi.stubGlobal('innerWidth', 1440);
  vi.stubGlobal('innerHeight', 900);
}

beforeEach(() => {
  localStorage.clear();
  useShell.setState({ guideClosed: true });
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

async function renderApp(touch = false): Promise<HTMLElement> {
  setup(touch);
  const { App } = await import('../src/App');
  return render(<App />).container;
}

const gripOf = (container: HTMLElement, i: number): HTMLElement =>
  container.querySelector(`[data-element-index="${i}"] .row.grip`) as HTMLElement;
const kinds = (): string[] =>
  useDesignStore
    .getState()
    .design.elements.map((e) => `${'orientation' in e ? e.orientation : ''} ${e.kind}`);

type Kind = 'mouse' | 'touch';
const down = (el: Element, x: number, y: number, kind: Kind = 'mouse'): void =>
  void fireEvent.pointerDown(el, {
    pointerId: 5,
    pointerType: kind,
    button: 0,
    clientX: x,
    clientY: y,
  });
const to = (el: Element, x: number, y: number, kind: Kind = 'mouse'): void =>
  void fireEvent.pointerMove(el, { pointerId: 5, pointerType: kind, clientX: x, clientY: y });
const up = (el: Element, x: number, y: number, kind: Kind = 'mouse'): void =>
  void fireEvent.pointerUp(el, {
    pointerId: 5,
    pointerType: kind,
    button: 0,
    clientX: x,
    clientY: y,
  });

describe('ladder drag on pointer events', () => {
  it('no card is draggable the HTML5 way any more', async () => {
    const container = await renderApp();
    expect(container.querySelector('[draggable="true"]')).toBeNull();
  });

  it('dragging the grip reorders: the first card to the last slot', async () => {
    const container = await renderApp();
    const grip = gripOf(container, 0);
    down(grip, 100, 320);
    to(grip, 100, 400);
    // Lifted: the card follows the pointer, the others move aside.
    const card = container.querySelector('[data-element-index="0"]') as HTMLElement;
    expect(card.classList.contains('lifted')).toBe(true);
    to(grip, 100, 560);
    expect(
      (container.querySelector('[data-element-index="1"]') as HTMLElement).style.transform,
    ).toBe('translateY(-110px)');
    to(grip, 100, 600);
    up(grip, 100, 600);
    expect(kinds()).toEqual(['series L', 'series C', 'shunt C']);
  });

  it('dropped outside the list it removes the part, with Undo in a message naming it', async () => {
    const container = await renderApp();
    const grip = gripOf(container, 1);
    down(grip, 100, 430);
    to(grip, 200, 430);
    // Over the chart, out of the list: the remove cue, and the list closes the gap.
    to(grip, 600, 430);
    const card = container.querySelector('[data-element-index="1"]') as HTMLElement;
    expect(card.classList.contains('remove-cue')).toBe(true);
    expect(card.textContent).toContain('Remove');
    expect(
      (container.querySelector('[data-element-index="2"]') as HTMLElement).style.transform,
    ).toBe('translateY(-110px)');
    up(grip, 600, 430);
    expect(kinds()).toEqual(['shunt C', 'series C']);
    expect(useDesignStore.getState().message).toMatch(/^Removed Series L 2: /);
    expect(useDesignStore.getState().messageExtras?.undo).toBe(true);
    const status = container.querySelector('footer.statusbar') as HTMLElement;
    fireEvent.click(within(status).getByRole('button', { name: 'Undo' }));
    expect(kinds()).toEqual(['shunt C', 'series L', 'series C']);
  });

  it('released back inside the list after being outside, it cancels', async () => {
    const container = await renderApp();
    const grip = gripOf(container, 1);
    down(grip, 100, 430);
    to(grip, 600, 430);
    to(grip, 100, 432);
    expect(
      (container.querySelector('[data-element-index="1"]') as HTMLElement).classList.contains(
        'remove-cue',
      ),
    ).toBe(false);
    up(grip, 100, 432);
    expect(kinds()).toEqual(['shunt C', 'series L', 'series C']);
    expect(useDesignStore.getState().past.length).toBe(0);
  });

  it('the pointer lost outside the list (outside the window) removes; inside it cancels', async () => {
    const container = await renderApp();
    let grip = gripOf(container, 0);
    down(grip, 100, 320);
    to(grip, 100, -40);
    fireEvent.pointerCancel(grip, { pointerId: 5, pointerType: 'mouse' });
    expect(kinds()).toEqual(['series L', 'series C']);
    grip = gripOf(container, 0);
    down(grip, 100, 320);
    to(grip, 100, 380);
    fireEvent.pointerCancel(grip, { pointerId: 5, pointerType: 'mouse' });
    expect(kinds()).toEqual(['series L', 'series C']);
  });

  it('a press on a button of the row does not start a drag; the arrows still reorder', async () => {
    const container = await renderApp();
    const upButton = container.querySelector(
      '[data-element-index="1"] button[aria-label="Move up"]',
    ) as HTMLElement;
    down(upButton, 100, 430);
    to(upButton, 600, 430);
    up(upButton, 600, 430);
    expect(kinds()).toEqual(['shunt C', 'series L', 'series C']);
    fireEvent.click(upButton);
    expect(kinds()).toEqual(['series L', 'shunt C', 'series C']);
  });

  it('on a touch screen the card lifts after a long press; a swipe before it does nothing', async () => {
    const container = await renderApp(true);
    let grip = gripOf(container, 0);
    down(grip, 100, 320, 'touch');
    to(grip, 100, 340, 'touch'); // a swipe: more than 10 px before 400 ms
    await act(() => new Promise((r) => setTimeout(r, 450)));
    to(grip, 600, 340, 'touch');
    up(grip, 600, 340, 'touch');
    expect(kinds()).toEqual(['shunt C', 'series L', 'series C']);
    grip = gripOf(container, 0);
    down(grip, 100, 320, 'touch');
    await act(() => new Promise((r) => setTimeout(r, 450)));
    expect(
      (container.querySelector('[data-element-index="0"]') as HTMLElement).classList.contains(
        'lifted',
      ),
    ).toBe(true);
    to(grip, 600, 320, 'touch');
    up(grip, 600, 320, 'touch');
    expect(kinds()).toEqual(['series L', 'series C']);
  });

  it('Escape puts a lifted card back', async () => {
    const container = await renderApp();
    const grip = gripOf(container, 0);
    down(grip, 100, 320);
    to(grip, 600, 320);
    fireEvent.keyDown(window, { key: 'Escape' });
    up(grip, 600, 320);
    expect(kinds()).toEqual(['shunt C', 'series L', 'series C']);
  });
});
