// @vitest-environment jsdom
/**
 * Redesign phase 6, feedback and motion: the empty states with their actions, the Share
 * button's Copied state, the stale note with Run again, the reduced-motion block, the Fit
 * interpolation, the file and view shortcuts with their overlay guard, and the undo label
 * of every step the phase named.
 */
import { complex, evaluateLadder, monteCarlo } from '@smithonline/core';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// uPlot reads matchMedia when it loads; the plots are not under test here.
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
const jobs = vi.hoisted(() => ({ started: 0 }));
vi.mock('../src/lib/montecarlo', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  // A stubbed job: it reports a first progress and never ends, so the bar stays on screen.
  startMonteCarlo: (
    _request: unknown,
    onProgress: (done: number, total: number, passed: number) => void,
  ) => {
    jobs.started += 1;
    queueMicrotask(() => onProgress(40, 200, 38));
    return { result: new Promise(() => undefined), cancel: () => undefined };
  },
}));
const saved = vi.hoisted(() => ({ json: [] as string[] }));
vi.mock('../src/lib/export', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  exportJson: (_data: unknown, name: string) => saved.json.push(name),
}));

import { FIT_MS, fitViewAt, HOME } from '../src/chart/gestures';
import { BandOptimizer } from '../src/components/BandOptimizer';
import { Ladder } from '../src/components/Ladder';
import { MonteCarloPanel } from '../src/components/MonteCarloPanel';
import { RightPanel } from '../src/components/RightPanel';
import { COPIED_MS, ShareButton } from '../src/components/ShareButton';
import { EmptyState } from '../src/components/ui/EmptyState';
import { StaleNote } from '../src/components/ui/StaleNote';
import { emptyDesign, identify, type Design, type DesignElement } from '../src/lib/design';
import { appShortcut } from '../src/lib/shortcuts';
import { ResponseView } from '../src/response/ResponseView';
import { SPlotView } from '../src/splot/SPlotView';
import { useDesignStore } from '../src/store/useDesignStore';
import { useHelp } from '../src/store/useHelp';
import { useMonteCarlo } from '../src/store/useMonteCarlo';
import { useShell } from '../src/store/useShell';
import { useSPlotStore } from '../src/store/useSPlotStore';
import { useTourStore } from '../src/store/useTourStore';

const D = () => useDesignStore.getState();

let coarse = false;
let reduced = false;
function stubMedia(): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches:
      (coarse && query === '(pointer: coarse)') ||
      (reduced && query === '(prefers-reduced-motion: reduce)'),
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
  }));
}
function stubResize(): void {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    },
  );
}
beforeAll(() => {
  stubMedia();
  stubResize();
});
beforeEach(() => {
  coarse = false;
  reduced = false;
  stubMedia();
  localStorage.clear();
  useShell.setState({ guideClosed: true, guideShown: false });
  useTourStore.getState().close();
  useHelp.getState().closeHelp();
  useMonteCarlo.getState().clear();
  useSPlotStore.setState({ files: [], activeId: null });
  D().init(emptyDesign());
  D().setMessage(null);
  jobs.started = 0;
  saved.json = [];
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  stubMedia();
  stubResize();
});

const withParts = (): Design => ({
  ...emptyDesign(),
  load: complex(20, -15),
  elements: identify([
    { kind: 'L', orientation: 'series', value: 10e-9 },
    { kind: 'C', orientation: 'shunt', value: 2e-12 },
  ]),
});

describe('EmptyState', () => {
  it('renders a title, one line, at most three steps and its actions', () => {
    const onAct = vi.fn();
    const onSecond = vi.fn();
    render(
      <EmptyState
        title="Set a sweep range"
        line="One line on why."
        steps={['one', 'two', 'three', 'four']}
        action={{ label: 'Do it', onClick: onAct }}
        secondary={{ label: 'Or this', onClick: onSecond }}
      />,
    );
    const note = screen.getByRole('note');
    expect(note.querySelector('.empty-title')?.textContent).toBe('Set a sweep range');
    expect(note.querySelector('.empty-line')?.textContent).toBe('One line on why.');
    expect(note.querySelectorAll('.empty-steps li')).toHaveLength(3);
    fireEvent.click(screen.getByRole('button', { name: 'Do it' }));
    fireEvent.click(screen.getByRole('button', { name: 'Or this' }));
    expect(onAct).toHaveBeenCalledTimes(1);
    expect(onSecond).toHaveBeenCalledTimes(1);
  });

  it('Response without a valid sweep offers 0.5 to 2 f, one named step', () => {
    D().init({
      ...emptyDesign(),
      frequency: 400e6,
      sweep: { enabled: false, start: 0, stop: 0, points: 101 },
    });
    render(<ResponseView response={null} designFrequency={400e6} />);
    expect(screen.getByText('Set a sweep range')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Use 0.5 to 2 f' }));
    expect(D().design.sweep.start).toBe(200e6);
    expect(D().design.sweep.stop).toBe(800e6);
    expect(D().message).toBe('Sweep range set to 200 MHz to 800 MHz');
    D().undo();
    expect(D().message).toBe('Undo: Sweep range set to 200 MHz to 800 MHz');
  });

  it('S-Plot without files: Drop a Touchstone file or Open, with Open and Add the network', () => {
    const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => undefined);
    render(<SPlotView />);
    expect(screen.getByText('Drop a Touchstone file or Open')).toBeTruthy();
    const empty = within(document.querySelector('.splot-empty') as HTMLElement);
    fireEvent.click(empty.getByRole('button', { name: 'Open' }));
    expect(click).toHaveBeenCalledTimes(1);
    fireEvent.click(empty.getByRole('button', { name: 'Add the network' }));
    expect(useSPlotStore.getState().files.length).toBe(1);
    click.mockRestore();
  });

  it('S-Plot on a touch screen says Open, not Drop', () => {
    coarse = true;
    stubMedia();
    render(<SPlotView />);
    expect(screen.getByText('Open a Touchstone file')).toBeTruthy();
  });

  // D3 QA: the limit and the tolerance stay settable without parts, since Auto match judges
  // its yield by them.
  it('Tolerance without parts shows its empty state with the limit and tolerance fields', () => {
    render(<MonteCarloPanel />);
    expect(screen.getByText('Add parts to analyse')).toBeTruthy();
    expect(screen.getByLabelText('VSWR limit')).toBeTruthy();
    expect(screen.getByLabelText('Default tolerance in percent')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Run' })).toBeNull();
  });

  it('Optimize band without a band offers 0.5 to 2 f', () => {
    // An empty range (start equal to stop); an inverted one is read in either order, as the
    // Response view reads it (final QA: one rule for inverted sweeps).
    D().init({ ...withParts(), sweep: { enabled: false, start: 1e9, stop: 1e9, points: 101 } });
    render(<BandOptimizer />);
    expect(screen.getByText('Set a sweep range')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Use 0.5 to 2 f' }));
    expect(D().design.sweep.start).toBe(0.5e9);
    expect(D().design.sweep.stop).toBe(2e9);
    expect(screen.queryByText('Set a sweep range')).toBeNull();
  });

  it('the datapoints table with only the load says Add parts to see the chain', () => {
    const d = D().design;
    const result = evaluateLadder({ z0: d.z0, frequency: d.frequency, load: d.load, elements: [] });
    const { unmount } = render(<RightPanel result={result} sweep={null} realized={null} />);
    expect(screen.getByText('Add parts to see the chain')).toBeTruthy();
    unmount();
    const p = withParts();
    D().init(p);
    const full = evaluateLadder({
      z0: p.z0,
      frequency: p.frequency,
      load: p.load,
      elements: p.elements,
    });
    render(<RightPanel result={full} sweep={null} realized={null} />);
    expect(screen.queryByText('Add parts to see the chain')).toBeNull();
  });

  it('the empty ladder has its empty state with Auto match, not while the start guide shows', () => {
    const d = D().design;
    const result = evaluateLadder({ z0: d.z0, frequency: d.frequency, load: d.load, elements: [] });
    const onAutoMatch = vi.fn();
    const { container, unmount } = render(
      <Ladder result={result} realization={null} onAutoMatch={onAutoMatch} />,
    );
    expect(container.querySelector('.ladder-empty .empty-title')?.textContent).toBe('No parts yet');
    fireEvent.click(screen.getByRole('button', { name: 'Auto match' }));
    expect(onAutoMatch).toHaveBeenCalledTimes(1);
    unmount();
    act(() => useShell.setState({ guideClosed: false }));
    const again = render(<Ladder result={result} realization={null} onAutoMatch={onAutoMatch} />);
    expect(again.container.querySelector('.ladder-empty')).toBeNull();
  });
});

describe('Share link', () => {
  it('shows Copied with a check for 1.5 s once the link is on the clipboard', async () => {
    vi.useFakeTimers();
    const onShare = vi.fn(() => Promise.resolve(true));
    render(<ShareButton onShare={onShare} />);
    const button = screen.getByRole('button', { name: 'Share link' });
    expect(button.textContent).toBe('Share');
    await act(async () => {
      fireEvent.click(button);
      await Promise.resolve();
    });
    expect(button.textContent).toBe('Copied');
    expect(button.className).toContain('copied');
    expect(button.querySelector('svg')).toBeTruthy();
    act(() => vi.advanceTimersByTime(COPIED_MS - 10));
    expect(button.textContent).toBe('Copied');
    act(() => vi.advanceTimersByTime(20));
    expect(button.textContent).toBe('Share');
  });

  it('stays Share where the clipboard refused (the link is in the address bar)', async () => {
    render(<ShareButton onShare={() => Promise.resolve(false)} />);
    const button = screen.getByRole('button', { name: 'Share link' });
    await act(async () => {
      fireEvent.click(button);
      await Promise.resolve();
    });
    expect(button.textContent).toBe('Share');
  });
});

describe('stale results', () => {
  it('StaleNote is a note row with a quiet Run again', () => {
    const onRun = vi.fn();
    render(<StaleNote onRun={onRun}>The design has changed since this run.</StaleNote>);
    const run = screen.getByRole('button', { name: 'Run again' });
    expect(run.className).toContain('quiet');
    fireEvent.click(run);
    expect(onRun).toHaveBeenCalledTimes(1);
  });

  it('a stale Monte Carlo result shows the note, not a sentence in the result, and Run again runs', async () => {
    const p = withParts();
    D().init(p);
    const r = monteCarlo(
      { z0: p.z0, frequency: p.frequency, load: p.load, elements: p.elements },
      { runs: 50, tolerance: 0.05, seed: 1, vswrLimit: 2 },
    );
    act(() => {
      useMonteCarlo.getState().set(r, 'M0 0');
      useMonteCarlo.getState().markStale(true);
    });
    const { container } = render(<MonteCarloPanel />);
    expect(container.querySelector('.mc-result .result')?.textContent).not.toMatch(/run again/i);
    const note = container.querySelector('.stale-note');
    expect(note?.textContent).toMatch(/The design has changed since this run/);
    await act(async () => {
      fireEvent.click(note?.querySelector('button') as HTMLElement);
      await Promise.resolve();
    });
    expect(jobs.started).toBe(1);
    // The stubbed job's progress is on show while it runs.
    const bar = screen.getByRole('progressbar', { name: 'Monte Carlo' });
    expect(bar.getAttribute('aria-valuenow')).toBe('40');
    expect(bar.getAttribute('aria-valuemax')).toBe('200');
  });
});

describe('motion', () => {
  const css = readFileSync(resolve(__dirname, '../src/index.css'), 'utf8');

  it('reduced motion sets every duration token to 0', () => {
    const block =
      /@media \(prefers-reduced-motion: reduce\) \{\s*:root \{([^}]*)\}/.exec(css)?.[1] ?? '';
    for (const name of ['--dur-fast', '--dur-base', '--dur-slow']) {
      expect(block, name).toMatch(new RegExp(`${name}:\\s*0m?s;`));
    }
  });

  it('every transition runs on a duration token, so reduced motion stops it', () => {
    const decls = [...css.matchAll(/transition:\s*([^;]+);/g)].map((m) => m[1] as string);
    expect(decls.length).toBeGreaterThan(5);
    for (const d of decls) {
      if (/^none$/.test(d.trim())) continue;
      expect(d, d).not.toMatch(/\b\d+(\.\d+)?m?s\b/);
      expect(d, d).toMatch(/var\(--dur-(fast|base|slow)\)/);
    }
  });

  it('popovers, dialogs and backdrops enter on their tokens', () => {
    expect(css).toMatch(
      /\.dropdown\.popover\[data-placed\] \{\s*animation: popover-in var\(--dur-base\)/,
    );
    expect(css).toMatch(/\.modal \{[^}]*animation: dialog-in var\(--dur-slow\)/);
    expect(css).toMatch(/@keyframes dialog-in \{\s*from \{\s*opacity: 0;\s*scale: 0\.98;/);
    expect(css).toMatch(
      /@keyframes popover-in \{\s*from \{\s*opacity: 0;\s*translate: 0 var\(--popover-from, -4px\);/,
    );
  });

  it('the theme switch cross-fades the chrome only, never the chart', () => {
    expect(css).toMatch(/:root\.theme-switching \*:not\(svg, svg \*, canvas\)/);
  });

  it('Fit reaches the target over FIT_MS and is skipped under reduced motion', () => {
    const from = { cx: 0.4, cy: -0.2, half: 0.1 };
    expect(FIT_MS).toBe(200);
    expect(fitViewAt(from, HOME, 0)).toEqual({ view: from, done: false });
    const mid = fitViewAt(from, HOME, FIT_MS / 2);
    expect(mid.done).toBe(false);
    expect(mid.view.half).toBeGreaterThan(from.half);
    expect(mid.view.half).toBeLessThan(HOME.half);
    expect(mid.view.cx).toBeLessThan(from.cx);
    expect(fitViewAt(from, HOME, FIT_MS)).toEqual({ view: HOME, done: true });
    expect(fitViewAt(from, HOME, FIT_MS * 3)).toEqual({ view: HOME, done: true });
    expect(fitViewAt(from, HOME, 0, true)).toEqual({ view: HOME, done: true });
    expect(fitViewAt({ cx: NaN, cy: 0, half: 1 }, HOME, 10)).toEqual({ view: HOME, done: true });
  });
});

describe('file and view shortcuts', () => {
  const key = (k: string, extra: Partial<KeyboardEventInit> = {}) =>
    ({ key: k, ctrlKey: true, metaKey: false, altKey: false, shiftKey: false, ...extra }) as never;

  it('appShortcut reads Ctrl or Cmd with S, O, E and Alt with 1 to 3, nothing else', () => {
    const alt = { ctrlKey: false, altKey: true };
    expect(appShortcut(key('s'))).toEqual({ kind: 'save' });
    expect(appShortcut(key('O'))).toEqual({ kind: 'open' });
    expect(appShortcut(key('e', { ctrlKey: false, metaKey: true }))).toEqual({ kind: 'export' });
    expect(appShortcut(key('2', alt))).toEqual({ kind: 'view', view: 'response' });
    expect(appShortcut(key('&', { ...alt, code: 'Digit1' }))).toEqual({
      kind: 'view',
      view: 'chart',
    });
    expect(appShortcut(key('3', alt))).toEqual({ kind: 'view', view: 'splot' });
    expect(appShortcut(key('4', alt))).toBeNull();
    // Ctrl+1 to Ctrl+3 are the browser's tabs (Chrome on Windows keeps Ctrl+1 to Ctrl+8).
    expect(appShortcut(key('2'))).toBeNull();
    expect(appShortcut(key('s', { shiftKey: true }))).toBeNull();
    expect(appShortcut(key('s', { altKey: true }))).toBeNull();
    expect(appShortcut(key('s', { ctrlKey: false }))).toBeNull();
  });

  async function renderApp(): Promise<void> {
    vi.stubGlobal('innerWidth', 1440);
    vi.stubGlobal('innerHeight', 900);
    const { App } = await import('../src/App');
    render(<App />);
  }
  const press = (k: string, extra: Partial<KeyboardEventInit> = {}): KeyboardEvent => {
    const e = new KeyboardEvent('keydown', {
      key: k,
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
      ...extra,
    });
    act(() => {
      window.dispatchEvent(e);
    });
    return e;
  };

  const view = (n: number): KeyboardEvent =>
    press(String(n), { ctrlKey: false, altKey: true, code: 'Digit' + n });

  it('Alt+1, 2 and 3 switch the views', async () => {
    await renderApp();
    expect(view(3).defaultPrevented).toBe(true);
    expect(D().view).toBe('splot');
    view(2);
    expect(D().view).toBe('response');
    view(1);
    expect(D().view).toBe('chart');
  });

  it('Ctrl+S saves the design as .json and Ctrl+O opens the file picker', async () => {
    const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => undefined);
    await renderApp();
    press('s');
    expect(saved.json).toEqual(['Untitled']);
    expect(D().message).toBe('Saved Untitled.json');
    press('o');
    expect(click).toHaveBeenCalledTimes(1);
    click.mockRestore();
  });

  it('Ctrl+E opens the File menu with the focus on its first export', async () => {
    await renderApp();
    press('e');
    const menu = screen.getByRole('menu', { name: 'File' });
    expect(document.activeElement?.textContent).toMatch(/^Chart as SVG/);
    expect(menu.contains(document.activeElement)).toBe(true);
  });

  it('the File menu shows the keys in kbd', async () => {
    await renderApp();
    fireEvent.click(screen.getByRole('button', { name: /^File/ }));
    const menu = screen.getByRole('menu', { name: 'File' });
    const keys = [...menu.querySelectorAll('kbd')].map((k) => k.textContent);
    expect(keys).toEqual(
      expect.arrayContaining(['Ctrl+N', 'Ctrl+O', 'Ctrl+S', 'Ctrl+E', 'Alt+1', 'Alt+2', 'Alt+3']),
    );
  });

  it('do nothing while an overlay is open, and keep the browser out of it', async () => {
    await renderApp();
    fireEvent.click(screen.getByRole('button', { name: /^File/ }));
    expect(screen.getByRole('menu', { name: 'File' })).toBeTruthy();
    const e = view(3);
    expect(e.defaultPrevented).toBe(true);
    expect(D().view).toBe('chart');
    press('s');
    expect(saved.json).toEqual([]);
  });

  it('do nothing while the help is open', async () => {
    await renderApp();
    act(() => useHelp.getState().openHelp());
    view(2);
    expect(D().view).toBe('chart');
  });
});

describe('undo labels on every step', () => {
  const steps: readonly [string, () => void, string][] = [
    ['setName', () => D().setName('Amp'), 'Renamed the design to "Amp"'],
    ['setFrequency', () => D().setFrequency(450e6), 'Changed f to 450 MHz'],
    ['setZ0', () => D().setZ0(75), 'Changed Z0 to 75 Ω'],
    ['setLoad', () => D().setLoad(complex(30, 10)), 'Changed the load to 30.0 + j10.0 Ω'],
    ['setTarget', () => D().setTarget(complex(25, 0)), 'Set the target to 25.0 + j0.0 Ω'],
    [
      'setTarget null',
      () => {
        D().setTarget(complex(25, 0));
        D().setTarget(null);
      },
      'Set the target back to Z0',
    ],
    [
      'updateElement',
      () =>
        D().updateElement(0, {
          ...(D().design.elements[0] as DesignElement),
          value: 12e-9,
        } as DesignElement),
      'Changed Series L 1 to 12 nH',
    ],
    [
      'setElementValues',
      () => D().setElementValues([{ kind: 'L', orientation: 'series', value: 13e-9 }]),
      'Changed the part values',
    ],
    ['setSweep enabled', () => D().setSweep({ enabled: true }), 'Sweep on'],
    ['setSweep', () => D().setSweep({ points: 51 }), 'Changed the sweep'],
    ['setDatapoint', () => D().setDatapoint(0, { z: complex(40, 0) }), 'Changed DP1'],
    ['setVswrCircles', () => D().setVswrCircles([2]), 'Changed the VSWR circles'],
    ['setQContours', () => D().setQContours([1]), 'Changed the Q contours'],
    ['setShowStability', () => D().setShowStability(true), 'Showed the stability circles'],
    [
      'setGainCircles',
      () => D().setGainCircles([{ type: 'available', gainDb: 10 } as never]),
      'Changed the gain circles',
    ],
    ['setNoiseCircles', () => D().setNoiseCircles([1]), 'Changed the noise circles'],
    ['setRealize', () => D().setRealize({ enabled: true }), 'Realize on'],
    ['setLosses', () => D().setLosses({ enabled: true }), 'Losses on'],
    ['setTolerance', () => D().setTolerance({ runs: 20 }), 'Changed the tolerance settings'],
    ['setStress', () => D().setStress({ power: 0.01 }), 'Changed the power and stress limits'],
    ['setLimits', () => D().setLimits([]), 'Changed the limit areas'],
    ['setPackage', () => D().setPackage(0, '0402'), 'Set the package of Series L 1 to 0402'],
    ['toggleLock', () => D().toggleLock(0), 'Locked Series L 1'],
  ];

  it.each(steps)('%s names its step for Undo and Redo', (_name, run, label) => {
    D().init({
      ...emptyDesign(),
      elements: identify([{ kind: 'L', orientation: 'series', value: 10e-9 }]),
    });
    run();
    D().undo();
    expect(D().message).toBe(`Undo: ${label}`);
    D().redo();
    expect(D().message).toBe(`Redo: ${label}`);
  });

  it('a quiet step leaves the status line clear', () => {
    D().setMessage('something before');
    D().setFrequency(2e9);
    expect(D().message).toBeNull();
  });

  it('step() names the change, says it and offers the inline Undo when asked', () => {
    D().init(withParts());
    D().step('Optimized over the band', (d) => ({ ...d, elements: d.elements.slice(0, 1) }), {
      undo: true,
    });
    expect(D().message).toBe('Optimized over the band');
    expect(D().messageExtras?.undo).toBe(true);
    D().undo();
    expect(D().message).toBe('Undo: Optimized over the band');
    expect(D().design.elements).toHaveLength(2);
  });

  it('step() that changes nothing says nothing and records nothing', () => {
    D().step('Nothing', (d) => d, { undo: true });
    expect(D().past).toHaveLength(0);
    expect(D().messageExtras).toBeNull();
  });

  it('a named load (open, example) carries the inline Undo', () => {
    D().loadDesign(withParts(), 'Loaded Example 5');
    expect(D().message).toBe('Loaded Example 5');
    expect(D().messageExtras?.undo).toBe(true);
  });

  it('a removal carries the inline Undo, and New does', () => {
    D().init(withParts());
    D().removeElement(1);
    expect(D().message).toBe('Removed Shunt C 2: 2 pF');
    expect(D().messageExtras?.undo).toBe(true);
    D().newDesign();
    expect(D().messageExtras?.undo).toBe(true);
  });

  it('updateFollowingDevice with a label is one named step', () => {
    D().updateFollowingDevice((d) => ({ ...d, load: complex(10, 5) }), 'Load set from x.s1p');
    expect(D().message).toBe('Load set from x.s1p');
    D().undo();
    expect(D().message).toBe('Undo: Load set from x.s1p');
  });

  it('a slider drag on a ladder card ends as one step named after the part', () => {
    const p = {
      ...emptyDesign(),
      elements: identify([{ kind: 'L', orientation: 'series', value: 10e-9 }]),
    };
    D().init(p);
    const result = evaluateLadder({
      z0: p.z0,
      frequency: p.frequency,
      load: p.load,
      elements: p.elements,
    });
    render(<Ladder result={result} realization={null} />);
    const slider = screen.getByRole('slider', { name: 'Tune Series L' });
    fireEvent.change(slider, { target: { value: '0.5' } });
    fireEvent.blur(slider);
    expect(D().message).toMatch(/^Tuned Series L 1 to \d/);
    const label = D().message as string;
    D().undo();
    expect(D().message).toBe(`Undo: ${label}`);
  });

  it('a tour step swapped in over an edit is named for Undo', () => {
    useTourStore.getState().start('l-network');
    expect(useTourStore.getState().tour).not.toBeNull();
    D().setName('my edit');
    useTourStore.getState().next();
    expect(D().message).toMatch(/^Tour ".+", step 2 of \d+$/);
  });
});
