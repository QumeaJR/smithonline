import {
  formatEngineering,
  type Complex,
  type Element,
  type PackageId,
  type RealizedElement,
} from '@smithonline/core';
import { fmtNum, NO_VALUE } from './format';

/** The narrowest cell of the horizontal schematic, drawing units (px at the default height). */
export const CELL_MIN = 56;
/** Room left and right of a value inside its cell, together, drawing units. */
export const CELL_PAD = 8;
/** Font size of the values in the strip, drawing units (`.schematic .value`). */
export const VALUE_FONT = 10;
/**
 * Advance of one character of the monospace value font in em. SF Mono and
 * Menlo advance 0.6 em, Consolas 0.55 em; the larger keeps every font clear.
 */
const MONO_ADVANCE = 0.62;

/**
 * Width of a value in the strip. The values are set in the monospace font,
 * where every character advances the same, so the width is measured from the
 * character count without a layout pass (and the same in the report SVG).
 */
export function valueWidth(text: string, fontSize = VALUE_FONT): number {
  return [...text].length * MONO_ADVANCE * fontSize;
}

/** A cell sized to its content: `max(56, measured value width + 8)`. */
export function cellWidth(text: string, fontSize = VALUE_FONT): number {
  return Math.max(CELL_MIN, Math.ceil(valueWidth(text, fontSize) + CELL_PAD));
}

/** A number to three significant digits, without trailing zeros or a negative zero. */
export function sig3(v: number): string {
  if (!Number.isFinite(v)) return v > 0 ? '∞' : v < 0 ? '-∞' : 'NaN';
  const n = Number(v.toPrecision(3));
  return Object.is(n, -0) || n === 0 ? '0' : String(n);
}

/**
 * Below this share of |Z| a part of an impedance is shown as 0: with three
 * significant digits it is under the resolution of the other part, and a
 * reactance of 0.04 Ω beside 50.1 Ω is numerical noise of a match.
 */
const NEAR_ZERO = 1e-3;

/**
 * An impedance in the strip and the schematic: `20 - j12`, three significant
 * digits per part; a part below NEAR_ZERO of |Z| is 0 (`50.1 + j0`).
 */
export function stripComplex(z: Complex): string {
  const size = Math.hypot(z.re, z.im);
  const small = (v: number): boolean => Number.isFinite(size) && Math.abs(v) < NEAR_ZERO * size;
  const re = small(z.re) ? 0 : z.re;
  const imValue = small(z.im) ? 0 : z.im;
  const im = sig3(Math.abs(imValue));
  const sign = imValue < 0 && im !== '0' ? '-' : '+';
  return `${sig3(re)} ${sign} j${im}`;
}

/** An element's value in the strip: the primary value with three significant digits. */
export function stripValue(el: Element): string {
  const eng = (v: number, unit: string): string => formatEngineering(v, { unit, digits: 3 });
  switch (el.kind) {
    case 'R':
      return eng(el.value, 'Ω');
    case 'L':
      return eng(el.value, 'H');
    case 'C':
      return eng(el.value, 'F');
    case 'transformer':
      return `n = ${formatEngineering(el.n, { prefixes: false, digits: 3 })}`;
    case 'line':
    case 'openStub':
    case 'shortStub':
      return `${formatEngineering(el.length, { prefixes: false, digits: 3 })} λ`;
    case 'microstrip':
      return eng(el.length, 'm');
    case 'RLC':
      return el.r ? eng(el.r, 'Ω') : el.l ? eng(el.l, 'H') : el.c ? eng(el.c, 'F') : '';
  }
}

/** Room the snap marker (a small dot after a realized value) takes, drawing units. */
export const SNAP_W = 6;

/** The package as the strip names it: the chip size, or WW for a wire-wound coil. */
export function packageShort(id: PackageId): string {
  return id === 'wirewound' ? 'WW' : id;
}

/** What a cell of the strip shows under its symbol. */
export interface StripLabel {
  /** The value the network uses, with the package after it: "33 pF 0402". */
  readonly text: string;
  /** Realize moved the value to a series or stock value: the strip marks it. */
  readonly snapped: boolean;
}

/**
 * The label of an element in the strip: the value the network uses (the
 * realized one when Realize is on, else the ideal one) with three significant
 * digits, SI prefix and unit; a line or stub shows its Z0 and electrical
 * length, a transformer its ratio; a part with a package names it after the
 * value.
 */
export function stripLabel(el: Element, realized?: RealizedElement | null): StripLabel {
  const used = realized ? realized.realized : el;
  const snapped = realized ? realized.parts.some((p) => p.source !== 'exact') : false;
  const text =
    used.kind === 'line' || used.kind === 'openStub' || used.kind === 'shortStub'
      ? `${formatEngineering(used.z0, { unit: 'Ω', digits: 3 })} ${stripValue(used)}`
      : used.kind === 'microstrip'
        ? `l ${stripValue(used)} w ${formatEngineering(used.width, { unit: 'm', digits: 3 })}`
        : stripValue(used);
  const pkg = (el.kind === 'L' || el.kind === 'C') && el.package ? el.package : undefined;
  if (!pkg) return { text, snapped };
  return { text: text ? `${text} ${packageShort(pkg)}` : packageShort(pkg), snapped };
}

/** A cell sized to its label: the text plus the snap marker when there is one. */
export function labelWidth(label: StripLabel): number {
  return label.snapped
    ? Math.max(CELL_MIN, Math.ceil(valueWidth(label.text) + SNAP_W + CELL_PAD))
    : cellWidth(label.text);
}

/** The two lines at the Zin terminal of the strip: "Zin 51.1 - j0.1 Ω" and "VSWR 1.022". */
export function terminalLines(zin: Complex, vswr: number | undefined): readonly [string, string] {
  return [
    `Zin ${stripComplex(zin)} Ω`,
    `VSWR ${vswr === undefined || Number.isNaN(vswr) ? NO_VALUE : fmtNum(vswr, 3)}`,
  ];
}

/** Room left of the terminal text: the wire stub, the terminal circle and a gap, drawing units. */
export const TERMINAL_LEAD = 22;

/** Width of the Zin terminal cell: the lead plus the longer of its two lines. */
export function terminalWidth(lines: readonly string[]): number {
  const text = Math.max(0, ...lines.map((l) => valueWidth(l)));
  return Math.max(CELL_MIN, Math.ceil(TERMINAL_LEAD + text + CELL_PAD / 2));
}

/** Left edges of cells laid side by side from 0, and the total width. */
export function cellOffsets(widths: readonly number[]): {
  readonly x: number[];
  readonly total: number;
} {
  const x: number[] = [];
  let at = 0;
  for (const w of widths) {
    x.push(at);
    at += w;
  }
  return { x, total: at };
}
