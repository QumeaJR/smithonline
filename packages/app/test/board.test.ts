/**
 * Phase D4 in the app: the board store (stored like the package table, the
 * old substrate carried over once), microstrip elements in share links, the
 * network as built with the board (builtNetwork, packagedElements), its
 * labels and the layout assumptions in the BOM.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  bomCsv,
  complex,
  DEFAULT_BOARD,
  DEFAULT_PACKAGES,
  DEFAULT_STACKUP,
  microstripProperties,
  STACKUP_PRESETS,
  type BoardSettings,
} from '@smithonline/core';
import { emptyDesign, identify, type Design } from '../src/lib/design';
import { asBuiltWhat, packagedElements } from '../src/lib/realize';
import { decodeDesign, encodeDesign } from '../src/lib/share';
import { builtNetwork } from '../src/lib/simexport';

const BOARD_KEY = 'smithonline.board.v1';
const SUBSTRATE_KEY = 'smithonline.substrate.v1';

async function freshBoard(stored: Record<string, string | null>) {
  vi.resetModules();
  const written: Record<string, string> = {};
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => stored[k] ?? null,
    setItem: (k: string, v: string) => {
      written[k] = v;
    },
  });
  const mod = await import('../src/store/useBoard');
  return { ...mod, written };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('board store', () => {
  it('nothing stored: the board is off on FR-4, 1.6 mm', async () => {
    const { useBoard } = await freshBoard({});
    expect(useBoard.getState().board).toEqual(DEFAULT_BOARD);
    expect(useBoard.getState().board.stackup.name).toBe('FR-4, 1.6 mm');
  });

  it('a substrate typed before the stackup existed carries over; the old defaults do not', async () => {
    const typed = await freshBoard({
      [SUBSTRATE_KEY]: JSON.stringify({ medium: 'microstrip', er: 3.38, h: 0.813e-3, t: 17e-6 }),
    });
    const s = typed.useBoard.getState().board.stackup;
    expect(s).toMatchObject({ er: 3.38, h: 0.813e-3, t: 17e-6, tanD: DEFAULT_STACKUP.tanD });
    expect(s.name).toBeUndefined();
    const old = await freshBoard({
      [SUBSTRATE_KEY]: JSON.stringify({ medium: 'microstrip', er: 4.3, h: 1.6e-3, t: 35e-6 }),
    });
    expect(old.useBoard.getState().board).toEqual(DEFAULT_BOARD);
  });

  it('stored settings are read back, unusable numbers replaced by the defaults', async () => {
    const { useBoard } = await freshBoard({
      [BOARD_KEY]: JSON.stringify({
        enabled: true,
        stackup: { h: -1, er: 3.66, tanD: 0.0037, fRef: 10e9, t: 35e-6, roughness: 'x' },
        viaDrill: 0,
        viasPerShunt: 2.6,
        traceLength: 1e-3,
        traceWidth: -2,
      }),
    });
    const b = useBoard.getState().board;
    expect(b.enabled).toBe(true);
    expect(b.stackup.h).toBe(DEFAULT_STACKUP.h);
    expect(b.stackup.er).toBe(3.66);
    expect(b.stackup.roughness).toBe(DEFAULT_STACKUP.roughness);
    expect(b.viaDrill).toBe(DEFAULT_BOARD.viaDrill);
    // 2.6 vias is not a count: refused (the default) since the D4 QA fixes, no longer rounded to 3.
    expect(b.viasPerShunt).toBe(DEFAULT_BOARD.viasPerShunt);
    expect(b.traceLength).toBe(1e-3);
    expect(b.traceWidth).toBe(0);
  });

  it('a changed number drops the preset name; a preset brings its stackup; changes are stored', async () => {
    const { useBoard, written } = await freshBoard({});
    useBoard.getState().setStackup({ er: 4.4 });
    expect(useBoard.getState().board.stackup.name).toBeUndefined();
    expect(useBoard.getState().board.stackup.er).toBe(4.4);
    useBoard.getState().applyPreset('ro4350b-0.762');
    expect(useBoard.getState().board.stackup).toEqual(
      STACKUP_PRESETS.find((p) => p.id === 'ro4350b-0.762')?.stackup,
    );
    useBoard.getState().setBoard({ enabled: true, viasPerShunt: 2 });
    expect(JSON.parse(written[BOARD_KEY] ?? '{}')).toMatchObject({
      enabled: true,
      viasPerShunt: 2,
    });
  });
});

const ms = {
  kind: 'microstrip' as const,
  width: 1.1e-3,
  length: 12.5e-3,
  stackup: STACKUP_PRESETS[2]!.stackup,
};

describe('microstrip elements in share links', () => {
  it('a microstrip travels with its stackup', () => {
    const d: Design = { ...emptyDesign(), elements: identify([ms]) };
    const back = decodeDesign(encodeDesign(d));
    expect(back).not.toBeNull();
    const el = back?.elements[0];
    expect(el?.kind).toBe('microstrip');
    if (el?.kind !== 'microstrip') return;
    expect(el.width).toBe(1.1e-3);
    expect(el.length).toBe(12.5e-3);
    expect(el.stackup).toMatchObject({ h: 0.508e-3, er: 3.55, tanD: 0.0027, fRef: 10e9 });
  });

  it('a link with an unusable stackup or derived board parasitics is refused', () => {
    const bad = {
      ...emptyDesign(),
      elements: identify([{ ...ms, stackup: { ...ms.stackup, er: 0.5 } }]),
    };
    expect(decodeDesign(encodeDesign(bad as Design))).toBeNull();
    const noWidth = { ...emptyDesign(), elements: identify([{ ...ms, width: 0 }]) };
    expect(decodeDesign(encodeDesign(noWidth as Design))).toBeNull();
    const derived = {
      ...emptyDesign(),
      elements: identify([{ kind: 'C', orientation: 'shunt', value: 1e-12, board: { via: 1e-9 } }]),
    };
    expect(decodeDesign(encodeDesign(derived as Design))).toBeNull();
  });
});

const BOARD: BoardSettings = {
  ...DEFAULT_BOARD,
  enabled: true,
  viasPerShunt: 1,
  traceLength: 2e-3,
};

function design(): Design {
  return {
    ...emptyDesign(),
    frequency: 1e9,
    load: complex(20, -15),
    elements: identify([
      { kind: 'C', orientation: 'shunt', value: 3e-12 },
      { kind: 'L', orientation: 'series', value: 5e-9, package: '0402' },
    ]),
  };
}

describe('the network as built with the board', () => {
  it('builtNetwork adds vias and traces and says so; off, only the packages', () => {
    const on = builtNetwork(design(), DEFAULT_PACKAGES, null, BOARD);
    expect(on.board).toBe(true);
    expect(on.packaged).toBe(true);
    const [c, l] = on.ladder.elements;
    expect(c?.kind === 'C' && c.board?.via).toBeGreaterThan(0);
    const trace = l?.kind === 'L' ? l.board?.trace : undefined;
    expect(trace?.length).toBe(2e-3);
    expect(microstripProperties(trace!.stackup, trace!.width, 1e9).z0.re).toBeCloseTo(50, 6);
    const off = builtNetwork(design(), DEFAULT_PACKAGES, null, DEFAULT_BOARD);
    expect(off.board).toBe(false);
    expect(off.ladder.elements[0]).not.toHaveProperty('board');
  });

  it('packagedElements: null with neither packages nor the board; the board alone is enough', () => {
    const plain = [{ kind: 'C' as const, orientation: 'shunt' as const, value: 1e-12 }];
    expect(packagedElements(plain, DEFAULT_PACKAGES)).toBeNull();
    expect(
      packagedElements(plain, DEFAULT_PACKAGES, BOARD, { z0: 50, frequency: 1e9 }),
    ).not.toBeNull();
  });

  it('labels: packages, the board, or both', () => {
    const els = design().elements;
    expect(asBuiltWhat(els, DEFAULT_BOARD)).toBe('packages');
    expect(asBuiltWhat(els, BOARD)).toBe('packages and the board');
    expect(asBuiltWhat([els[0]!], BOARD)).toBe('the board');
    expect(asBuiltWhat([els[0]!], DEFAULT_BOARD)).toBeNull();
  });

  it('the BOM lists the layout assumptions under the table', () => {
    const csv = bomCsv([], ['Stackup: FR-4', 'Vias: 1; per "shunt" part']);
    const lines = csv.split('\n');
    expect(lines[1]).toBe('');
    expect(lines[2]).toBe('Note;Stackup: FR-4');
    expect(lines[3]).toBe('Note;"Vias: 1; per ""shunt"" part"');
  });
});
