// @vitest-environment jsdom
/**
 * QA round 2 fixes (0.6.0) in the app: every design in the store carries its own build, the
 * Amplifier to Broadband chain, the part library's Undo and Escape, Settings' Manage… round
 * trip, the Verify comparison step, the Build edits in the status line, and the start with an
 * autosave this version cannot read.
 */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { complex, DEFAULT_BOARD, STACKUP_PRESETS } from '@smithonline/core';

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

import { PartLibraryDialog } from '../src/components/PartLibraryDialog';
import { designFromXmlsc, emptyDesign } from '../src/lib/design';
import { designBuild } from '../src/lib/designBuild';
import { EXAMPLES } from '../src/lib/examples';
import { memoryPartStore } from '../src/lib/partStore';
import { tourSnapshot } from '../src/lib/tourSnapshot';
import { useTourEvents } from '../src/lib/tourEvents';
import { WORKFLOWS } from '../src/lib/workflows';
import * as actions from '../src/lib/buildActions';
import { useBoard } from '../src/store/useBoard';
import { useDesignStore } from '../src/store/useDesignStore';
import { usePackages } from '../src/store/usePackages';
import { usePartLibrary } from '../src/store/usePartLibrary';
import { useShell } from '../src/store/useShell';
import { useSPlotStore } from '../src/store/useSPlotStore';
import { useTourStore, workflowSteps } from '../src/store/useTourStore';

const D = () => useDesignStore.getState();
const T = () => useTourStore.getState();
const RO4350 = STACKUP_PRESETS.find((p) => p.id === 'ro4350b-0.762')!.stackup;
const example5 = () => {
  const ex = EXAMPLES.find((e) => e.file === 'Example5.xmlsc')!;
  return designFromXmlsc(ex.xml, ex.title);
};

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
}

beforeAll(stubs);
beforeEach(async () => {
  localStorage.clear();
  T().close();
  useBoard.getState().reset();
  usePackages.getState().reset();
  D().init(emptyDesign());
  D().setMessage(null);
  useShell.setState({ settings: null, tool: null });
  usePartLibrary.setState({ parts: [], open: false, fromSettings: false });
  await usePartLibrary.getState().init(memoryPartStore());
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => cleanup());

describe('every design in the store carries its own build', () => {
  it('an example, a start and a replaced design take the defaults when they come on show', () => {
    useBoard.getState().restore({ ...DEFAULT_BOARD, enabled: true, stackup: RO4350 });
    D().loadDesign(example5(), 'Loaded Example 5');
    expect(D().design.build?.board?.stackup.h).toBe(RO4350.h);
    D().init(example5());
    expect(D().design.build?.packages).toEqual([]);
    D().replaceDesign({ ...emptyDesign(), name: 'lesson step' });
    expect(D().design.build?.board?.enabled).toBe(true);
    // Defaults changed later move nothing on show or in history.
    useBoard.getState().reset();
    expect(designBuild(D().design).board.enabled).toBe(true);
  });

  it('Example 5, Board on, Use as default, Undo: the board is off again', () => {
    D().loadDesign(example5(), 'Loaded Example 5');
    actions.setBoardEnabled(true);
    expect(D().message).toBe('Board on');
    useBoard.getState().restore(designBuild(D().design).board);
    D().undo();
    expect(designBuild(D().design).board.enabled).toBe(false);
    expect(D().message).toBe('Undo: Board on');
  });
});

describe('Amplifier, then Broadband limits', () => {
  it('the chain starts Broadband with its own load as one step; Undo brings the amplifier back', () => {
    T().startWorkflow('amplifier');
    D().setTwoPort({
      s: {
        s11: complex(0.5, -0.3),
        s12: complex(0.05, 0),
        s21: complex(3, 1),
        s22: complex(0.4, -0.2),
      },
      noise: null,
    });
    const amplifier = D().design;
    act(() => T().finish(true));
    expect(T().tour?.id).toBe('broadband-limits');
    expect(D().design.name).toBe('Workflow: broadband limits');
    expect(D().design.twoPort).toBeNull();
    expect(D().design.load).toEqual(complex(25, 0));
    D().undo();
    expect(D().design.name).toBe(amplifier.name);
    expect(D().design.twoPort).not.toBeNull();
  });

  it('every chain of the workflows starts on a design its first step can use', () => {
    for (const w of WORKFLOWS) {
      if (!w.next) continue;
      const following = WORKFLOWS.find((x) => x.id === w.next)!;
      // Chained from the design the first workflow starts with.
      const first = w.start(emptyDesign(), false) ?? emptyDesign();
      const kept = following.start(first, true, true);
      const used = kept ?? first;
      // A two-port device is the amplifier's alone.
      if (following.id !== 'amplifier') expect(used.twoPort ?? null, w.id).toBeNull();
    }
  });
});

describe('the part library on the phone', () => {
  it('a removal offers Undo in the status message (the toast), and it puts the part back once', async () => {
    render(<PartLibraryDialog onClose={() => undefined} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Add synthetic examples/ }));
      await Promise.resolve();
    });
    const before = usePartLibrary.getState().parts.length;
    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'Remove SYNTH-C0402-10P from the library' }),
      );
      await Promise.resolve();
    });
    expect(usePartLibrary.getState().parts.length).toBe(before - 1);
    const action = D().messageExtras?.action;
    expect(action?.label).toBe('Undo');
    await act(async () => {
      action?.run();
      await Promise.resolve();
    });
    expect(usePartLibrary.getState().parts.length).toBe(before);
    // The dialog's own Undo went with it; the message's Undo pressed again changes nothing.
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
    await act(async () => {
      action?.run();
      await Promise.resolve();
    });
    expect(usePartLibrary.getState().parts.length).toBe(before);
  });

  it('Escape during "Remove all…" closes the question, not the dialog', async () => {
    const onClose = vi.fn();
    render(<PartLibraryDialog onClose={onClose} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Add synthetic examples/ }));
      await Promise.resolve();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Remove all…' }));
    expect(screen.getByText(/Remove all \d+ parts from the library\?/)).toBeTruthy();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    expect(screen.queryByText(/Remove all \d+ parts from the library\?/)).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('Settings, Libraries, Manage…', () => {
  it('closing the part library goes back to Settings at Libraries', async () => {
    const { App } = await import('../src/App');
    render(<App />);
    act(() => useShell.getState().openSettings());
    fireEvent.click(screen.getAllByRole('button', { name: 'Manage…' })[0]!);
    expect(useShell.getState().settings).toBeNull();
    expect(usePartLibrary.getState().open).toBe(true);
    fireEvent.click(screen.getAllByRole('button', { name: /^Close/ }).at(-1)!);
    expect(usePartLibrary.getState().open).toBe(false);
    expect(useShell.getState().settings).toEqual({ section: 'libraries' });
  });
});

describe('Verify, your simulator file', () => {
  it('a file in S-Plot from before the step does not make it done', () => {
    const verify = WORKFLOWS.find((w) => w.id === 'verify')!;
    const compare = workflowSteps(verify).find((s) => s.id === 'compare')!;
    useSPlotStore.setState({
      files: [
        { id: 'a', fileName: 'sample.s2p', visible: true } as never,
        { id: 'b', fileName: 'live', visible: true, network: 'live' } as never,
      ],
    });
    const seen = { ...useTourEvents.getState().counts };
    const at = tourSnapshot(seen, D().design);
    expect(typeof compare.advance === 'function' && compare.advance(at)).toBe(false);
    useTourEvents.getState().emit('splot-file');
    const after = tourSnapshot(seen, D().design);
    expect(typeof compare.advance === 'function' && compare.advance(after)).toBe(true);
    useSPlotStore.setState({ files: [] });
  });
});

describe('Settings, Data in this browser', () => {
  it('lists an autosave kept as a backup, with Save a copy and Clear', async () => {
    localStorage.setItem('smithonline.design.backup', '{"name":"kept"}');
    const { SettingsDialog } = await import('../src/components/SettingsDialog');
    render(<SettingsDialog onClose={() => undefined} />);
    expect(screen.getByText(/could not open, kept as/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save a copy' })).toBeTruthy();
    const line = screen
      .getByText(/could not open, kept as/)
      .closest('.settings-line') as HTMLElement;
    fireEvent.click(within(line).getByRole('button', { name: 'Clear…' }));
    fireEvent.click(within(line).getByRole('button', { name: 'Yes' }));
    expect(localStorage.getItem('smithonline.design.backup')).toBeNull();
    expect(screen.queryByText(/could not open, kept as/)).toBeNull();
  });
});
