/**
 * QA round 2, 0.6.0 (docs/09b section 6, QA): the same design with its own build gives the
 * same SPICE and LTspice notes, S-Plot entry, report layout notes, tour numbers and new
 * microstrips under two different browser defaults, after a link and a .json round trip.
 * The expected values come from the spec (the design's build decides, the browser's does not).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  complex,
  DEFAULT_BOARD,
  layoutAssumptions,
  STACKUP_PRESETS,
  type BoardSettings,
} from '@smithonline/core';

const memory = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => memory.get(k) ?? null,
  setItem: (k: string, v: string) => void memory.set(k, v),
  removeItem: (k: string) => void memory.delete(k),
  clear: () => memory.clear(),
});

const { emptyDesign, identify } = await import('../src/lib/design');
type Design = import('../src/lib/design').Design;
const db = await import('../src/lib/designBuild');
const { decodeDesign, encodeDesign } = await import('../src/lib/share');
const { useBoard } = await import('../src/store/useBoard');
const { usePackages } = await import('../src/store/usePackages');
const { useSettings } = await import('../src/store/useSettings');
const { useDesignStore } = await import('../src/store/useDesignStore');
const { useSPlotStore } = await import('../src/store/useSPlotStore');
const sim = await import('../src/lib/simexport');
const { realizeDesign, effectiveElements } = await import('../src/lib/realize');
const { addNetworkToSPlot } = await import('../src/lib/splotNetwork');
const { newMicrostrip } = await import('../src/lib/elements');

const D = () => useDesignStore.getState();
const RO4350 = STACKUP_PRESETS.find((p) => p.id === 'ro4350b-0.762')!.stackup;
const RO4003 = STACKUP_PRESETS.find((p) => p.id === 'ro4003c-0.508')!.stackup;

/** Shunt C and series L in 0402, Realize on, swept 0.5 to 2 GHz. */
function packaged(): Design {
  const base = emptyDesign();
  return {
    ...base,
    name: 'Parity',
    load: complex(25, -15),
    elements: identify([
      { kind: 'C', orientation: 'shunt', value: 3.3e-12, package: '0402' },
      { kind: 'L', orientation: 'series', value: 6.8e-9, package: '0402' },
    ]),
    sweep: { ...base.sweep, enabled: true, start: 0.5e9, stop: 2e9, points: 21 },
    realize: { ...base.realize, enabled: true },
  };
}

const BOARD_ON_RO4350: BoardSettings = {
  ...DEFAULT_BOARD,
  enabled: true,
  stackup: RO4350,
  viasPerShunt: 2,
  traceLength: 1e-3,
};

/** "Another browser": its default board is on, on RO4003C, and its 0402 row is changed. */
function otherBrowser(): void {
  useBoard.getState().restore({ ...DEFAULT_BOARD, enabled: true, stackup: RO4003 });
  usePackages.getState().setRow('0402', { esl: 0.9e-9, padLength: 0.8e-3 });
}
function builtInBrowser(): void {
  useBoard.getState().reset();
  usePackages.getState().reset();
}

/** What the File menu writes (Header.tsx composes the exports from designBuild(design)). */
function exportsOf(d: Design) {
  const { board, table } = db.designBuild(d);
  const realization = realizeDesign(d, effectiveElements(d));
  const elements = realization ? realization.ladder.elements : effectiveElements(d);
  return {
    spice: sim.designToSpice(d, realization, board),
    ltspice: sim.designToLtspice(d, realization, board),
    s2p: sim.designToS2p(d, realization, table, board).replace(/^!.*\d{4}-\d{2}-\d{2}.*$/gm, ''),
    notes: layoutAssumptions(elements, table, board, { z0: d.z0, frequency: d.frequency }),
  };
}

beforeEach(() => {
  memory.clear();
  builtInBrowser();
  useSettings.getState().reset();
  useSPlotStore.setState({ files: [] });
  D().init(emptyDesign());
});

describe('SPICE, LTspice, .s2p and report notes follow the design, not the browser', () => {
  it('a design with the board off says only that packages are left out, though the browser default board is on', () => {
    const d = { ...packaged(), build: { board: DEFAULT_BOARD, packages: [] } };
    otherBrowser();
    const linked = decodeDesign(encodeDesign(d))!;
    const out = exportsOf(linked);
    // Second line of the netlist: the comment of simLeftOutNote; the board is off in the design.
    expect(out.spice.split('\n')[1]).toBe(`* ${sim.PACKAGE_NOTE}`);
    expect(out.ltspice).toContain(sim.PACKAGE_NOTE);
    expect(out.ltspice).not.toContain('The board');
    // The .s2p says no board and has no stackup line.
    expect(out.s2p).toContain('no board');
    expect(out.s2p).not.toContain('Board stackup');
  });

  it('a design with its board on gives byte-identical exports and notes in both browsers, through a link and a .json', () => {
    const d = {
      ...packaged(),
      build: { board: BOARD_ON_RO4350, packages: [{ id: '0402' as const, esl: 0.45e-9 }] },
    };
    const here = exportsOf(d);
    otherBrowser();
    const viaLink = exportsOf(decodeDesign(encodeDesign(d))!);
    const file = JSON.parse(
      JSON.stringify({
        app: 'Smith Online',
        version: 1,
        design: encodeDesign(d, { partData: true }),
      }),
    ) as { design: string };
    const viaFile = exportsOf(decodeDesign(file.design)!);
    expect(viaLink).toEqual(here);
    expect(viaFile).toEqual(here);
    expect(here.spice.split('\n')[1]).toBe(`* ${sim.PACKAGE_BOARD_NOTE}`);
    // The stackup line names the design's laminate, never the browser's.
    expect(here.s2p).toMatch(/Board stackup: RO4350B/);
    expect(here.s2p).not.toMatch(/RO4003C/);
    expect(here.notes.join(' ')).toMatch(/RO4350B/);
    expect(here.notes.join(' ')).not.toMatch(/RO4003C/);
  });
});

describe('modules that read the build on show', () => {
  it('Add the network to S-Plot gives the same curves under two browser defaults', () => {
    D().init({
      ...packaged(),
      build: { board: BOARD_ON_RO4350, packages: [{ id: '0402', esl: 0.45e-9 }] },
    });
    addNetworkToSPlot();
    const first = useSPlotStore.getState().files.map((f) => f.data);
    otherBrowser();
    addNetworkToSPlot();
    const second = useSPlotStore.getState().files.map((f) => f.data);
    expect(first).toHaveLength(1);
    expect(second).toEqual(first);
  });

  it('a new microstrip takes the stackup of the design on show, not the default board', () => {
    otherBrowser();
    D().init({ ...packaged(), build: { board: BOARD_ON_RO4350, packages: [] } });
    const ms = newMicrostrip(50, 1e9);
    expect(ms.stackup.h).toBe(RO4350.h);
    expect(ms.stackup.er).toBe(RO4350.er);
    // A design without a build follows the defaults (RO4003C here), as before 0.6.0.
    D().init(packaged());
    expect(newMicrostrip(50, 1e9).stackup.h).toBe(RO4003.h);
  });
});

describe('the resolved build: branches the existing tests do not reach', () => {
  it('a build object kept across a change of defaults follows the new defaults where it has no part', () => {
    const build = { packages: [] };
    const a = db.resolveBuild(build, db.BUILT_IN_BUILD);
    expect(a.board).toBe(DEFAULT_BOARD);
    const other = { board: BOARD_ON_RO4350, table: db.BUILT_IN_BUILD.table };
    const b = db.resolveBuild(build, other);
    expect(b.board).toBe(BOARD_ON_RO4350);
  });

  it('an empty build object is no build: it is the defaults themselves', () => {
    expect(db.resolveBuild({}, db.BUILT_IN_BUILD)).toBe(db.BUILT_IN_BUILD);
  });

  it('opening a design with its board but no package rows fills the rows and says nothing', () => {
    otherBrowser();
    const opened = db.openedDesign({ ...packaged(), build: { board: DEFAULT_BOARD } });
    expect(opened.notice).toBeNull();
    expect(opened.design.build?.board).toEqual(DEFAULT_BOARD);
    expect(opened.design.build?.packages).toEqual([{ id: '0402', esl: 0.9e-9, padLength: 0.8e-3 }]);
  });

  it('opening a design with package rows but no board takes the default board and says so', () => {
    otherBrowser();
    const opened = db.openedDesign({ ...packaged(), build: { packages: [] } });
    expect(opened.notice).toContain('RO4003C, 0.508 mm');
    expect(opened.design.build?.board?.stackup.h).toBe(RO4003.h);
    expect(opened.design.build?.packages).toEqual([]);
  });

  it('a board whose stackup holds a preset numbers without its name reads back unchanged from a link', () => {
    const { name: _n, ...unnamed } = RO4350;
    void _n;
    const d = {
      ...packaged(),
      build: { board: { ...BOARD_ON_RO4350, stackup: unnamed }, packages: [] },
    };
    const back = decodeDesign(encodeDesign(d));
    expect(back?.build).toEqual(d.build);
  });

  it('the summary of the defaults names the part library and one changed package', () => {
    const settings = { ...useSettings.getState().settings, defaultSeries: 'library' as const };
    const table = db.patchPackage(db.BUILT_IN_BUILD.table, '0603', { esr: 0.4 });
    expect(db.defaultsSummary(settings, { board: DEFAULT_BOARD, table })).toBe(
      'FR-4, 1.6 mm, board off, 1 package changed, Q 50 and 500, part library',
    );
  });

  it('the board in one line: plural vias, the trace in mm to 0.01 mm', () => {
    expect(db.boardSummary({ ...BOARD_ON_RO4350, traceLength: 1.2345e-3 })).toBe(
      'RO4350B, 0.762 mm, 2 vias per shunt part, traces 1.23 mm',
    );
    expect(db.boardSummary(DEFAULT_BOARD)).toBe('FR-4, 1.6 mm, 1 via per shunt part, traces 0 mm');
  });

  it('a stackup patch that changes a number drops the laminate name; a bad number keeps the current one', () => {
    const b = db.patchStackup(BOARD_ON_RO4350, { h: 1e-3 });
    expect(b.stackup.h).toBe(1e-3);
    expect(b.stackup.name).toBeUndefined();
    const same = db.patchStackup(BOARD_ON_RO4350, { h: -1 });
    expect(same.stackup.h).toBe(RO4350.h);
  });

  it('Use as default keeps the default series when the design uses a stock list', () => {
    useSettings.getState().update({ defaultSeries: 'E96' });
    db.keepAsDefaults({ ...packaged(), realize: { ...packaged().realize, series: 'stock' } });
    expect(useSettings.getState().settings.defaultSeries).toBe('E96');
  });

  it('a new design carries no tolerance while the defaults are the built-in ones, and the limit when it is not', () => {
    expect(db.newDesignFromDefaults().tolerance).toBeUndefined();
    useSettings.getState().update({ defaultVswrLimit: 1.5 });
    expect(db.newDesignFromDefaults().tolerance?.vswrLimit).toBe(1.5);
    expect(db.newDesignFromDefaults().tolerance?.percent).toBeNull();
  });
});
