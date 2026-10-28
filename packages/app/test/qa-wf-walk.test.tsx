// @vitest-environment jsdom
/**
 * QA round 1 on docs/09 (guided workflows): every step of every shipped
 * workflow, walked in the whole application the way a user would, by the
 * step's own "Do it for me" button where it has one and by the real control
 * where it has not. A step that waits for a predicate must then move on by
 * itself (400 ms later) without Next being pressed; a step that advances on
 * Next must find its anchor on screen once the steps before it were done.
 *
 * The five Web Worker jobs (Broadband search, real frequency run, Tolerance run,
 * design centring, Optimize band) run in process here: the same core functions the workers
 * call, so the walk sees real results.
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

// The workers' bodies, in process (packages/app/src/workers/*.worker.ts).
vi.mock('../src/lib/broadband', async (orig) => {
  const core = await import('@smithonline/core');
  type Req = {
    frequencies: number[];
    load: unknown;
    z0: number;
    target: never;
    prefix: never;
    maxElements: number;
    allowLine: boolean;
  };
  return {
    ...(await orig<Record<string, unknown>>()),
    startBroadband: (req: Req) => ({
      result: new Promise((resolve) =>
        setTimeout(() =>
          resolve(
            core.broadbandMatch(req.frequencies, {
              load: Array.isArray(req.load)
                ? core.interpolatedLoad(req.load as never, { z0: req.z0 })
                : (req.load as never),
              z0: req.z0,
              target: req.target,
              prefix: req.prefix,
              maxElements: req.maxElements,
              allowLine: req.allowLine,
            }),
          ),
        ),
      ),
      cancel: () => undefined,
    }),
  };
});
// The real frequency run of D7 in process, with fewer starts so the walk stays quick.
vi.mock('../src/lib/rft', async (orig) => {
  const core = await import('@smithonline/core');
  type Req = {
    frequencies: number[];
    load: unknown;
    z0: number;
    r0: number;
    prefix: never;
    parts: number;
  };
  return {
    ...(await orig<Record<string, unknown>>()),
    startRft: (req: Req) => ({
      result: new Promise((resolve) =>
        setTimeout(() => {
          const load = Array.isArray(req.load)
            ? core.interpolatedLoad(req.load as never, { z0: req.z0 })
            : (req.load as never);
          const result = core.realFrequencyMatch(req.frequencies, {
            load,
            z0: req.r0,
            prefix: req.prefix,
            parts: req.parts,
            starts: 2,
            continuation: false,
            polish: false,
          });
          const limit = core.rftBandLimit(result, load, req.prefix ?? []);
          resolve({ result, floor: limit.floor, limitNote: limit.note });
        }),
      ),
      cancel: () => undefined,
    }),
  };
});
vi.mock('../src/lib/montecarlo', async (orig) => {
  const core = await import('@smithonline/core');
  return {
    ...(await orig<Record<string, unknown>>()),
    startMonteCarlo: (req: { ladder: never; options: never; loads?: never[] }) => ({
      result: new Promise((resolve) =>
        setTimeout(() => {
          const load =
            req.loads && req.loads.length >= 2
              ? core.interpolatedLoad(req.loads, { z0: (req.ladder as { z0: number }).z0 })
              : null;
          const result = core.monteCarlo(req.ladder, {
            ...(req.options as object),
            ...(load ? { load } : {}),
          } as never);
          const { runs: _r, ...rest } = req.options as { runs: number };
          void _r;
          const corner = core.worstCorner(req.ladder, {
            ...rest,
            ...(load ? { load } : {}),
            worstRun: result.worstRun,
          } as never);
          resolve({ result, corner });
        }),
      ),
      cancel: () => undefined,
    }),
  };
});
vi.mock('../src/lib/centre', async (orig) => {
  const core = await import('@smithonline/core');
  return {
    ...(await orig<Record<string, unknown>>()),
    startCentring: (req: { ladder: never; options: never; loads?: never[] }) => ({
      result: new Promise((resolve) =>
        setTimeout(() => {
          const load =
            req.loads && req.loads.length >= 2
              ? core.interpolatedLoad(req.loads, { z0: (req.ladder as { z0: number }).z0 })
              : null;
          resolve(
            core.centreDesign(req.ladder, {
              ...(req.options as object),
              ...(load ? { load } : {}),
            } as never),
          );
        }),
      ),
      cancel: () => undefined,
    }),
  };
});
vi.mock('../src/lib/optimizer', async (orig) => {
  const core = await import('@smithonline/core');
  return {
    ...(await orig<Record<string, unknown>>()),
    startOptimizer: (req: {
      ladder: { load: never; z0: number };
      frequencies: number[];
      options?: object;
      loads?: never[];
    }) => ({
      result: new Promise((resolve) =>
        setTimeout(() => {
          const load =
            req.loads && req.loads.length >= 2
              ? core.interpolatedLoad(req.loads, { z0: req.ladder.z0 })
              : req.ladder.load;
          resolve(
            core.optimizeBand(req.ladder as never, req.frequencies, {
              ...req.options,
              load,
            } as never),
          );
        }),
      ),
      cancel: () => undefined,
    }),
  };
});

import { emptyDesign } from '../src/lib/design';
import { findAnchor } from '../src/lib/tourAnchor';
import { doItLabel, isShipped, type WorkflowStep } from '../src/lib/workflowKit';
import { WORKFLOWS } from '../src/lib/workflows';
import { useBoard } from '../src/store/useBoard';
import { useDesignStore } from '../src/store/useDesignStore';
import { useHelp } from '../src/store/useHelp';
import { usePartLibrary } from '../src/store/usePartLibrary';
import { useShell } from '../src/store/useShell';
import { useSPlotStore } from '../src/store/useSPlotStore';
import { useImported } from '../src/lib/importDialog';
import { useTourStore, workflowSteps } from '../src/store/useTourStore';

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
  URL.createObjectURL = () => 'blob:qa';
  URL.revokeObjectURL = () => undefined;
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

/** Wait until `ok` holds, at most `ms`. */
async function until(ok: () => boolean, ms: number): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (ok()) return true;
    await wait(50);
  }
  return ok();
}

/** The panel with the step's buttons: the narration, or on the phone at peek the sheet head. */
const panel = (): HTMLElement =>
  (document.querySelector('.tour-panel.workflow') ??
    document.querySelector('.tour-peek')) as HTMLElement;

function clickPanelButton(name: string): void {
  fireEvent.click(within(panel()).getByRole('button', { name }));
}

function clickMenuItem(name: RegExp): void {
  fireEvent.click(screen.getByRole('menuitem', { name }));
}

/** The first control to press among the elements an anchor names (it can name several). */
function firstIn(anchor: string, selector: string): HTMLElement {
  for (const host of document.querySelectorAll<HTMLElement>(`[data-tour~="${anchor}"]`)) {
    const el = host.matches(selector) ? host : host.querySelector<HTMLElement>(selector);
    if (el) return el;
  }
  throw new Error(`nothing to press in ${anchor}`);
}

/**
 * What the user does on a predicate step beyond the step's own doIt (or in
 * place of it where there is none). Keys are workflow/step.
 */
const USER: Record<string, () => unknown> = {
  // measured-antenna/use-rows: the step's own doIt uses the rows of the open dialog.
  'measured-antenna/pick': () =>
    fireEvent.click(firstIn('match.broadband.results', '[role="menuitem"], button')),
  'buildable/bom': () => clickMenuItem(/Bill of materials/),
  'buildable/report': () => clickMenuItem(/^Report/),
  'verify/freeze': () => fireEvent.click(screen.getByRole('button', { name: /^Freeze / })),
  'verify/s2p': () => clickMenuItem(/Touchstone S-parameters/),
  'amplifier/gain': () => {
    const input = screen.getByRole('textbox', { name: 'Add gain circle' }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: input.placeholder } });
    fireEvent.keyDown(input, { key: 'Enter' });
  },
  'amplifier/match': () => {
    const row = document.querySelector<HTMLElement>(
      '.solutions [role="menuitem"], .solutions .solution-row button',
    );
    if (!row)
      throw new Error(
        `no Add parts row; tool ${useShell.getState().tool}, pane ${useShell.getState().pane}, detent ${useShell.getState().detent}`,
      );
    fireEvent.click(row);
  },
  'broadband-limits/sections': () =>
    fireEvent.click(firstIn('match.transformer.list', '[role="menuitem"], button')),
  'broadband-limits/optimize': () =>
    fireEvent.click(screen.getByRole('button', { name: 'Optimize' })),
  'real-parts/bom': () => clickMenuItem(/Bill of materials/),
  'real-frequency/use': () =>
    fireEvent.click(firstIn('match.rft.ladder', '[role="menuitem"], button')),
};

/** Steps whose own doIt is expected to satisfy the predicate without another action. */
interface Outcome {
  step: string;
  anchor: 'found' | 'missing' | 'none';
  advanced: 'by-itself' | 'next' | 'stuck' | 'last';
  note?: string;
}

async function walk(id: string): Promise<Outcome[]> {
  const w = WORKFLOWS.find((x) => x.id === id);
  if (!w) throw new Error(id);
  act(() => T().startWorkflow(id));
  const steps = workflowSteps(w);
  const out: Outcome[] = [];
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i] as WorkflowStep;
    expect(T().step, `${id}: at ${step.id}`).toBe(i);
    await wait(380);
    const anchor = step.anchor ? (findAnchor(step.anchor) ? 'found' : 'missing') : 'none';
    if (i === steps.length - 1) {
      out.push({ step: step.id, anchor, advanced: 'last' });
      break;
    }
    if (step.advance === 'next') {
      const next = within(panel()).queryByRole('button', { name: 'Next' });
      if (next) {
        act(() => fireEvent.click(next));
        out.push({ step: step.id, anchor, advanced: 'next' });
      } else {
        const sh = useShell.getState();
        out.push({
          step: step.id,
          anchor,
          advanced: 'stuck',
          note: `no Next button (detent ${sh.detent}, panel ${panel()?.className})`,
        });
        act(() => T().next());
      }
      continue;
    }
    // A step done already when it came on show offers no doIt (QA round 2): Next goes on.
    if (T().done && T().heldAtEntry) {
      const next = within(panel()).queryByRole('button', { name: 'Next' });
      if (next) {
        act(() => fireEvent.click(next));
        out.push({ step: step.id, anchor, advanced: 'next' });
        continue;
      }
    }
    // A predicate step: do it as a user would, never pressing Next.
    try {
      // The step's own button: Show me brings a missing anchor up first, then its doIt.
      const show = within(panel()).queryByRole('button', { name: 'Show me' });
      if (show) {
        await act(async () => fireEvent.click(show));
        await wait(380);
      }
      // A doIt that only opens the menu its anchor is in is not offered while that menu is
      // open (0.6.0 QA round 3): the user goes on with the menu.
      const doIt = doItLabel(step, useDesignStore.getState().design);
      if (step.doIt && within(panel()).queryByRole('button', { name: doIt })) {
        await act(async () => clickPanelButton(doIt));
        await wait(20);
      }
      const extra = USER[`${id}/${step.id}`];
      if (extra) await act(async () => extra());
    } catch (err) {
      out.push({ step: step.id, anchor, advanced: 'stuck', note: String(err) });
      act(() => T().next());
      continue;
    }
    const moved = await until(() => T().step === i + 1, 15_000);
    out.push({ step: step.id, anchor, advanced: moved ? 'by-itself' : 'stuck' });
    if (!moved) act(() => T().next());
  }
  return out;
}

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
  usePartLibrary.setState({ open: false, parts: [] });
  useBoard.getState().setBoard({ enabled: false });
  useSPlotStore.setState({ files: [] } as never);
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

describe('every step of every shipped workflow, done by its doIt or by hand, moves on by itself', () => {
  for (const [width, height] of [
    [1440, 900],
    [1024, 768],
    [768, 1024],
    [390, 844],
  ] as const) {
    for (const w of WORKFLOWS.filter(isShipped)) {
      it(`${w.id} at ${width} px`, { timeout: 240_000 }, async () => {
        await renderApp(width, height);
        const out = await walk(w.id);
        const stuck = out.filter((o) => o.advanced === 'stuck');
        const lost = out.filter((o) => o.anchor === 'missing');
        // One line per problem, for the report.
        expect(
          [
            ...stuck.map((o) => `${w.id}/${o.step} did not advance${o.note ? `: ${o.note}` : ''}`),
            ...lost.map((o) => `${w.id}/${o.step} anchor missing after the steps before it`),
          ],
          JSON.stringify(out),
        ).toEqual([]);
      });
    }
  }
});
