// @vitest-environment jsdom
/**
 * Adversarial, phase 5 ladder drag: the design changing under a drag, Escape
 * shared with the mode layer, a single card, a drop onto itself and
 * pointercancel. Each test asserts the correct behaviour; a failure is a defect.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
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

const THREE = [
  { kind: 'C', orientation: 'shunt', value: 4.7e-12 },
  { kind: 'L', orientation: 'series', value: 10e-9 },
  { kind: 'C', orientation: 'series', value: 2.2e-12 },
] as const;

beforeEach(() => {
  localStorage.clear();
  useShell.setState({ guideClosed: true });
  useDesignStore.getState().init({
    ...emptyDesign(),
    load: { re: 20, im: -12 },
    elements: identify(THREE as never),
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

const ev = (x: number, y: number) => ({
  pointerId: 5,
  pointerType: 'mouse',
  button: 0,
  clientX: x,
  clientY: y,
});

describe('ladder drag: the design changes under the drag', () => {
  it('Delete of another part mid-drag: drop outside removes the card that was dragged', async () => {
    const container = await renderApp();
    act(() => useDesignStore.getState().select(1)); // element 1 (shunt C) selected
    const grip = gripOf(container, 1); // drag series L
    fireEvent.pointerDown(grip, ev(100, 430));
    fireEvent.pointerMove(grip, ev(200, 430));
    fireEvent.pointerMove(grip, ev(600, 430));
    // The keyboard Delete removes the selected shunt C while the mouse still holds series L.
    fireEvent.keyDown(window, { key: 'Delete' });
    expect(kinds()).toEqual(['series L', 'series C']);
    fireEvent.pointerUp(grip, ev(600, 430));
    // Correct: series L, the card in the hand, is gone (or the drag was cancelled).
    expect(kinds()).not.toEqual(['series L']);
    expect(useDesignStore.getState().message ?? '').not.toMatch(/Series C/);
  });

  it('Ctrl+Z mid-drag: drop outside removes the card that was dragged', async () => {
    const container = await renderApp();
    act(() => useDesignStore.getState().removeElement(0)); // ['series L', 'series C']
    let grip = gripOf(container, 1); // drag series C
    fireEvent.pointerDown(grip, ev(100, 430));
    fireEvent.pointerMove(grip, ev(600, 430));
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true }); // the shunt C comes back at 0
    expect(kinds()).toEqual(['shunt C', 'series L', 'series C']);
    grip = gripOf(container, 1);
    fireEvent.pointerUp(grip, ev(600, 430));
    const message = useDesignStore.getState().message ?? '';
    // Correct: series C removed (or nothing), never series L which nobody touched.
    expect(kinds()).toContain('series L');
    expect(message).not.toMatch(/^Removed Series L/);
  });

  it('a reorder after a part was removed mid-drag moves the dragged card', async () => {
    const container = await renderApp();
    act(() => useDesignStore.getState().select(1));
    const grip = gripOf(container, 2); // drag series C (2.2 pF) to the top
    fireEvent.pointerDown(grip, ev(100, 540));
    fireEvent.pointerMove(grip, ev(100, 500));
    fireEvent.pointerMove(grip, ev(100, 310));
    fireEvent.keyDown(window, { key: 'Delete' }); // removes shunt C
    fireEvent.pointerUp(grip, ev(100, 310));
    // ['series L', 'series C'] before the drop; the dragged series C should now lead or stay.
    expect(kinds()[0] === 'series C' || kinds().join() === 'series L,series C').toBe(true);
  });
});

describe('ladder drag: Escape', () => {
  it('Escape during a drag puts the card back and leaves an armed part armed', async () => {
    const container = await renderApp();
    fireEvent.click(screen.getByRole('button', { name: /^Series L/ }));
    expect(container.querySelector('.chart-mode-bar')).not.toBeNull();
    const grip = gripOf(container, 0);
    fireEvent.pointerDown(grip, ev(100, 320));
    fireEvent.pointerMove(grip, ev(600, 320));
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.pointerUp(grip, ev(600, 320));
    expect(kinds()).toEqual(['shunt C', 'series L', 'series C']);
    // One Escape, one action: the arm is still there.
    expect(container.querySelector('.chart-mode-bar')).not.toBeNull();
  });
});

describe('ladder drag: shapes', () => {
  it('one card, dragged and dropped onto itself: no step', async () => {
    useDesignStore.getState().init({
      ...emptyDesign(),
      elements: identify([THREE[0]] as never),
    });
    const container = await renderApp();
    const grip = gripOf(container, 0);
    fireEvent.pointerDown(grip, ev(100, 320));
    fireEvent.pointerMove(grip, ev(100, 360));
    fireEvent.pointerMove(grip, ev(100, 330));
    fireEvent.pointerUp(grip, ev(100, 330));
    expect(kinds()).toEqual(['shunt C']);
    expect(useDesignStore.getState().past.length).toBe(0);
  });

  it('dropping the middle card onto its own slot: no step', async () => {
    const container = await renderApp();
    const grip = gripOf(container, 1);
    fireEvent.pointerDown(grip, ev(100, 430));
    fireEvent.pointerMove(grip, ev(100, 470));
    fireEvent.pointerMove(grip, ev(100, 440));
    fireEvent.pointerUp(grip, ev(100, 440));
    expect(useDesignStore.getState().past.length).toBe(0);
  });

  it('pointercancel inside after having been outside cancels', async () => {
    const container = await renderApp();
    const grip = gripOf(container, 1);
    fireEvent.pointerDown(grip, ev(100, 430));
    fireEvent.pointerMove(grip, ev(600, 430));
    fireEvent.pointerMove(grip, ev(100, 430));
    fireEvent.pointerCancel(grip, { pointerId: 5, pointerType: 'mouse' });
    expect(kinds()).toEqual(['shunt C', 'series L', 'series C']);
  });

  it('a pointerup of another pointer id does not end the drag', async () => {
    const container = await renderApp();
    const grip = gripOf(container, 0);
    fireEvent.pointerDown(grip, ev(100, 320));
    fireEvent.pointerMove(grip, ev(600, 320));
    fireEvent.pointerUp(grip, { ...ev(600, 320), pointerId: 9 });
    expect(kinds().length).toBe(3);
    fireEvent.pointerUp(grip, ev(600, 320));
    expect(kinds().length).toBe(2);
  });

  it('all cards dragged out one after another leave an empty ladder and Undo restores each', async () => {
    const container = await renderApp();
    for (let n = 3; n > 0; n--) {
      const grip = gripOf(container, 0);
      fireEvent.pointerDown(grip, ev(100, 320));
      fireEvent.pointerMove(grip, ev(600, 320));
      fireEvent.pointerUp(grip, ev(600, 320));
      expect(kinds().length).toBe(n - 1);
    }
    for (let n = 0; n < 3; n++) act(() => useDesignStore.getState().undo());
    expect(kinds()).toEqual(['shunt C', 'series L', 'series C']);
  });
});
