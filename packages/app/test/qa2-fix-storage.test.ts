/**
 * QA round 2 fixes (0.6.0), the blocker: the exact package tables 0.5.0 could leave in
 * `smithonline.packages.v1`, and every reader taking what the app itself wrote. One rule for a
 * package number (core PACKAGE_LIMITS) in the browser defaults, the Build fields and the
 * readers; an autosave this version cannot read is kept under a backup key, never overwritten.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  complex,
  DEFAULT_BOARD,
  DEFAULT_PACKAGES,
  STACKUP_PRESETS,
  droppedPackageNumbers,
  normalizePackageTable,
} from '@smithonline/core';

const memory = new Map<string, string>();
let refuse: ((key: string) => boolean) | null = null;
vi.stubGlobal('localStorage', {
  getItem: (k: string) => memory.get(k) ?? null,
  setItem: (k: string, v: string) => {
    if (refuse?.(k)) throw new Error('QuotaExceededError');
    memory.set(k, v);
  },
  removeItem: (k: string) => void memory.delete(k),
  clear: () => memory.clear(),
});

const { emptyDesign, identify } = await import('../src/lib/design');
type Design = import('../src/lib/design').Design;
const db = await import('../src/lib/designBuild');
const { decodeDesign, designFromJsonFile, encodeDesign } = await import('../src/lib/share');
const autosave = await import('../src/lib/autosave');
const { useBoard } = await import('../src/store/useBoard');
const { usePackages, loadPackageTable, packagesDropped } = await import('../src/store/usePackages');

const { DESIGN_STORAGE_KEY, readSavedDesign, keepUnreadableAutosave, autosaveHold } = autosave;
const PACKAGES_KEY = 'smithonline.packages.v1';
const ESL_0805 = DEFAULT_PACKAGES.find((p) => p.id === '0805')!.esl;

/** The 0.5.0 store wrote every row with its six numbers (usePackages.ts at v0.5.0). */
const FULL_050 = JSON.stringify(
  DEFAULT_PACKAGES.map(({ id, esl, cp, esr, pad, padLength, padWidth }) => ({
    id,
    esl: id === '0805' ? 10 : esl,
    cp,
    esr,
    pad,
    padLength,
    padWidth,
  })),
);

/** An autosave as 0.5.0 wrote it: no build, an 0805 capacitor and inductor. */
const AUTOSAVE_050 = JSON.stringify({
  name: 'Old design',
  z0: 50,
  frequency: 1e9,
  load: { re: 25, im: -15 },
  target: null,
  elements: [
    { id: 'a', kind: 'C', orientation: 'shunt', value: 3.3e-12, package: '0805', color: '#111' },
    { id: 'b', kind: 'L', orientation: 'series', value: 6.8e-9, package: '0805', color: '#222' },
  ],
  vswrCircles: [],
  qContours: [],
  sweep: { enabled: false, start: 5e8, stop: 2e9, points: 101 },
  twoPort: null,
  showStability: false,
  gainCircles: [],
  noiseCircles: [],
  realize: { enabled: false, series: 'E24', stockText: '', scope: 'all' },
  losses: { enabled: false, inductorQ: 50, capacitorQ: 500 },
});

/** The .json file File, Save .json writes. */
const jsonFile = (d: Design): string =>
  JSON.stringify({ app: 'Smith Online', version: 1, design: encodeDesign(d, { partData: true }) });

/** What the app writes and reads back: the autosave, a link and a .json file of the design. */
function roundTrips(d: Design): { autosave: Design | null; link: Design | null; json: string } {
  const own = db.ownBuild(d);
  memory.set(DESIGN_STORAGE_KEY, JSON.stringify(own));
  const file = designFromJsonFile(jsonFile(own));
  return {
    autosave: readSavedDesign(),
    link: decodeDesign(encodeDesign(own)),
    json: 'value' in file ? 'read' : file.problem,
  };
}

function startWith(packagesV1: string): void {
  memory.clear();
  memory.set(PACKAGES_KEY, packagesV1);
  packagesDropped.list = [];
  usePackages.setState({ table: loadPackageTable() });
}

beforeEach(() => {
  memory.clear();
  refuse = null;
  autosaveHold.held = false;
  packagesDropped.list = [];
  useBoard.getState().reset();
  usePackages.getState().reset();
});

describe('the package tables 0.5.0 left in smithonline.packages.v1', () => {
  for (const [name, stored] of [
    ['[{"id":"0805","esl":10}] (the QA input)', '[{"id":"0805","esl":10}]'],
    ['every row with its six numbers, 0805 ESL 10', FULL_050],
  ] as const) {
    it(`${name}: the 10 H goes back to the built-in ESL, once, with a message naming it`, () => {
      startWith(stored);
      const row = usePackages.getState().table.find((r) => r.id === '0805')!;
      expect(row.esl).toBe(ESL_0805);
      expect(packagesDropped.list).toEqual([{ id: '0805', key: 'esl', value: 10 }]);
      expect(db.droppedPackagesNotice(packagesDropped.list)).toBe(
        'The package defaults for new designs held numbers out of range, now the built-in ones: 0805 ESL 10 H. Check them in Build.',
      );
      // Stored back without it: the next start says nothing.
      expect(memory.get(PACKAGES_KEY)).not.toMatch(/"esl":10\b/);
      packagesDropped.list = [];
      loadPackageTable();
      expect(packagesDropped.list).toEqual([]);
    });

    it(`${name}: a 0.5.0 autosave, a new design and a link all read back`, () => {
      startWith(stored);
      // A 0.5.0 autosave opened (main.tsx), then autosaved, linked and saved as .json.
      memory.set(DESIGN_STORAGE_KEY, AUTOSAVE_050);
      const first = readSavedDesign();
      expect(first?.name).toBe('Old design');
      const opened = db.openedDesign(first!).design;
      const old = roundTrips(opened);
      expect(old.autosave?.name).toBe('Old design');
      expect(old.link?.name).toBe('Old design');
      expect(old.json).toBe('read');
      // New, with elements in the 0805 package.
      const fresh = {
        ...db.newDesignFromDefaults(),
        elements: identify([{ kind: 'C', orientation: 'shunt', value: 1e-12, package: '0805' }]),
      } as Design;
      const made = roundTrips(fresh);
      expect(made.autosave).not.toBeNull();
      expect(made.link).not.toBeNull();
      expect(made.json).toBe('read');
    });
  }

  it('the rule is one: every stored number the defaults keep, the reader takes', () => {
    const stored = [
      { id: '0402', esl: 1e-6, cp: 1e-9, esr: 1000, pad: 1e-9, padLength: 0.1, padWidth: 0.1 },
      { id: '0603', esl: 1.0000001e-6, cp: -1, esr: 1001, pad: 2e-9, padLength: 0.2 },
    ];
    const table = normalizePackageTable(stored);
    expect(droppedPackageNumbers(stored).map((d) => `${d.id} ${d.key}`)).toEqual([
      '0603 esl',
      '0603 cp',
      '0603 esr',
      '0603 pad',
      '0603 padLength',
    ]);
    const d = db.ownBuild(
      { ...emptyDesign(), load: complex(25, -15) },
      { board: DEFAULT_BOARD, table },
    );
    expect(decodeDesign(encodeDesign(d))?.build?.packages).toEqual(d.build?.packages);
    // The Build fields keep the same rule: a number out of range keeps the current one.
    expect(db.patchPackage(table, '0402', { esl: 2e-6 })).toEqual(table);
  });
});

describe('the link writer and reader agree at the edges', () => {
  it('a stackup whose rounded fRef would leave the model band is written at full precision', () => {
    const fr4 = STACKUP_PRESETS[0]!.stackup;
    const d: Design = {
      ...emptyDesign(),
      build: {
        board: { ...DEFAULT_BOARD, stackup: { ...fr4, tanD: 0, fRef: 1000.0000001 } },
        packages: [],
      },
    };
    const back = decodeDesign(encodeDesign(d));
    expect(back?.build?.board?.stackup.fRef).toBe(1000.0000001);
  });

  it('a nameless stackup with a preset numbers reads back nameless', () => {
    const { name: _n, ...unnamed } = STACKUP_PRESETS[0]!.stackup;
    void _n;
    const d: Design = {
      ...emptyDesign(),
      build: { board: { ...DEFAULT_BOARD, stackup: unnamed }, packages: [] },
    };
    expect(decodeDesign(encodeDesign(d))?.build?.board?.stackup.name).toBeUndefined();
    const named: Design = {
      ...emptyDesign(),
      build: { board: DEFAULT_BOARD, packages: [] },
    };
    expect(decodeDesign(encodeDesign(named))?.build?.board?.stackup.name).toBe(
      DEFAULT_BOARD.stackup.name,
    );
  });
});

describe('an autosave this version cannot read', () => {
  const hostile = JSON.stringify({
    ...JSON.parse(AUTOSAVE_050),
    build: { packages: [{ id: '0805', esl: 10 }] },
  });

  it('is kept under a backup key before anything writes over it, once per text', () => {
    memory.set(DESIGN_STORAGE_KEY, hostile);
    expect(readSavedDesign()).toBeNull();
    const kept = keepUnreadableAutosave();
    expect(kept).toEqual({ text: hostile, key: autosave.BACKUP_KEY_PREFIX });
    expect(memory.get(autosave.BACKUP_KEY_PREFIX)).toBe(hostile);
    // The same text again (the start ran twice) is not kept twice.
    expect(keepUnreadableAutosave()?.key).toBe(autosave.BACKUP_KEY_PREFIX);
    expect(autosave.autosaveBackups()).toEqual([autosave.BACKUP_KEY_PREFIX]);
    // Another unreadable one goes beside it.
    memory.set(DESIGN_STORAGE_KEY, `${hostile} `);
    expect(keepUnreadableAutosave()?.key).toBe(`${autosave.BACKUP_KEY_PREFIX}.2`);
    expect(autosaveHold.held).toBe(false);
  });

  it('a readable autosave, or none, keeps nothing', () => {
    expect(keepUnreadableAutosave()).toBeNull();
    memory.set(DESIGN_STORAGE_KEY, AUTOSAVE_050);
    expect(keepUnreadableAutosave()).toBeNull();
    expect(autosave.autosaveBackups()).toEqual([]);
  });

  it('when storage has no room for the copy, autosave is held so the design is not lost', () => {
    memory.set(DESIGN_STORAGE_KEY, 'not json {');
    refuse = (k) => k.startsWith(autosave.BACKUP_KEY_PREFIX);
    expect(keepUnreadableAutosave()).toEqual({ text: 'not json {', key: null });
    expect(autosaveHold.held).toBe(true);
  });
});

describe('a .json file says why it does not open', () => {
  const good = (): Design => ({ ...emptyDesign(), name: 'x' });
  it.each([
    ['', 'the file is empty'],
    ['  \n', 'the file is empty'],
    ['{"app":"Smith Online","design":', 'the file is not JSON (it may be cut short)'],
    ['{"app":"Smith Online"}', 'not a Smith Online design file'],
    ['{"design":"!!!"}', 'the design in it is damaged (it cannot be decoded)'],
  ])('%j: %s', (text, problem) => {
    expect(designFromJsonFile(text)).toEqual({ problem });
  });

  it('a bad board names the field', () => {
    const raw = JSON.parse(Buffer.from(encodeDesign(good()), 'base64url').toString('utf8'));
    raw.build = { board: { stackup: { ...STACKUP_PRESETS[0]!.stackup, h: -1 } } };
    const design = Buffer.from(JSON.stringify(raw)).toString('base64url');
    expect(designFromJsonFile(JSON.stringify({ design }))).toEqual({
      problem: 'the board in it is not usable: the height h is outside 1 µm to 100 mm',
    });
    raw.build = { board: { stackup: STACKUP_PRESETS[0]!.stackup, viasPerShunt: 2.5 } };
    const vias = Buffer.from(JSON.stringify(raw)).toString('base64url');
    expect(designFromJsonFile(JSON.stringify({ design: vias }))).toEqual({
      problem: 'the board in it is not usable: the vias per shunt part is out of range',
    });
    raw.build = { packages: [{ id: '0805', esl: 10 }] };
    const pk = Buffer.from(JSON.stringify(raw)).toString('base64url');
    expect(designFromJsonFile(JSON.stringify({ design: pk }))).toEqual({
      problem: 'the package models in it are not usable: 0805 ESL is out of range',
    });
  });
});
