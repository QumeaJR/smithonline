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

/**
 * Why a stock entry was left out: not a number, no unit in a list where other values have
 * one, a comma that may be a decimal comma or a separator, a comma before three digits that
 * may be a thousands separator or a decimal comma, or a unit that is not H, F or ohm.
 */
export type StockSkip = 'unreadable' | 'no unit' | 'decimal comma' | 'thousands' | 'unit';

export interface StockReport {
  readonly stock: CustomStock;
  /** The entries left out, as typed, with the reason. */
  readonly skipped: readonly { readonly text: string; readonly reason: StockSkip }[];
}

/** No stock entry is longer; a longer token is unreadable before any pattern runs. */
const MAX_TOKEN = 256;
const DECIMAL = String.raw`(?:\d+(?:\.\d*)?|\.\d+)`;
/** IEC 60062 R notation: the R as decimal point, at the end or in front, `4R7`, `100R`, `R47`. */
const R_CODE = new RegExp(String.raw`^(?:(\d+)[Rr](\d+)|[Rr](\d+)|(${DECIMAL})\s*[Rr])$`);
/** IEC 60062 k and M notation, `4k7`, `1M5`, or a value with a k or M and no unit, `10k`. */
const KM_CODE = new RegExp(String.raw`^(?:\d+[kKM]\d+|${DECIMAL}(?:[eE][+-]?\d+)?\s*[kKM])$`);

/**
 * The value of a resistor code, or null when the text is none: the R notation, and the k and
 * M notation, which no realistic inductor or capacitor uses (1000 H, 1000 F).
 */
function resistorCode(text: string): number | null {
  if (text.length > MAX_TOKEN) return null;
  const r = R_CODE.exec(text);
  if (r) {
    if (r[1] !== undefined) return Number(`${r[1]}.${r[2] ?? '0'}`);
    if (r[3] !== undefined) return Number(`0.${r[3]}`);
    return Number(r[4]);
  }
  if (!KM_CODE.test(text)) return null;
  // Read without the blank, so "1e3 k" is 1e3 kilo as "1e3k" is, not 1e3 with the unit k.
  return tryParseEngineering(text.replace(/\s+/g, ''))?.value ?? null;
}

/** The unit of a stock entry as a part kind, or null for a unit that is not H, F or ohm. */
function unitKind(unit: string): PartKind | null {
  const u = unit.toLowerCase();
  if (u === 'h') return 'L';
  if (u === 'f') return 'C';
  if (u === 'ω' || u === 'ohm' || u === 'ohms') return 'R';
  return null;
}

/** One entry of the list as typed, with what its commas between digits may mean. */
interface StockEntry {
  readonly text: string;
  /** Holds a comma between digits (a decimal comma or ambiguous). */
  readonly inner: boolean;
  /** One of those commas stands before exactly three digits (`1,000`). */
  readonly thousands: boolean;
  /** Joined from several values of a comma-only list: always ambiguous. */
  readonly group: boolean;
}

const isDigit = (ch: string): boolean => ch >= '0' && ch <= '9';

/** Exactly three digits from position i: `1,000` but not `1,0000`. */
function threeDigits(text: string, i: number): boolean {
  return (
    isDigit(text.charAt(i)) &&
    isDigit(text.charAt(i + 1)) &&
    isDigit(text.charAt(i + 2)) &&
    !isDigit(text.charAt(i + 3))
  );
}

/**
 * Split the list into entries. Semicolons, tabs and line breaks separate; so does a comma,
 * except a comma between two digits: in a list that has a semicolon, tab or line break it
 * stays inside the entry, and in a list of commas alone it joins the values beside it into
 * one entry, reported as typed (`4,7n`).
 */
function splitStock(text: string): { entries: StockEntry[]; separatingComma: boolean } {
  const lines = /[;\n\t]/.test(text);
  const entries: StockEntry[] = [];
  let separatingComma = false;
  let start = 0;
  let inner = false;
  let thousands = false;
  let joined = 0;
  for (let i = 0; i <= text.length; i++) {
    const ch = text.charAt(i);
    if (i < text.length && ch !== ',' && ch !== ';' && ch !== '\n' && ch !== '\t') continue;
    const between = ch === ',' && isDigit(text.charAt(i - 1)) && isDigit(text.charAt(i + 1));
    if (ch === ',' && !between) separatingComma = true;
    if (between) {
      inner = true;
      thousands ||= threeDigits(text, i + 1);
      if (!lines) joined++;
      continue;
    }
    const entry = text.slice(start, i).trim();
    if (entry !== '') entries.push({ text: entry, inner, thousands, group: joined > 0 });
    start = i + 1;
    inner = false;
    thousands = false;
    joined = 0;
  }
  return { entries, separatingComma };
}

/**
 * Parse a pasted stock list and say what was left out.
 *
 * Separators: semicolons, tabs, line breaks and commas. A comma between two
 * digits may be a decimal comma (`8,2 nH`) or a separator written without a
 * blank (`10,22`), so it is read as a decimal comma only in a list that uses
 * semicolons, tabs or line breaks, has units, and uses no comma as a separator
 * anywhere (`8,2 nH; 12 nH`). Everywhere else the values beside it are skipped
 * and reported as one entry: in a list of commas alone (`4,7n, 10n` reports
 * `4,7n`; `1,5` alone is reported), in a list without units (a two-column
 * paste, `10,22` on each line), and in a list whose commas also separate values
 * (`10 nH, 22 nH` on one line, `47,100 pF` on the next). A comma before exactly
 * three digits (`1,000 pF`) may be a thousands separator and is skipped in every list.
 *
 * Values are in engineering notation with an optional unit: `H` goes to the
 * inductors, `F` to the capacitors, ohm (`Ω`, `ohm`) to the resistors. The
 * IEC 60062 resistor codes go to the resistors only: the R notation (`4R7`,
 * `100R`, `R47` = 0.47 Ω), the k and M notation (`4k7`, `1M5`) and a value with
 * a k or M and no unit (`1k`, `10k`, `1M`), since no realistic inductor or
 * capacitor is 1000 H or 1000 F. A value without a unit is offered to all three
 * only when no entry of the list has a unit (a resistor code is no unit here);
 * in a list with units it is skipped. Unreadable entries and units other than
 * H, F and ohm (`100 MHz`) are skipped.
 */
export function parseStockReport(text: string): StockReport {
  const L: number[] = [];
  const C: number[] = [];
  const R: number[] = [];
  const skipped: { text: string; reason: StockSkip }[] = [];
  const { entries, separatingComma } = splitStock(text);

  const read = entries.map((e) => {
    if (e.group) return { e, p: null };
    const code = resistorCode(e.text);
    if (code !== null) return { e, p: { value: code, unit: '', code: true } };
    // A comma between digits reads as a decimal point; whether it may is judged below.
    const p =
      e.text.length > MAX_TOKEN ? null : tryParseEngineering(e.text.replace(/(\d),(?=\d)/g, '$1.'));
    return { e, p: p ? { value: p.value, unit: p.unit, code: false } : null };
  });
  const withUnits = read.some(({ p }) => p && !p.code && p.unit !== '');

  for (const { e, p } of read) {
    if (e.inner && e.thousands) {
      skipped.push({ text: e.text, reason: 'thousands' });
    } else if (e.group || (e.inner && (separatingComma || !withUnits))) {
      skipped.push({ text: e.text, reason: 'decimal comma' });
    } else if (!p || !(p.value > 0)) {
      skipped.push({ text: e.text, reason: 'unreadable' });
    } else if (p.code) {
      R.push(p.value);
    } else if (p.unit === '') {
      if (withUnits) {
        skipped.push({ text: e.text, reason: 'no unit' });
      } else {
        L.push(p.value);
        C.push(p.value);
        R.push(p.value);
      }
    } else {
      const kind = unitKind(p.unit);
      if (kind === 'L') L.push(p.value);
      else if (kind === 'C') C.push(p.value);
      else if (kind === 'R') R.push(p.value);
      else skipped.push({ text: e.text, reason: 'unit' });
    }
  }
  const sorted = (a: number[]): number[] => [...new Set(a)].sort((x, y) => x - y);
  return { stock: { L: sorted(L), C: sorted(C), R: sorted(R) }, skipped };
}

/** The stock of a pasted list, by the rules of parseStockReport. */
export function parseStock(text: string): CustomStock {
  return parseStockReport(text).stock;
}
