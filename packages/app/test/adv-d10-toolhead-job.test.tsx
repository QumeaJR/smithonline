// @vitest-environment jsdom
/**
 * QA docs/10 section 5 (adversarial): in the whole application, a Broadband
 * search started in Auto match keeps running after X, after Escape, after
 * another tool is opened and after a workflow takes the column; its job row
 * Stop really stops the search (the worker is cancelled) and the panel lets
 * go afterwards. The search is a controllable fake of the Web Worker job.
 */
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

interface FakeJob {
  progress: (p: { done: number; total: number; best: number; label: string }) => void;
  resolve: (r: unknown) => void;
  cancelled: number;
}
const jobs: FakeJob[] = [];
vi.mock('../src/lib/broadband', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  startBroadband: (_req: unknown, onProgress: FakeJob['progress']) => {
    let reject: (e: Error) => void = () => undefined;
    const job: FakeJob = { progress: onProgress, resolve: () => undefined, cancelled: 0 };
    const result = new Promise((res, rej) => {
      job.resolve = res;
      reject = rej;
    });
    jobs.push(job);
    return {
      result,
      cancel: () => {
        job.cancelled++;
        reject(new Error('cancelled'));
      },
    };
  },
}));

import { emptyDesign } from '../src/lib/design';
import { useDesignStore } from '../src/store/useDesignStore';
import { useJobs } from '../src/store/useJobs';
import { useShell } from '../src/store/useShell';

const D = () => useDesignStore.getState();

function stubs(width: number, height: number): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
  }));
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    },
  );
  vi.stubGlobal('innerWidth', width);
  vi.stubGlobal('innerHeight', height);
  URL.createObjectURL = () => 'blob:qa';
  URL.revokeObjectURL = () => undefined;
}

const wait = (ms: number): Promise<void> =>
  act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });

const unhandled: unknown[] = [];
const onUnhandled = (e: unknown): void => void unhandled.push(e);

async function startSearch(width = 1440, height = 900): Promise<void> {
  stubs(width, height);
  D().init({ ...emptyDesign(), name: 'Mine', load: { re: 12, im: -30 }, frequency: 433e6 });
  const { App } = await import('../src/App');
  render(<App />);
  await wait(10);
  const button = document.querySelector<HTMLButtonElement>('[data-tool="match"]');
  if (button) fireEvent.click(button);
  else {
    // Tablet and phone: the way a workflow opens a tool (the Tools list on a phone).
    const { appBridge } = await import('../src/lib/tourUi');
    act(() => appBridge.current?.openTool('match'));
  }
  await wait(10);
  const method = document.querySelector<HTMLElement>('[data-tour="match.method.broadband"]');
  expect(method, 'the Broadband method').toBeTruthy();
  fireEvent.click(method as HTMLElement);
  await wait(10);
  const run = document.querySelector<HTMLButtonElement>('[data-tour="match.broadband.run"]');
  expect(run, 'the Broadband Run button').toBeTruthy();
  fireEvent.click(run as HTMLButtonElement);
  await wait(10);
  expect(jobs).toHaveLength(1);
  act(() => jobs[0]?.progress({ done: 3, total: 40, best: 2.1, label: 'ladder 4 of 40' }));
  await wait(10);
  expect(useJobs.getState().jobs.match).toBeTruthy();
}

beforeEach(() => {
  jobs.length = 0;
  unhandled.length = 0;
  process.on('unhandledRejection', onUnhandled);
  localStorage.clear();
  useShell.setState({ background: [], tool: null } as never);
  useJobs.setState({ jobs: {}, finished: {}, stops: {} } as never);
});
afterEach(() => {
  process.off('unhandledRejection', onUnhandled);
  cleanup();
  vi.unstubAllGlobals();
});

describe('a running Broadband search and the tool head', () => {
  it('survives X, shows the job row, and its Stop cancels the search', async () => {
    await startSearch();
    fireEvent.click(screen.getByRole('button', { name: 'Close Auto match' }));
    await wait(10);
    expect(useShell.getState().tool).toBeNull();
    expect(useShell.getState().background).toContain('match');
    expect(jobs[0]?.cancelled).toBe(0);
    // Progress keeps arriving and shows in the row.
    act(() => jobs[0]?.progress({ done: 9, total: 40, best: 1.9, label: 'ladder 10 of 40' }));
    await wait(10);
    expect(
      screen.getByRole('progressbar', { name: 'Auto match' }).getAttribute('aria-valuenow'),
    ).toBe('9');
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    await wait(10);
    expect(jobs[0]?.cancelled).toBe(1);
    expect(useJobs.getState().jobs.match).toBeUndefined();
    expect(useShell.getState().background).not.toContain('match');
    expect(D().message).toBe('Stopped the broadband search');
    expect(unhandled).toEqual([]);
  });

  it('survives Escape the same way', async () => {
    await startSearch();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    await wait(10);
    expect(useShell.getState().tool).toBeNull();
    expect(jobs[0]?.cancelled).toBe(0);
    expect(useJobs.getState().jobs.match).toBeTruthy();
    expect(screen.getByRole('progressbar', { name: 'Auto match' })).toBeTruthy();
  });

  it('survives opening another tool; the row stays above its head, Stop still works', async () => {
    await startSearch();
    const tol = document.querySelector<HTMLButtonElement>('[data-tool="montecarlo"]');
    fireEvent.click(tol as HTMLButtonElement);
    await wait(10);
    expect(useShell.getState().tool).toBe('montecarlo');
    expect(jobs[0]?.cancelled).toBe(0);
    expect(screen.getByRole('progressbar', { name: 'Auto match' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    await wait(10);
    expect(jobs[0]?.cancelled).toBe(1);
  });

  it('finishing in the background leaves the result line and the result waits for Show', async () => {
    await startSearch();
    fireEvent.click(screen.getByRole('button', { name: 'Close Auto match' }));
    await wait(10);
    const core = await import('@smithonline/core');
    const r = core.broadbandMatch([400e6, 433e6, 470e6], {
      load: { re: 12, im: -30 },
      z0: 50,
      target: { re: 50, im: 0 },
      maxElements: 2,
    } as never);
    act(() => jobs[0]?.resolve(r));
    await wait(10);
    expect(screen.getByRole('status', { name: '' }).textContent ?? '').toMatch(
      /Broadband search done/,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Show' }));
    await wait(10);
    expect(useShell.getState().tool).toBe('match');
    expect(unhandled).toEqual([]);
  });

  it('a new design while the search runs in the background: the search still stops', async () => {
    await startSearch();
    fireEvent.click(screen.getByRole('button', { name: 'Close Auto match' }));
    await wait(10);
    act(() => D().init({ ...emptyDesign(), name: 'Other' }));
    await wait(10);
    const stop = screen.queryByRole('button', { name: 'Stop' });
    expect(stop, 'Stop is still offered while the job runs').toBeTruthy();
    fireEvent.click(stop as HTMLButtonElement);
    await wait(10);
    expect(jobs[0]?.cancelled).toBe(1);
  });

  it('at tablet and phone widths the search survives X as well', async () => {
    for (const [w, h] of [
      [1024, 768],
      [390, 844],
    ] as const) {
      cleanup();
      jobs.length = 0;
      useShell.setState({ background: [], tool: null } as never);
      useJobs.setState({ jobs: {}, finished: {} } as never);
      await startSearch(w, h);
      fireEvent.click(
        screen.getAllByRole('button', { name: 'Close Auto match' })[0] as HTMLElement,
      );
      await wait(10);
      expect(jobs[0]?.cancelled, `${w} px`).toBe(0);
      expect(useJobs.getState().jobs.match, `${w} px`).toBeTruthy();
      let stop = screen.queryAllByRole('button', { name: 'Stop' });
      if (stop.length === 0) {
        // Phone: no Stop in the job line; the tool comes back from the Tools list with its Stop.
        const { appBridge } = await import('../src/lib/tourUi');
        act(() => appBridge.current?.openTool('match'));
        await wait(10);
        stop = screen.queryAllByRole('button', { name: 'Stop' });
      }
      expect(stop.length, `${w} px: a Stop for the running search`).toBeGreaterThan(0);
      fireEvent.click(stop[0] as HTMLElement);
      await wait(10);
      expect(jobs[0]?.cancelled, `${w} px`).toBe(1);
    }
  });
});
