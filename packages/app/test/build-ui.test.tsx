// @vitest-environment jsdom
/**
 * docs/09b in the interface: the Build tool beside the chart (every edit one
 * named undo step, the chart staying on screen), the network row's summaries
 * with Edit…, Settings holding app preferences only, and the buildable
 * workflow's board step as an ordinary design change (no browser-wide flag).
 */
import { complex, DEFAULT_BOARD, DEFAULT_PACKAGES, STACKUP_PRESETS } from '@smithonline/core';
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

import { BuildPanel } from '../src/components/BuildPanel';
import { SettingsDialog } from '../src/components/SettingsDialog';
import { emptyDesign, identify, type Design } from '../src/lib/design';
import { designBuild } from '../src/lib/designBuild';
import { WORKFLOWS } from '../src/lib/workflows';
import { isShipped, shippedSteps } from '../src/lib/workflowKit';
import { useBoard } from '../src/store/useBoard';
import { useDesignStore } from '../src/store/useDesignStore';
import { useHelp } from '../src/store/useHelp';
import { usePackages } from '../src/store/usePackages';
import { useSettings } from '../src/store/useSettings';
import { useShell } from '../src/store/useShell';
import { useTourStore } from '../src/store/useTourStore';

const D = () => useDesignStore.getState();
const T = () => useTourStore.getState();
const RO4350 = STACKUP_PRESETS.find((p) => p.id === 'ro4350b-0.762')!.stackup;

function stubs(width = 1440, height = 900): void {
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

/** Shunt C and series L in 0402 on a 25 - j15 Ω load. */
function packaged(): Design {
  return {
    ...emptyDesign(),
    name: 'Mine',
    load: complex(25, -15),
    elements: identify([
      { kind: 'C', orientation: 'shunt', value: 3.3e-12, package: '0402' },
      { kind: 'L', orientation: 'series', value: 6.8e-9, package: '0402' },
    ]),
  };
}

/** Type into a field and press Enter, as the user commits it. */
function typeEnter(box: HTMLElement, text: string): void {
  fireEvent.change(box, { target: { value: text } });
  fireEvent.keyDown(box, { key: 'Enter' });
}

beforeEach(() => {
  localStorage.clear();
  useBoard.getState().reset();
  usePackages.getState().reset();
  useSettings.getState().reset();
  useShell.setState({
    guideClosed: true,
    guideShown: false,
    settings: null,
    tool: null,
    buildSection: null,
    pane: 'network',
  });
  useHelp.getState().closeHelp();
  T().close();
  D().init(packaged());
  D().setView('chart');
  D().setMessage(null);
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  T().close();
  cleanup();
  vi.unstubAllGlobals();
});

describe('the Build tool beside the chart', () => {
  it('opens from the header next to Tolerance; the chart stays on screen', async () => {
    await renderApp();
    const tools = screen.getByRole('group', { name: 'Design tools' });
    const names = within(tools)
      .getAllByRole('button')
      .map((b) => b.textContent);
    expect(names).toEqual(['Auto match', 'Optimize', 'Tolerance', 'Build']);
    const build = within(tools).getByRole('button', { name: 'Build' });
    expect(build.getAttribute('title')).toMatch(/Saved with the design/);
    fireEvent.click(build);
    expect(useShell.getState().tool).toBe('build');
    expect(document.querySelector('.build-panel')).not.toBeNull();
    expect(document.querySelector('svg.smith-chart, .chart-area svg')).not.toBeNull();
    for (const caption of ['Realization', 'Losses', 'Packages', 'Board', 'Part ratings']) {
      expect(screen.getByRole('heading', { name: caption })).toBeTruthy();
    }
    expect(screen.getByText('Saved with this design.')).toBeTruthy();
  });

  it('every Build edit is one named undo step, and Undo brings the build back exactly', () => {
    render(<BuildPanel />);
    const start = D().design;
    fireEvent.click(screen.getByRole('switch', { name: /Include the board/ }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Stackup preset' }), {
      target: { value: 'ro4350b-0.762' },
    });
    typeEnter(screen.getByRole('textbox', { name: 'Trace length between parts' }), '1 mm');
    typeEnter(screen.getByRole('textbox', { name: '0402 chip Land l' }), '0.6 mm');
    expect(D().past.length).toBe(4);
    const b = designBuild(D().design);
    expect(b.board).toMatchObject({ enabled: true, traceLength: 1e-3 });
    expect(b.board.stackup.name).toBe('RO4350B, 0.762 mm');
    expect(b.table.find((r) => r.id === '0402')?.padLength).toBe(0.6e-3);
    expect(D().design.build?.packages).toEqual([{ id: '0402', padLength: 0.6e-3 }]);
    // The browser's defaults for new designs are not touched.
    expect(useBoard.getState().board).toEqual(DEFAULT_BOARD);
    expect(usePackages.getState().table).toEqual(DEFAULT_PACKAGES);
    const said: string[] = [];
    for (let i = 0; i < 4; i++) {
      act(() => D().undo());
      said.push(D().message ?? '');
    }
    expect(said).toEqual([
      'Undo: Changed 0402: Land l to 600 µm',
      'Undo: Changed the trace between parts to 1 mm',
      'Undo: Changed the stackup to RO4350B, 0.762 mm',
      'Undo: Board on',
    ]);
    expect(D().design).toBe(start);
  });

  it('packages: the ones in use, a tag and Reset when changed, Use 0402 for all, Show all', () => {
    D().init({
      ...packaged(),
      elements: identify([
        { kind: 'C', orientation: 'shunt', value: 3.3e-12, package: '0603' },
        { kind: 'L', orientation: 'series', value: 6.8e-9 },
      ]),
    });
    render(<BuildPanel />);
    const cards = () => [...document.querySelectorAll('.build-package > summary')];
    expect(cards().map((c) => c.textContent)).toEqual(['0603 chip · 1 part']);
    typeEnter(screen.getByRole('textbox', { name: '0603 chip ESL' }), '0.7 nH');
    expect(cards()[0]?.textContent).toBe('0603 chip · 1 part · changed for this design');
    fireEvent.click(screen.getByRole('button', { name: 'Reset 0603 chip to the built-in values' }));
    expect(D().design.build?.packages).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Use 0402 for all parts' }));
    expect(D().design.elements.map((e) => ('package' in e ? e.package : null))).toEqual([
      '0402',
      '0402',
    ]);
    expect(D().message).toBe('Package 0402 for every L and C');
    fireEvent.click(screen.getByRole('button', { name: 'Show all packages' }));
    expect(cards()).toHaveLength(DEFAULT_PACKAGES.length);
  });

  it('Use as default and Reset to defaults', () => {
    render(<BuildPanel />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Stackup preset' }), {
      target: { value: 'ro4350b-0.762' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Use as default for new designs' }));
    expect(useBoard.getState().board.stackup).toEqual(RO4350);
    expect(localStorage.getItem('smithonline.board.v1')).toContain('RO4350B');
    fireEvent.change(screen.getByRole('combobox', { name: 'Stackup preset' }), {
      target: { value: 'fr4-0.8' },
    });
    const steps = D().past.length;
    fireEvent.click(screen.getByRole('button', { name: 'Reset to defaults' }));
    expect(D().past.length).toBe(steps + 1);
    expect(designBuild(D().design).board.stackup).toEqual(RO4350);
  });

  it('part ratings say they need a source power', () => {
    render(<BuildPanel />);
    expect(screen.getByText(/Needs a source power P in the design strip/)).toBeTruthy();
  });

  it('Save as my laminate puts it in the list of laminates', () => {
    render(<BuildPanel />);
    typeEnter(screen.getByRole('textbox', { name: 'Substrate height' }), '1.2 mm');
    fireEvent.click(screen.getByRole('button', { name: 'Save as my laminate' }));
    const name = screen.getByRole('textbox', { name: 'Name of the laminate' });
    fireEvent.change(name, { target: { value: 'Shop FR-4 1.2' } });
    fireEvent.submit(name.closest('form') as HTMLFormElement);
    const select = screen.getByRole('combobox', { name: 'Stackup preset' }) as HTMLSelectElement;
    expect(select.selectedOptions[0]?.textContent).toBe('Shop FR-4 1.2');
    expect(localStorage.getItem('smithonline.laminates.v1')).toContain('Shop FR-4 1.2');
  });
});

describe('the network row: summaries with Edit…', () => {
  it('Losses and Board summarise and open Build at their section', async () => {
    await renderApp();
    fireEvent.click(screen.getByRole('switch', { name: 'Losses' }));
    const losses = screen.getByRole('group', { name: 'Losses' });
    expect(losses.textContent).toMatch(/Q 50 \(L\), 500 \(C\)/);
    fireEvent.click(within(losses).getByRole('button', { name: 'Edit…' }));
    expect(useShell.getState().tool).toBe('build');
    expect(useShell.getState().buildSection?.section).toBe('losses');
    fireEvent.click(screen.getByRole('switch', { name: 'Board' }));
    const board = screen.getByRole('group', { name: 'Board' });
    expect(board.textContent).toMatch(/FR-4, 1\.6 mm, 1 via per shunt part, traces 0 mm/);
    expect(
      screen.getByRole('switch', { name: 'Board' }).closest('label')?.getAttribute('title'),
    ).toMatch(/Saved with this design/);
    // The Build switch mirrors the network row's.
    expect(
      (screen.getByRole('switch', { name: /Include the board/ }) as HTMLInputElement).checked,
    ).toBe(true);
    // Stress limits are no longer in the network panel.
    expect(document.querySelectorAll('.stress-controls')).toHaveLength(1);
    expect(document.querySelector('.build-panel .stress-controls')).not.toBeNull();
  });
});

describe('Settings: app preferences only', () => {
  it('six sections, no board or package table, "for this browser"', () => {
    render(<SettingsDialog onClose={() => undefined} theme="auto" onTheme={() => undefined} />);
    expect(screen.getByText('for this browser')).toBeTruthy();
    const heads = [...document.querySelectorAll('.settings h3')].map((h) => h.textContent);
    expect(heads).toEqual([
      'Appearance',
      'Schematic',
      'New designs',
      'Behaviour',
      'Libraries',
      'Data in this browser',
    ]);
    expect(screen.queryByRole('textbox', { name: 'Via drill diameter' })).toBeNull();
    expect(screen.queryByRole('textbox', { name: /0402 chip/ })).toBeNull();
    expect(screen.getByRole('tablist', { name: 'Theme' })).toBeTruthy();
  });

  it('New designs: Take from the open design, and the summary says it', () => {
    D().init({
      ...packaged(),
      build: { board: { ...DEFAULT_BOARD, enabled: true, stackup: RO4350 }, packages: [] },
    });
    render(<SettingsDialog onClose={() => undefined} />);
    const summary = screen.getByTestId('defaults-summary');
    expect(summary.textContent).toBe(
      'FR-4, 1.6 mm, board off, default packages, Q 50 and 500, E24',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Take from the open design' }));
    expect(summary.textContent).toBe(
      'RO4350B, 0.762 mm, board on, default packages, Q 50 and 500, E24',
    );
  });

  it('Chart at start is kept and applied; Reset all leaves the build and the defaults', () => {
    useBoard.getState().setBoard({ enabled: true });
    D().init({ ...packaged(), build: { board: { ...DEFAULT_BOARD, traceLength: 2e-3 } } });
    render(<SettingsDialog onClose={() => undefined} />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Admittance (Y) grid' }));
    expect(useSettings.getState().settings.chart.yGrid).toBe(true);
    expect(D().chart.yGrid).toBe(true);
    expect(localStorage.getItem('smithonline.settings.v1')).toContain('"yGrid":true');
    fireEvent.click(screen.getByRole('button', { name: 'Reset all…' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reset all' }));
    expect(useSettings.getState().settings.chart.yGrid).toBe(false);
    expect(useBoard.getState().board.enabled).toBe(true);
    expect(D().design.build?.board?.traceLength).toBe(2e-3);
  });
});

describe('the buildable workflow changes the design, not the browser', () => {
  it('its board step turns on the board of the design, an ordinary undoable step', async () => {
    await renderApp();
    const steps = WORKFLOWS.find((w) => w.id === 'buildable')!.steps.map((s) => s.id);
    expect(steps).toEqual([
      'realize',
      'series',
      'build-open',
      'package',
      'packages',
      'board',
      'stackup',
      'default',
      'legend',
      'response',
      'bom',
      'report',
      'done',
    ]);
    act(() => T().startWorkflow('buildable', { keep: true, at: 'board' }));
    expect(useShell.getState().tool).toBe('build');
    const before = D().past.length;
    fireEvent.click(screen.getByRole('button', { name: 'Include the board' }));
    expect(D().design.build?.board?.enabled).toBe(true);
    expect(useBoard.getState().board.enabled).toBe(false);
    expect(D().past.length).toBe(before + 1);
    act(() => T().close());
    act(() => D().undo());
    expect(D().message).toBe('Undo: Board on');
    expect(designBuild(D().design).board.enabled).toBe(false);
  });

  it('every build.* anchor of the workflows is on screen with Build open', async () => {
    await renderApp();
    act(() => D().init({ ...packaged(), realize: { ...packaged().realize, enabled: true } }));
    act(() => T().startWorkflow('buildable', { keep: true, at: 'build-open' }));
    const anchors = new Set(
      WORKFLOWS.filter(isShipped)
        .flatMap((w) => shippedSteps(w))
        .map((s) => s.anchor)
        .filter((a): a is string => a !== undefined && a.startsWith('build.')),
    );
    expect([...anchors].sort()).toEqual([
      'build.board',
      'build.default',
      'build.packages',
      'build.packages.all',
      'build.partLibrary',
      'build.realization.series',
      'build.stackup',
    ]);
    for (const a of anchors) {
      expect(document.querySelector(`[data-tour~="${a}"]`), a).not.toBeNull();
    }
    act(() => T().close());
  });
});
