// @vitest-environment jsdom
/**
 * iPhone pass after 0.2.0: the start guide closes itself once all three steps
 * are done. It shows Done for GUIDE_DONE_MS, then closes the way its close
 * button does (remembered in this browser; Help brings it back). A step that
 * unticks within that time (Undo) stops the close, and a guide Help brought
 * back on a design that is already complete stays.
 */
import { complex } from '@smithonline/core';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { GUIDE_DONE_MS, StartGuide } from '../src/components/StartGuide';
import { emptyDesign } from '../src/lib/design';
import { useDesignStore } from '../src/store/useDesignStore';
import { useHelp } from '../src/store/useHelp';
import { readGuideClosed, useShell } from '../src/store/useShell';
import { useTourStore } from '../src/store/useTourStore';

beforeAll(() => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
  }));
});
beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  useShell.setState({ guideClosed: false, guideShown: false });
  useTourStore.getState().close();
  useHelp.getState().closeHelp();
  useDesignStore.getState().init(emptyDesign());
  useDesignStore.getState().setMessage(null);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const guide = (): HTMLElement | null => document.querySelector('.start-guide');
const store = () => useDesignStore.getState();

/** Ticks the load and the target; the part, the third step, is left to the test. */
function twoSteps(): void {
  act(() => store().setLoad(complex(20, -12)));
  act(() => store().setTarget(complex(50, 10)));
}
const addPart = (): void =>
  act(() => store().addElement({ kind: 'C', orientation: 'shunt', value: 2e-12 }));

describe('the start guide closes itself when done', () => {
  it('shows Done for about 2 s after the third step, then closes and remembers it', () => {
    render(<StartGuide onAutoMatch={() => undefined} />);
    twoSteps();
    addPart();
    expect(guide()?.className).toContain('complete');
    expect(screen.getByRole('status').textContent).toMatch(/Done/);
    act(() => vi.advanceTimersByTime(GUIDE_DONE_MS - 100));
    expect(guide()).not.toBeNull();
    act(() => vi.advanceTimersByTime(100));
    expect(guide()).toBeNull();
    // Remembered the same way as the close button.
    expect(useShell.getState().guideClosed).toBe(true);
    expect(readGuideClosed()).toBe(true);
  });

  it('does not close when a step unticks within the 2 s (Undo), and waits the full time again', () => {
    render(<StartGuide onAutoMatch={() => undefined} />);
    twoSteps();
    addPart();
    act(() => vi.advanceTimersByTime(1000));
    act(() => store().undo());
    expect(guide()?.className).not.toContain('complete');
    act(() => vi.advanceTimersByTime(GUIDE_DONE_MS * 2));
    expect(guide()).not.toBeNull();
    expect(useShell.getState().guideClosed).toBe(false);
    // Redo ticks it again: the 2 s start over from there.
    act(() => store().redo());
    act(() => vi.advanceTimersByTime(GUIDE_DONE_MS - 1));
    expect(guide()).not.toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(guide()).toBeNull();
  });

  it('Undo and Redo churn inside the 2 s never closes it early', () => {
    render(<StartGuide onAutoMatch={() => undefined} />);
    twoSteps();
    addPart();
    for (let i = 0; i < 3; i++) {
      act(() => vi.advanceTimersByTime(800));
      act(() => store().undo());
      act(() => vi.advanceTimersByTime(800));
      act(() => store().redo());
    }
    // 4.8 s have passed, but never 2 s with all three done in a row.
    expect(guide()).not.toBeNull();
  });

  it('a guide Help brings back on a complete design stays until it is closed', () => {
    twoSteps();
    addPart();
    useShell.setState({ guideClosed: true });
    render(<StartGuide onAutoMatch={() => undefined} />);
    expect(guide()).toBeNull();
    act(() => useShell.getState().showGuide());
    expect(guide()).not.toBeNull();
    act(() => vi.advanceTimersByTime(GUIDE_DONE_MS * 3));
    expect(guide()).not.toBeNull();
  });
});
