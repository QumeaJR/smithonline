/**
 * QA round 1 on docs/09 section 4: every row of the next-step table that has
 * shipped. Each rule fires with the label of the table, does what the table
 * says, is withdrawn by any other change, stays silent on an opened file or a
 * share link before the first edit, and stays silent with the setting off.
 * Expected labels and actions are the spec's table, not the code's output.
 */
import { complex, DEFAULT_BOARD } from '@smithonline/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const memory = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => memory.get(k) ?? null,
  setItem: (k: string, v: string) => void memory.set(k, v),
  removeItem: (k: string) => void memory.delete(k),
  clear: () => memory.clear(),
});

const { emptyDesign } = await import('../src/lib/design');
const ns = await import('../src/lib/nextSteps');
const { useDesignStore } = await import('../src/store/useDesignStore');
const { useSettings } = await import('../src/store/useSettings');
const { useTourStore } = await import('../src/store/useTourStore');
const { useShell } = await import('../src/store/useShell');
const { useBoard } = await import('../src/store/useBoard');
const { applyPreset, setBoardEnabled } = await import('../src/lib/buildActions');
const { usePartLibrary } = await import('../src/store/usePartLibrary');
const { useSPlotStore } = await import('../src/store/useSPlotStore');
const { fileShortcuts } = await import('../src/lib/shortcuts');
const { DEFAULT_SETTINGS } = await import('../src/lib/settings');
const { WORKFLOWS } = await import('../src/lib/workflows');
const { workflowSteps } = await import('../src/store/useTourStore');
const { emitTourEvent } = await import('../src/lib/tourEvents');

const D = () => useDesignStore.getState();
const suggestion = () => ns.useNextStep.getState().suggestion;

/** 100 - j50 at 1 GHz matched exactly by shunt L + series C (the L match of yield.test.ts). */
const MATCH = [
  { kind: 'L' as const, orientation: 'shunt' as const, value: 11.5346728762e-9 },
  { kind: 'C' as const, orientation: 'series' as const, value: 2.5989893374e-12 },
];

/**
 * Rows of a series RLC over 0.9 to 1.1 GHz: a measured load with 11 rows. R 100 ohm, L 10 nH and
 * C chosen so the reactance at 1 GHz is -50 ohm: the row at f is the 100 - j50 of MATCH.
 */
const W0 = 2 * Math.PI * 1e9;
const C0 = 1 / (W0 * (W0 * 10e-9 + 50));
const ROWS = Array.from({ length: 11 }, (_, i) => {
  const f = 0.9e9 + i * 0.02e9;
  const w = 2 * Math.PI * f;
  return { frequency: f, z: complex(100, w * 10e-9 - 1 / (w * C0)) };
});

function useMeasuredLoad(): void {
  D().step('Datapoint sweep', (d) => ({
    ...d,
    load: ROWS[5]?.z ?? d.load,
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
}

/** Stable: S11 = S22 = 0.3, S21 = 2, S12 = 0.05, all real. K = 0.8201 / 0.2 = 4.1, |delta| = 0.01. */
const STABLE = {
  s11: complex(0.3, 0),
  s12: complex(0.05, 0),
  s21: complex(2, 0),
  s22: complex(0.3, 0),
};
/** Unstable: S11 = S22 = 0.8, S21 = 3, S12 = 0.3. K = (1 - 1.28 + 0.0676) / 1.8 < 0. */
const UNSTABLE = {
  s11: complex(0.8, 0),
  s12: complex(0.3, 0),
  s21: complex(3, 0),
  s22: complex(0.8, 0),
};

beforeEach(() => {
  memory.clear();
  useSettings.setState({ settings: DEFAULT_SETTINGS });
  useTourStore.getState().close();
  useShell.setState({ tool: null, matchMode: null, pane: 'network' });
  useBoard.getState().setBoard({ enabled: false });
  usePartLibrary.setState({ parts: [], open: false });
  useSPlotStore.setState({ files: [] } as never);
  D().init({ ...emptyDesign({ frequency: 1e9 }), load: complex(100, -50) }, { fresh: true });
  D().setView('chart');
  D().setMessage(null);
  ns.useNextStep.setState({ suggestion: null });
});

describe('each row of docs/09 section 4 fires and does what it says', () => {
  it('Add parts with a measured load: Optimize over the band, which opens Optimize band', () => {
    useMeasuredLoad();
    D().addElements(MATCH, 'Added');
    ns.noteMatchAdded('add');
    expect(suggestion()?.label).toBe('Optimize over the band');
    suggestion()?.run();
    expect(useShell.getState().tool).toBe('optimize');
  });

  it('a Tune over a measured load that lands: Check tolerance, over band on', () => {
    useMeasuredLoad();
    // The row at 1 GHz is 100 - j50, which MATCH brings to 50 ohm.
    D().addElements(MATCH, 'Added');
    ns.noteMatchAdded('tune');
    expect(suggestion()?.label).toBe('Check tolerance');
    suggestion()?.run();
    expect(useShell.getState().tool).toBe('montecarlo');
    expect(D().design.tolerance?.overBand ?? true).toBe(true);
  });

  it('a match that does not land (VSWR at f above the limit) offers nothing', () => {
    // A series 1 nH on 100 - j50: Zin = 100 - j43.7, VSWR well above 2.
    D().addElements([{ kind: 'L', orientation: 'series', value: 1e-9 }], 'Added');
    ns.noteMatchAdded('add');
    expect(suggestion()).toBeNull();
  });

  it('a match call with no parts offers nothing', () => {
    ns.noteMatchAdded('suggestion');
    expect(suggestion()).toBeNull();
  });

  it('Broadband result applied: Check tolerance over the band, which opens Tolerance over the band', () => {
    D().setSweep({ enabled: true, start: 0.9e9, stop: 1.1e9 });
    D().addElements(MATCH, 'Added');
    ns.noteBroadbandApplied();
    expect(suggestion()?.label).toBe('Check tolerance over the band');
    suggestion()?.run();
    expect(useShell.getState().tool).toBe('montecarlo');
    expect(D().design.tolerance?.overBand).toBe(true);
  });

  it('Broadband best over 1.5 times the limit: Allow more parts; at 1.5 times or without a limit: nothing', () => {
    D().setFrequency(1.01e9); // an edit
    ns.noteBroadbandResult(1.5, 1);
    expect(suggestion()).toBeNull();
    ns.noteBroadbandResult(Infinity, 1);
    expect(suggestion()).toBeNull();
    ns.noteBroadbandResult(NaN, 1);
    expect(suggestion()).toBeNull();
    ns.noteBroadbandResult(3, null);
    expect(suggestion()).toBeNull();
    ns.noteBroadbandResult(1.51, 1);
    expect(suggestion()?.label).toBe('Allow more parts');
    expect(suggestion()?.text).toMatch(/1\.51.*1(\.00)?\b/);
    suggestion()?.run();
    expect(useShell.getState().tool).toBe('match');
    expect(useShell.getState().matchMode).toBe('broadband');
  });

  it('a yield at exactly 90 % asks for no centring; just under does', () => {
    D().setFrequency(1.01e9);
    ns.noteToleranceResult(0.9, null);
    expect(suggestion()).toBeNull();
    ns.noteToleranceResult(0.8999, null);
    expect(suggestion()?.label).toBe('Centre for yield');
  });

  it('a part at exactly 50 % of the spread is not dominant; at a yield of 90 % or more nothing is', () => {
    D().setFrequency(1.01e9);
    emitTourEvent('centre-result');
    ns.noteToleranceResult(0.8, { label: 'Shunt L 1', share: 0.5 });
    expect(suggestion()?.id).toBe('centre');
    D().setFrequency(1.02e9);
    ns.noteToleranceResult(0.95, { label: 'Shunt L 1', share: 0.9 });
    expect(suggestion()).toBeNull();
  });

  it('centring applied with Realize already on offers nothing; with library parts it realizes to the library', () => {
    D().addElements(MATCH, 'Added');
    D().setRealize({ enabled: true });
    ns.noteCentred();
    expect(suggestion()).toBeNull();
    D().setRealize({ enabled: false });
    usePartLibrary.setState({ parts: [{} as never] });
    ns.noteCentred();
    expect(suggestion()?.label).toBe('Realize to standard values');
    suggestion()?.run();
    expect(D().design.realize).toMatchObject({ enabled: true, series: 'library' });
  });

  it('Realize turned on: Open Build at Packages; Part library and empty: Load part files; no L or C: nothing', () => {
    D().addElements(MATCH, 'Added');
    D().setRealize({ enabled: true });
    ns.noteRealizeOn();
    expect(suggestion()?.label).toBe('Open Build');
    expect(suggestion()?.workflow).toEqual({ id: 'buildable', at: 'package' });
    suggestion()?.run();
    expect(useShell.getState().tool).toBe('build');
    expect(useShell.getState().buildSection?.section).toBe('packages');
    D().setRealize({ enabled: true, series: 'library' });
    ns.noteRealizeOn();
    expect(suggestion()?.label).toBe('Load part files');
    suggestion()?.run();
    expect(usePartLibrary.getState().open).toBe(true);
    // A line only: nothing to package.
    D().init(
      {
        ...emptyDesign({ frequency: 1e9 }),
        load: complex(100, -50),
        realize: { ...emptyDesign().realize, enabled: true },
      },
      { fresh: true },
    );
    D().addElements(
      [{ kind: 'line', orientation: 'series', z0: 50, length: 0.1, refFrequency: 1e9 } as never],
      'Added a line',
    );
    ns.noteRealizeOn();
    expect(suggestion()).toBeNull();
  });

  it('Board turned on with Realize on: Export the BOM, which opens the File menu at Export', () => {
    const exportMenu = vi.fn();
    fileShortcuts.current = { exportMenu } as never;
    D().addElements(MATCH, 'Added');
    D().setRealize({ enabled: true });
    // The built-in FR-4 asks to check the stackup first, which opens Build at Board.
    setBoardEnabled(true);
    expect(suggestion()?.label).toBe('Check the stackup');
    suggestion()?.run();
    expect(useShell.getState().buildSection?.section).toBe('board');
    setBoardEnabled(false);
    applyPreset('ro4350b-0.762');
    setBoardEnabled(true);
    expect(suggestion()?.label).toBe('Export the BOM');
    suggestion()?.run();
    expect(exportMenu).toHaveBeenCalledTimes(1);
    fileShortcuts.current = null;
  });

  it('.s2p exported: Compare in S-Plot, which adds the live network and switches to S-Plot', () => {
    D().addElements(MATCH, 'Added');
    ns.noteS2pExported();
    expect(suggestion()?.label).toBe('Compare in S-Plot');
    suggestion()?.run();
    expect(D().view).toBe('splot');
    expect(useSPlotStore.getState().files.some((f) => f.network === 'live')).toBe(true);
  });

  it('a stable device: Check stability; a potentially unstable one: Draw stability circles, which draws them', () => {
    D().setTwoPort({ s: STABLE, noise: null });
    ns.noteDevice();
    expect(suggestion()?.label).toBe('Check stability');
    D().setTwoPort({ s: UNSTABLE, noise: null });
    D().setShowStability(false);
    ns.noteDevice();
    expect(suggestion()?.label).toBe('Draw stability circles');
    expect(suggestion()?.text).toMatch(/Potentially unstable \(K -0\.1/);
    suggestion()?.run();
    expect(D().design.showStability).toBe(true);
  });

  it('a device call without a device offers nothing', () => {
    ns.noteDevice();
    expect(suggestion()).toBeNull();
  });

  it('an empty library note with parts in the library offers nothing', () => {
    usePartLibrary.setState({ parts: [{} as never] });
    ns.noteEmptyLibrary();
    expect(suggestion()).toBeNull();
  });
});

/** Every shipped rule, with the design it needs on show and anything outside the design. */
type D0 = ReturnType<typeof emptyDesign>;
const same = (d: D0): D0 => d;
const RULES: readonly {
  name: string;
  design: (d: D0) => D0;
  outside?: () => void;
  fire: () => void;
}[] = [
  { name: 'measured load', design: same, fire: () => ns.noteMeasuredLoad() },
  {
    name: 'match at f',
    design: (d) => ({ ...d, elements: withIds(MATCH) }),
    fire: () => ns.noteMatchAdded('add'),
  },
  { name: 'broadband applied', design: same, fire: () => ns.noteBroadbandApplied() },
  { name: 'broadband far', design: same, fire: () => ns.noteBroadbandResult(3, 1) },
  { name: 'low yield', design: same, fire: () => ns.noteToleranceResult(0.4, null) },
  {
    name: 'centred',
    design: (d) => ({ ...d, elements: withIds(MATCH) }),
    fire: () => ns.noteCentred(),
  },
  {
    name: 'realize on',
    design: (d) => ({ ...d, elements: withIds(MATCH), realize: { ...d.realize, enabled: true } }),
    fire: () => ns.noteRealizeOn(),
  },
  {
    name: 'board on',
    // The board is the design's own (0.6.0): on in the design, not in the browser's defaults.
    design: (d) => ({
      ...d,
      realize: { ...d.realize, enabled: true },
      build: { board: { ...DEFAULT_BOARD, enabled: true }, packages: [] },
    }),
    fire: () => ns.noteBoardOn(),
  },
  { name: 's2p exported', design: same, fire: () => ns.noteS2pExported() },
  {
    name: 'device',
    design: (d) => ({ ...d, twoPort: { s: STABLE, noise: null } }),
    fire: () => ns.noteDevice(),
  },
  { name: 'empty library', design: same, fire: () => ns.noteEmptyLibrary() },
];

function withIds(els: typeof MATCH) {
  return els.map((el, i) => ({ ...el, id: `q${i}`, color: '#000' }));
}

const base = (): D0 => ({ ...emptyDesign({ frequency: 1e9 }), load: complex(100, -50) });

describe('for every rule: withdrawn, silent on an opened file or a share link, silent when off', () => {
  for (const rule of RULES) {
    it(`${rule.name}: fires on a new design, and any other change withdraws it`, () => {
      D().init(rule.design(base()), { fresh: true });
      rule.outside?.();
      rule.fire();
      expect(suggestion(), rule.name).not.toBeNull();
      D().setLoad(complex(60, 10));
      expect(suggestion(), rule.name).toBeNull();
    });

    it(`${rule.name}: silent on an opened file before its first edit, offered after it`, () => {
      D().loadDesign({ ...rule.design(base()), name: 'opened' }, 'Opened a.json');
      rule.outside?.();
      rule.fire();
      expect(suggestion(), rule.name).toBeNull();
      D().setFrequency(1.0001e9);
      rule.fire();
      expect(suggestion(), rule.name).not.toBeNull();
    });

    it(`${rule.name}: silent on a share link before its first edit`, () => {
      D().init({ ...rule.design(base()), name: 'shared' }, { fresh: false });
      rule.outside?.();
      rule.fire();
      expect(suggestion(), rule.name).toBeNull();
    });

    it(`${rule.name}: silent with Suggest next steps off`, () => {
      useSettings.getState().update({ suggestNextSteps: false });
      D().init(rule.design(base()), { fresh: true });
      rule.outside?.();
      rule.fire();
      expect(suggestion(), rule.name).toBeNull();
    });
  }
});

describe('Show me of every suggestion names a shipped step', () => {
  it('each workflow and step a rule points at exists', () => {
    const seen: { id: string; at?: string }[] = [];
    for (const rule of RULES) {
      ns.useNextStep.setState({ suggestion: null });
      useBoard.getState().setBoard({ enabled: false });
      D().init(rule.design(base()), { fresh: true });
      rule.outside?.();
      rule.fire();
      const w = suggestion()?.workflow;
      if (w) seen.push(w);
    }
    expect(seen.length).toBeGreaterThanOrEqual(8);
    for (const { id, at } of seen) {
      const w = WORKFLOWS.find((x) => x.id === id);
      expect(w, id).toBeDefined();
      if (w && at)
        expect(
          workflowSteps(w).map((s) => s.id),
          `${id}/${at}`,
        ).toContain(at);
    }
  });
});
