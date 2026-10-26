// @vitest-environment jsdom
/**
 * Adversarial: next-step suggestions acting on a stale state.
 */
import { act, cleanup, render, screen } from '@testing-library/react';
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

import { complex } from '@smithonline/core';
import { emptyDesign } from '../src/lib/design';
import { useDesignStore } from '../src/store/useDesignStore';
import { useHelp } from '../src/store/useHelp';
import { usePartLibrary } from '../src/store/usePartLibrary';
import { useShell } from '../src/store/useShell';
import { useTourStore } from '../src/store/useTourStore';
import { useBoard } from '../src/store/useBoard';
import { useSettings } from '../src/store/useSettings';
import { DEFAULT_SETTINGS } from '../src/lib/settings';
import { noteBoardOn, noteToleranceResult, useNextStep } from '../src/lib/nextSteps';
import { tourUi } from '../src/lib/tourUi';
import { emitTourEvent } from '../src/lib/tourEvents';

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
}
const wait = (ms: number): Promise<void> =>
  act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });

beforeEach(() => {
  localStorage.clear();
  useSettings.setState({ settings: DEFAULT_SETTINGS });
  useShell.setState({
    guideClosed: true,
    guideShown: false,
    settings: null,
    tool: null,
    matchMode: null,
    pane: 'network',
  });
  useHelp.getState().closeHelp();
  usePartLibrary.setState({ open: false });
  useTourStore.getState().close();
  D().init({ ...emptyDesign({ frequency: 1e9 }), load: complex(100, -50) }, { fresh: true });
  D().addElements(
    [
      { kind: 'L', orientation: 'shunt', value: 11e-9 },
      { kind: 'C', orientation: 'series', value: 2.7e-12 },
    ],
    'Added',
  );
  useNextStep.setState({ suggestion: null });
});
afterEach(() => cleanup());

describe('stale suggestions', () => {
  it('Export the BOM is withdrawn when the board is turned off again', () => {
    D().setRealize({ enabled: true });
    useBoard.getState().setBoard({ enabled: true });
    noteBoardOn();
    expect(useNextStep.getState().suggestion?.id).toBe('bom');
    useBoard.getState().setBoard({ enabled: false });
    expect(useNextStep.getState().suggestion, 'chip still says "The board is in"').toBeNull();
  });

  it('"Set Shunt L 1 to 2 %" opens the per-part tolerances, it does not hide them', async () => {
    stubs(1440, 900);
    const { App } = await import('../src/App');
    render(<App />);
    act(() => tourUi.openTool('montecarlo'));
    const toggle = () =>
      document.querySelector('[data-tour~="tolerance.perPart"]') as HTMLButtonElement;
    // The user already looks at the per-part tolerances.
    act(() => toggle().click());
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    act(() => {
      emitTourEvent('centre-result');
      noteToleranceResult(0.8, { label: 'Shunt L 1', share: 0.7 });
    });
    const chipButton = screen.getAllByRole('button', {
      name: 'Set Shunt L 1 to 2 %',
    })[0] as HTMLButtonElement;
    act(() => chipButton.click());
    await wait(20);
    expect(toggle().getAttribute('aria-expanded'), 'the chip collapsed the per-part list').toBe(
      'true',
    );
  });
});
