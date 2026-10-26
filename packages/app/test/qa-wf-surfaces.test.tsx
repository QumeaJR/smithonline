// @vitest-environment jsdom
/**
 * QA round 1 on docs/09 section 2: the measured-load header (front door of
 * job 1) and its buttons, Tolerance judged over the measured band by default
 * with a measured load, the stability readout of the two-port device, and the
 * guide's `workflow:` links. Expected numbers by hand: S11 = S22 = 0.3,
 * S21 = 2, S12 = 0.05 give K = 0.8201 / 0.2 = 4.10 and mu = 0.91 / 0.403 = 2.26.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { complex } from '@smithonline/core';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
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

import { emptyDesign } from '../src/lib/design';
import { parseTarget } from '../src/lib/helpActions';
import { openSample } from '../src/lib/samples';
import { useDesignStore } from '../src/store/useDesignStore';
import { useHelp } from '../src/store/useHelp';
import { useShell } from '../src/store/useShell';
import { useTourStore } from '../src/store/useTourStore';
import { useBoard } from '../src/store/useBoard';

const D = () => useDesignStore.getState();

async function renderApp(): Promise<void> {
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
  vi.stubGlobal('innerWidth', 1440);
  vi.stubGlobal('innerHeight', 900);
  const { App } = await import('../src/App');
  render(<App />);
}

beforeEach(() => {
  localStorage.clear();
  useShell.setState({ guideClosed: true, guideShown: false, settings: null, tool: null });
  useHelp.getState().closeHelp();
  useTourStore.getState().close();
  D().init({ ...emptyDesign({ frequency: 1e9 }), name: 'Mine' });
  D().setView('chart');
  D().setMessage(null);
});
afterEach(() => cleanup());

describe('the measured load header', () => {
  it('names the synthetic sample, its 101 rows and its band; Match over the band opens Auto match, Broadband', async () => {
    await renderApp();
    act(() => openSample('antenna'));
    fireEvent.click(screen.getByRole('button', { name: 'Use all 101 rows as the load' }));
    const header = document.querySelector('.measured-header') as HTMLElement;
    expect(header).not.toBeNull();
    expect(header.textContent).toMatch(
      /^Measured load: antenna-2g4-synthetic\.s1p \(synthetic sample, not a measurement\), 101 rows, 2\.2 GHz to 2\.7 GHz, /,
    );
    // The header's own button (the next-step chip offers the same step).
    fireEvent.click(within(header).getByRole('button', { name: 'Match over the band' }));
    expect(useShell.getState().tool).toBe('match');
    expect(useShell.getState().matchMode).toBe('broadband');
  });

  it('Tolerance opened on a measured load judges over the measured band by default', async () => {
    await renderApp();
    act(() => openSample('antenna'));
    fireEvent.click(screen.getByRole('button', { name: 'Use all 101 rows as the load' }));
    act(() => D().addElements([{ kind: 'C', orientation: 'shunt', value: 1e-12 }], 'Added'));
    const tools = document.querySelector(
      '[role="group"][aria-label="Design tools"]',
    ) as HTMLElement;
    fireEvent.click(tools.querySelector('[data-tour="header.tolerance"]') as HTMLElement);
    const box = screen.getByRole('switch', { name: /Judge over the measured band/ });
    expect((box as HTMLInputElement).checked).toBe(true);
  });
});

describe('the stability readout', () => {
  it('a stable device: "Stable at 1 GHz (K 4.10, mu 2.26)"', async () => {
    await renderApp();
    act(() =>
      D().setTwoPort({
        s: {
          s11: complex(0.3, 0),
          s12: complex(0.05, 0),
          s21: complex(2, 0),
          s22: complex(0.3, 0),
        },
        noise: null,
      }),
    );
    const line = document.querySelector('[data-tour="numbers.stability"]') as HTMLElement;
    expect(line.textContent).toMatch(/^Stable at 1 GHz \(K 4\.10, mu 2\.26\): for any passive/);
  });

  it('a potentially unstable device offers Draw stability circles, which draws them', async () => {
    await renderApp();
    act(() => {
      D().setTwoPort({
        s: {
          s11: complex(0.8, 0),
          s12: complex(0.3, 0),
          s21: complex(3, 0),
          s22: complex(0.8, 0),
        },
        noise: null,
      });
      D().setShowStability(false);
    });
    const line = document.querySelector('[data-tour="numbers.stability"]') as HTMLElement;
    expect(line.textContent).toMatch(/^Potentially unstable at 1 GHz/);
    fireEvent.click(screen.getByRole('button', { name: 'Draw stability circles' }));
    expect(D().design.showStability).toBe(true);
  });
});

describe('the network row: Realize | Losses | Board', () => {
  it('Board turns the board of the design on, one undo step; Edit… opens Build at Board', async () => {
    useBoard.getState().setBoard({ enabled: false });
    await renderApp();
    act(() => D().addElements([{ kind: 'C', orientation: 'shunt', value: 1e-12 }], 'Added'));
    const before = D().past.length;
    fireEvent.click(screen.getByRole('switch', { name: 'Board' }));
    // The design's own board, not the browser's default (docs/09b).
    expect(D().design.build?.board?.enabled).toBe(true);
    expect(useBoard.getState().board.enabled).toBe(false);
    expect(D().past.length).toBe(before + 1);
    const board = screen.getByRole('group', { name: 'Board' });
    fireEvent.click(within(board).getByRole('button', { name: 'Edit…' }));
    expect(useShell.getState().tool).toBe('build');
    expect(useShell.getState().buildSection?.section).toBe('board');
    expect(useShell.getState().settings).toBeNull();
    act(() => D().undo());
    expect(D().design.build?.board?.enabled ?? false).toBe(false);
  });
});

describe('the guide', () => {
  it('every workflow: link in docs/06-user-guide.md names a shipped workflow', () => {
    const guide = readFileSync(resolve(__dirname, '../../../docs/06-user-guide.md'), 'utf8');
    const links = [...guide.matchAll(/\]\((workflow:[^)\s]+)\)/g)].map((m) => m[1] as string);
    expect(links.length).toBeGreaterThanOrEqual(7);
    for (const href of links) expect(parseTarget(href), href).not.toBeNull();
  });
});
