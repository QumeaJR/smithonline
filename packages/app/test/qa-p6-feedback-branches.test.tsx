// @vitest-environment jsdom
/**
 * QA, redesign phase 6: branches of the empty states, StaleNote, ShareButton, the sweep action
 * of the empty states, the S-Plot drop target, fitViewAt, the shortcut guards and the reduced
 * motion query that ir7-feedback does not reach.
 */
import { complex, evaluateLadder } from '@smithonline/core';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
const dropped = vi.hoisted(() => ({ calls: [] as unknown[] }));
vi.mock('../src/lib/splotActions', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  openSPlotFiles: (list: unknown) => {
    dropped.calls.push(list);
    return Promise.resolve();
  },
}));

import { FIT_MS, fitViewAt, HOME } from '../src/chart/gestures';
import { Ladder } from '../src/components/Ladder';
import { COPIED_MS, ShareButton } from '../src/components/ShareButton';
import { EmptyState } from '../src/components/ui/EmptyState';
import { StaleNote } from '../src/components/ui/StaleNote';
import { emptyDesign } from '../src/lib/design';
import { applyHalfToDoubleSweep, HALF_TO_DOUBLE_LABEL } from '../src/lib/emptyActions';
import { prefersReducedMotion } from '../src/lib/motion';
import { appShortcut, SHORTCUT_HINTS } from '../src/lib/shortcuts';
import { SPlotView } from '../src/splot/SPlotView';
import { useDesignStore } from '../src/store/useDesignStore';
import { useShell } from '../src/store/useShell';
import { useSPlotStore } from '../src/store/useSPlotStore';
import { useTourStore } from '../src/store/useTourStore';

const D = () => useDesignStore.getState();

function stubMedia(matches: (q: string) => boolean): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: matches(query),
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
  }));
}

beforeEach(() => {
  stubMedia(() => false);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    },
  );
  useShell.setState({ guideClosed: true, guideShown: false });
  useTourStore.getState().close();
  useSPlotStore.setState({ files: [], activeId: null });
  D().init(emptyDesign());
  D().setMessage(null);
  dropped.calls = [];
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('qa: EmptyState branches', () => {
  it('without steps or actions it renders only the title and the line', () => {
    const { container } = render(<EmptyState title="Nothing here" line="Why." />);
    expect(container.querySelector('.empty-state')?.className).toBe('empty-state');
    expect(container.querySelector('.empty-steps')).toBeNull();
    expect(container.querySelector('.empty-actions')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('an empty steps list draws no list; a class is appended', () => {
    const { container } = render(
      <EmptyState title="T" line="L" steps={[]} className="extra-class" />,
    );
    expect(container.querySelector('.empty-steps')).toBeNull();
    expect(container.querySelector('.empty-state')?.className).toBe('empty-state extra-class');
  });

  it('one step is a list of one', () => {
    const { container } = render(<EmptyState title="T" line="L" steps={['only']} />);
    const items = container.querySelectorAll('.empty-steps li');
    expect(items).toHaveLength(1);
    expect(items[0]?.textContent).toBe('only');
  });

  it('a secondary action alone is a secondary button, with its title', () => {
    const onClick = vi.fn();
    render(
      <EmptyState
        title="T"
        line="L"
        secondary={{ label: 'Second', onClick, title: 'What it does' }}
      />,
    );
    const b = screen.getByRole('button', { name: 'Second' });
    expect(b.getAttribute('title')).toBe('What it does');
    expect(b.className).not.toContain('primary');
    fireEvent.click(b);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('the main action is the primary button', () => {
    render(<EmptyState title="T" line="L" action={{ label: 'Main', onClick: () => undefined }} />);
    expect(screen.getByRole('button', { name: 'Main' }).className).toContain('primary');
  });
});

describe('qa: StaleNote', () => {
  it('takes its own label and is a status row', () => {
    const onRun = vi.fn();
    render(
      <StaleNote onRun={onRun} label="Search again">
        Changed.
      </StaleNote>,
    );
    const row = screen.getByRole('status');
    expect(row.className).toBe('row stale-note');
    expect(row.querySelector('.stale-text')?.textContent).toBe('Changed.');
    fireEvent.click(screen.getByRole('button', { name: 'Search again' }));
    expect(onRun).toHaveBeenCalledTimes(1);
  });
});

describe('qa: ShareButton', () => {
  const click = async (b: HTMLElement): Promise<void> => {
    await act(async () => {
      fireEvent.click(b);
      await Promise.resolve();
    });
  };

  it('a second copy restarts the 1.5 s', async () => {
    vi.useFakeTimers();
    render(<ShareButton onShare={() => Promise.resolve(true)} />);
    const b = screen.getByRole('button', { name: 'Share link' });
    await click(b);
    act(() => vi.advanceTimersByTime(1000));
    await click(b);
    // 2000 ms after the first copy, 1000 ms after the second: still Copied.
    act(() => vi.advanceTimersByTime(1000));
    expect(b.textContent).toBe('Copied');
    // 1500 ms after the second copy it is back.
    act(() => vi.advanceTimersByTime(COPIED_MS - 1000 + 1));
    expect(b.textContent).toBe('Share');
  });

  it('unmounting while Copied clears its timer', async () => {
    vi.useFakeTimers();
    const { unmount } = render(<ShareButton onShare={() => Promise.resolve(true)} />);
    await click(screen.getByRole('button', { name: 'Share link' }));
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a refusal after a copy leaves the Copied state running to its end', async () => {
    vi.useFakeTimers();
    let ok = true;
    render(<ShareButton onShare={() => Promise.resolve(ok)} />);
    const b = screen.getByRole('button', { name: 'Share link' });
    await click(b);
    ok = false;
    await click(b);
    expect(b.textContent).toBe('Copied');
    act(() => vi.advanceTimersByTime(COPIED_MS));
    expect(b.textContent).toBe('Share');
  });
});

describe('qa: the 0.5 to 2 f action', () => {
  it('sets 500 MHz to 2 GHz at 1 GHz as one named step and keeps the sweep switch', () => {
    expect(HALF_TO_DOUBLE_LABEL).toBe('Sweep 0.5 f to 2 f');
    const before = D().design.sweep.enabled;
    applyHalfToDoubleSweep();
    expect(D().design.sweep.start).toBe(5e8);
    expect(D().design.sweep.stop).toBe(2e9);
    expect(D().design.sweep.enabled).toBe(before);
    expect(D().message).toBe('Sweep range set to 500 MHz to 2 GHz');
    expect(D().past).toHaveLength(1);
  });

  it('does nothing with a frequency that is not finite and positive', () => {
    for (const frequency of [0, -1, NaN, Infinity]) {
      useDesignStore.setState({ design: { ...emptyDesign(), frequency }, past: [] });
      const d = D().design;
      applyHalfToDoubleSweep();
      expect(D().design).toBe(d);
      expect(D().past).toHaveLength(0);
    }
  });
});

describe('qa: the empty ladder', () => {
  const emptyResult = () => {
    const d = D().design;
    return evaluateLadder({ z0: d.z0, frequency: d.frequency, load: d.load, elements: [] });
  };

  it('without an Auto match handler it shows the note without a button', () => {
    const { container } = render(<Ladder result={emptyResult()} realization={null} />);
    const empty = container.querySelector('.ladder-empty') as HTMLElement;
    expect(empty).toBeTruthy();
    expect(empty.querySelector('button')).toBeNull();
  });

  it('is left out while Help brought the guide back on an opened design', () => {
    D().loadDesign({ ...emptyDesign(), load: complex(20, 5) }, 'Opened x.json');
    act(() => useShell.setState({ guideClosed: false, guideShown: true }));
    const { container } = render(<Ladder result={emptyResult()} realization={null} />);
    expect(container.querySelector('.ladder-empty')).toBeNull();
  });

  it('shows while a tour runs, since the guide steps aside for the tour', () => {
    act(() => useShell.setState({ guideClosed: false, guideShown: false }));
    expect(D().fresh).toBe(true);
    useTourStore.getState().start('l-network');
    // The tour builds its own network; clear it back to an empty ladder in place.
    act(() => D().replaceDesign({ ...D().design, elements: [] }));
    const { container } = render(<Ladder result={emptyResult()} realization={null} />);
    expect(container.querySelector('.ladder-empty')).toBeTruthy();
  });
});

describe('qa: files dropped on the S-Plot view', () => {
  const body = (): HTMLElement => document.querySelector('.splot-body') as HTMLElement;

  it('a drag without files neither marks the view nor is taken', () => {
    render(<SPlotView />);
    fireEvent.dragOver(body(), { dataTransfer: { types: ['text/plain'] } });
    expect(body().className).not.toContain('dropping');
  });

  it('a drag with files marks the view; leaving it clears the mark', () => {
    render(<SPlotView />);
    fireEvent.dragOver(body(), { dataTransfer: { types: ['Files'] } });
    expect(body().className).toContain('dropping');
    fireEvent.dragLeave(body(), { relatedTarget: document.body });
    expect(body().className).not.toContain('dropping');
  });

  it('a drop with files loads them as Open does; a drop without files does nothing', () => {
    render(<SPlotView />);
    fireEvent.drop(body(), { dataTransfer: { files: [] } });
    expect(dropped.calls).toHaveLength(0);
    const file = new File(['! x'], 'a.s2p');
    fireEvent.dragOver(body(), { dataTransfer: { types: ['Files'] } });
    fireEvent.drop(body(), { dataTransfer: { files: [file], types: ['Files'] } });
    expect(dropped.calls).toHaveLength(1);
    expect(body().className).not.toContain('dropping');
  });
});

describe('qa: fitViewAt', () => {
  const from = { cx: 0.4, cy: -0.2, half: 0.1 };

  it('half way in time is 0.875 of the way (1 - 0.5^3) with the cubic ease-out', () => {
    const { view, done } = fitViewAt(from, HOME, FIT_MS / 2);
    expect(done).toBe(false);
    expect(view.cx).toBeCloseTo(0.4 + (0 - 0.4) * 0.875, 12);
    expect(view.cy).toBeCloseTo(-0.2 + (0 + 0.2) * 0.875, 12);
    expect(view.half).toBeCloseTo(0.1 + (1.18 - 0.1) * 0.875, 12);
  });

  it('a negative elapsed time stays at the start; NaN and Infinity end at the target', () => {
    expect(fitViewAt(from, HOME, -50)).toEqual({ view: from, done: false });
    expect(fitViewAt(from, HOME, NaN)).toEqual({ view: HOME, done: true });
    expect(fitViewAt(from, HOME, Infinity)).toEqual({ view: HOME, done: true });
    expect(fitViewAt(from, HOME, FIT_MS - 1e-9).done).toBe(false);
  });

  it('a start with an infinite cy or half jumps to the target', () => {
    expect(fitViewAt({ cx: 0, cy: Infinity, half: 1 }, HOME, 10)).toEqual({
      view: HOME,
      done: true,
    });
    expect(fitViewAt({ cx: 0, cy: 0, half: -Infinity }, HOME, 10)).toEqual({
      view: HOME,
      done: true,
    });
  });

  it('from home to home stays home', () => {
    expect(fitViewAt(HOME, HOME, 50).view).toEqual(HOME);
  });
});

describe('qa: shortcut guards', () => {
  const ev = (key: string, extra: Record<string, unknown> = {}) => ({
    key,
    ctrlKey: true,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    ...extra,
  });

  it('AltGr (Ctrl+Alt) and Shift leave every key to the browser and the layout', () => {
    for (const k of ['s', 'o', 'e', '1', '2', '3']) {
      expect(appShortcut(ev(k, { altKey: true }))).toBeNull();
      expect(appShortcut(ev(k, { shiftKey: true }))).toBeNull();
      expect(appShortcut(ev(k, { ctrlKey: false }))).toBeNull();
    }
  });

  it('Ctrl and Cmd together still count; Caps Lock (upper case) does too', () => {
    expect(appShortcut(ev('s', { metaKey: true }))).toEqual({ kind: 'save' });
    expect(appShortcut(ev('E'))).toEqual({ kind: 'export' });
  });

  it('0, 4 to 9, Enter, an empty key and other letters are not shortcuts', () => {
    for (const k of ['0', '4', '9', 'Enter', '', 'z', 'n', 'y', 'ss']) {
      expect(appShortcut(ev(k))).toBeNull();
    }
  });

  it('Alt with the digit row by position; the numeric keypad is left to Windows Alt codes', () => {
    const alt = { ctrlKey: false, altKey: true };
    expect(appShortcut(ev('"', { ...alt, code: 'Digit2' }))).toEqual({
      kind: 'view',
      view: 'response',
    });
    expect(appShortcut(ev('3', { ...alt, code: 'Numpad3' }))).toBeNull();
    expect(appShortcut(ev('(', { ...alt, code: 'Digit5' }))).toBeNull();
  });

  it('the hints the File menu shows', () => {
    expect(SHORTCUT_HINTS).toEqual({
      new: 'Ctrl+N',
      open: 'Ctrl+O',
      save: 'Ctrl+S',
      export: 'Ctrl+E',
      views: ['Alt+1', 'Alt+2', 'Alt+3'],
    });
  });
});

describe('qa: prefersReducedMotion', () => {
  it('reads the media query', () => {
    stubMedia((q) => q === '(prefers-reduced-motion: reduce)');
    expect(prefersReducedMotion()).toBe(true);
    stubMedia(() => false);
    expect(prefersReducedMotion()).toBe(false);
  });

  it('is false without matchMedia or when it throws', () => {
    vi.stubGlobal('matchMedia', undefined);
    expect(prefersReducedMotion()).toBe(false);
    vi.stubGlobal('matchMedia', () => {
      throw new Error('no');
    });
    expect(prefersReducedMotion()).toBe(false);
  });
});
