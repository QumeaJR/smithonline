// @vitest-environment jsdom
/**
 * Phase 4: the schematic strip sizes each cell to its value
 * (`max(56px, measured value width + 8px)`) and shows the values with three
 * significant digits, so values never run into each other (before: "0.0 -
 * j12.016.03 nH" at 1100 px and on the phone).
 */
import { complex, evaluateLadder } from '@smithonline/core';
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Schematic } from '../src/components/Schematic';
import { emptyDesign } from '../src/lib/design';
import { ladderOf } from '../src/lib/files';
import {
  CELL_MIN,
  CELL_PAD,
  cellOffsets,
  cellWidth,
  sig3,
  stripComplex,
  stripValue,
  terminalLines,
  terminalWidth,
  valueWidth,
} from '../src/lib/schematicCells';
import { useDesignStore } from '../src/store/useDesignStore';

describe('cell sizing', () => {
  it('a short value keeps the 56 px cell, a long one gets its width plus 8 px', () => {
    expect(cellWidth('')).toBe(CELL_MIN);
    expect(cellWidth('16 nH')).toBe(CELL_MIN);
    const long = '1.23k - j4.56k';
    expect(valueWidth(long)).toBeGreaterThan(CELL_MIN - CELL_PAD);
    expect(cellWidth(long)).toBe(Math.ceil(valueWidth(long) + CELL_PAD));
  });

  it('the width grows with the characters of the monospace value', () => {
    expect(valueWidth('abcd')).toBeCloseTo(2 * valueWidth('ab'));
    expect(valueWidth('ab', 20)).toBeCloseTo(2 * valueWidth('ab', 10));
    // Unicode characters count once each.
    expect(valueWidth('Ω')).toBeCloseTo(valueWidth('x'));
  });

  it('cells sit side by side', () => {
    expect(cellOffsets([56, 70, 56])).toEqual({ x: [0, 56, 126], total: 182 });
  });
});

describe('values with three significant digits', () => {
  it('numbers', () => {
    expect(sig3(16.03)).toBe('16');
    expect(sig3(0.012345)).toBe('0.0123');
    expect(sig3(-0.0000001)).toBe('-1e-7');
    expect(sig3(-0)).toBe('0');
    expect(sig3(1234.5)).toBe('1230');
    expect(sig3(Number.POSITIVE_INFINITY)).toBe('∞');
  });

  it('impedances: never a negative zero reactance', () => {
    expect(stripComplex(complex(0, -12.01))).toBe('0 - j12');
    expect(stripComplex(complex(20.04, 7.333))).toBe('20 + j7.33');
    // A part under a thousandth of |Z| is below the three-digit resolution: shown as 0.
    expect(stripComplex(complex(50, -0.0001))).toBe('50 + j0');
    expect(stripComplex(complex(50.1, 0.0401))).toBe('50.1 + j0');
    expect(stripComplex(complex(50, -0.06))).toBe('50 - j0.06');
    expect(stripComplex(complex(50, -0))).toBe('50 + j0');
  });

  it('elements: the primary value', () => {
    expect(stripValue({ kind: 'L', orientation: 'series', value: 16.03e-9 })).toBe('16 nH');
    expect(stripValue({ kind: 'C', orientation: 'shunt', value: 4.725e-12 })).toBe('4.73 pF');
    expect(stripValue({ kind: 'R', orientation: 'series', value: 1234 })).toBe('1.23 kΩ');
    expect(stripValue({ kind: 'line', length: 0.12345, z0: 50 })).toBe('0.123 λ');
    expect(stripValue({ kind: 'transformer', n: 1.4142 })).toBe('n = 1.41');
    expect(
      stripValue({ kind: 'RLC', connection: 'series', orientation: 'series', r: 0, l: 2e-9, c: 0 }),
    ).toBe('2 nH');
  });
});

describe('the drawing', () => {
  afterEach(cleanup);
  beforeEach(() => {
    useDesignStore.getState().init({ ...emptyDesign(), load: complex(0, -12.01) });
    useDesignStore.getState().addElement({ kind: 'L', orientation: 'series', value: 16.03e-9 });
    useDesignStore.getState().addElement({ kind: 'C', orientation: 'shunt', value: 1.234e-12 });
  });

  it('shows three significant digits and a viewBox that sums the cell widths', () => {
    const d = useDesignStore.getState().design;
    const result = evaluateLadder(ladderOf(d));
    const svg = render(<Schematic result={result} />).container.innerHTML;
    expect(svg).toContain('>0 - j12<');
    expect(svg).toContain('>16 nH<');
    expect(svg).toContain('>1.23 pF<');
    const texts = [stripComplex(d.load), ...d.elements.map((el) => stripValue(el))];
    // The source end is the Zin terminal with its two lines, Zin and VSWR.
    const terminal = terminalWidth(
      terminalLines(result.zin, result.info[result.info.length - 1]?.vswr),
    );
    const total = texts.reduce((sum, t) => sum + cellWidth(t), 0) + terminal;
    expect(svg).toContain(`viewBox="0 0 ${total} 84"`);
  });

  it('every value fits inside its own cell, so neighbours never collide', () => {
    useDesignStore.getState().setLoad(complex(1234.5, -6789.1));
    const d = useDesignStore.getState().design;
    const result = evaluateLadder(ladderOf(d));
    const texts = [
      stripComplex(d.load),
      ...d.elements.map((el) => stripValue(el)),
      stripComplex(result.zin),
    ];
    for (const t of texts) expect(valueWidth(t) + CELL_PAD).toBeLessThanOrEqual(cellWidth(t));
  });
});
