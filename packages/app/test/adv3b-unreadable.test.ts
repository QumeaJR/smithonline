/**
 * Adversarial QA round 3b (0.6.0 verification): designs the app itself puts in the store that its
 * own readers (autosave, link, .json) then refuse; the backup slots.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  complex,
  DEFAULT_STACKUP,
  dsLowestPermittivity,
  isUsableMicrostripLength,
  MICROSTRIP_LENGTH,
  isUsableStackup,
  microstripDimensions,
  parameterBound,
  type Stackup,
} from '@smithonline/core';

const memory = new Map<string, string>();
let refuseWrites = false;
vi.stubGlobal('localStorage', {
  getItem: (k: string) => memory.get(k) ?? null,
  setItem: (k: string, v: string) => {
    if (refuseWrites) throw new DOMException('quota', 'QuotaExceededError');
    memory.set(k, v);
  },
  removeItem: (k: string) => void memory.delete(k),
  clear: () => memory.clear(),
  key: (i: number) => [...memory.keys()][i] ?? null,
  get length() {
    return memory.size;
  },
});

const { emptyDesign, identify } = await import('../src/lib/design');
const { ownBuild } = await import('../src/lib/designBuild');
const { decodeDesign, encodeDesign, designFileOfText, designFromJsonFile, readDesign } =
  await import('../src/lib/share');
const autosave = await import('../src/lib/autosave');
const { DESIGN_STORAGE_KEY, readSavedDesign, keepUnreadableAutosave, autosaveHold } = autosave;
const { withPrimaryValue } = await import('../src/lib/elements');
const { useDesignStore } = await import('../src/store/useDesignStore');

const D = () => useDesignStore.getState();

/** What App.tsx's autosave effect writes. */
const autosaveNow = (): void =>
  void memory.set(DESIGN_STORAGE_KEY, JSON.stringify(ownBuild(D().design)));
/** What Header's Save .json writes. */
const jsonFile = (): string =>
  JSON.stringify({
    app: 'Smith Online',
    version: 1,
    design: encodeDesign(ownBuild(D().design), { partData: true }),
  });

beforeEach(() => {
  memory.clear();
  refuseWrites = false;
  autosaveHold.held = false;
});

describe('a microstrip the app makes longer than its readers allowed (10 m)', () => {
  // Fixed in round 3: one length rule (core MICROSTRIP_LENGTH, 0 to 1 km) for every maker and
  // every reader; tests/qa3-length-rule.test.ts walks the makers at and past the new limit.
  it('Dimensions, Use microstrip, on a quarter-wave line at 3.5 MHz: autosave, link and .json read it', () => {
    D().init({
      ...emptyDesign({ frequency: 3.5e6, z0: 50 }),
      name: 'HF match',
      load: complex(25, -15),
      elements: identify([{ kind: 'line', z0: 50, length: 0.25 }]),
    });
    // DimensionsDialog.tsx "Use microstrip", same computation and the same step.
    const stackup = DEFAULT_STACKUP;
    const ms = microstripDimensions(stackup, 50, 0.25, 3.5e6)!;
    // The dialog's condition for offering the button.
    expect(isUsableMicrostripLength(ms.length)).toBe(true);
    D().step('Line 1 built as a microstrip on FR-4', (d) => ({
      ...d,
      elements: d.elements.map((e) => ({
        id: e.id,
        color: e.color,
        kind: 'microstrip' as const,
        width: ms.width,
        length: ms.length,
        stackup,
      })),
    }));
    expect(D().design.elements[0]).toMatchObject({ kind: 'microstrip' });
    const len = (D().design.elements[0] as { length: number }).length;
    autosaveNow();
    expect({
      length: len,
      autosaveReads: readSavedDesign() !== null,
      linkReads: decodeDesign(encodeDesign(ownBuild(D().design))) !== null,
      jsonReads: 'value' in designFromJsonFile(jsonFile()),
    }).toEqual({ length: len, autosaveReads: true, linkReads: true, jsonReads: true });
  });

  it('the tune slider at its right end (5x) on a 2.5 m microstrip makes 12.5 m, which reads back', () => {
    const ms = microstripDimensions(DEFAULT_STACKUP, 50, 0.1, 10e6)!;
    D().init({
      ...emptyDesign({ frequency: 10e6, z0: 50 }),
      elements: identify([
        { kind: 'microstrip', width: ms.width, length: 2.5, stackup: DEFAULT_STACKUP },
      ]),
    });
    const el = D().design.elements[0]!;
    // Ladder.tsx tune slider: updateElement(index, withPrimaryValue(element, center * 5 ** v), true)
    D().updateElement(0, withPrimaryValue(el, 2.5 * 5 ** 1), true);
    D().commit('Tuned microstrip 1');
    autosaveNow();
    expect((D().design.elements[0] as { length: number }).length).toBe(12.5);
    expect(readSavedDesign()).not.toBeNull();
  });

  it('Optimize band bounds a microstrip at 7 MHz within the length every reader takes', () => {
    const ms = microstripDimensions(DEFAULT_STACKUP, 50, 0.1, 7e6)!;
    const b = parameterBound(
      { kind: 'microstrip', width: ms.width, length: 1, stackup: DEFAULT_STACKUP },
      50,
      7e6,
    )!;
    expect(b.hi).toBeGreaterThan(11);
    expect(b.hi).toBeLessThanOrEqual(MICROSTRIP_LENGTH.max);
  });
});

describe('the backup of an unreadable autosave', () => {
  const unreadable = (n: number): string =>
    JSON.stringify({
      ...ownBuild(emptyDesign()),
      name: `lost ${n}`,
      elements: [{ kind: 'microstrip', width: 3e-3, length: 2000 + n, stackup: DEFAULT_STACKUP }],
    });

  // Fixed in round 3: Save a copy writes a design file (designFileOfText). File, Open reads it
  // with the reader of links and files: an autosave the 10 m rule refused (12 m) now opens, and
  // one this version still cannot open says why; a raw autosave copy saved before the fix reads.
  it('Save a copy gives a design file File, Open reads', () => {
    const was = JSON.stringify({
      ...ownBuild(emptyDesign()),
      name: 'kept at 12 m',
      elements: [{ kind: 'microstrip', width: 3e-3, length: 12, stackup: DEFAULT_STACKUP }],
    });
    const opened = designFromJsonFile(designFileOfText(was));
    expect('value' in opened ? opened.value.name : opened.problem).toBe('kept at 12 m');
    memory.set(DESIGN_STORAGE_KEY, unreadable(0));
    const kept = keepUnreadableAutosave()!;
    expect(kept.problem).toBe('element 1 of its network must be 0 to 1 km long (it would be 2 km)');
    const read = designFromJsonFile(designFileOfText(memory.get(kept.key!)!));
    expect('problem' in read ? read.problem : 'opened').toBe(
      'element 1 of its network must be 0 to 1 km long (it would be 2 km)',
    );
    const readable = JSON.stringify({ ...ownBuild(emptyDesign()), name: 'raw copy' });
    const old = designFromJsonFile(readable);
    expect('value' in old ? old.value.name : old.problem).toBe('raw copy');
  });

  // Fixed in round 3: no backup is overwritten; the sixth pauses the autosave and says so.
  it('a sixth unreadable autosave leaves the five backups and pauses the autosave', () => {
    for (let i = 1; i <= 5; i++) {
      memory.set(DESIGN_STORAGE_KEY, unreadable(i));
      expect(keepUnreadableAutosave()?.key).not.toBeNull();
    }
    expect(autosaveHold.held).toBe(false);
    memory.set(DESIGN_STORAGE_KEY, unreadable(6));
    expect(keepUnreadableAutosave()).toMatchObject({ key: null, full: true });
    expect(autosaveHold.held).toBe(true);
    const kept = [1, 2, 3, 4, 5].map((i) =>
      memory.get(i === 1 ? 'smithonline.design.backup' : `smithonline.design.backup.${i}`),
    );
    expect(kept.map((t) => (t ? (JSON.parse(t) as { name: string }).name : null))).toEqual([
      'lost 1',
      'lost 2',
      'lost 3',
      'lost 4',
      'lost 5',
    ]);
  });
});

describe('link rounding of a microstrip stackup on the edge of physical', () => {
  /** tanD on the edge for er and fRef: the largest that keeps eps' >= 1 to 110 GHz. */
  function edgeTanD(er: number, fRef: number): number {
    let lo = 0;
    let hi = 0.5;
    for (let i = 0; i < 200; i++) {
      const mid = (lo + hi) / 2;
      if (dsLowestPermittivity(er, mid, fRef) >= 1) lo = mid;
      else hi = mid;
    }
    return lo;
  }

  it('Share writes a link its own reader refuses when tanD sits on the edge (7th digit)', () => {
    // Find an er whose edge tanD rounds up out of physical at 6 significant figures.
    let found: Stackup | null = null;
    for (let k = 0; k < 400 && !found; k++) {
      const er = 1.05 + k * 0.01;
      const t = edgeTanD(er, 1e9);
      const s = { ...DEFAULT_STACKUP, er, tanD: t, name: undefined } as unknown as Stackup;
      const r: Stackup = { ...s, tanD: Number(t.toPrecision(6)) };
      if (isUsableStackup(s) && !isUsableStackup(r)) found = s;
    }
    expect(found).not.toBeNull();
    const { name: _n, ...stackup } = found!;
    void _n;
    D().init({
      ...emptyDesign(),
      elements: identify([{ kind: 'microstrip', width: 3e-3, length: 0.02, stackup }]),
    });
    autosaveNow();
    expect(readSavedDesign()).not.toBeNull();
    const link = encodeDesign(ownBuild(D().design));
    const read = readDesign(link);
    expect({
      er: stackup.er,
      tanD: stackup.tanD,
      read: 'value' in read ? 'ok' : read.problem,
    }).toEqual({
      er: stackup.er,
      tanD: stackup.tanD,
      read: 'ok',
    });
  });
});

describe('autosave round trip of a nameless stackup with a preset numbers', () => {
  it('a nameless board stackup with the numbers of a preset reads back nameless', () => {
    const { name: _n, ...nameless } = DEFAULT_STACKUP;
    void _n;
    D().init({
      ...ownBuild(emptyDesign()),
      build: {
        board: { ...ownBuild(emptyDesign()).build!.board!, stackup: nameless },
        packages: [],
      },
    });
    autosaveNow();
    const back = readSavedDesign()!;
    expect(back.build?.board?.stackup.name).toBeUndefined();
  });
});
