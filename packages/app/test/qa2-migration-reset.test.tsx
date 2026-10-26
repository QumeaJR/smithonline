// @vitest-environment jsdom
/**
 * QA round 2, 0.6.0 (docs/09b sections 2.3 a, d, e and 6): an autosave written by 0.5.0
 * opens with this browser's board and package table, says so once, and is saved back with
 * its build, so a later change of the defaults no longer moves it. Settings' Reset all leaves
 * every default for new designs, the build of the design on show and its Undo alone. A link
 * written now reads in the 0.5.0 reader with what 0.5.0 knows of it.
 */
import { complex, DEFAULT_BOARD, STACKUP_PRESETS, type BoardSettings } from '@smithonline/core';
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

import { SettingsDialog } from '../src/components/SettingsDialog';
import { DESIGN_STORAGE_KEY, readSavedDesign } from '../src/lib/autosave';
import { emptyDesign, identify, type Design } from '../src/lib/design';
import { designBuild, openedDesign, resetDefaults, startNotice } from '../src/lib/designBuild';
import { DEFAULT_TOLERANCE } from '../src/lib/tolerance';
import { encodeDesign } from '../src/lib/share';
import * as old from './fixtures/share-0.5.0';
import { useBoard } from '../src/store/useBoard';
import { useDesignStore } from '../src/store/useDesignStore';
import { useLaminates } from '../src/store/useLaminates';
import { usePackages } from '../src/store/usePackages';
import { useSettings } from '../src/store/useSettings';
import { useShell } from '../src/store/useShell';

const D = () => useDesignStore.getState();
const RO4003 = STACKUP_PRESETS.find((p) => p.id === 'ro4003c-0.508')!.stackup;
const RO4350 = STACKUP_PRESETS.find((p) => p.id === 'ro4350b-0.762')!.stackup;
const BOARD_B: BoardSettings = {
  ...DEFAULT_BOARD,
  enabled: true,
  stackup: RO4003,
  viaDrill: 0.5e-3,
};

/**
 * An autosave as 0.5.0 wrote it (JSON.stringify of its Design): no build, no tolerance, the
 * 0402 package on both parts, Realize on.
 */
const AUTOSAVE_050 = JSON.stringify({
  name: 'Old antenna',
  z0: 50,
  frequency: 1e9,
  load: { re: 25, im: -15 },
  target: null,
  elements: [
    { id: 'a', kind: 'C', orientation: 'shunt', value: 3.3e-12, package: '0402', color: '#1f77b4' },
    { id: 'b', kind: 'L', orientation: 'series', value: 6.8e-9, package: '0402', color: '#ff7f0e' },
  ],
  vswrCircles: [],
  qContours: [],
  sweep: { enabled: true, start: 5e8, stop: 2e9, points: 101 },
  twoPort: null,
  showStability: false,
  gainCircles: [],
  noiseCircles: [],
  realize: { enabled: true, series: 'E24', stockText: '', scope: 'all' },
  losses: { enabled: false, inductorQ: 50, capacitorQ: 500 },
});

function stubs(): void {
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
}

beforeEach(() => {
  localStorage.clear();
  useBoard.getState().reset();
  usePackages.getState().reset();
  useSettings.getState().reset();
  useShell.setState({ guideClosed: true, guideShown: false, settings: null, tool: null });
  D().init(emptyDesign());
  D().setMessage(null);
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('an autosave from 0.5.0', () => {
  it('opens with this browser board and packages, says so once, and is saved back with them', async () => {
    useBoard.getState().restore(BOARD_B);
    usePackages.getState().setRow('0402', { esl: 0.9e-9 });
    localStorage.setItem(DESIGN_STORAGE_KEY, AUTOSAVE_050);
    // main.tsx: readSavedDesign, openedDesign, init, startNotice.
    const opened = openedDesign(readSavedDesign()!);
    expect(opened.notice).toBe(
      "Saved before the board travelled with designs: using this browser's default board (RO4003C, 0.508 mm). Check it in Build.",
    );
    D().init(opened.design);
    startNotice.text = opened.notice;
    stubs();
    const { App } = await import('../src/App');
    await act(async () => {
      render(<App />);
    });
    expect(D().message).toBe(opened.notice);
    expect(startNotice.text).toBeNull();
    // The autosave now carries the build it evaluated with.
    const saved = JSON.parse(localStorage.getItem(DESIGN_STORAGE_KEY)!) as Design;
    expect(saved.build?.board).toEqual(BOARD_B);
    expect(saved.build?.packages).toEqual([{ id: '0402', esl: 0.9e-9 }]);
    // Defaults changed later: the design keeps its build and is not announced again.
    useBoard.getState().reset();
    usePackages.getState().reset();
    const again = openedDesign(readSavedDesign()!);
    expect(again.notice).toBeNull();
    expect(designBuild(again.design).board).toEqual(BOARD_B);
    expect(designBuild(again.design).table.find((r) => r.id === '0402')?.esl).toBe(0.9e-9);
  });

  it('with the default board off it takes the changed package row and says nothing', () => {
    usePackages.getState().setRow('0402', { esl: 0.9e-9 });
    localStorage.setItem(DESIGN_STORAGE_KEY, AUTOSAVE_050);
    const opened = openedDesign(readSavedDesign()!);
    expect(opened.notice).toBeNull();
    expect(opened.design.build?.board).toEqual(DEFAULT_BOARD);
    expect(opened.design.build?.packages).toEqual([{ id: '0402', esl: 0.9e-9 }]);
  });
});

describe('a link written now, read by 0.5.0', () => {
  it('a design from changed defaults (limit 1.5, 2 % parts, board on a laminate of your own) reads with its limit', () => {
    const d: Design = {
      ...emptyDesign(),
      load: complex(25, -15),
      elements: identify([
        { kind: 'C', orientation: 'shunt', value: 3.3e-12, package: '0603' },
        { kind: 'L', orientation: 'series', value: 6.8e-9, package: '0603' },
      ]),
      tolerance: { ...DEFAULT_TOLERANCE, percent: 2, vswrLimit: 1.5 },
      build: {
        board: { ...DEFAULT_BOARD, enabled: true, stackup: { ...RO4350, h: 0.5e-3, name: 'Mine' } },
        packages: [{ id: '0603', esl: 0.7e-9, padWidth: 0.9e-3 }],
      },
    };
    const read = old.decodeDesign(encodeDesign(d));
    expect(read).not.toBeNull();
    expect(read).not.toHaveProperty('build');
    expect(read?.tolerance?.vswrLimit).toBe(1.5);
    expect(read?.tolerance?.percent).toBe(2);
    expect(
      read?.elements.map((e) => (e.kind === 'C' || e.kind === 'L' ? e.package : null)),
    ).toEqual(['0603', '0603']);
  });
});

describe('Settings, Reset all', () => {
  it('leaves every default for new designs, the laminates, the design build, its limit and its Undo', () => {
    useBoard.getState().restore(BOARD_B);
    usePackages.getState().setRow('0603', { esr: 0.4 });
    useSettings.getState().update({
      defaultFrequency: 2.4e9,
      defaultZ0: 75,
      defaultInductorQ: 30,
      defaultCapacitorQ: 300,
      defaultSeries: 'E96',
      defaultTolerancePercent: 2,
      defaultVswrLimit: 1.5,
      suggestNextSteps: false,
      gridWidth: 2,
    });
    useLaminates.getState().save('My board', { ...RO4350, h: 0.5e-3 });
    const laminates = useLaminates.getState().laminates;
    D().init({
      ...emptyDesign(),
      elements: identify([{ kind: 'L', orientation: 'series', value: 6.8e-9, package: '0402' }]),
      build: {
        board: { ...DEFAULT_BOARD, traceLength: 2e-3 },
        packages: [{ id: '0402', esl: 1e-9 }],
      },
    });
    D().setVswrLimit(1.7);
    const design = D().design;
    const past = D().past.length;
    const board = useBoard.getState().board;
    const table = usePackages.getState().table;

    render(<SettingsDialog onClose={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: 'Reset all…' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reset all' }));

    const s = useSettings.getState().settings;
    // Reset: appearance and behaviour.
    expect(s.gridWidth).toBe(1);
    expect(s.suggestNextSteps).toBe(true);
    // Kept: the defaults for new designs.
    expect(s.defaultFrequency).toBe(2.4e9);
    expect(s.defaultZ0).toBe(75);
    expect(s.defaultInductorQ).toBe(30);
    expect(s.defaultCapacitorQ).toBe(300);
    expect(s.defaultSeries).toBe('E96');
    expect(s.defaultTolerancePercent).toBe(2);
    expect(s.defaultVswrLimit).toBe(1.5);
    expect(useBoard.getState().board).toBe(board);
    expect(usePackages.getState().table).toBe(table);
    expect(useLaminates.getState().laminates).toBe(laminates);
    // Kept: the design on show, its limit and its history.
    expect(D().design).toBe(design);
    expect(D().design.tolerance?.vswrLimit).toBe(1.7);
    expect(D().past.length).toBe(past);
  });
});

describe('a design on show without a build (an example, an .xmlsc, a lesson)', () => {
  it('reopens from the autosave as it is on screen after the defaults change', async () => {
    useBoard.getState().restore(BOARD_B);
    const { build: _b, ...bare } = JSON.parse(AUTOSAVE_050) as Design;
    void _b;
    D().init({ ...emptyDesign(), ...bare, elements: identify(bare.elements) });
    stubs();
    const { App } = await import('../src/App');
    await act(async () => {
      render(<App />);
    });
    // The design took the default board when it came on show, and keeps it when Settings, New
    // designs, Reset sets the default board back to off.
    act(() => resetDefaults());
    const onScreen = designBuild(D().design).board;
    expect(onScreen).toEqual(BOARD_B);
    // What the next start shows (main.tsx reads the autosave).
    const reopened = designBuild(openedDesign(readSavedDesign()!).design).board;
    expect(reopened).toEqual(onScreen);
  });
});
