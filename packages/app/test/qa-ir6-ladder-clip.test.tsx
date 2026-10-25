// @vitest-environment jsdom
/**
 * QA, redesign phase 5: the ladder drag's "out of the list" test when the
 * list is scrolled inside a clipping panel (components/Ladder.tsx
 * visibleRect, lib/ladderDrag.ts outsideList; docs/07 section 4, Ladder
 * card). The panel shows y 100 to 500 and x 0 to 250 of a ladder that runs
 * from y -200 to 1000 (scrolled up by 300 px) and is 300 px wide. Cards are
 * 100 px tall with a 10 px gap from y 100: 100, 210, 320, 430.
 */
import { evaluateLadder } from '@smithonline/core';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Ladder } from '../src/components/Ladder';
import { emptyDesign, identify } from '../src/lib/design';
import { effectiveElements } from '../src/lib/realize';
import { useDesignStore } from '../src/store/useDesignStore';

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
/** How far the panel has scrolled since the drag began, px (moves the ladder and its cards up). */
let scrolled = 0;

beforeAll(() => {
  Element.prototype.getBoundingClientRect = function (this: Element): DOMRect {
    if (!(this instanceof HTMLElement)) return realRect.call(this);
    if (this.classList.contains('qa-scroller')) return rect(0, 100, 250, 400);
    if (this.classList.contains('qa-plain')) return rect(0, 100, 300, 50);
    if (this.classList.contains('ladder')) return rect(0, -200 - scrolled, 300, 1200);
    const i = this.dataset.elementIndex;
    if (i !== undefined) return rect(0, 100 + Number(i) * 110 - scrolled, 300, 100);
    return realRect.call(this);
  };
});
afterAll(() => {
  Element.prototype.getBoundingClientRect = realRect;
});

function LiveLadder() {
  const design = useDesignStore((s) => s.design);
  const result = evaluateLadder({
    z0: design.z0,
    frequency: design.frequency,
    load: design.load,
    elements: effectiveElements(design),
  });
  return <Ladder result={result} realization={null} />;
}

beforeEach(() => {
  scrolled = 0;
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
  useDesignStore.getState().init({
    ...emptyDesign(),
    load: { re: 20, im: -12 },
    elements: identify([
      { kind: 'C', orientation: 'shunt', value: 4.7e-12 },
      { kind: 'L', orientation: 'series', value: 10e-9 },
      { kind: 'C', orientation: 'series', value: 2.2e-12 },
      { kind: 'L', orientation: 'shunt', value: 22e-9 },
    ]),
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** The ladder inside a clipping panel (overflow auto), itself inside a plain box that does not clip. */
function renderClipped(): HTMLElement {
  return render(
    <div className="qa-plain">
      <div className="qa-scroller" style={{ overflowY: 'auto' }}>
        <LiveLadder />
      </div>
    </div>,
  ).container;
}

const kinds = (): string[] =>
  useDesignStore
    .getState()
    .design.elements.map((e) => `${'orientation' in e ? e.orientation : ''} ${e.kind}`);
const START = ['shunt C', 'series L', 'series C', 'shunt L'];
const grip = (c: HTMLElement, i: number): HTMLElement =>
  c.querySelector(`[data-element-index="${i}"] .row.grip`) as HTMLElement;
const ev = (x: number, y: number) => ({
  pointerId: 7,
  pointerType: 'mouse',
  button: 0,
  clientX: x,
  clientY: y,
});
function drag(c: HTMLElement, from: number, path: readonly [number, number][]): void {
  const g = grip(c, from);
  const [x0, y0] = path[0] as [number, number];
  fireEvent.pointerDown(g, ev(x0, y0));
  for (const [x, y] of path.slice(1)) fireEvent.pointerMove(g, ev(x, y));
  const [xe, ye] = path[path.length - 1] as [number, number];
  fireEvent.pointerUp(g, ev(xe, ye));
}

describe('out of a scrolled, clipped list', () => {
  it('below the panel (y 550) but inside the ladder box is out: the part is removed', () => {
    const c = renderClipped();
    drag(c, 0, [
      [100, 150],
      [100, 160],
      [100, 550],
    ]);
    expect(kinds()).toEqual(['series L', 'series C', 'shunt L']);
  });

  it('above the panel (y 50) but inside the ladder box is out: the part is removed', () => {
    const c = renderClipped();
    drag(c, 3, [
      [100, 480],
      [100, 470],
      [100, 50],
    ]);
    expect(kinds()).toEqual(['shunt C', 'series L', 'series C']);
  });

  it('right of the panel (x 270) but inside the ladder box is out: the part is removed', () => {
    const c = renderClipped();
    drag(c, 1, [
      [100, 260],
      [110, 260],
      [270, 260],
    ]);
    expect(kinds()).toEqual(['shunt C', 'series C', 'shunt L']);
  });

  it('inside the panel the drop reorders; a non-clipping ancestor (50 px tall) is ignored', () => {
    const c = renderClipped();
    // Middles of the other cards: 260, 370, 480. y 485 is past all three: the last slot.
    drag(c, 0, [
      [100, 150],
      [100, 160],
      [100, 485],
    ]);
    expect(kinds()).toEqual(['series L', 'series C', 'shunt L', 'shunt C']);
  });

  it('at the panel edge (y 500 exactly) it is still inside: no removal', () => {
    const c = renderClipped();
    drag(c, 0, [
      [100, 150],
      [100, 160],
      [100, 500],
    ]);
    expect(kinds()).toHaveLength(4);
  });

  it('the panel scrolled by 110 px during the drag: the slot follows the cards now under the pointer', () => {
    const c = renderClipped();
    const g = grip(c, 0);
    fireEvent.pointerDown(g, ev(100, 150));
    fireEvent.pointerMove(g, ev(100, 160));
    // A wheel turn scrolls the panel; the cards now lie at -10, 100, 210, 320 (middles of the
    // others 150, 260, 370). The pointer at y 300 is past two of them: slot 2.
    scrolled = 110;
    fireEvent.scroll(c.querySelector('.qa-scroller') as HTMLElement);
    fireEvent.pointerMove(g, ev(100, 300));
    fireEvent.pointerUp(g, ev(100, 300));
    expect(kinds()).toEqual(['series L', 'series C', 'shunt C', 'shunt L']);
  });
});

it('the starting order is the one the cases assume', () => {
  renderClipped();
  expect(kinds()).toEqual(START);
});
