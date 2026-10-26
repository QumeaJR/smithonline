// @vitest-environment jsdom
/**
 * QA round 1 on docs/09 section 4, the next-step chip in the application:
 * one at a time, its button runs and withdraws it, Show me starts the
 * covering workflow at the matching step on the user's own design, the close
 * button turns suggestions off (Undo on the message), and the chip waits
 * while a workflow runs.
 */
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
import { noteMatchAdded, noteToleranceResult, useNextStep } from '../src/lib/nextSteps';
import { DEFAULT_SETTINGS } from '../src/lib/settings';
import { useDesignStore } from '../src/store/useDesignStore';
import { useHelp } from '../src/store/useHelp';
import { useSettings } from '../src/store/useSettings';
import { useShell } from '../src/store/useShell';
import { useTourStore, workflowSteps } from '../src/store/useTourStore';
import { tourUi } from '../src/lib/tourUi';
import { emitTourEvent } from '../src/lib/tourEvents';

const D = () => useDesignStore.getState();
const T = () => useTourStore.getState();

/** 100 - j50 at 1 GHz matched by shunt L + series C. */
const MATCH = [
  { kind: 'L' as const, orientation: 'shunt' as const, value: 11.5346728762e-9 },
  { kind: 'C' as const, orientation: 'series' as const, value: 2.5989893374e-12 },
];
/** 11 rows of a series RLC whose 1 GHz row is 100 - j50 (R 100, L 10 nH, C from X = -50 at f). */
const W0 = 2 * Math.PI * 1e9;
const C0 = 1 / (W0 * (W0 * 10e-9 + 50));
const ROWS = Array.from({ length: 11 }, (_, i) => {
  const f = 0.9e9 + i * 0.02e9;
  const w = 2 * Math.PI * f;
  return { frequency: f, z: complex(100, w * 10e-9 - 1 / (w * C0)) };
});

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

const chip = (): HTMLElement | null => document.querySelector('section.next-step');

beforeEach(() => {
  localStorage.clear();
  useSettings.setState({ settings: DEFAULT_SETTINGS });
  useShell.setState({ guideClosed: true, guideShown: false, settings: null, tool: null });
  useHelp.getState().closeHelp();
  T().close();
  D().init({ ...emptyDesign({ frequency: 1e9 }), load: complex(100, -50) }, { fresh: true });
  D().setView('chart');
  D().setMessage(null);
  useNextStep.setState({ suggestion: null });
});
afterEach(() => {
  T().close();
  cleanup();
});

describe('the next-step chip', () => {
  it('shows one suggestion; a newer one replaces it; its button runs it and withdraws it', async () => {
    await renderApp();
    act(() => {
      D().setSweep({ enabled: true, start: 0.9e9, stop: 1.1e9 });
      D().addElements(MATCH, 'Added');
      noteMatchAdded('add');
    });
    expect(document.querySelectorAll('section.next-step').length).toBe(1);
    expect(
      within(chip() as HTMLElement).getByRole('button', { name: 'Check tolerance' }),
    ).toBeTruthy();
    act(() => noteToleranceResult(0.5, null));
    expect(document.querySelectorAll('section.next-step').length).toBe(1);
    fireEvent.click(
      within(chip() as HTMLElement).getByRole('button', { name: 'Centre for yield' }),
    );
    expect(chip()).toBeNull();
    expect(useShell.getState().tool).toBe('montecarlo');
  });

  it('waits while a workflow runs', async () => {
    await renderApp();
    act(() => {
      D().addElements(MATCH, 'Added');
      noteMatchAdded('add');
    });
    expect(chip()).not.toBeNull();
    act(() => T().startWorkflow('robust', { keep: true }));
    expect(chip()).toBeNull();
  });

  it('the close button turns suggestions off; the Undo on the message turns them back on', async () => {
    await renderApp();
    act(() => {
      D().addElements(MATCH, 'Added');
      noteMatchAdded('add');
    });
    fireEvent.click(screen.getByRole('button', { name: 'Turn next-step suggestions off' }));
    expect(chip()).toBeNull();
    expect(useSettings.getState().settings.suggestNextSteps).toBe(false);
    act(() => D().messageExtras?.action?.run());
    expect(useSettings.getState().settings.suggestNextSteps).toBe(true);
  });

  it('Show me on "Check tolerance" starts the robust workflow at its first step on the user design', async () => {
    await renderApp();
    act(() => {
      D().setSweep({ enabled: true, start: 0.9e9, stop: 1.1e9 });
      D().addElements(MATCH, 'Added');
      noteMatchAdded('add');
    });
    const mine = D().design;
    fireEvent.click(within(chip() as HTMLElement).getByRole('button', { name: 'Show me' }));
    expect(T().tour?.id).toBe('robust');
    expect(D().design.elements).toBe(mine.elements);
  });

  it('Show me on "Optimize over the band" keeps the measured load and the network it is about', async () => {
    await renderApp();
    act(() => {
      D().step('Datapoint sweep', (d) => ({
        ...d,
        sweep: {
          ...d.sweep,
          enabled: true,
          start: 0.9e9,
          stop: 1.1e9,
          loads: ROWS,
          loadsName: 'mine.s1p',
          mode: 'datapoints',
        },
      }));
      D().addElements(MATCH, 'Added');
      noteMatchAdded('add');
    });
    expect(
      within(chip() as HTMLElement).getByRole('button', { name: 'Optimize over the band' }),
    ).toBeTruthy();
    const mine = D().design;
    fireEvent.click(within(chip() as HTMLElement).getByRole('button', { name: 'Show me' }));
    const w = T().tour;
    expect(w?.id).toBe('broadband-limits');
    if (w && w.kind === 'workflow') expect(workflowSteps(w)[T().step]?.id).toBe('optimize');
    // The suggestion was to optimize this network over this measured band.
    expect(D().design.elements).toBe(mine.elements);
    expect(D().design.sweep.loads).toBe(ROWS);
  });

  it('"Set Shunt L 1 to 2 %" shows Tolerance per part, also when the table is open already', async () => {
    await renderApp();
    act(() => D().addElements(MATCH, 'Added'));
    act(() => tourUi.openTool('montecarlo'));
    fireEvent.click(screen.getByRole('button', { name: 'Tolerance per part' }));
    expect(screen.getByRole('button', { name: 'Hide tolerance per part' })).toBeTruthy();
    // A low yield after a centring, with one part above half the spread (QA round: never at 90 % or more).
    act(() => {
      emitTourEvent('centre-result');
      noteToleranceResult(0.8, { label: 'Shunt L 1', share: 0.6 });
    });
    fireEvent.click(
      within(chip() as HTMLElement).getByRole('button', { name: 'Set Shunt L 1 to 2 %' }),
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    // docs/09 section 4: "opens Tolerance per part at that part".
    expect(screen.queryByRole('button', { name: 'Hide tolerance per part' })).not.toBeNull();
  });
});
