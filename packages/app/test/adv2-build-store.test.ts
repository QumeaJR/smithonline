/**
 * Adversarial QA round 2 (0.6.0): Build store actions, undo and redo, the migration of old
 * designs and the per-design VSWR limit.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { complex, DEFAULT_BOARD, STACKUP_PRESETS, type BoardSettings } from '@smithonline/core';

const memory = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => memory.get(k) ?? null,
  setItem: (k: string, v: string) => void memory.set(k, v),
  removeItem: (k: string) => void memory.delete(k),
  clear: () => memory.clear(),
});

const { emptyDesign, identify, designFromXmlsc } = await import('../src/lib/design');
type Design = import('../src/lib/design').Design;
const db = await import('../src/lib/designBuild');
const { decodeDesign, encodeDesign } = await import('../src/lib/share');
const { useBoard } = await import('../src/store/useBoard');
const { usePackages } = await import('../src/store/usePackages');
const { useSettings } = await import('../src/store/useSettings');
const { useDesignStore } = await import('../src/store/useDesignStore');
const actions = await import('../src/lib/buildActions');
const ns = await import('../src/lib/nextSteps');
const { EXAMPLES } = await import('../src/lib/examples');

const D = () => useDesignStore.getState();
const RO4350 = STACKUP_PRESETS.find((p) => p.id === 'ro4350b-0.762')!.stackup;
const BOARD_A: BoardSettings = {
  ...DEFAULT_BOARD,
  enabled: true,
  stackup: RO4350,
  viasPerShunt: 2,
};

function packaged(): Design {
  const base = emptyDesign();
  return {
    ...base,
    name: 'adv2 store',
    load: complex(25, -15),
    elements: identify([
      { kind: 'C', orientation: 'shunt', value: 3.3e-12, package: '0402' },
      { kind: 'L', orientation: 'series', value: 6.8e-9, package: '0402' },
    ]),
  };
}

beforeEach(() => {
  memory.clear();
  useBoard.getState().reset();
  usePackages.getState().reset();
  useSettings.getState().reset();
  ns.resetBuildEdits();
  D().init(emptyDesign());
});

describe('undo of a Build edit restores the network as built', () => {
  it('an example (no build): Board on, Use as default, Undo -> the board is off again', () => {
    const ex = EXAMPLES.find((e) => e.file === 'Example5.xmlsc')!;
    const example = designFromXmlsc(ex.xml, ex.title);
    D().loadDesign(example, 'Opened Example 5');
    expect(db.designBuild(D().design).board.enabled).toBe(false);
    actions.setBoardEnabled(true);
    expect(db.designBuild(D().design).board.enabled).toBe(true);
    // Build footer: Use as default for new designs (or the Buildable workflow's Do it).
    db.keepAsDefaults(D().design);
    D().undo();
    expect(db.designBuild(D().design).board.enabled, 'Undo of "Board on" leaves the board on').toBe(
      false,
    );
  });

  it('a .json-opened design (own build): the same sequence restores it', () => {
    const d = db.openedDesign(packaged()).design;
    D().loadDesign(d, 'Opened x.json');
    actions.setBoardEnabled(true);
    db.keepAsDefaults(D().design);
    D().undo();
    expect(db.designBuild(D().design).board.enabled).toBe(false);
  });

  it('Reset to defaults and its Undo restore the build exactly', () => {
    D().loadDesign(
      { ...packaged(), build: { board: BOARD_A, packages: [{ id: '0402', esl: 0.45e-9 }] } },
      'x',
    );
    const before = db.designBuild(D().design);
    actions.resetBuildToDefaults();
    expect(db.designBuild(D().design).board.enabled).toBe(false);
    D().undo();
    expect(db.sameBuild(db.designBuild(D().design), before)).toBe(true);
  });
});

describe('a saved or shared example keeps the build it was saved with (docs/09b section 7)', () => {
  it('an example saved as .json, then Settings > New designs > Reset: the design on screen moves', () => {
    useBoard.getState().restore(BOARD_A);
    const ex = EXAMPLES.find((e) => e.file === 'Example5.xmlsc')!;
    D().loadDesign(designFromXmlsc(ex.xml, ex.title), 'Opened Example 5');
    // File > Save .json and Share do this (Header.tsx 213 and 261); the design on show is not changed.
    const saved = encodeDesign(db.ownBuild(D().design), { partData: true });
    expect(decodeDesign(saved)?.build?.board?.enabled).toBe(true);
    const past = D().past.length;
    db.resetDefaults();
    expect(D().past.length).toBe(past);
    expect(
      db.designBuild(D().design).board.enabled,
      'after Save, the example still follows the defaults: its board went off with no step',
    ).toBe(true);
  });
});

describe('no-op Build edits record no step', () => {
  it('the same stackup number, the same preset, the same switch, after a link', () => {
    const link = encodeDesign({ ...packaged(), build: { board: BOARD_A, packages: [] } });
    const d = decodeDesign(link)!;
    D().loadDesign(d, 'Opened link');
    const n = D().past.length;
    actions.setStackup({ h: RO4350.h });
    actions.applyPreset('ro4350b-0.762');
    actions.setBoardEnabled(true);
    actions.setBoardNumber('viasPerShunt', 2);
    actions.setPackageNumber(
      '0402',
      'esl',
      db.designBuild(D().design).table.find((r) => r.id === '0402')!.esl,
    );
    expect(D().past.length).toBe(n);
  });
});

describe('hostile numbers through the Build actions never reach the design', () => {
  const bad = [NaN, Infinity, -Infinity, -1, 1e300, -0];
  for (const v of bad) {
    it(`package esl ${v}`, () => {
      D().loadDesign(db.openedDesign(packaged()).design, 'x');
      const n = D().past.length;
      actions.setPackageNumber('0402', 'esl', v);
      const esl = db.designBuild(D().design).table.find((r) => r.id === '0402')!.esl;
      expect(Number.isFinite(esl) && esl >= 0).toBe(true);
      if (!Object.is(v, -0)) expect(D().past.length).toBe(n);
    });
    it(`stackup h ${v}`, () => {
      D().loadDesign(db.openedDesign(packaged()).design, 'x');
      actions.setStackup({ h: v });
      const h = db.designBuild(D().design).board.stackup.h;
      expect(Number.isFinite(h) && h > 0).toBe(true);
      // The link and the autosave still read.
      expect(decodeDesign(encodeDesign(D().design))).not.toBeNull();
    });
  }
});

describe('migration: two old links in a row, a default change in between, Undo', () => {
  it('the first link keeps the board it opened with after the second opens and Undo', () => {
    useBoard.getState().restore(BOARD_A);
    const first = db.openedDesign(decodeDesign(encodeDesign(packaged()))!);
    expect(first.notice).toMatch(/default board/);
    D().loadDesign(first.design, 'Opened link 1');
    // The default board changes (Settings, New designs, Reset).
    db.resetDefaults();
    expect(db.designBuild(D().design).board).toEqual(BOARD_A);
    const second = db.openedDesign(decodeDesign(encodeDesign({ ...packaged(), name: 'two' }))!);
    expect(second.notice).toBeNull();
    D().loadDesign(second.design, 'Opened link 2');
    expect(db.designBuild(D().design).board.enabled).toBe(false);
    D().undo();
    expect(db.designBuild(D().design).board).toEqual(BOARD_A);
    D().redo();
    expect(db.designBuild(D().design).board.enabled).toBe(false);
  });
});
