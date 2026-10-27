/**
 * The measured board (phase D6, docs/08): the S11 of the built board, imported
 * with "Compare with the design", compared with the network as built, fitted
 * for what moved and retuned. The measurement is saved with the design (the
 * `.json` file and the autosave; a share link only when it is small); the fit
 * and the retune are results of this session.
 *
 * Two models of the same board: as measured (the load at port 2 is the VNA's
 * termination for a two-port file, else the design's load), which the fit and
 * the curves use, and on the design's load, which the retune and every figure
 * against the target use.
 */
import {
  compareMeasurement,
  complex,
  formatEngineering,
  measuredPart,
  measuredReflections,
  modelGammas,
  partAt,
  retuneCandidates,
  retunedGammas,
  retunedWorst,
  suggestRetune,
  sweepPoints,
  type BuildFit,
  type BuildModel,
  type Comparison,
  type Complex,
  type DriftParameter,
  type Element,
  type FittedParameter,
  type MeasuredReflection,
  type Retune,
  type RetuneChange,
  type SweepLoad,
} from '@smithonline/core';
import type { Design, DesignElement } from './design';
import { designBuild } from './designBuild';
import { elementName, withPrimaryValue } from './elements';
import { hasMeasuredLoad, measuredPoints } from './measuredLoad';
import { effectiveElements, realizeDesign, valueSource } from './realize';
import { designVswrLimit, monteCarloOptions } from './tolerance';
import { MAX_SWEEP_LOADS } from './datapoints';
import { fmtFrequency, fmtNum, fmtSig } from './format';
import { targetOf } from './design';
import { usePartLibrary } from '../store/usePartLibrary';

/** The measured S11 of the built board, as the design keeps it. */
export interface MeasuredBoard {
  /** The file it came from. */
  readonly name: string;
  /** The measured input impedance per frequency (from S11 at the file's reference). */
  readonly points: readonly SweepLoad[];
  /**
   * The resistance port 2 was terminated in, ohm, for a two-port measurement (the VNA's
   * reference); absent: the board was measured with its load connected.
   */
  readonly termination?: number;
}

/** Most points a measurement keeps (as a measured load). */
export const MAX_BOARD_POINTS = MAX_SWEEP_LOADS;
/** Most points a share link carries; a larger measurement is left out of links (saved in a .json file). */
export const LINK_BOARD_POINTS = 201;
/** The largest impedance a measured point may have: the open the readers make of |S11| = 1 at 0 degrees. */
export const MAX_BOARD_Z = 1e18;

/* ------------------------------------------------------------ the points */

/** The points a measurement keeps, and what one rule left out. */
export interface BoardPoints {
  readonly points: SweepLoad[];
  /** Rows at a frequency an earlier row had: one per frequency is kept, the last. */
  readonly repeated: number;
  /** Rows without a finite positive frequency or a finite impedance (|R| and |X| up to 1e18 ohm). */
  readonly dropped: number;
}

/**
 * One rule for Compare and every reader (file, autosave, link): finite positive frequencies,
 * finite impedances up to MAX_BOARD_Z (an open is kept), one point per frequency (a segmented
 * sweep repeats the joint: the last row is kept), sorted by frequency. What Compare takes is
 * what a saved file gives back.
 */
export function boardPoints(rows: readonly unknown[]): BoardPoints {
  const byF = new Map<number, SweepLoad>();
  let seen = 0;
  for (const item of rows) {
    const l = item as { frequency?: unknown; z?: { re?: unknown; im?: unknown } } | null;
    const f = l?.frequency;
    const re = l?.z?.re;
    const im = l?.z?.im;
    if (
      typeof f !== 'number' ||
      !(f > 0) ||
      !Number.isFinite(f) ||
      typeof re !== 'number' ||
      typeof im !== 'number' ||
      !(Math.abs(re) <= MAX_BOARD_Z) ||
      !(Math.abs(im) <= MAX_BOARD_Z)
    )
      continue;
    seen += 1;
    byF.set(f, { frequency: f, z: { re, im } });
  }
  const points = [...byF.values()].sort((a, b) => a.frequency - b.frequency);
  return { points, repeated: seen - points.length, dropped: rows.length - seen };
}

/* ------------------------------------------------------------ the model */

interface Models {
  readonly lib: unknown;
  readonly build: string;
  /** As measured: port 2 on the VNA's termination for a two-port file. */
  readonly measured: BuildModel;
  /** On the design's load: what the retune and the target figures judge. */
  readonly designed: BuildModel;
  key?: string;
}

const modelsMemo = new WeakMap<Design, Models>();

/** The models of a design, kept per design and part library (Realize from the library depends on it). */
function models(design: Design): Models {
  const lib = usePartLibrary.getState().parts;
  const built = designBuild(design);
  const build = JSON.stringify(built);
  const hit = modelsMemo.get(design);
  if (hit && hit.lib === lib && hit.build === build) return hit;
  const elements = effectiveElements(design);
  const real = realizeDesign(design, elements);
  const load: BuildModel['load'] = hasMeasuredLoad(design)
    ? (measuredPoints(design) ?? design.load)
    : design.load;
  const designed: BuildModel = {
    z0: design.z0,
    frequency: design.frequency,
    base: real ? real.ladder.elements : elements,
    table: built.table,
    board: built.board,
    load,
  };
  const termination = design.measurement?.termination;
  const measured =
    termination !== undefined ? { ...designed, load: complex(termination, 0) } : designed;
  const out: Models = { lib, build, measured, designed };
  modelsMemo.set(design, out);
  return out;
}

/**
 * The network the board was built from, as measured: the realized values (Realize on) or the
 * ideal ones with the loss model, the design's packages and board, and the load at port 2 (the
 * VNA's termination for a two-port file, else the measured load or the fixed load). The fit and
 * the curves use it.
 */
export function boardModel(design: Design): BuildModel {
  return models(design).measured;
}

/** The same network on the design's load: the retune and every figure against the target. */
export function designModel(design: Design): BuildModel {
  return models(design).designed;
}

const reflectionsMemo = new WeakMap<MeasuredBoard, { z0: number; out: MeasuredReflection[] }>();

/** The measured reflection coefficients at the design's Z0. */
export function boardReflections(design: Design): MeasuredReflection[] {
  const m = design.measurement;
  if (!m) return [];
  const hit = reflectionsMemo.get(m);
  if (hit && hit.z0 === design.z0) return hit.out;
  const out = measuredReflections(m.points, design.z0);
  reflectionsMemo.set(m, { z0: design.z0, out });
  return out;
}

/** The frequencies the target is judged at: Tolerance's band, else the sweep, else f. */
export function boardBand(design: Design): number[] {
  const band = monteCarloOptions(design).band;
  if (band && band.length > 0) return [...band];
  const s = design.sweep;
  if (s.enabled && s.start > 0 && s.stop > 0 && s.start !== s.stop && !s.loads) {
    return sweepPoints(
      Math.min(s.start, s.stop),
      Math.max(s.start, s.stop),
      Math.min(201, Math.max(2, s.points)),
    );
  }
  return [design.frequency];
}

/* ----------------------------------------------------------- the key */

/** A short hash of text (FNV-1a, 32 bit). */
function hashText(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

const dataHashes = new WeakMap<object, string>();

/** A hash of an object's content, made once per object (part data, measurement points). */
function contentHash(value: object): string {
  const hit = dataHashes.get(value);
  if (hit) return hit;
  const out = hashText(JSON.stringify(value));
  dataHashes.set(value, out);
  return out;
}

/** An element as the key sees it: a library part by its names and a hash of its data. */
function keyElement(el: Element): unknown {
  if (el.kind !== 'part') return el;
  const { data, ...names } = el.part;
  return { ...el, part: { ...names, data: data ? contentHash(data) : null } };
}

/**
 * What the comparison, the fit and the retune were computed for: a change to the network, the
 * part library Realize draws on, the build, the load or the measurement makes them stale. Kept
 * per design and library: a few kilobytes, whatever the size of the parts' data.
 */
export function boardKey(design: Design): string {
  const s = models(design);
  if (s.key !== undefined) return s.key;
  const m = design.measurement;
  const model = s.measured;
  s.key = JSON.stringify({
    base: model.base.map(keyElement),
    board: model.board,
    table: model.table,
    load: Array.isArray(model.load) ? contentHash(model.load as readonly SweepLoad[]) : model.load,
    designLoad: s.designed.load === model.load ? null : s.designed.load,
    z0: design.z0,
    f: design.frequency,
    m: m ? [m.name, m.points.length, contentHash(m.points), m.termination] : null,
    band: boardBand(design),
    limit: designVswrLimit(design),
    target: design.target,
    realize: design.realize,
  });
  return s.key;
}

/* ------------------------------------------------------- the comparison */

/** The measured board against the network as built, with what a bench engineer checks first. */
export interface BoardComparison extends Comparison {
  /** The measured frequencies, lowest and highest; null without a usable point. */
  readonly span: readonly [number, number] | null;
  /** The design frequency lies outside the measured span. */
  readonly frequencyOutside: boolean;
  /** The target band's frequencies inside the measured span (where the retune is judged). */
  readonly judged: readonly number[];
  /** The target band's frequencies outside the measured span. */
  readonly bandOutside: number;
  /** The board was measured as a two-port: the measured VSWR is not on the design's load. */
  readonly twoPort: boolean;
}

const comparisonMemo = new WeakMap<Design, { key: string; out: BoardComparison }>();

/**
 * The measured board against the network as built (null without a measurement). The curves
 * and |ΔΓ| are as measured; the designed worst VSWR is the design's own, on its load over the
 * whole target band; the measured worst VSWR is over the band where it was measured, and left
 * out for a two-port measurement (port 2 was not on the design's load).
 */
export function boardComparison(design: Design): BoardComparison | null {
  if (!design.measurement) return null;
  const key = boardKey(design);
  const hit = comparisonMemo.get(design);
  if (hit && hit.key === key) return hit.out;
  const band = boardBand(design);
  const lo = Math.min(...band);
  const hi = Math.max(...band);
  const cmp = compareMeasurement(boardModel(design), boardReflections(design), {
    band: [lo, hi],
  });
  const fs = cmp.points.map((p) => p.frequency);
  const span: [number, number] | null = fs.length > 0 ? [Math.min(...fs), Math.max(...fs)] : null;
  const part = measuredPart(band, cmp.points);
  const twoPort = design.measurement.termination !== undefined;
  const designedWorst = retunedWorst(designModel(design), {}, new Map(), band, targetOf(design));
  const out: BoardComparison = {
    ...cmp,
    measuredWorst: twoPort ? null : cmp.measuredWorst,
    designedWorst: Number.isFinite(designedWorst.frequency) ? designedWorst : null,
    span,
    frequencyOutside:
      span !== null &&
      (design.frequency < span[0] * (1 - 1e-9) || design.frequency > span[1] * (1 + 1e-9)),
    judged: part.inside,
    bandOutside: part.outside,
    twoPort,
  };
  comparisonMemo.set(design, { key, out });
  return out;
}

const spanText = (s: readonly [number, number]): string =>
  `${fmtFrequency(s[0])} to ${fmtFrequency(s[1])}`;

/** What the comparison cannot vouch for, in words: the design frequency or the band outside the measurement. */
export function coverageNote(design: Design, c: BoardComparison): string | null {
  if (!c.span) return null;
  const band = boardBand(design);
  if (c.frequencyOutside)
    return `The design frequency (${fmtFrequency(design.frequency)}) lies outside the measurement (${spanText(c.span)}): is this the measurement of this design?`;
  if (c.judged.length === 0)
    return `The target band (${spanText([Math.min(...band), Math.max(...band)])}) lies outside the measurement (${spanText(c.span)}): measure the board over the band.`;
  if (c.bandOutside > 0)
    return `Part of the target band lies outside the measurement (${spanText(c.span)}): ${c.bandOutside} of its ${band.length} frequencies are not judged.`;
  return null;
}

/** The measured worst VSWR in words: the number, or why there is none. */
export function measuredWorstText(c: BoardComparison): string {
  if (c.measuredWorst) return fmtNum(c.measuredWorst.vswr, 3);
  return c.twoPort
    ? 'not on the design load (port 2 on the VNA reference)'
    : 'not measured in the band';
}

/** The design as built misses its own target (no drift): a retune would correct the design as well as the board. */
export function designMisses(design: Design, c: BoardComparison | null): boolean {
  return c?.designedWorst != null && c.designedWorst.vswr > designVswrLimit(design);
}

/* ------------------------------------------------------- the fit, judged */

/** How far a fit can be acted on, and why, in words. */
export interface Verdict {
  readonly level: 'ok' | 'caution' | 'untrusted';
  readonly text: string;
}

/**
 * What a senior engineer concludes from a fit before acting on it: is the residual noise, are
 * the drifts those of a board built as designed, was the design frequency measured.
 */
export function fitVerdict(design: Design, fit: BuildFit): Verdict {
  const c = fit.check;
  const ratio = fmtSig(c.residualRatio, 2);
  const floor = Number.isFinite(c.noiseFloor) ? fmtSig(c.noiseFloor, 2) : null;
  const causes =
    'Check the calibration plane (tick Reference plane and fit again), the file, the design, or an assembly fault (a wrong or misplaced part).';
  const said: string[] = [];
  if (c.frequencyOutside)
    said.push(
      `The design frequency (${fmtFrequency(design.frequency)}) lies outside the measurement: is this the measurement of this design?`,
    );
  if (c.residual === 'unexplained')
    said.push(
      `The model does not explain this board: |ΔΓ| RMS ${fmtSig(fit.rmsAfter, 2)} after the fit is ${ratio} times the noise floor${floor ? ` (${floor})` : ''}.`,
    );
  const label = (id: string): string => {
    const p = fit.parameters.find((q) => q.id === id);
    return p ? parameterLabel(design, p) : id;
  };
  for (const x of c.implausible) {
    const p = fit.parameters.find((q) => q.id === x.id);
    if (!p) continue;
    said.push(
      x.why === 'unphysical'
        ? `${label(x.id)} ${driftText(p, p.drift)} is past what is physical.`
        : `${label(x.id)} ${driftText(p, p.drift)} is ${fmtSig(Math.abs(p.drift) / p.prior, 2)} times its typical drift: not a board built as designed.`,
    );
  }
  if (said.length > 0)
    return { level: 'untrusted', text: `${said.join(' ')} ${causes} Do not act on these drifts.` };
  if (c.residual === 'above')
    return {
      level: 'caution',
      text: `The residual is ${ratio} times the noise floor${floor ? ` (${floor})` : ''}: the model explains most of the board but not all. Treat the drifts with care; ${causes.charAt(0).toLowerCase()}${causes.slice(1)}`,
    };
  return {
    level: 'ok',
    text: `The residual is at the noise floor (${ratio} times${floor ? ` ${floor}` : ''}): the model explains this board.`,
  };
}

/* ------------------------------------------------------------ in words */

/** The name of a parameter as the drift table shows it: "Shunt L 1 value", "Series C 2 pads", "Vias". */
export function parameterLabel(design: Design, p: Pick<DriftParameter, 'kind' | 'index'>): string {
  const el = p.index !== undefined ? design.elements[p.index] : undefined;
  const name = el && p.index !== undefined ? `${elementName(el)} ${p.index + 1}` : '';
  switch (p.kind) {
    case 'value':
      return `${name} value`;
    case 'pad':
      return `${name} pads`;
    case 'padScale':
      return 'All pads';
    case 'via':
      return 'Vias';
    case 'trace':
      return 'Trace length';
    case 'er':
      return 'Board εr';
    case 'h':
      return 'Board height';
    case 'plane':
      return 'Reference plane';
  }
}

/** The unit a drift is shown in and its scale from SI. */
function driftUnit(p: Pick<DriftParameter, 'kind' | 'relative'>): {
  readonly unit: string;
  readonly scale: number;
} {
  if (p.relative) return { unit: '%', scale: 100 };
  if (p.kind === 'pad') return { unit: 'pF', scale: 1e12 };
  if (p.kind === 'plane') return { unit: 'ps', scale: 1e12 };
  return { unit: 'mm', scale: 1e3 };
}

/** Decimals that show a quantity to two significant figures of its uncertainty. */
function decimalsFor(sigma: number): number {
  if (!(sigma > 0) || !Number.isFinite(sigma)) return 2;
  return Math.min(6, Math.max(0, 1 - Math.floor(Math.log10(sigma))));
}

/**
 * A drift in words, the sign always shown: "+8.02 %" or "+0.298 pF". With its uncertainty the
 * drift takes as many decimals as two figures of the uncertainty need.
 */
export function driftText(
  p: Pick<DriftParameter, 'kind' | 'relative'>,
  v: number,
  sigma?: number | null,
): string {
  const { unit, scale } = driftUnit(p);
  const x = v * scale;
  const sign = x > 0 ? '+' : x < 0 ? '-' : '';
  const digits =
    sigma !== undefined && sigma !== null
      ? decimalsFor(sigma * scale)
      : p.relative
        ? Math.abs(v) < 0.001
          ? 2
          : 1
        : null;
  const body = digits === null ? fmtSig(Math.abs(x), 2) : Math.abs(x).toFixed(digits);
  return `${sign}${body} ${unit}`;
}

/** An uncertainty in words, to two significant figures: "0.040 %". */
export function sigmaText(p: Pick<DriftParameter, 'kind' | 'relative'>, sigma: number): string {
  const { unit, scale } = driftUnit(p);
  return `${(sigma * scale).toFixed(decimalsFor(sigma * scale))} ${unit}`;
}

/** The typical drift of a parameter, the prior: "±10 %", "±0.2 pF". */
export function typicalText(p: Pick<DriftParameter, 'kind' | 'relative' | 'prior'>): string {
  const { unit, scale } = driftUnit(p);
  return `±${fmtSig(p.prior * scale, 3)} ${unit}`;
}

/** The nominal a drift applies to, in words: "12 nH", "0.121 pF", "0.543 nH", "4.17"; null where it has none. */
export function nominalText(p: DriftParameter, design: Design): string | null {
  const el = p.index !== undefined ? design.elements[p.index] : undefined;
  switch (p.kind) {
    case 'value': {
      const unit = el?.kind === 'L' ? 'H' : el?.kind === 'C' ? 'F' : 'Ω';
      return formatEngineering(p.nominal, { unit, digits: 3 });
    }
    case 'pad':
      return `${fmtSig(p.nominal * 1e12, 3)} pF`;
    case 'via':
      return formatEngineering(p.nominal, { unit: 'H', digits: 3 });
    case 'trace':
    case 'h':
      return formatEngineering(p.nominal, { unit: 'm', digits: 3 });
    case 'er':
      return String(Number(p.nominal.toPrecision(3)));
    case 'padScale':
    case 'plane':
      return null;
  }
}

/** Why a parameter was not fitted, in words that match the rule that fixed it. */
export function notFittedText(p: FittedParameter, label: (id: string) => string): string {
  if (p.status === 'not-free') return 'not fitted (unticked)';
  if (p.status === 'no-effect') return 'no effect on S11 here';
  if (p.why === 'too-many') return 'not resolved: more unknowns than the data supports';
  if (p.why === 'like-another' && p.partner)
    return `not resolved: acts like ${label(p.partner)} (correlation ${fmtNum(Math.abs(p.correlation ?? 0), 4)} with it)`;
  const partner =
    p.partner !== undefined
      ? ` (correlation ${fmtNum(Math.abs(p.correlation ?? 0), 2)} with ${label(p.partner)})`
      : '';
  return `not resolved: its uncertainty is half its typical drift or more${partner}`;
}

/** A part a retune puts in, in words: "11 nH" or the library part number. */
export function partText(el: Element): string {
  if (el.kind === 'part') return el.part.partNumber;
  if (el.kind === 'L') return formatEngineering(el.value, { unit: 'H', digits: 3 });
  if (el.kind === 'C') return formatEngineering(el.value, { unit: 'F', digits: 3 });
  if (el.kind === 'R') return formatEngineering(el.value, { unit: 'Ω', digits: 3 });
  return elementName(el);
}

/* --------------------------------------------------------------- retune */

/** A retune of the board, with where it was judged. */
export interface BoardRetune extends Retune {
  /** The target band's frequencies it was judged at: those inside the measured span. */
  readonly judged: readonly number[];
  /** The band's frequencies left out (outside the measurement). */
  readonly bandOutside: number;
  /** The design as built misses the target with no drift: the retune corrects the design too. */
  readonly designMisses: boolean;
}

/**
 * The retune of the design with fitted drifts, on the design's load, snapped to the design's
 * Realize source, judged only where the board was measured. Refused when no band frequency was
 * measured, or when the fit it rests on is not to be acted on.
 */
export function retuneFor(
  design: Design,
  fit: BuildFit | Readonly<Record<string, number>>,
): BoardRetune {
  const drifts =
    'check' in fit ? (fit as BuildFit).drifts : (fit as Readonly<Record<string, number>>);
  const c = boardComparison(design);
  const band = boardBand(design);
  const judged = c ? c.judged : band;
  const bandOutside = c ? c.bandOutside : 0;
  const misses = designMisses(design, c);
  const refuse = (reason: string): BoardRetune => ({
    before: { vswr: NaN, frequency: NaN },
    single: null,
    suggestion: null,
    first: null,
    evaluated: 0,
    refused: reason,
    judged,
    bandOutside,
    designMisses: misses,
  });
  if ('check' in fit && !(fit as BuildFit).check.trusted)
    return refuse(
      'the fit cannot be acted on (see the check under the drift table): a retune built on it would not be trusted; find the cause first',
    );
  if (judged.length === 0)
    return refuse(
      c?.span
        ? `the target band (${spanText([Math.min(...band), Math.max(...band)])}) lies outside the measurement (${spanText(c.span)}); measure the board over the band`
        : 'no measured frequency can be compared with the network',
    );
  // With Realize off, the series Realize would snap to.
  const source = valueSource(design.realize);
  const retune = suggestRetune(designModel(design), drifts, {
    band: judged,
    limit: designVswrLimit(design),
    target: targetOf(design),
    candidates: retuneCandidates(source, design.frequency, judged),
    locked: design.elements.flatMap((el, i) => (el.locked ? [i] : [])),
  });
  return { ...retune, judged, bandOutside, designMisses: misses };
}

/** The reflection coefficients of the board as fitted (the reference plane kept), at the measured frequencies. */
export function fittedGammas(design: Design, drifts: Readonly<Record<string, number>>): Complex[] {
  const fs = boardReflections(design).map((p) => p.frequency);
  return modelGammas(boardModel(design), drifts, fs);
}

/**
 * The reflection coefficients expected after a retune, at the measured frequencies, as this
 * bench would measure them (the termination and the reference plane kept), so the curve sets
 * against the next measurement.
 */
export function expectedAfter(
  design: Design,
  drifts: Readonly<Record<string, number>>,
  changes: readonly RetuneChange[],
): Complex[] {
  const fs = boardReflections(design).map((p) => p.frequency);
  return retunedGammas(boardModel(design), drifts, changes, fs);
}

/** A library part placed where an element was: the element keeps its place, colour and lock. */
function placedPart(el: DesignElement, to: Extract<Element, { kind: 'part' }>): DesignElement {
  return {
    kind: 'part',
    orientation: 'orientation' in el ? el.orientation : to.orientation,
    part: to.part,
    id: el.id,
    color: el.color,
    ...(el.locked ? { locked: true } : {}),
    ...(el.note !== undefined ? { note: el.note } : {}),
  } as DesignElement;
}

/** The element as built is what a retune change evaluated: the same library part, or the same value. */
function builtAs(built: Element | undefined, to: Element): boolean {
  if (!built) return false;
  if (to.kind === 'part')
    return built.kind === 'part' && built.part.partNumber === to.part.partNumber;
  if (to.kind === 'R' || to.kind === 'L' || to.kind === 'C')
    return built.kind === to.kind && Math.abs(built.value - to.value) <= 1e-9 * to.value;
  return false;
}

/**
 * The design with a retune applied, placing exactly what the retune evaluated: a value of the
 * series or the stock as the part's value; a library part as the library part element (with
 * Realize from the library, a part Realize maps the effective value back to keeps the design
 * ideal). Null, with the reason, when the network as built would differ from the suggestion.
 */
export function withRetune(
  design: Design,
  changes: readonly RetuneChange[],
): { readonly design: Design } | { readonly reason: string } {
  const fromLibrary = design.realize.enabled && design.realize.series === 'library';
  const write = (asPart: ReadonlySet<number>): Design => ({
    ...design,
    elements: design.elements.map((el, i): DesignElement => {
      const ch = changes.find((c) => c.index === i);
      if (!ch) return el;
      const to = ch.to;
      if (to.kind === 'part') {
        if (el.kind === 'part') return { ...el, part: to.part };
        if (fromLibrary && !asPart.has(i)) {
          const v = partAt(to.part, design.frequency)?.value;
          if (v && v > 0) return withPrimaryValue(el, v);
        }
        return placedPart(el, to);
      }
      if (to.kind === 'R' || to.kind === 'L' || to.kind === 'C')
        return withPrimaryValue(el, to.value);
      return el;
    }),
  });
  let next = write(new Set());
  // Realize from the library maps a value to the nearest part: where that is not the part the
  // retune evaluated, the part itself is placed.
  const off = changes.filter((c) => !builtAs(designModel(next).base[c.index], c.to));
  if (off.length > 0) next = write(new Set(off.map((c) => c.index)));
  const wrong = changes.find((c) => !builtAs(designModel(next).base[c.index], c.to));
  if (wrong) {
    const el = design.elements[wrong.index];
    return {
      reason: `${el ? `${elementName(el)} ${wrong.index + 1}` : 'A part'} would not be built as ${partText(wrong.to)} (Realize would snap it to another value)`,
    };
  }
  return { design: next };
}

/** The step's name: "Retuned Shunt L 1 to 9.1 nH" or "Retuned 2 parts". */
export function retuneLabel(design: Design, changes: readonly RetuneChange[]): string {
  const first = changes[0];
  if (!first) return 'Retune: nothing to change';
  if (changes.length === 1) {
    const el = design.elements[first.index];
    return `Retuned ${el ? `${elementName(el)} ${first.index + 1}` : 'a part'} to ${partText(first.to)}`;
  }
  return `Retuned ${changes.length} parts: ${changes
    .map((c) => {
      const el = design.elements[c.index];
      return `${el ? `${elementName(el)} ${c.index + 1}` : 'a part'} to ${partText(c.to)}`;
    })
    .join(', ')}`;
}

/** What a retune leaves to say about the design and the drift, in words; null when there is nothing. */
export function retuneCause(design: Design, r: BoardRetune): string | null {
  const c = boardComparison(design);
  const limit = designVswrLimit(design);
  if (r.designMisses && c?.designedWorst)
    return `The design as built misses the target already (designed worst VSWR ${fmtNum(c.designedWorst.vswr, 3)} against ${fmtSig(limit)}): this retune corrects the design as well as the drift.`;
  if (c?.designedWorst && Number.isFinite(r.before.vswr) && r.before.vswr > limit)
    return `The design as built meets the target (designed ${fmtNum(c.designedWorst.vswr, 3)}); the board drifted out of it (${fmtNum(r.before.vswr, 3)} as fitted).`;
  return null;
}
