/**
 * Snapping a ladder to standard or stocked component values.
 *
 * Every lumped part (R, L, C, and the three parts of an RLC block) that is in
 * scope and not locked gets the standard value nearest in log distance. With
 * `preferVswr` (the default) the two bracketing values are then compared on
 * the whole network's VSWR at the ladder frequency and the better one kept,
 * one coordinate pass at a time until nothing changes. The scope "pairs"
 * treats an L and a C that form a resonator (an RLC block with both, or two
 * adjacent L and C elements of the same orientation) as a unit: the L is
 * snapped, the C is solved for the ideal resonance and then snapped as well,
 * and the residual detuning is reported.
 */
import { complex, type Complex } from '../complex.js';
import type { Element, LumpedElement } from '../elements.js';
import { evaluateAt, evaluateLadder, type Ladder, type LadderResult } from '../ladder.js';
import { tryParseEngineering } from '../units.js';
import {
  nearestInStock,
  pickNearest,
  seriesNeighbors,
  stockNeighbors,
  type ESeries,
} from './eSeries.js';
import { vswrTowards } from './mismatch.js';

export type RealizeScope = 'all' | 'L' | 'C' | 'R' | 'pairs';

export const REALIZE_SCOPES: readonly RealizeScope[] = ['all', 'L', 'C', 'R', 'pairs'];

export type PartKind = 'R' | 'L' | 'C';

/** The values a user actually has, in SI units, per part kind. */
export interface CustomStock {
  readonly L: readonly number[];
  readonly C: readonly number[];
  readonly R: readonly number[];
}

export type ValueSource =
  | { readonly kind: 'series'; readonly series: ESeries }
  | { readonly kind: 'stock'; readonly stock: CustomStock };

export interface RealizeOptions {
  readonly source: ValueSource;
  readonly scope: RealizeScope;
  /** Indices of elements kept exact. */
  readonly locked?: readonly number[];
  /** Compare both bracketing values on the VSWR at the ladder frequency. Default true. */
  readonly preferVswr?: boolean;
  /**
   * Where the network should land. The VSWR that ranks the bracketing values
   * is referred to this impedance (see `vswrTowards`); default Z0, which is
   * the ordinary VSWR.
   */
  readonly target?: Complex;
}

export interface RealizedPart {
  readonly part: PartKind;
  readonly ideal: number;
  readonly realized: number;
  /** (realized - ideal) / ideal. */
  readonly deviation: number;
  /** The series name, "stock", or "exact" when the part was not snapped. */
  readonly source: string;
}

export interface RealizedElement {
  readonly index: number;
  readonly ideal: Element;
  readonly realized: Element;
  readonly locked: boolean;
  /** The lumped parts of the element; empty for lines, stubs and transformers. */
  readonly parts: readonly RealizedPart[];
  /** Resonance shift of an L-C pair: realized over ideal resonant frequency minus one. */
  readonly detuning?: number;
  /** The other element of the pair, when the pair spans two elements. */
  readonly pairWith?: number;
}

export interface Realization {
  readonly ideal: Ladder;
  readonly ladder: Ladder;
  readonly elements: readonly RealizedElement[];
  readonly result: LadderResult;
  readonly idealResult: LadderResult;
  /** How the values were chosen, for display and the BOM. */
  readonly sourceLabel: string;
}

interface Assignment {
  readonly index: number;
  readonly part: PartKind;
  readonly ideal: number;
  readonly value: number;
  readonly source: string;
}

interface UnitOption {
  readonly assignments: readonly Assignment[];
  readonly detuning?: number;
}

/** One independently chosen thing: a part, or an L-C pair. Options hold the bracketing values. */
interface Unit {
  readonly options: readonly UnitOption[];
}

/** The lumped parts of an element with their current values. Zero and missing parts are skipped. */
export function elementParts(el: Element): readonly { part: PartKind; value: number }[] {
  switch (el.kind) {
    case 'R':
    case 'L':
    case 'C':
      return [{ part: el.kind, value: el.value }];
    case 'RLC': {
      const out: { part: PartKind; value: number }[] = [];
      if ((el.r ?? 0) > 0) out.push({ part: 'R', value: el.r as number });
      if ((el.l ?? 0) > 0) out.push({ part: 'L', value: el.l as number });
      if ((el.c ?? 0) > 0) out.push({ part: 'C', value: el.c as number });
      return out;
    }
    default:
      return [];
  }
}

/** A copy of the element with one part set to a new value. */
export function withPart<T extends Element>(el: T, part: PartKind, value: number): T {
  switch (el.kind) {
    case 'R':
    case 'L':
    case 'C':
      return el.kind === part ? { ...el, value } : el;
    case 'RLC':
      return part === 'R'
        ? { ...el, r: value }
        : part === 'L'
          ? { ...el, l: value }
          : { ...el, c: value };
    default:
      return el;
  }
}

function inScope(scope: RealizeScope, part: PartKind): boolean {
  return scope === 'all' || scope === 'pairs' || scope === part;
}

function sourceLabel(source: ValueSource): string {
  return source.kind === 'series' ? source.series : 'stock';
}

/** The bracketing candidate values for a part, or null when the source has none. */
function bracket(
  source: ValueSource,
  part: PartKind,
  value: number,
): { lower: number; upper: number } | null {
  if (!(value > 0) || !Number.isFinite(value)) return null;
  if (source.kind === 'series') return seriesNeighbors(value, source.series);
  return stockNeighbors(value, source.stock[part]);
}

function nearest(source: ValueSource, part: PartKind, value: number): number | null {
  if (!(value > 0) || !Number.isFinite(value)) return null;
  if (source.kind === 'series') {
    const { lower, upper } = seriesNeighbors(value, source.series);
    return pickNearest(value, lower, upper);
  }
  return nearestInStock(value, source.stock[part]);
}

function partUnit(source: ValueSource, index: number, part: PartKind, ideal: number): Unit | null {
  const b = bracket(source, part, ideal);
  if (!b) return null;
  const label = sourceLabel(source);
  const near = pickNearest(ideal, b.lower, b.upper);
  const far = near === b.lower ? b.upper : b.lower;
  const option = (value: number): UnitOption => ({
    assignments: [{ index, part, ideal, value, source: label }],
  });
  return { options: far === near ? [option(near)] : [option(near), option(far)] };
}

/**
 * A resonator unit: snap the inductor to each bracketing value, solve the
 * capacitor for the ideal resonance, snap it too.
 */
function pairUnit(
  source: ValueSource,
  l: { index: number; ideal: number },
  c: { index: number; ideal: number },
): Unit | null {
  const b = bracket(source, 'L', l.ideal);
  if (!b) return null;
  const label = sourceLabel(source);
  const lc = l.ideal * c.ideal;
  const option = (lValue: number): UnitOption | null => {
    const cTarget = lc / lValue;
    const cValue = nearest(source, 'C', cTarget) ?? cTarget;
    const detuning = Math.sqrt(lc / (lValue * cValue)) - 1;
    return {
      assignments: [
        { index: l.index, part: 'L', ideal: l.ideal, value: lValue, source: label },
        { index: c.index, part: 'C', ideal: c.ideal, value: cValue, source: label },
      ],
      detuning,
    };
  };
  const near = pickNearest(l.ideal, b.lower, b.upper);
  const far = near === b.lower ? b.upper : b.lower;
  const options = [option(near), far === near ? null : option(far)].filter(
    (o): o is UnitOption => o !== null,
  );
  return { options };
}

function isLumped(el: Element): el is LumpedElement {
  return el.kind === 'R' || el.kind === 'L' || el.kind === 'C' || el.kind === 'RLC';
}

/** Build the units: per part, or per pair in the pairs scope. */
function buildUnits(ladder: Ladder, options: RealizeOptions): Unit[] {
  const locked = new Set(options.locked ?? []);
  const units: Unit[] = [];
  const consumed = new Set<number>();
  const els = ladder.elements;

  if (options.scope === 'pairs') {
    els.forEach((el, i) => {
      if (locked.has(i)) return;
      if (el.kind === 'RLC' && (el.l ?? 0) > 0 && (el.c ?? 0) > 0) {
        const u = pairUnit(
          options.source,
          { index: i, ideal: el.l as number },
          { index: i, ideal: el.c as number },
        );
        if (u) {
          units.push(u);
          consumed.add(i);
          // The resistor of the block is an ordinary part.
          if ((el.r ?? 0) > 0) {
            const r = partUnit(options.source, i, 'R', el.r as number);
            if (r) units.push(r);
          }
        }
        return;
      }
      if (consumed.has(i)) return;
      const next = els[i + 1];
      if (
        next &&
        !locked.has(i + 1) &&
        isLumped(el) &&
        isLumped(next) &&
        el.kind !== 'RLC' &&
        next.kind !== 'RLC' &&
        el.orientation === next.orientation &&
        ((el.kind === 'L' && next.kind === 'C') || (el.kind === 'C' && next.kind === 'L'))
      ) {
        const l =
          el.kind === 'L' ? { index: i, ideal: el.value } : { index: i + 1, ideal: next.value };
        const c =
          el.kind === 'C' ? { index: i, ideal: el.value } : { index: i + 1, ideal: next.value };
        const u = pairUnit(options.source, l, c);
        if (u) {
          units.push(u);
          consumed.add(i);
          consumed.add(i + 1);
        }
      }
    });
  }

  els.forEach((el, i) => {
    if (locked.has(i) || consumed.has(i)) return;
    for (const { part, value } of elementParts(el)) {
      if (!inScope(options.scope, part)) continue;
      const u = partUnit(options.source, i, part, value);
      if (u) units.push(u);
    }
  });
  return units;
}

function applyChoices(
  ladder: Ladder,
  units: readonly Unit[],
  chosen: readonly number[],
): Element[] {
  const elements = [...ladder.elements];
  units.forEach((u, k) => {
    const opt = u.options[chosen[k] ?? 0];
    if (!opt) return;
    for (const a of opt.assignments) {
      elements[a.index] = withPart(elements[a.index] as Element, a.part, a.value);
    }
  });
  return elements;
}

function vswrAtF0(ladder: Ladder, elements: readonly Element[], target: Complex): number {
  const r = evaluateAt({ ...ladder, elements }, ladder.frequency, ladder.load, { arcSteps: 0 });
  const v = vswrTowards(r.zin, target);
  return Number.isFinite(v) ? v : Infinity;
}

/** Snap a ladder's values and evaluate the result. */
export function realizeLadder(ladder: Ladder, options: RealizeOptions): Realization {
  const units = buildUnits(ladder, options);
  const chosen = units.map(() => 0);
  const target = options.target ?? complex(ladder.z0, 0);

  if (options.preferVswr ?? true) {
    let best = vswrAtF0(ladder, applyChoices(ladder, units, chosen), target);
    for (let pass = 0; pass < 4; pass++) {
      let changed = false;
      units.forEach((u, k) => {
        if (u.options.length < 2) return;
        const alt = chosen[k] === 0 ? 1 : 0;
        const trial = chosen.map((c, j) => (j === k ? alt : c));
        const v = vswrAtF0(ladder, applyChoices(ladder, units, trial), target);
        if (v < best - 1e-9) {
          best = v;
          chosen[k] = alt;
          changed = true;
        }
      });
      if (!changed) break;
    }
  }

  const elements = applyChoices(ladder, units, chosen);
  const assigned = new Map<string, Assignment>();
  const detuning = new Map<number, number>();
  const pairWith = new Map<number, number>();
  units.forEach((u, k) => {
    const opt = u.options[chosen[k] ?? 0];
    if (!opt) return;
    for (const a of opt.assignments) assigned.set(`${a.index}:${a.part}`, a);
    if (opt.detuning !== undefined) {
      const indices = [...new Set(opt.assignments.map((a) => a.index))];
      for (const i of indices) {
        detuning.set(i, opt.detuning);
        const other = indices.find((j) => j !== i);
        if (other !== undefined) pairWith.set(i, other);
      }
    }
  });

  const locked = new Set(options.locked ?? []);
  const realizedElements: RealizedElement[] = ladder.elements.map((ideal, i) => {
    const realized = elements[i] as Element;
    const parts: RealizedPart[] = elementParts(ideal).map(({ part, value }) => {
      const a = assigned.get(`${i}:${part}`);
      const realizedValue = a ? a.value : value;
      return {
        part,
        ideal: value,
        realized: realizedValue,
        deviation: value !== 0 ? realizedValue / value - 1 : 0,
        source: a ? a.source : 'exact',
      };
    });
    const out: RealizedElement = { index: i, ideal, realized, locked: locked.has(i), parts };
    const d = detuning.get(i);
    const p = pairWith.get(i);
    return {
      ...out,
      ...(d !== undefined ? { detuning: d } : {}),
      ...(p !== undefined ? { pairWith: p } : {}),
    };
  });

  const realizedLadder: Ladder = { ...ladder, elements };
  return {
    ideal: ladder,
    ladder: realizedLadder,
    elements: realizedElements,
    result: evaluateLadder(realizedLadder),
    idealResult: evaluateLadder(ladder),
    sourceLabel: sourceLabel(options.source),
  };
}

/** Why a stock entry was left out. */
export type StockSkip = 'unreadable' | 'no unit' | 'decimal comma' | 'unit';

export interface StockReport {
  readonly stock: CustomStock;
  /** The entries left out, as typed, with the reason. */
  readonly skipped: readonly { readonly text: string; readonly reason: StockSkip }[];
}

/** Resistor notation: the `R` as decimal point or at the end, `4R7`, `100R`, `4.7 R`. */
const R_NOTATION = /^(?:\d+[Rr]\d+|(?:\d+(?:\.\d*)?|\.\d+)\s*[Rr])$/;

/**
 * Parse a pasted stock list and say what was left out.
 *
 * Separators: semicolons and line breaks; commas too, except that in a list
 * that uses semicolons or line breaks a comma between two digits is a decimal
 * comma (`8,2 nH; 12 nH`). In a list separated by commas alone, a comma between
 * two digits may be a decimal comma (`1,5 nH, 2,2 nH`); where the list carries
 * units, the two values beside such a comma are skipped as ambiguous.
 *
 * Values are in engineering notation with an optional unit: `H` goes to the
 * inductors, `F` to the capacitors, ohm (`Ω`, `ohm`) and the R notation
 * (`4R7`, `100R`) to the resistors only. A value without a unit is offered to
 * all three only when no entry of the list has a unit; in a list with units it
 * is skipped. Unreadable entries and foreign units are skipped.
 */
export function parseStockReport(text: string): StockReport {
  const L: number[] = [];
  const C: number[] = [];
  const R: number[] = [];
  const skipped: { text: string; reason: StockSkip }[] = [];
  const semicolons = /[;\n]/.test(text);
  const source = semicolons ? text.replace(/(\d),(?=\d)/g, '$1.') : text;
  // Comma-only list: each token remembers whether a digit-comma-digit touches it.
  const tokens: { text: string; ambiguous: boolean }[] = [];
  let start = 0;
  let touched = false;
  for (let i = 0; i <= source.length; i++) {
    const ch = source.charAt(i);
    if (i < source.length && ch !== ',' && ch !== ';' && ch !== '\n') continue;
    const between =
      ch === ',' && /\d/.test(source.charAt(i - 1)) && /\d/.test(source.charAt(i + 1));
    tokens.push({ text: source.slice(start, i).trim(), ambiguous: touched || between });
    touched = between;
    start = i + 1;
  }

  const read = tokens
    .filter((t) => t.text !== '')
    .map((t) => {
      const p = tryParseEngineering(t.text);
      const resistor = R_NOTATION.test(t.text);
      return { ...t, p, kind: p ? (resistor ? 'r' : p.unit.toLowerCase()) : '' };
    });
  const withUnits = read.some((t) => t.p && t.kind !== '');

  for (const t of read) {
    if (!t.p || !(t.p.value > 0)) {
      skipped.push({ text: t.text, reason: 'unreadable' });
    } else if (withUnits && t.ambiguous) {
      skipped.push({ text: t.text, reason: 'decimal comma' });
    } else if (t.kind === '') {
      if (withUnits) {
        skipped.push({ text: t.text, reason: 'no unit' });
      } else {
        L.push(t.p.value);
        C.push(t.p.value);
        R.push(t.p.value);
      }
    } else if (t.kind.startsWith('h')) L.push(t.p.value);
    else if (t.kind.startsWith('f')) C.push(t.p.value);
    else if (t.kind.startsWith('ω') || t.kind.startsWith('ohm') || t.kind === 'r') {
      R.push(t.p.value);
    } else skipped.push({ text: t.text, reason: 'unit' });
  }
  const sorted = (a: number[]): number[] => [...new Set(a)].sort((x, y) => x - y);
  return { stock: { L: sorted(L), C: sorted(C), R: sorted(R) }, skipped };
}

/** The stock of a pasted list, by the rules of parseStockReport. */
export function parseStock(text: string): CustomStock {
  return parseStockReport(text).stock;
}
