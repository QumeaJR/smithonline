/**
 * Phase D4 QA fixes in the core: the stackup validation (the Djordjevic-Sarkar
 * band and a physical permittivity), normalizeStackup, the width bounds, the
 * width search and the drag on an unusable stackup, the board refused as a
 * whole, the land model below h and the layout notes.
 */
import { describe, expect, it } from 'vitest';
import {
  boardActive,
  complex,
  DEFAULT_BOARD,
  DEFAULT_PACKAGES,
  djordjevicSarkar,
  dsLowestPermittivity,
  isUsableStackup,
  isUsableWidth,
  landCapacitance,
  layoutAssumptions,
  microstripDimensions,
  microstripProperties,
  microstripWidthAt,
  nanohenries,
  normalizeStackup,
  STACKUP_PRESETS,
  stackupLabel,
  stackupProblem,
  tuneElement,
  withBoard,
  type Element,
  type Stackup,
} from '../src/index';

const FR4 = (STACKUP_PRESETS[0] as { stackup: Stackup }).stackup;

describe('d4 qa: the stackup the model accepts', () => {
  it('every preset is usable, and stays so through normalizeStackup', () => {
    for (const p of STACKUP_PRESETS) {
      expect(stackupProblem(p.stackup)).toBeNull();
      expect(normalizeStackup(p.stackup)).toEqual(p.stackup);
    }
  });

  it('the reference frequency lies strictly inside 1 kHz to 1 THz', () => {
    for (const fRef of [1, 10, 1e3, 1e12, 1e15, NaN]) {
      expect(stackupProblem({ ...FR4, fRef })?.field).toBe('fRef');
    }
    for (const fRef of [1.001e3, 1e6, 1e9, 0.999e12]) {
      // FR-4's loss is low enough to stay physical over the whole band.
      expect(isUsableStackup({ ...FR4, fRef })).toBe(true);
    }
  });

  it("an er and tanD whose eps' falls below 1 by 110 GHz is refused with the reason", () => {
    const s = { ...FR4, tanD: 0.3 };
    expect(dsLowestPermittivity(s.er, s.tanD, s.fRef)).toBeLessThan(1);
    const p = stackupProblem(s);
    expect(p?.field).toBe('tanD');
    expect(p?.reason).toMatch(/below 1 .*110 GHz.*Djordjevic-Sarkar/);
    // Whatever is accepted has eps' >= 1 from 1 Hz to 110 GHz.
    for (const tanD of [0, 0.01, 0.05, 0.1, 0.2, 0.5]) {
      for (const er of [1.0001, 2, 4.17, 10]) {
        const t = { ...FR4, er, tanD };
        if (!isUsableStackup(t)) continue;
        for (const f of [1, 1e6, 1e9, 1e10, 110e9]) {
          expect(djordjevicSarkar(er, tanD, FR4.fRef, f).er.re).toBeGreaterThanOrEqual(1);
        }
      }
    }
  });

  it('numbers out of range are refused: h, er, tanD, copper, roughness, resistivity', () => {
    expect(stackupProblem({ ...FR4, h: 1e-9 })?.field).toBe('h');
    expect(stackupProblem({ ...FR4, h: 1 })?.field).toBe('h');
    expect(stackupProblem({ ...FR4, er: 1 })?.field).toBe('er');
    expect(stackupProblem({ ...FR4, tanD: 0.6 })?.field).toBe('tanD');
    expect(stackupProblem({ ...FR4, t: 1 })?.field).toBe('t');
    expect(stackupProblem({ ...FR4, roughness: -1 })?.field).toBe('roughness');
    expect(stackupProblem({ ...FR4, rho: -1e-8 })?.field).toBe('rho');
  });
});

describe('d4 qa: normalizeStackup', () => {
  it('cuts a long name at 80 characters and drops a name that is not text', () => {
    expect(normalizeStackup({ ...FR4, name: 'A'.repeat(1_000_000) }).name).toHaveLength(80);
    expect(normalizeStackup({ ...FR4, name: { evil: 1 } }).name).toBeUndefined();
  });

  it('replaces a bad resistivity by the fallback, and an unphysical er/tanD/fRef as a whole', () => {
    expect(normalizeStackup({ ...FR4, rho: -1 }).rho).toBeUndefined();
    expect(normalizeStackup({ ...FR4, rho: 'x' }).rho).toBeUndefined();
    const fallback = STACKUP_PRESETS[2]!.stackup;
    const n = normalizeStackup({ ...FR4, tanD: 0.4 }, fallback);
    expect([n.er, n.tanD, n.fRef]).toEqual([fallback.er, fallback.tanD, fallback.fRef]);
    expect(isUsableStackup(n)).toBe(true);
    expect(normalizeStackup({ ...FR4, fRef: 1 }, fallback).fRef).toBe(fallback.fRef);
  });
});

describe('d4 qa: an unusable stackup in hand-built elements', () => {
  const bad: Stackup = { ...FR4, fRef: 10 };

  it('is evaluated as lossless er (finite), and no width is solved on it', () => {
    const p = microstripProperties(bad, 3e-3, 1e9);
    expect(Number.isFinite(p.z0.re) && Number.isFinite(p.beta)).toBe(true);
    expect(p.alphaDielectric).toBe(0);
    expect(microstripWidthAt(bad, 50, 1e9)).toBeNull();
    expect(microstripDimensions(bad, 50, 0.25, 1e9)).toBeNull();
  });

  it('dragging such a microstrip is refused (null), not a NaN length', () => {
    const el: Element = { kind: 'microstrip', width: 3e-3, length: 0.02, stackup: bad };
    expect(tuneElement(el, complex(25, 10), complex(50, 0), 1e9)).toBeNull();
    const ok: Element = { ...el, stackup: FR4 };
    const t = tuneElement(ok, complex(25, 10), complex(50, 0), 1e9);
    expect(t !== null && Number.isFinite((t as { length: number }).length)).toBe(true);
  });

  it('with the board on, the whole board is left out and the notes say why', () => {
    const board = { ...DEFAULT_BOARD, enabled: true, traceLength: 2e-3, stackup: bad };
    expect(boardActive(board)).toBe(false);
    const els: Element[] = [
      { kind: 'C', orientation: 'shunt', value: 2e-12, package: '0402' },
      { kind: 'L', orientation: 'series', value: 5e-9, package: '0402' },
    ];
    const built = withBoard(els, DEFAULT_PACKAGES, board, { z0: 50, frequency: 1e9 });
    expect(built.every((el) => (el as { board?: unknown }).board === undefined)).toBe(true);
    const notes = layoutAssumptions(els, DEFAULT_PACKAGES, board, { z0: 50, frequency: 1e9 });
    expect(notes[0]).toMatch(/^Board: left out, the stackup is not usable \(fRef/);
  });
});

describe('d4 qa: microstrip width bounds', () => {
  it('1 um to 1 m and W/h 0.001 to 1000', () => {
    expect(isUsableWidth(3e-3, FR4)).toBe(true);
    expect(isUsableWidth(1e-12, FR4)).toBe(false);
    expect(isUsableWidth(1e-6, FR4)).toBe(false); // W/h 6e-4
    expect(isUsableWidth(2, FR4)).toBe(false);
    expect(isUsableWidth(NaN, FR4)).toBe(false);
  });
});

describe('d4 qa: the land model below h', () => {
  it('a small land takes the larger estimate; a land wider than h the edge estimate', () => {
    // Larger than the edge estimate below h (the disc), and continuous within 2 % across h.
    const small = landCapacitance(FR4, 0.5e-3, 0.6e-3);
    expect(small * 1e15).toBeCloseTo(60.29, 1);
    const big = landCapacitance(FR4, 3e-3, 3e-3);
    expect(big).toBeGreaterThan(small);
  });
});

describe('d4 qa: layout note wording', () => {
  const board = {
    ...DEFAULT_BOARD,
    enabled: true,
    viaDrill: 0.3e-3,
    viasPerShunt: 2,
    traceLength: 2e-3,
  };
  const ctx = { z0: 50, frequency: 1e9 };
  it('traces "2 mm long, 3.14 mm wide", vias in nH, "off (length 0)"', () => {
    const on = layoutAssumptions([], DEFAULT_PACKAGES, board, ctx).join('\n');
    expect(on).toMatch(/Traces between parts: microstrip 2 mm long, 3.14 mm wide/);
    expect(on).toMatch(/0.271 nH for the 2 in parallel \(0.543 nH each, no mutual inductance\)/);
    const off = layoutAssumptions([], DEFAULT_PACKAGES, { ...board, traceLength: 0 }, ctx);
    expect(off).toContain('Traces between parts: off (length 0)');
    expect(nanohenries(82.3e-12)).toBe('0.0823 nH');
  });
  it('a set trace width outside the dispersion range (W/h 0.1 to 10) is flagged', () => {
    const wide = layoutAssumptions([], DEFAULT_PACKAGES, { ...board, traceWidth: 20e-3 }, ctx);
    expect(wide.join('\n')).toMatch(/W\/h 12.5 is outside the dispersion model's range/);
  });
  it('the table pad value is named when a package has no land size', () => {
    const table = DEFAULT_PACKAGES.map((p) => (p.id === '0402' ? { ...p, padLength: 0 } : p));
    const els: Element[] = [{ kind: 'C', orientation: 'shunt', value: 1e-12, package: '0402' }];
    expect(layoutAssumptions(els, table, board, ctx).join('\n')).toMatch(
      /0402 30 fF \(table, no land size\)/,
    );
  });
});

describe('d4 qa: stackup label', () => {
  it('a preset name on other numbers reads "custom stackup"; an own name stays', () => {
    expect(stackupLabel({ ...FR4, er: 4.3 })).toBe('custom stackup');
    expect(stackupLabel({ ...FR4, er: 4.3, name: 'My board' })).toBe('My board');
    const { name: _name, ...unnamed } = FR4;
    void _name;
    expect(stackupLabel(unnamed)).toBe('FR-4, 1.6 mm');
  });
});
