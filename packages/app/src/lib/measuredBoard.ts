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
  HOBBY_VNA_ACCURACY,
  MAX_PLANE,
  MIN_NOISE_FLOOR,
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
  type FitCheck,
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
  /**
   * The class of the VNA it was measured on: its accuracy is the floor the fit's residual is held
   * against (lab 0.002, hobby such as a NanoVNA 0.02). Absent: lab.
   */
  readonly vna?: VnaClass;
  /** What the board was built from when it was compared, in words ("E24 values", "the part library"). */
  readonly source?: string;
}

/** The class of a VNA, for its accuracy: a lab instrument or a hobby one (a NanoVNA). */
export type VnaClass = 'lab' | 'hobby';

/** The accuracy of each class, |ΔΓ| RMS: what its calibration leaves that the scatter does not show. */
export const VNA_ACCURACY: Readonly<Record<VnaClass, number>> = {
  lab: MIN_NOISE_FLOOR,
  hobby: HOBBY_VNA_ACCURACY,
};

/** The class in words: "lab VNA", "hobby VNA". */
export const VNA_NAME: Readonly<Record<VnaClass, string>> = {
  lab: 'lab VNA',
  hobby: 'hobby VNA (e.g. a NanoVNA)',
};

/** The VNA class a measurement is held to: its own, else lab. */
export function vnaOf(design: Design): VnaClass {
  return design.measurement?.vna ?? 'lab';
}

/**
 * The class a file suggests: hobby only on positive evidence, a NanoVNA, LibreVNA or tinySA named
 * in the file name or in the file's comments or header (`instrument`, from instrumentNamed); else
 * lab, the stricter floor. The layout of a table (frequency, re, im) names no instrument.
 */
export function vnaFromFile(fileName: string, instrument?: string): VnaClass {
  return /nano[ -]?vna|librevna|tinysa/i.test(`${fileName} ${instrument ?? ''}`) ? 'hobby' : 'lab';
}

/** What the design is built from, in words: "E24 values", "the stock list", "the part library", "ideal values (Realize off)". */
export function buildSource(design: Design): string {
  const r = design.realize;
  if (!r.enabled) return 'ideal values (Realize off)';
  if (r.series === 'library') return 'the part library';
  if (r.series === 'stock') return 'the stock list';
  return `${r.series} values`;
}

/** The source the measured board was built from and the one the design uses now, when they differ. */
export function sourceChanged(
  design: Design,
): { readonly then: string; readonly now: string } | null {
  const then = design.measurement?.source;
  if (!then) return null;
  const now = buildSource(design);
  return then === now ? null : { then, now };
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
    m: m ? [m.name, m.points.length, contentHash(m.points), m.termination, m.vna, m.source] : null,
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
  return c.twoPort ? 'not on the design load (port 2 on the VNA reference)' : 'not measured there';
}

/** Why a comparison has no measured worst VSWR, as a clause: "the board was not measured there". */
export function noMeasuredWorstText(c: BoardComparison): string {
  return c.twoPort
    ? 'the measured VSWR is not on the design load (port 2 on the VNA reference)'
    : 'the board was not measured there';
}

/** Where the target is judged, in words: "from 900 MHz to 1.1 GHz", or "at 450 MHz" for one frequency. */
export function bandPhrase(band: readonly number[]): string {
  const lo = Math.min(...band);
  const hi = Math.max(...band);
  return lo === hi ? `at ${fmtFrequency(lo)}` : `from ${fmtFrequency(lo)} to ${fmtFrequency(hi)}`;
}

/**
 * The worst VSWR sentence of a comparison: "Worst VSWR from 0.9 to 1.1 GHz: measured 1.55,
 * designed 1.30, target 1.38." A board not measured in the band, or measured as a two-port,
 * gets designed and target only, with why; null without a designed figure.
 */
export function worstVswrText(design: Design, c: BoardComparison): string | null {
  if (!c.designedWorst) return null;
  const where = bandPhrase(boardBand(design));
  const designed = `designed ${fmtNum(c.designedWorst.vswr, 3)}, target ${fmtSig(designVswrLimit(design))}`;
  if (c.measuredWorst)
    return `Worst VSWR ${where}: measured ${fmtNum(c.measuredWorst.vswr, 3)}, ${designed}.`;
  return `Worst VSWR ${where}: ${designed}; ${noMeasuredWorstText(c)}.`;
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

/** A reference plane in words: "+30.8 ps (about 4.6 mm of FR-4 microstrip)". */
export function planeText(tau: number): string {
  const ps = tau * 1e12;
  // Microstrip on FR-4: an effective permittivity of about 3.3, 0.165 mm per ps one way.
  const mm = Math.abs(tau) * (299792458 / Math.sqrt(3.3)) * 1e3;
  return `${ps > 0 ? '+' : ps < 0 ? '-' : ''}${fmtSig(Math.abs(ps), 3)} ps (about ${fmtSig(mm, 2)} mm of FR-4 microstrip)`;
}

/** The floor a fit's residual was held against, in words. */
export function floorText(c: FitCheck, vna: VnaClass): string {
  const scatter = Number.isFinite(c.noiseFloor) ? fmtSig(c.noiseFloor, 2) : null;
  if (c.floorFrom === 'scatter')
    return `the noise floor ${fmtSig(c.floorUsed, 2)} (the scatter between neighbouring points)`;
  return `the ${VNA_NAME[vna]} accuracy floor ${fmtSig(c.accuracy, 2)}${scatter ? ` (the scatter between points, ${scatter}, is below it)` : ''}`;
}

/**
 * The reference plane's range and its band ambiguity, in words, when the plane was fitted or
 * checked: the fit searches it over plus and minus the range (MAX_PLANE, less with coarse
 * frequency steps); planes 1 / (2 f_centre) apart turn Gamma alike at the band centre, and only
 * the slope across the band tells them apart, so a narrow band may not.
 */
export function planeRangeText(design: Design, fit: BuildFit): string | null {
  const plane = fit.parameters.find((p) => p.kind === 'plane');
  if (!plane || (plane.status === 'not-free' && !fit.check.plane)) return null;
  const fs = boardReflections(design).map((p) => p.frequency);
  if (fs.length === 0) return null;
  const centre = (Math.min(...fs) + Math.max(...fs)) / 2;
  const step = fmtSig((1 / (2 * centre)) * 1e12, 3);
  return `Reference plane searched over ±${fmtSig(fit.planeRange * 1e12, 4)} ps. Over this band, planes about ${step} ps apart turn the response alike at its centre; only the slope across the band tells them apart, and a fit that cannot is not trusted.`;
}

/** Drifts a plane or laminate moves, in words: "Series C 2 value and Shunt L 1 pads". */
function movedList(
  design: Design,
  fit: BuildFit,
  moved: readonly { readonly id: string }[],
): string {
  const names = moved.map((m) => {
    const p = fit.parameters.find((q) => q.id === m.id);
    return p ? parameterLabel(design, p) : m.id;
  });
  return names.length <= 1
    ? (names[0] ?? 'a drift')
    : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** The plane is ticked in this fit. */
const planeTicked = (fit: BuildFit): boolean =>
  fit.parameters.some((p) => p.kind === 'plane' && p.status !== 'not-free');

/**
 * Why a fit cannot be acted on, shortest first, as clauses: the design frequency outside the
 * measurement, a board built from another source, a reference plane that explains the data
 * better, a model that does not explain the board, implausible drifts. Empty when it can be.
 */
export function untrustedReasons(design: Design, fit: BuildFit): string[] {
  const c = fit.check;
  const out: string[] = [];
  const fs = boardReflections(design).map((p) => p.frequency);
  const span: [number, number] | null = fs.length > 0 ? [Math.min(...fs), Math.max(...fs)] : null;
  if (c.frequencyOutside)
    out.push(
      `the design frequency (${fmtFrequency(design.frequency)}) lies outside the measurement${span ? ` (${spanText(span)})` : ''}`,
    );
  const changed = sourceChanged(design);
  if (changed)
    out.push(
      `this measurement was taken on a board built from ${changed.then}; the design now uses ${changed.now}: set Realize back to ${changed.then} to compare with the board as built`,
    );
  const pText = (p: number): string =>
    p < 1e-6 ? 'below 1e-6' : p < 1e-3 ? p.toExponential(1) : fmtSig(p, 2);
  const laminateToo = c.plane?.laminateToo ? ' (or a laminate drift, εr or h, as well)' : '';
  if (c.ambiguous.length > 0)
    out.push(
      `the measured band is too narrow to tell a reference-plane offset from part drift: ${c.ambiguous.length === 1 ? 'another plane' : `${c.ambiguous.length} other planes`} (${c.ambiguous.map((x) => planeText(x.drifts.plane ?? 0)).join(', ')}) with other drifts fit${c.ambiguous.length === 1 ? 's' : ''} the data as well; measure over a wider band or calibrate at the board`,
    );
  if (c.plane?.unresolved && !c.frequencyOutside)
    out.push(
      'this data cannot tell whether there is a reference-plane offset (fitted with the plane, its uncertainty is an eighth of a period or more), and the drifts depend on it; tick Reference plane over a wider band, or calibrate at the board',
    );
  else if (c.plane?.better && !c.frequencyOutside)
    out.push(
      `a reference-plane offset of about ${planeText(c.plane.drift)}${laminateToo} explains this measurement better (|ΔΓ| RMS ${fmtSig(fit.rmsAfter, 2)} without it, ${fmtSig(c.plane.rmsWith, 2)} with it; p ${pText(c.plane.p)})`,
    );
  else if (c.plane && c.plane.moved.length > 0 && !c.frequencyOutside)
    out.push(
      `a reference-plane offset of about ${planeText(c.plane.drift)}${laminateToo}, which this data allows, moves ${movedList(design, fit, c.plane.moved)} by more than twice its uncertainty: the drifts depend on the plane`,
    );
  if (c.laminate && (c.laminate.better || c.laminate.moved.length > 0) && !c.frequencyOutside)
    out.push(
      c.laminate.better
        ? `a laminate drift (${c.laminate.ids.map((id) => (id === 'er' ? 'εr' : id)).join(', ')}) explains this measurement better (|ΔΓ| RMS ${fmtSig(fit.rmsAfter, 2)} without it, ${fmtSig(c.laminate.rmsWith, 2)} with it; p ${pText(c.laminate.p)})`
        : `a laminate drift (εr or h), which this data allows, moves ${movedList(design, fit, c.laminate.moved)} by more than twice its uncertainty: the drifts depend on it`,
    );
  if (c.residual === 'unexplained')
    out.push(
      `the model does not explain this board: |ΔΓ| RMS ${fmtSig(fit.rmsAfter, 2)} after the fit is ${fmtSig(c.residualRatio, 2)} times ${floorText(c, vnaOf(design))}`,
    );
  else if (c.residual === 'above')
    out.push(
      `the residual is ${fmtSig(c.residualRatio, 2)} times ${floorText(c, vnaOf(design))}: the model leaves a pattern it does not explain, and the drifts take part of it`,
    );
  if (c.noneFitted)
    out.push('no parameter is resolved by this data: every one was set aside (see the table)');
  const label = (id: string): string => {
    const p = fit.parameters.find((q) => q.id === id);
    return p ? parameterLabel(design, p) : id;
  };
  // Three or more drifts of several typical drifts: one sentence with the range.
  const large = c.implausible.filter((x) => x.why === 'large');
  const many = large.length >= 3;
  if (many) {
    const items = large.flatMap((x) => {
      const p = fit.parameters.find((q) => q.id === x.id);
      return p ? [{ p, k: Math.abs(p.drift) / p.prior }] : [];
    });
    const ks = items.map((i) => i.k);
    out.push(
      `${items.length} drifts are ${fmtSig(Math.min(...ks), 2)} to ${fmtSig(Math.max(...ks), 2)} times their typical drift (${items.map((i) => `${label(i.p.id)} ${driftText(i.p, i.p.drift)}`).join(', ')}): not a board built as designed`,
    );
  }
  for (const x of c.implausible) {
    const p = fit.parameters.find((q) => q.id === x.id);
    if (!p || (many && x.why === 'large')) continue;
    if (x.why === 'range')
      out.push(
        `${label(x.id)} ${driftText(p, p.drift)} is beyond ±${fmtSig(MAX_PLANE * 1e12, 4)} ps (about 20 cm of cable), the range the fit takes: calibrate nearer the board`,
      );
    else if (x.why === 'unphysical')
      out.push(`${label(x.id)} ${driftText(p, p.drift)} is past what is physical`);
    else
      out.push(
        `${label(x.id)} ${driftText(p, p.drift)} is ${fmtSig(Math.abs(p.drift) / p.prior, 2)} times its typical drift: not a board built as designed`,
      );
  }
  return out;
}

/**
 * A pair the data cannot tell apart, in words ("X or Y"): core lists it in `correlated` when one
 * of the two is uncertain by more than a third of its typical drift (AMBIGUOUS_PAIR), or was set
 * aside for its uncertainty while the other took their joint effect (`either`). The data fixes
 * their joint effect, not which of them moved, and neither drift is a finding.
 */
export function pairText(
  design: Design,
  fit: BuildFit,
  pair: { readonly a: string; readonly b: string; readonly rho: number; readonly either?: true },
): { readonly text: string; readonly ambiguous: boolean } {
  const get = (id: string): FittedParameter | undefined => fit.parameters.find((q) => q.id === id);
  const a = get(pair.a);
  const b = get(pair.b);
  const name = (p: FittedParameter | undefined, id: string): string =>
    p ? parameterLabel(design, p) : id;
  const rho = fmtNum(pair.rho, 3);
  if (pair.either && a)
    return {
      ambiguous: true,
      text: `${name(a, pair.a)} or ${name(b, pair.b)}: this data cannot tell them apart (correlation ${rho}). The fit puts their joint effect, ${driftText(a, a.drift, a.sigma)}, on ${name(a, pair.a)}; it is not a finding about either, and the retune is checked with it on ${name(b, pair.b)} instead.`,
    };
  return {
    ambiguous: true,
    text: `${name(a, pair.a)} or ${name(b, pair.b)}: this data cannot tell them apart (correlation ${rho}; one is uncertain by more than a third of its typical drift). The data fixes their joint effect, not which of them moved.`,
  };
}

/**
 * The resolved pairs that move together in a fit (correlated above 0.95, each uncertain by at
 * most a third of its typical drift), in one line: the parameters once, then those of them that
 * did not move ("X did not move, Y moved": the drift column gives Y's). Null without any.
 */
export function togetherText(design: Design, fit: BuildFit): string | null {
  if (fit.together.length === 0) return null;
  const ids = new Set(fit.together.flatMap((pr) => [pr.a, pr.b]));
  const ps = fit.parameters.filter((p) => ids.has(p.id));
  if (ps.length === 0) return null;
  const list = (names: readonly string[]): string =>
    names.length <= 1
      ? (names[0] ?? '')
      : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1] ?? ''}`;
  const still = ps.filter((p) => p.sigma !== null && Math.abs(p.drift) < 2 * p.sigma);
  const top = Math.max(...fit.together.map((pr) => Math.abs(pr.rho)));
  const head = `${list(ps.map((p) => parameterLabel(design, p)))} move together in this fit (correlations up to ${fmtNum(top, 3)}), and each is told apart: its ± includes that.`;
  return still.length > 0
    ? `${head} Of these, ${list(still.map((p) => parameterLabel(design, p)))} did not move (within 2σ).`
    : head;
}

/** A clause as a sentence: first letter capital, a stop at the end. */
const sentence = (t: string): string =>
  `${t.charAt(0).toUpperCase()}${t.slice(1)}${/[.?]$/.test(t) ? '' : '.'}`;

/**
 * What a senior engineer concludes from a fit before acting on it: was the design frequency
 * measured, is this the board the design describes, does a reference plane explain the data
 * better, is the residual at the floor, are the drifts those of a board built as designed. The
 * advice names only what is left to check: never "tick Reference plane" when it is ticked or
 * when the design frequency lies outside the data.
 */
export function fitVerdict(design: Design, fit: BuildFit): Verdict {
  const c = fit.check;
  const ratio = fmtSig(c.residualRatio, 2);
  const floor = floorText(c, vnaOf(design));
  const ticked = planeTicked(fit);
  const reasons = untrustedReasons(design, fit);
  const wrongBoard = c.frequencyOutside || sourceChanged(design) !== null;
  const planeCalls =
    !ticked && (c.plane?.better || c.plane?.unresolved || (c.plane?.moved.length ?? 0) > 0);
  const laminateCalls = c.laminate?.better || (c.laminate?.moved.length ?? 0) > 0;
  const causes = c.frequencyOutside
    ? 'Check that the file is the measurement of this design and that the design is the one built.'
    : wrongBoard
      ? ''
      : c.ambiguous.length > 0
        ? 'Measure over a wider band, or calibrate at the board.'
        : planeCalls
          ? `Tick Reference plane${c.plane?.laminateToo ? ' (or εr and h)' : ''} and fit again.`
          : laminateCalls
            ? 'Tick εr and h and fit again.'
            : `Check ${ticked ? '' : 'the reference plane (tick Reference plane and fit again), '}the calibration, the file, the design, or an assembly fault (a wrong or misplaced part).`;
  if (reasons.length > 0)
    return {
      level: 'untrusted',
      text: `${reasons.map(sentence).join(' ')}${causes ? ` ${causes}` : ''} Do not act on these drifts.`,
    };
  return {
    level: 'ok',
    text: `The residual is at the floor: ${ratio} times ${floor}. The model explains this board.`,
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
  const digits =
    sigma !== undefined && sigma !== null
      ? decimalsFor(sigma * scale)
      : p.relative
        ? Math.abs(v) < 0.001
          ? 2
          : 1
        : null;
  const body = digits === null ? fmtSig(Math.abs(x), 2) : Math.abs(x).toFixed(digits);
  // No sign on a drift that rounds to none ("0.00 pF", never "-0.00 pF").
  const zero = Number(body) === 0;
  const sign = zero ? '' : x > 0 ? '+' : x < 0 ? '-' : '';
  return `${sign}${body} ${unit}`;
}

/** An uncertainty in words, to two significant figures: "0.040 %". */
export function sigmaText(p: Pick<DriftParameter, 'kind' | 'relative'>, sigma: number): string {
  const { unit, scale } = driftUnit(p);
  return `${(sigma * scale).toFixed(decimalsFor(sigma * scale))} ${unit}`;
}

/** The typical drift of a parameter, the prior: "±10 %", "±0.2 pF"; a library part's is a scale on its data. */
export function typicalText(
  p: Pick<DriftParameter, 'kind' | 'relative' | 'prior' | 'library'>,
): string {
  const { unit, scale } = driftUnit(p);
  const t = `±${fmtSig(p.prior * scale, 3)} ${unit}`;
  return p.library ? `${t}, a scale on the part's measured impedance, approximate` : t;
}

/** The nominal a drift applies to, in words: "12 nH", "0.121 pF", "0.543 nH", "4.17"; null where it has none. */
export function nominalText(p: DriftParameter, design: Design): string | null {
  const el = p.index !== undefined ? design.elements[p.index] : undefined;
  switch (p.kind) {
    case 'value': {
      const kind = el?.kind === 'part' ? el.part.type : el?.kind;
      const unit = kind === 'L' ? 'H' : kind === 'C' ? 'F' : 'Ω';
      const v = formatEngineering(p.nominal, { unit, digits: 3 });
      return p.library ? `${v} effective at f` : v;
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
  if (p.why === 'like-another' && p.partner && p.combination)
    return `not resolved: its effect is a combination of the fitted parameters (the closest, ${label(p.partner)}, at correlation ${fmtNum(Math.abs(p.correlation ?? 0), 4)})`;
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
  /** Each significant fitted drift the retune compensates, in words with its tolerance; null without one. */
  readonly drifted: string | null;
  /** How many of those are beyond their typical drift (decides the new-batch advice). */
  readonly beyondTolerance: number;
}

/** A retune leaves a small margin when it is inside by less than this fraction of (limit - 1). */
export const SMALL_MARGIN = 0.15;

/**
 * Each significant fitted drift the retune compensates, largest against its typical drift
 * first, with whether it is within its part's typical drift (tolerance): "Series C 2 pads
 * +0.298 pF (beyond its typical ±0.2 pF), Shunt L 1 value +8.0 % (within ±10 %)". Null without
 * one. A drift the data cannot tell from another's ("X or Y") is not a finding.
 */
function compensated(design: Design, fit: BuildFit): { text: string; beyond: number } | null {
  const either = new Set(fit.correlated.flatMap((c) => [c.a, c.b]));
  const found = fit.parameters
    .filter(
      (p) =>
        p.status === 'fitted' &&
        p.kind !== 'plane' &&
        p.sigma !== null &&
        !p.orWith &&
        !either.has(p.id) &&
        Math.abs(p.drift) >= 2 * p.sigma,
    )
    .sort((a, b) => Math.abs(b.drift) / b.prior - Math.abs(a.drift) / a.prior);
  if (found.length === 0) return null;
  const beyond = found.filter((p) => Math.abs(p.drift) > p.prior).length;
  const text = found
    .map(
      (p) =>
        `${parameterLabel(design, p)} ${driftText(p, p.drift, p.sigma)} (${Math.abs(p.drift) > p.prior ? 'beyond its typical' : 'within'} ${typicalText({ ...p, library: false })})`,
    )
    .join(', ');
  return { text, beyond };
}

/**
 * A retune inside the target with little to spare, in words: it compensates this board's drift
 * (named), and a new batch needs the cause fixed rather than the retune copied. Null otherwise.
 */
export function marginNote(design: Design, r: BoardRetune): string | null {
  const s = r.suggestion;
  if (!s || !s.inside || s.changes.length === 0) return null;
  const limit = designVswrLimit(design);
  if (!(limit - s.worst.vswr < SMALL_MARGIN * (limit - 1))) return null;
  const batch =
    r.beyondTolerance > 0
      ? 'for a new batch, fix the cause of the drift beyond its typical size rather than copy the retune'
      : 'the drift is within the parts’ tolerances, so a new batch may drift otherwise: measure it before copying the retune';
  return `The margin is small (${fmtNum(s.worst.vswr, 3)} against ${fmtSig(limit)}). This retune compensates this board's drift: ${batch}.`;
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
  const comp = 'check' in fit ? compensated(design, fit as BuildFit) : null;
  const drifted = comp?.text ?? null;
  const beyondTolerance = comp?.beyond ?? 0;
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
    drifted,
    beyondTolerance,
  });
  if ('check' in fit && !(fit as BuildFit).check.trusted) {
    const why = untrustedReasons(design, fit as BuildFit);
    return refuse(
      `the fit cannot be acted on: ${why[0] ?? 'see the check under the drift table'}${why.length > 1 ? ` (and ${why.length - 1} more under the drift table)` : ''}`,
    );
  }
  if (c?.frequencyOutside)
    return refuse(
      `the design frequency (${fmtFrequency(design.frequency)}) lies outside the measurement${c.span ? ` (${spanText(c.span)})` : ''}: is this the measurement of this design?`,
    );
  if (judged.length === 0)
    return refuse(
      c?.span
        ? `the target band (${spanText([Math.min(...band), Math.max(...band)])}) lies outside the measurement (${spanText(c.span)}); measure the board over the band`
        : 'no measured frequency can be compared with the network',
    );
  // Fail safe: a change judged on part of the band can make the unmeasured part worse (QA round 4
  // found it: 1.29 to 1.42 outside a 0.9 to 1.0 GHz measurement of a 0.9 to 1.1 GHz target).
  if (bandOutside > 0)
    return refuse(
      `part of the target band (${spanText([Math.min(...band), Math.max(...band)])}) lies outside the measurement${c?.span ? ` (${spanText(c.span)})` : ''}, and a change could make that part worse; measure the board over the whole band`,
    );
  // With Realize off, the series Realize would snap to.
  const source = valueSource(design.realize);
  const retune = suggestRetune(designModel(design), drifts, {
    band: judged,
    limit: designVswrLimit(design),
    target: targetOf(design),
    candidates: retuneCandidates(source, design.frequency, judged),
    locked: design.elements.flatMap((el, i) => (el.locked ? [i] : [])),
    // Every other explanation the data allows: the change must leave none of them worse.
    ...('check' in fit ? { alternatives: (fit as BuildFit).alternatives } : {}),
  });
  return { ...retune, judged, bandOutside, designMisses: misses, drifted, beyondTolerance };
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

/** The element as built is the one evaluated: the same library part, the same value, or the same element. */
function sameBuilt(built: Element | undefined, evaluated: Element): boolean {
  if (!built) return false;
  if (
    evaluated.kind === 'part' ||
    evaluated.kind === 'R' ||
    evaluated.kind === 'L' ||
    evaluated.kind === 'C'
  )
    return builtAs(built, evaluated);
  return JSON.stringify(built) === JSON.stringify(evaluated);
}

/** A design with a retune applied, and the unchanged parts it had to pin to keep them as built. */
export interface RetuneApplied {
  readonly design: Design;
  /** Unchanged parts Realize would have picked again: set to what the board has (named). */
  readonly pinned: readonly string[];
}

/**
 * The design with a retune applied, placing exactly what the retune evaluated: a value of the
 * series or the stock as the part's value; a library part as the library part element (with
 * Realize from the library, a part Realize maps the effective value back to keeps the design
 * ideal). Realize compares neighbouring values on the whole network, so a change can make it
 * pick another value for a part the retune did not change: such a part is set to the value or
 * part the board has (and locked where Realize would still move it), and named. Refused, with
 * the reason, when the network as built would still differ from what was evaluated.
 */
export function withRetune(
  design: Design,
  changes: readonly RetuneChange[],
): RetuneApplied | { readonly reason: string } {
  const fromLibrary = design.realize.enabled && design.realize.series === 'library';
  const before = designModel(design).base;
  const evaluated = before.map((el, i) => changes.find((c) => c.index === i)?.to ?? el);
  const write = (
    asPart: ReadonlySet<number>,
    pin: ReadonlySet<number>,
    lock: ReadonlySet<number>,
  ): Design => ({
    ...design,
    elements: design.elements.map((el, i): DesignElement => {
      const ch = changes.find((c) => c.index === i);
      if (!ch) {
        const built = before[i];
        if (!pin.has(i) || !built) return el;
        const kept =
          built.kind === 'part'
            ? el.kind === 'part'
              ? { ...el, part: built.part }
              : placedPart(el, built)
            : built.kind === 'R' || built.kind === 'L' || built.kind === 'C'
              ? withPrimaryValue(el, built.value)
              : el;
        return lock.has(i) ? ({ ...kept, locked: true } as DesignElement) : kept;
      }
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
  const none = new Set<number>();
  const off = (d: Design): number[] => {
    const now = designModel(d).base;
    return evaluated.flatMap((el, i) => (sameBuilt(now[i], el) ? [] : [i]));
  };
  const changed = new Set(changes.map((c) => c.index));
  let next = write(none, none, none);
  // Realize from the library maps a value to the nearest part: where that is not the part the
  // retune evaluated, the part itself is placed.
  const asPart = new Set(off(next).filter((i) => changed.has(i)));
  if (asPart.size > 0) next = write(asPart, none, none);
  // Unchanged parts Realize picked again: set to what the board has, then locked if need be.
  const pin = new Set(off(next).filter((i) => !changed.has(i)));
  if (pin.size > 0) {
    next = write(asPart, pin, none);
    const lock = new Set(off(next).filter((i) => pin.has(i)));
    if (lock.size > 0) next = write(asPart, pin, lock);
  }
  const wrong = off(next)[0];
  if (wrong !== undefined) {
    const el = design.elements[wrong];
    const to = evaluated[wrong] as Element;
    return {
      reason: `${el ? `${elementName(el)} ${wrong + 1}` : 'A part'} would not be built as ${partText(to)} (Realize would pick another value)`,
    };
  }
  const pinned = [...pin].map((i) => {
    const el = design.elements[i];
    const built = before[i] as Element;
    const locked = next.elements[i]?.locked && !el?.locked;
    return `${el ? `${elementName(el)} ${i + 1}` : 'a part'} at ${partText(built)}${locked ? ' (locked)' : ''}`;
  });
  return { design: next, pinned };
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
    return `The design as built meets the target (designed ${fmtNum(c.designedWorst.vswr, 3)}); the board drifted out of it (${fmtNum(r.before.vswr, 3)} as fitted)${r.drifted ? `: ${r.drifted}` : ''}.`;
  return null;
}
