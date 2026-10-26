// @vitest-environment jsdom
/**
 * Adversarial: the workflow engine in the running application.
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

import { emptyDesign } from '../src/lib/design';
import { useDesignStore } from '../src/store/useDesignStore';
import { useHelp } from '../src/store/useHelp';
import { usePartLibrary } from '../src/store/usePartLibrary';
import { useShell } from '../src/store/useShell';
import { useTourStore, workflowSteps } from '../src/store/useTourStore';
import { useImported } from '../src/lib/importDialog';
import { tourUi } from '../src/lib/tourUi';

const D = () => useDesignStore.getState();
const T = () => useTourStore.getState();

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

async function renderApp(width = 1440, height = 900): Promise<void> {
  stubs(width, height);
  const { App } = await import('../src/App');
  render(<App />);
}
const wait = (ms: number): Promise<void> =>
  act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
const highlightRules = (): string[] =>
  [...document.querySelectorAll('style')]
    .map((s) => s.textContent ?? '')
    .filter((t) => t.includes('data-tour~='));

beforeEach(() => {
  localStorage.clear();
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
  useImported.setState({ imported: null });
  T().close();
  D().init({ ...emptyDesign(), name: 'Mine' });
  D().setView('chart');
  D().setMessage(null);
});
afterEach(() => {
  T().close();
  cleanup();
});

describe('no highlight left behind', () => {
  it('Escape removes the highlight rule', async () => {
    await renderApp();
    act(() => T().startWorkflow('robust'));
    await wait(360);
    expect(highlightRules().length).toBe(1);
    fireEvent.keyDown(document, { key: 'Escape' });
    // Tolerance is open: maybe Escape closes it first
    if (T().tour) fireEvent.keyDown(document, { key: 'Escape' });
    expect(T().tour).toBeNull();
    expect(highlightRules()).toEqual([]);
  });

  it('Undo past the start removes the highlight and the panel', async () => {
    await renderApp();
    act(() => T().startWorkflow('buildable'));
    await wait(360);
    act(() => D().undo());
    expect(T().tour).toBeNull();
    expect(highlightRules()).toEqual([]);
    expect(document.querySelector('.tour-panel')).toBeNull();
  });
});

describe('Escape with the import dialog open mid-workflow', () => {
  it('first Escape closes the dialog, the workflow stays', async () => {
    await renderApp();
    act(() => T().startWorkflow('measured-antenna'));
    act(() => tourUi.openSample('antenna'));
    await wait(450);
    expect(workflowSteps(T().tour as never)[T().step]?.id).toBe('use-rows');
    expect(screen.getByRole('dialog', { name: /Import/ })).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: /Import/ })).toBeNull();
    expect(T().tour?.id).toBe('measured-antenna');
  });

  it('a sample opened over the dialog of the user file replaces it', async () => {
    await renderApp();
    act(() => T().startWorkflow('measured-antenna'));
    act(() => tourUi.openSample('amplifier'));
    const first = useImported.getState().imported?.id;
    act(() => tourUi.openSample('antenna'));
    expect(useImported.getState().imported?.id).not.toBe(first);
    expect(screen.getAllByRole('dialog', { name: /Import/ }).length).toBe(1);
  });
});

describe('layout switch mid-step', () => {
  it('desktop to phone and back keeps the workflow and its step', async () => {
    await renderApp();
    act(() => T().startWorkflow('robust'));
    await wait(360);
    const step = T().step;
    act(() => {
      vi.stubGlobal('innerWidth', 390);
      vi.stubGlobal('innerHeight', 844);
      window.dispatchEvent(new Event('resize'));
    });
    await wait(400);
    expect(T().tour?.id).toBe('robust');
    expect(T().step).toBe(step);
    expect(document.querySelector('.tour-peek')).not.toBeNull();
    act(() => {
      vi.stubGlobal('innerWidth', 1440);
      vi.stubGlobal('innerHeight', 900);
      window.dispatchEvent(new Event('resize'));
    });
    await wait(400);
    expect(T().tour?.id).toBe('robust');
    expect(document.querySelector('.tour-panel.workflow')).not.toBeNull();
    // one Escape stack entry: close button still works
    fireEvent.click(screen.getAllByRole('button', { name: 'Close workflow' })[0] as HTMLElement);
    expect(T().tour).toBeNull();
    expect(highlightRules()).toEqual([]);
  });
});

describe('an example loaded mid-workflow', () => {
  it('Learn > Example 5 mid-workflow: Escape, one Undo restores the design from before', async () => {
    await renderApp();
    const before = D().design;
    act(() => T().startWorkflow('buildable'));
    fireEvent.click(screen.getByRole('button', { name: 'Learn' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /^Example 5/ }));
    expect(D().design.name).not.toBe('Mine');
    const tourAfterExample = T().tour?.id ?? null;
    if (tourAfterExample) {
      fireEvent.click(screen.getAllByRole('button', { name: 'Close workflow' })[0] as HTMLElement);
    }
    act(() => D().undo());
    expect(D().design).toBe(before);
  });
});
