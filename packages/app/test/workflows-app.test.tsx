// @vitest-environment jsdom
/**
 * The guided workflows in the application (docs/09 sections 2, 3 and 6):
 * every step's prepare brings its anchor up or the fallback text shows; a
 * workflow survives a tool opening (a lesson does not); Escape ends it and
 * one Undo then brings back the design from before; the BOM entry is listed
 * but disabled with its reason while Realize is off; the Learn menu holds
 * the workflows, lessons, sample files and examples; the phone's More is
 * regrouped.
 */
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
import { findAnchor } from '../src/lib/tourAnchor';
import { tourUi } from '../src/lib/tourUi';
import { WORKFLOWS } from '../src/lib/workflows';
import { useDesignStore } from '../src/store/useDesignStore';
import { useHelp } from '../src/store/useHelp';
import { usePartLibrary } from '../src/store/usePartLibrary';
import { useShell } from '../src/store/useShell';
import { isWorkflow, useTourStore, workflowSteps } from '../src/store/useTourStore';
import {
  isShipped,
  markCompleted as completeWorkflow,
  readCompleted,
} from '../src/lib/workflowKit';

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

/** Let the step's prepare render and the anchor check run (ANCHOR_WAIT_MS and a frame). */
const settle = (): Promise<void> =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 360));
  });

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
  T().close();
  D().init({ ...emptyDesign(), name: 'Mine' });
  D().setView('chart');
  D().setMessage(null);
});
afterEach(() => {
  T().close();
  cleanup();
});

describe('every workflow step points at an anchor, or says where to go', () => {
  for (const w of WORKFLOWS.filter(isShipped)) {
    it(`${w.title}: each step's prepare brings its anchor up or the fallback shows`, async () => {
      await renderApp();
      act(() => T().startWorkflow(w.id));
      const steps = workflowSteps(w);
      const missing: string[] = [];
      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        if (!step) continue;
        // A predicate never moved the walk on by itself: the store is at this step.
        if (T().step !== i) act(() => useTourStore.setState({ step: i }));
        await settle();
        const panel = document.querySelector('.tour-panel.workflow') as HTMLElement;
        expect(panel, `${w.id}/${step.id} panel`).not.toBeNull();
        expect(within(panel).getByRole('heading', { name: step.title })).toBeTruthy();
        if (!step.anchor) continue;
        if (findAnchor(step.anchor)) {
          expect(T().missing).toBe(false);
        } else {
          missing.push(step.id);
          expect(T().missing, `${w.id}/${step.id} missing flag`).toBe(true);
          expect(panel.querySelector('.tour-missing')?.textContent, `${w.id}/${step.id}`).toMatch(
            /first\.|Press Next/,
          );
        }
        // The next step comes on show through Next, which runs its prepare.
        if (i < steps.length - 1) act(() => T().next());
      }
      // The walk presses only Next (no doIt): steps that wait for a file, a run or a dialog may
      // fall back, the others find their anchor.
      expect(missing.length).toBeLessThan(steps.length);
    });
  }
});

describe('a workflow lives through the tools and ends on Escape', () => {
  it('opening a tool, changing the view or editing a value never ends a workflow', async () => {
    await renderApp();
    act(() => T().startWorkflow('robust'));
    act(() => tourUi.openTool('match', 'add'));
    expect(useShell.getState().tool).toBe('match');
    fireEvent.click(screen.getByRole('button', { name: 'Optimize band' }));
    act(() => D().setView('response'));
    act(() => D().setFrequency(1.1e9));
    expect(T().tour?.id).toBe('robust');
  });

  it('a lesson still ends when a tool opens', async () => {
    await renderApp();
    act(() => T().start('l-network'));
    const tools = document.querySelector(
      '[role="group"][aria-label="Design tools"]',
    ) as HTMLElement;
    fireEvent.click(within(tools).getByRole('button', { name: 'Auto match' }));
    expect(T().tour).toBeNull();
  });

  it('Escape ends it, and one Undo brings back the design from before it', async () => {
    await renderApp();
    const before = D().design;
    act(() => T().startWorkflow('buildable'));
    // The user works in it: several steps of their own.
    act(() => D().setRealize({ enabled: true }));
    act(() => D().setPackage(0, '0402'));
    act(() => D().setFrequency(1.05e9));
    expect(T().tour).not.toBeNull();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(T().tour).toBeNull();
    expect(D().message).toMatch(/Undo brings back the design from before it/);
    act(() => D().undo());
    expect(D().design).toBe(before);
  });

  it('the close button ends it the same way', async () => {
    await renderApp();
    act(() => T().startWorkflow('amplifier'));
    fireEvent.click(screen.getByRole('button', { name: 'Close workflow' }));
    expect(T().tour).toBeNull();
  });

  it('a predicate moves the step on by itself, 400 ms later', async () => {
    await renderApp();
    act(() => T().startWorkflow('buildable'));
    expect(workflowSteps(T().tour as never)[T().step]?.id).toBe('realize');
    act(() => D().setRealize({ enabled: true }));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 450));
    });
    expect(T().step).toBe(1);
  });

  it('Done on the last step stores it as completed; Learn shows the check', async () => {
    await renderApp();
    act(() => T().startWorkflow('broadband-limits'));
    const w = T().tour;
    if (!isWorkflow(w)) throw new Error('no workflow');
    act(() => useTourStore.setState({ step: workflowSteps(w).length - 1 }));
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(T().tour).toBeNull();
    expect(T().completed.has('broadband-limits')).toBe(true);
    expect(localStorage.getItem('smithonline.workflows.v1')).toContain('broadband-limits');
    fireEvent.click(screen.getByRole('button', { name: 'Learn' }));
    const item = screen.getByRole('menuitem', { name: /Broadband limits and multi-section/ });
    expect(item.textContent).toMatch(/✓/);
  });

  it('the last step of a chained workflow offers the next one', async () => {
    await renderApp();
    act(() => T().startWorkflow('robust'));
    const w = T().tour;
    if (!isWorkflow(w)) throw new Error('no workflow');
    act(() => useTourStore.setState({ step: workflowSteps(w).length - 1 }));
    fireEvent.click(screen.getByRole('button', { name: 'Next: Make it buildable' }));
    expect(T().tour?.id).toBe('buildable');
    expect(T().completed.has('robust')).toBe(true);
  });
});

describe('the File and Learn menus', () => {
  it('the BOM entry is listed while Realize is off, disabled with its reason', async () => {
    await renderApp();
    fireEvent.click(screen.getByRole('button', { name: /^File/ }));
    const bom = screen.getByRole('menuitem', { name: /Bill of materials/ });
    expect((bom as HTMLButtonElement).disabled).toBe(true);
    expect(bom.getAttribute('title')).toBe('Turn Realize on to list standard values');
  });

  it('the export is grouped: for a simulator, for the build, compare in the app, images and data', async () => {
    await renderApp();
    fireEvent.click(screen.getByRole('button', { name: /^File/ }));
    const menu = screen.getByRole('menu', { name: 'File' });
    const sections = [...menu.querySelectorAll('.section')].map((s) => s.textContent);
    expect(sections).toEqual(
      expect.arrayContaining([
        'For a simulator',
        'For the build',
        'Compare in the app',
        'Images and data',
      ]),
    );
  });

  it('Learn holds the workflows, the lessons, the sample files and the Smith V4.1 examples', async () => {
    await renderApp();
    const learn = screen.getByRole('button', { name: 'Learn' });
    expect(learn.getAttribute('title')).toBe(
      'Guided workflows, lessons, sample files and the Smith V4.1 examples',
    );
    fireEvent.click(learn);
    const menu = screen.getByRole('menu', { name: 'Learn' });
    const sections = [...menu.querySelectorAll('.section')].map((s) => s.textContent);
    expect(sections).toEqual(['Workflows', 'Lessons', 'Sample files', 'Smith V4.1 examples']);
    for (const w of WORKFLOWS.filter(isShipped)) {
      expect(within(menu).getByRole('menuitem', { name: new RegExp(w.title) })).toBeTruthy();
    }
    expect(within(menu).queryByRole('menuitem', { name: /Measure, compare, retune/ })).toBeNull();
    expect(within(menu).getByRole('menuitem', { name: /L-network match/ })).toBeTruthy();
    expect(
      within(menu).getByRole('menuitem', { name: /Antenna at 2\.4 GHz \(synthetic/ }),
    ).toBeTruthy();
    expect(within(menu).getByRole('menuitem', { name: /^Example 5/ })).toBeTruthy();
  });

  it('a sample opens through the import dialog', async () => {
    await renderApp();
    fireEvent.click(screen.getByRole('button', { name: 'Learn' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Antenna at 2\.4 GHz/ }));
    const dialog = screen.getByRole('dialog', { name: /Import/ });
    expect(
      within(dialog).getByRole('button', { name: 'Use all 101 rows as the load' }),
    ).toBeTruthy();
    expect(dialog.textContent).toMatch(/synthetic sample made from a circuit model/);
  });

  it('a completed workflow carries its check from storage', async () => {
    completeWorkflow('verify');
    useTourStore.setState({ completed: readCompleted() });
    await renderApp();
    fireEvent.click(screen.getByRole('button', { name: 'Learn' }));
    expect(
      screen.getByRole('menuitem', { name: /Verify against an independent tool/ }).textContent,
    ).toMatch(/✓/);
  });

  it('the desktop header: Tolerance among the design tools, Learn in the help group', async () => {
    await renderApp();
    const tools = document.querySelector(
      '[role="group"][aria-label="Design tools"]',
    ) as HTMLElement;
    expect(within(tools).getByRole('button', { name: 'Tolerance' })).toBeTruthy();
    const help = document.querySelector('[role="group"][aria-label="Help"]') as HTMLElement;
    expect(within(help).getByRole('button', { name: 'Learn' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Settings' }).getAttribute('title')).toMatch(
      /component packages and the board stackup/,
    );
  });
});

describe('the phone', () => {
  it('More: Data; Settings without Tolerance; Help with Learn', async () => {
    await renderApp(390, 844);
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    const groups = [...document.querySelectorAll('.more-groups [role="group"]')];
    expect(groups.map((g) => g.getAttribute('aria-label'))).toEqual(['Data', 'Settings', 'Help']);
    const [data, settings, help] = groups as HTMLElement[];
    expect(within(data as HTMLElement).getByRole('button', { name: /^File/ })).toBeTruthy();
    expect(
      within(settings as HTMLElement).queryByRole('button', { name: /^Tolerance/ }),
    ).toBeNull();
    expect(within(settings as HTMLElement).getByRole('button', { name: /^Settings/ })).toBeTruthy();
    expect(within(help as HTMLElement).getByRole('button', { name: /^Learn/ })).toBeTruthy();
    // Learn opens its menu in two presses from the top bar.
    fireEvent.click(within(help as HTMLElement).getByRole('button', { name: /^Learn/ }));
    expect(screen.getByRole('menu', { name: 'Learn' })).toBeTruthy();
  });

  it('a workflow step on the phone shows its title and counter at the sheet head', async () => {
    await renderApp(390, 844);
    act(() => T().startWorkflow('robust'));
    await settle();
    const head = document.querySelector('.tour-peek') as HTMLElement;
    expect(head.textContent).toMatch(/Open Tolerance/);
    expect(head.textContent).toMatch(/Workflow · step 1 of/);
    // The step opened Tolerance in the sheet's Tools segment.
    expect(useShell.getState().tool).toBe('montecarlo');
    expect(useShell.getState().pane).toBe('tool');
  });
});
