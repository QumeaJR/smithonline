// @vitest-environment jsdom
/**
 * The start guide once all three steps are done (docs/09 section 2, which
 * replaced the iPhone pass's two-second close): it no longer closes itself
 * but folds to one row with the next steps, "Matched. Next: Check tolerance,
 * Make it buildable, More". With a measured load the first button is
 * Optimize over the band. A step that unticks (Undo) unfolds it again, and
 * the close button still hides it for good in this browser.
 */
import { complex } from '@smithonline/core';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { StartGuide } from '../src/components/StartGuide';
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
  useShell.setState({ guideClosed: false, guideShown: false, tool: null });
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

describe('the start guide folds to its next steps when done', () => {
  it('stays after the third step and offers the next steps instead of closing', () => {
    render(<StartGuide onAutoMatch={() => undefined} />);
    twoSteps();
    addPart();
    expect(guide()?.className).toContain('complete');
    expect(screen.getByRole('status').textContent).toMatch(/Matched/);
    act(() => vi.advanceTimersByTime(10_000));
    expect(guide()).not.toBeNull();
    expect(useShell.getState().guideClosed).toBe(false);
    expect(readGuideClosed()).toBe(false);
    expect(screen.getByRole('button', { name: 'Check tolerance' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Make it buildable' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'More…' })).toBeTruthy();
    // Folded: the three steps are gone.
    expect(document.querySelector('.start-steps')).toBeNull();
  });

  it('Check tolerance opens the Tolerance panel', () => {
    render(<StartGuide onAutoMatch={() => undefined} />);
    twoSteps();
    addPart();
    fireEvent.click(screen.getByRole('button', { name: 'Check tolerance' }));
    expect(useShell.getState().tool).toBe('montecarlo');
  });

  it('Make it buildable starts that workflow on the design on show', () => {
    render(<StartGuide onAutoMatch={() => undefined} />);
    twoSteps();
    addPart();
    const before = store().design;
    fireEvent.click(screen.getByRole('button', { name: 'Make it buildable' }));
    expect(useTourStore.getState().tour?.id).toBe('buildable');
    // The user's own matched design stays.
    expect(store().design.elements).toEqual(before.elements);
  });

  it('with a measured load the first next step is Optimize over the band', () => {
    act(() =>
      store().update((d) => ({
        ...d,
        sweep: {
          ...d.sweep,
          enabled: true,
          mode: 'datapoints',
          loads: [
            { frequency: 0.9e9, z: complex(30, -10) },
            { frequency: 1e9, z: complex(32, 0) },
            { frequency: 1.1e9, z: complex(34, 12) },
          ],
          loadsName: 'antenna-2g4-synthetic.s1p',
        },
      })),
    );
    render(<StartGuide onAutoMatch={() => undefined} />);
    twoSteps();
    addPart();
    expect(screen.getByRole('button', { name: 'Optimize over the band' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Check tolerance' })).toBeNull();
  });

  it('an Undo of the last step unfolds it to the three steps again', () => {
    render(<StartGuide onAutoMatch={() => undefined} />);
    twoSteps();
    addPart();
    act(() => store().undo());
    expect(guide()?.className).not.toContain('complete');
    expect(document.querySelector('.start-steps')).not.toBeNull();
  });

  it('the close button of the folded guide hides it for good in this browser', () => {
    render(<StartGuide onAutoMatch={() => undefined} />);
    twoSteps();
    addPart();
    fireEvent.click(screen.getByRole('button', { name: 'Close the start guide' }));
    expect(guide()).toBeNull();
    expect(readGuideClosed()).toBe(true);
  });

  it('the first step offers a measured file and the sample antenna', () => {
    render(<StartGuide onAutoMatch={() => undefined} />);
    expect(screen.getByRole('button', { name: 'Open a measured file…' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try a sample antenna' })).toBeTruthy();
  });

  it('a guide Help brings back on a complete design stays until it is closed', () => {
    twoSteps();
    addPart();
    useShell.setState({ guideClosed: true });
    render(<StartGuide onAutoMatch={() => undefined} />);
    expect(guide()).toBeNull();
    act(() => useShell.getState().showGuide());
    expect(guide()).not.toBeNull();
    act(() => vi.advanceTimersByTime(10_000));
    expect(guide()).not.toBeNull();
  });
});
