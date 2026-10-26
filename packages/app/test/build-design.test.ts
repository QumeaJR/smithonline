/**
 * docs/09b: the build goes with the design. The board and the package models
 * are saved in the design (`build`), read back from links, `.json` files and
 * the autosave with the same checks as every other field, and a design without
 * one (saved before 0.6.0) takes this browser's defaults for new designs. The
 * as-built network, the `.s2p` and the BOM layout notes of a design with its own
 * build do not depend on the browser that opens it. One VSWR limit per design.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  complex,
  DEFAULT_BOARD,
  DEFAULT_PACKAGES,
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
const { decodeDesign, encodeDesign, shareUrl } = await import('../src/lib/share');
const old = await import('./fixtures/share-0.5.0');
const { DESIGN_STORAGE_KEY, readSavedDesign } = await import('../src/lib/autosave');
const { useBoard } = await import('../src/store/useBoard');
const { usePackages } = await import('../src/store/usePackages');
const { useSettings } = await import('../src/store/useSettings');
const { useDesignStore } = await import('../src/store/useDesignStore');
const actions = await import('../src/lib/buildActions');
const { designToS2p } = await import('../src/lib/simexport');
const { realizeDesign, effectiveElements, packagedElements } = await import('../src/lib/realize');
const { designVswrLimit } = await import('../src/lib/tolerance');
const { bandwidthText } = await import('../src/lib/tourKit');
const ns = await import('../src/lib/nextSteps');
const { DEFAULT_SETTINGS } = await import('../src/lib/settings');
const { buildableStart } = await import('../src/lib/workflows');

const D = () => useDesignStore.getState();
const RO4350 = STACKUP_PRESETS.find((p) => p.id === 'ro4350b-0.762')!.stackup;
const RO4003 = STACKUP_PRESETS.find((p) => p.id === 'ro4003c-0.508')!.stackup;

/** A buildable design: shunt C and series L in 0402 at 1 GHz, swept 0.5 to 2 GHz. */
function packaged(): Design {
  const base = emptyDesign();
  return {
    ...base,
    name: 'Build test',
    load: complex(25, -15),
    elements: identify([
      { kind: 'C', orientation: 'shunt', value: 3.3e-12, package: '0402' },
      { kind: 'L', orientation: 'series', value: 6.8e-9, package: '0402' },
    ]),
    sweep: { ...base.sweep, enabled: true, start: 0.5e9, stop: 2e9, points: 31 },
    realize: { ...base.realize, enabled: true },
  };
}

const BOARD_A: BoardSettings = {
  ...DEFAULT_BOARD,
  enabled: true,
  stackup: RO4350,
  viasPerShunt: 2,
  traceLength: 1e-3,
};
const BOARD_B: BoardSettings = {
  ...DEFAULT_BOARD,
  enabled: true,
  stackup: RO4003,
  viaDrill: 0.5e-3,
};

/** The defaults of "another browser": board B and a changed 0402 row. */
function otherBrowser(): void {
  useBoard.getState().restore(BOARD_B);
  usePackages.getState().setRow('0402', { esl: 0.9e-9, padLength: 0.8e-3 });
}

beforeEach(() => {
  memory.clear();
  useBoard.getState().reset();
  usePackages.getState().reset();
  useSettings.getState().reset();
  ns.resetBuildEdits();
  D().init(emptyDesign());
});

/** What a decoded design carries of its build, for comparing. */
const buildOf = (d: Design | null) => (d ? db.designBuild(d) : null);

describe('the absent-field rule and the resolved build', () => {
  it('a design without a build takes the browser defaults; one with a build keeps its own', () => {
    otherBrowser();
    const d = packaged();
    expect(db.designBuild(d).board).toEqual(BOARD_B);
    expect(db.designBuild(d).table.find((r) => r.id === '0402')?.esl).toBe(0.9e-9);
    const own = { ...d, build: { board: BOARD_A, packages: [] } };
    expect(db.designBuild(own).board).toEqual(BOARD_A);
    expect(db.designBuild(own).table).toBe(DEFAULT_PACKAGES);
    // Each part on its own: a build with a board only takes the default packages.
    const half = { ...d, build: { board: BOARD_A } };
    expect(db.designBuild(half).table.find((r) => r.id === '0402')?.esl).toBe(0.9e-9);
  });

  it('the package rows are stored as the numbers that differ from the built-in table', () => {
    const table = db.patchPackage(DEFAULT_PACKAGES, '0603', { esr: 0.4, padWidth: 1e-3 });
    expect(db.changesFromTable(table)).toEqual([{ id: '0603', esr: 0.4, padWidth: 1e-3 }]);
    expect(db.tableFromChanges(db.changesFromTable(table))).toEqual(table);
    expect(db.changesFromTable(DEFAULT_PACKAGES)).toEqual([]);
    // A number outside the limits keeps the current one.
    expect(db.patchPackage(DEFAULT_PACKAGES, '0603', { esl: 1 })).toEqual(DEFAULT_PACKAGES);
  });

  it('the resolved build is the same object for the same inputs (a memo dependency)', () => {
    const d = { ...packaged(), build: { board: BOARD_A, packages: [] } };
    expect(db.designBuild(d)).toBe(db.designBuild(d));
    expect(db.designBuild(emptyDesign())).toBe(db.designBuild(emptyDesign()));
  });
});

describe('round trips: link, .json file and autosave carry the build', () => {
  const withBuild = (): Design => ({
    ...packaged(),
    build: {
      board: BOARD_A,
      packages: [{ id: '0402', esl: 0.45e-9, padLength: 0.6e-3 }],
    },
  });

  it('a share link', () => {
    const d = withBuild();
    const back = decodeDesign(encodeDesign(d));
    expect(back?.build).toEqual(d.build);
    expect(buildOf(back)).toEqual(buildOf(d));
  });

  it('a .json file (the wrapper the File menu writes, with the part data)', () => {
    const d = withBuild();
    const file = JSON.stringify({
      app: 'Smith Online',
      version: 1,
      design: encodeDesign(d, { partData: true }),
    });
    const raw = JSON.parse(file) as { design: string };
    expect(decodeDesign(raw.design)?.build).toEqual(d.build);
  });

  it('the autosave', () => {
    const d = withBuild();
    memory.set(DESIGN_STORAGE_KEY, JSON.stringify(d));
    expect(readSavedDesign()?.build).toEqual(d.build);
  });

  it('a design without its own build is written with the build it evaluates with', () => {
    otherBrowser();
    const d = packaged();
    const own = db.ownBuild(d);
    expect(own.build?.board).toEqual(BOARD_B);
    expect(own.build?.packages).toEqual([{ id: '0402', esl: 0.9e-9, padLength: 0.8e-3 }]);
    // In another browser with the built-in defaults, the link evaluates as here.
    const link = encodeDesign(own);
    useBoard.getState().reset();
    usePackages.getState().reset();
    expect(buildOf(decodeDesign(link))?.board).toEqual(BOARD_B);
  });

  it('what the build adds to a link, measured (docs/09b: about 200 characters)', () => {
    const d = packaged();
    const url = (x: Design) => shareUrl(x, 'https://x/').length;
    // A preset laminate with the board on and one changed package row: the usual build.
    const usual: Design = {
      ...d,
      build: {
        board: { ...DEFAULT_BOARD, enabled: true, stackup: RO4350 },
        packages: [{ id: '0402', esl: 0.45e-9 }],
      },
    };
    // Every board number changed as well.
    const full: Design = {
      ...withBuild(),
      build: { ...withBuild().build, board: { ...BOARD_A, viaDrill: 0.4e-3, traceWidth: 0.5e-3 } },
    };
    const extra = { usual: url(usual) - url(d), full: url(full) - url(d) };
    expect(extra.usual).toBeLessThanOrEqual(250);
    // Measured: 238 and 364 characters of the link (base64 of about 180 and 270 of JSON).
    expect(extra.full).toBeLessThanOrEqual(380);
    // The preset's name and the default numbers are left out of the link and come back.
    expect(decodeDesign(encodeDesign(usual))?.build).toEqual(usual.build);
    expect(decodeDesign(encodeDesign(full))?.build).toEqual(full.build);
  });
});

describe('migration: designs saved before 0.6.0', () => {
  it('an old link, file and autosave open with this browser defaults, as they did before', () => {
    otherBrowser();
    const d = packaged();
    // The format of 0.5.0: no build field.
    const oldLink = encodeDesign(d);
    expect(JSON.stringify(decodeDesign(oldLink))).not.toContain('"build"');
    const opened = db.openedDesign(decodeDesign(oldLink)!);
    expect(opened.design.build?.board).toEqual(BOARD_B);
    expect(db.designBuild(opened.design).table.find((r) => r.id === '0402')?.esl).toBe(0.9e-9);
    memory.set(DESIGN_STORAGE_KEY, JSON.stringify(d));
    const saved = db.openedDesign(readSavedDesign()!);
    expect(saved.design.build).toEqual(opened.design.build);
  });

  it('says so once, when the default board is on; not when it is off or the design has a build', () => {
    useBoard.getState().restore(BOARD_B);
    const opened = db.openedDesign(packaged());
    expect(opened.notice).toBe(
      "Saved before the board travelled with designs: using this browser's default board (RO4003C, 0.508 mm). Check it in Build.",
    );
    // Opened once, it has its own build: no second notice.
    expect(db.openedDesign(opened.design).notice).toBeNull();
    useBoard.getState().reset();
    expect(db.openedDesign(packaged()).notice).toBeNull();
  });

  it('a link made now opens in 0.5.0: its reader ignores the build', () => {
    const d = {
      ...packaged(),
      build: { board: BOARD_A, packages: [{ id: '0402' as const, esl: 0.45e-9 }] },
    };
    const link = encodeDesign(d);
    const read = old.decodeDesign(link);
    expect(read).not.toBeNull();
    expect(read).not.toHaveProperty('build');
    expect(read?.elements.map((e) => e.kind)).toEqual(['C', 'L']);
    expect(read?.elements[0]).toMatchObject({ package: '0402', value: 3.3e-12 });
    expect(read?.realize.enabled).toBe(true);
  });
});

describe('hostile build fields are refused, never thrown', () => {
  const link = (build: unknown): string => {
    const json = JSON.stringify({ v: 1, ...packaged(), build });
    return Buffer.from(json).toString('base64url');
  };
  const cases: [string, unknown][] = [
    ['a string', 'board'],
    ['an array', [1, 2]],
    ['a board that is not an object', { board: 3 }],
    ['a board without a stackup', { board: { enabled: true } }],
    ['a stackup height out of range', { board: { ...BOARD_A, stackup: { ...RO4350, h: 5 } } }],
    ['a stackup number that is text', { board: { ...BOARD_A, stackup: { ...RO4350, er: '3' } } }],
    ['an unphysical er and tanD', { board: { ...BOARD_A, stackup: { ...RO4350, tanD: 0.5 } } }],
    ['a via drill out of range', { board: { ...BOARD_A, viaDrill: 0.5 } }],
    ['half a via', { board: { ...BOARD_A, viasPerShunt: 2.5 } }],
    ['a negative trace', { board: { ...BOARD_A, traceLength: -1 } }],
    ['an enabled that is text', { board: { ...BOARD_A, enabled: 'yes' } }],
    ['packages that are not a list', { packages: { id: '0402' } }],
    ['an unknown package', { packages: [{ id: '9999', esl: 1e-9 }] }],
    ['a package twice', { packages: [{ id: '0402' }, { id: '0402' }] }],
    ['an ESL of 1 H', { packages: [{ id: '0402', esl: 1 }] }],
    ['a negative ESR', { packages: [{ id: '0402', esr: -1 }] }],
    ['a land size that is text', { packages: [{ id: '0402', padLength: '1' }] }],
    ['a million rows', { packages: Array.from({ length: 1e6 }, () => ({ id: '0402' })) }],
  ];
  for (const [name, build] of cases) {
    it(`${name}: the link is refused`, () => {
      expect(() => decodeDesign(link(build))).not.toThrow();
      expect(decodeDesign(link(build))).toBeNull();
    });
  }

  it('the same in the autosave: it is not read (the error boundary then starts new)', () => {
    memory.set(DESIGN_STORAGE_KEY, JSON.stringify({ ...packaged(), build: { board: 'x' } }));
    expect(readSavedDesign()).toBeNull();
  });

  it('a long laminate name is cut, unknown fields are dropped, null and {} are no build', () => {
    const named = { ...BOARD_A, stackup: { ...RO4350, name: 'x'.repeat(1_000_000) }, extra: 1 };
    const back = decodeDesign(link({ board: named, packages: [{ id: '0603', foo: 1 }] }));
    expect(back?.build?.board?.stackup.name?.length).toBe(80);
    expect(back?.build?.board).not.toHaveProperty('extra');
    expect(back?.build?.packages).toEqual([]);
    expect(decodeDesign(link(null))).not.toHaveProperty('build');
    expect(decodeDesign(link({}))).not.toHaveProperty('build');
  });
});

describe('the same design gives the same network as built in any browser', () => {
  const evaluate = (d: Design) => {
    const { board, table } = db.designBuild(d);
    const realization = realizeDesign(d, effectiveElements(d));
    const ctx = { z0: d.z0, frequency: d.frequency };
    const elements = realization ? realization.ladder.elements : d.elements;
    return {
      locus: JSON.stringify(packagedElements(elements, table, board, ctx)),
      s2p: designToS2p(d, realization, table, board).replace(/^!.*\d{4}-\d{2}-\d{2}.*$/gm, ''),
      bom: layoutAssumptions(elements, table, board, ctx),
    };
  };

  it('the as-built locus, the .s2p and the BOM layout notes do not follow the defaults', () => {
    const d = {
      ...packaged(),
      build: { board: BOARD_A, packages: [{ id: '0402' as const, esl: 0.45e-9 }] },
    };
    const here = evaluate(d);
    otherBrowser();
    const there = evaluate(decodeDesign(encodeDesign(d))!);
    expect(there).toEqual(here);
    expect(here.bom.join(' ')).toMatch(/RO4350B/);
    // Without its own build, the same design does follow them (the 0.5.0 behaviour).
    useBoard.getState().reset();
    usePackages.getState().reset();
    const bare = evaluate(packaged());
    otherBrowser();
    expect(evaluate(packaged()).s2p).not.toEqual(bare.s2p);
  });
});

describe('Build edits are design steps', () => {
  it('each edit is one named undo step, and Undo restores the as-built network exactly', () => {
    D().init(packaged());
    const before = D().design;
    const built = () => JSON.stringify(db.designBuild(D().design));
    const start = built();
    actions.setBoardEnabled(true);
    expect(D().message ?? D().past.length).toBeTruthy();
    actions.applyPreset('ro4350b-0.762');
    actions.setBoardNumber('traceLength', 1e-3);
    actions.setPackageNumber('0402', 'esl', 0.45e-9);
    expect(D().past.length).toBe(4);
    expect(db.designBuild(D().design).board.stackup.name).toBe('RO4350B, 0.762 mm');
    D().undo();
    expect(D().message).toBe('Undo: Changed 0402: ESL to 450 pH');
    D().undo();
    expect(D().message).toBe('Undo: Changed the trace between parts to 1 mm');
    D().undo();
    expect(D().message).toBe('Undo: Changed the stackup to RO4350B, 0.762 mm');
    D().undo();
    expect(D().message).toBe('Undo: Board on');
    expect(D().design).toBe(before);
    expect(built()).toBe(start);
    // The browser's defaults were never touched.
    expect(useBoard.getState().board).toEqual(DEFAULT_BOARD);
  });

  it('an edit that changes nothing records nothing', () => {
    D().init({ ...packaged(), build: { board: DEFAULT_BOARD, packages: [] } });
    actions.setBoardEnabled(false);
    actions.setBoardNumber('viaDrill', DEFAULT_BOARD.viaDrill);
    expect(D().past.length).toBe(0);
  });

  it('Reset to defaults is one step back to the defaults for new designs', () => {
    useBoard.getState().restore(BOARD_B);
    D().init({ ...packaged(), build: { board: BOARD_A, packages: [{ id: '0402', esl: 1e-9 }] } });
    actions.resetBuildToDefaults();
    expect(D().past.length).toBe(1);
    expect(db.designBuild(D().design).board).toEqual(BOARD_B);
    expect(db.designBuild(D().design).table).toEqual(DEFAULT_PACKAGES);
    D().undo();
    expect(D().design.build?.board).toEqual(BOARD_A);
  });

  it('Use as default writes the old browser keys; New design copies them', () => {
    D().init({
      ...packaged(),
      build: { board: BOARD_A, packages: [{ id: '0402', esl: 0.45e-9 }] },
      losses: { enabled: false, inductorQ: 40, capacitorQ: 300 },
    });
    db.keepAsDefaults(D().design);
    expect(JSON.parse(memory.get('smithonline.board.v1') ?? '{}')).toMatchObject({
      enabled: true,
      viasPerShunt: 2,
    });
    expect(memory.get('smithonline.packages.v1')).toContain('4.5e-10');
    useSettings.getState().update({ defaultVswrLimit: 1.5 });
    D().newDesign();
    const n = D().design;
    expect(n.build?.board).toEqual(BOARD_A);
    expect(n.build?.packages).toEqual([{ id: '0402', esl: 0.45e-9 }]);
    expect(n.losses).toMatchObject({ inductorQ: 40, capacitorQ: 300 });
    expect(designVswrLimit(n)).toBe(1.5);
    expect(db.defaultsSummary(useSettings.getState().settings, db.browserBuildDefaults())).toBe(
      'RO4350B, 0.762 mm, board on, 1 package changed, Q 40 and 300, E24',
    );
  });

  it('the new design of an untouched browser has the built-in build', () => {
    D().newDesign();
    expect(D().design.build).toEqual({ board: DEFAULT_BOARD, packages: [] });
    expect(D().design.tolerance).toBeUndefined();
    expect(DEFAULT_SETTINGS.defaultVswrLimit).toBe(2);
  });
});

describe('one VSWR limit per design', () => {
  /** The reference L match of the robust workflow (VSWR about 1.3 at f), without its limit. */
  const matched = (): Design => {
    const { tolerance: _t, ...rest } = buildableStart();
    void _t;
    return rest;
  };

  it('the readout, Tolerance and the tours read the same number, set in one place', () => {
    D().init(matched());
    expect(designVswrLimit(D().design)).toBe(2);
    D().setVswrLimit(1.5);
    expect(D().past.length).toBe(1);
    expect(D().design.tolerance?.vswrLimit).toBe(1.5);
    expect(bandwidthText(D().design)).toMatch(/For VSWR below 1\.50 the usable band/);
    D().undo();
    expect(D().message).toBe('Undo: Changed the VSWR limit to 1.5');
    expect(designVswrLimit(D().design)).toBe(2);
  });

  it('the next step "a match lands" judges against the design limit', () => {
    useSettings.getState().update({ suggestNextSteps: true });
    D().init(emptyDesign(), { fresh: true });
    D().loadDesign({ ...matched(), tolerance: { ...matchedTolerance(), vswrLimit: 1.0001 } });
    // Edited since it was opened, so suggestions are on.
    D().setVswrLimit(1.0002);
    ns.noteMatchAdded('add');
    expect(ns.useNextStep.getState().suggestion).toBeNull();
    D().setVswrLimit(2);
    ns.noteMatchAdded('add');
    expect(ns.useNextStep.getState().suggestion?.id).toBe('check-tolerance');
  });
});

function matchedTolerance() {
  return {
    runs: 1000,
    seed: 1,
    distribution: 'uniform' as const,
    percent: null,
    vswrLimit: 2,
    overBand: false,
    overrides: {},
  };
}
