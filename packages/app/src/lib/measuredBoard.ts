/**
 * The measured board (phase D6, docs/08): the S11 of the built board, imported
 * with "Compare with the design", compared with the network as built, fitted
 * for what moved and retuned. The measurement is saved with the design (the
 * `.json` file and the autosave; a share link only when it is small); the fit
 * and the retune are results of this session.
 */
import {
  compareMeasurement,
  complex,
  formatEngineering,
  measuredReflections,
  partAt,
  retuneCandidates,
  retunedGammas,
  suggestRetune,
  sweepPoints,
  type BuildModel,
  type Comparison,
  type Complex,
  type DriftParameter,
  type Element,
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
import { fmtSig } from './format';
import { targetOf } from './design';

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

/* ------------------------------------------------------------ the model */

/**
 * The network the board was built from, as the fit sees it: the realized values (Realize on)
 * or the ideal ones with the loss model, the design's packages and board, and the load at
 * port 2 (the measured load, the fixed load, or the VNA's reference for a two-port file).
 */
export function boardModel(design: Design): BuildModel {
  const elements = effectiveElements(design);
  const real = realizeDesign(design, elements);
  const { board, table } = designBuild(design);
  const termination = design.measurement?.termination;
  const load: BuildModel['load'] =
    termination !== undefined
      ? complex(termination, 0)
      : hasMeasuredLoad(design)
        ? (measuredPoints(design) ?? design.load)
        : design.load;
  return {
    z0: design.z0,
    frequency: design.frequency,
    base: real ? real.ladder.elements : elements,
    table,
    board,
    load,
  };
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

const comparisonMemo = new WeakMap<Design, Comparison>();

/** The measured board against the network as built (null without a measurement). */
export function boardComparison(design: Design): Comparison | null {
  if (!design.measurement) return null;
  const hit = comparisonMemo.get(design);
  if (hit) return hit;
  const band = boardBand(design);
  const out = compareMeasurement(boardModel(design), boardReflections(design), {
    band: [Math.min(...band), Math.max(...band)],
  });
  comparisonMemo.set(design, out);
  return out;
}

/**
 * What the fit and the retune were computed for: a change to the network, the build, the
 * load or the measurement makes them stale.
 */
export function boardKey(design: Design): string {
  const m = design.measurement;
  const model = boardModel(design);
  return JSON.stringify({
    base: model.base,
    board: model.board,
    table: model.table,
    load: Array.isArray(model.load) ? (model.load as readonly SweepLoad[]).length : model.load,
    z0: design.z0,
    f: design.frequency,
    m: m
      ? [m.name, m.points.length, m.points[0], m.points[m.points.length - 1], m.termination]
      : null,
    band: boardBand(design),
    limit: designVswrLimit(design),
    target: design.target,
    realize: design.realize,
  });
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
  }
}

/** A drift in words: "+8.0 %" or "+0.30 pF"; the sign always shown. */
export function driftText(p: Pick<DriftParameter, 'kind' | 'relative'>, v: number): string {
  const sign = v > 0 ? '+' : v < 0 ? '-' : '';
  if (p.relative) return `${sign}${Math.abs(v * 100).toFixed(Math.abs(v) < 0.001 ? 2 : 1)} %`;
  // Pads in pF whatever their size, as land capacitances are quoted.
  if (p.kind === 'pad') return `${sign}${fmtSig(Math.abs(v) * 1e12, 2)} pF`;
  return `${sign}${formatEngineering(Math.abs(v), { unit: 'm', digits: 2 })}`;
}

/** The nominal a drift applies to, in words: "12 nH", "0.121 pF", "0.543 nH", "4.17". */
export function nominalText(p: DriftParameter, design: Design): string {
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
      return 'all';
  }
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

/** The retune of the design with fitted drifts: snapped to the design's Realize source. */
export function retuneFor(design: Design, drifts: Readonly<Record<string, number>>): Retune {
  const band = boardBand(design);
  const model = boardModel(design);
  // With Realize off, the series Realize would snap to.
  const source = valueSource(design.realize);
  return suggestRetune(model, drifts, {
    band,
    limit: designVswrLimit(design),
    target: targetOf(design),
    candidates: retuneCandidates(source, design.frequency, band),
    locked: design.elements.flatMap((el, i) => (el.locked ? [i] : [])),
  });
}

/** The reflection coefficients expected after a retune, at the measured frequencies. */
export function expectedAfter(
  design: Design,
  drifts: Readonly<Record<string, number>>,
  changes: readonly RetuneChange[],
): Complex[] {
  const fs = boardReflections(design).map((p) => p.frequency);
  return retunedGammas(boardModel(design), drifts, changes, fs);
}

/**
 * The design with a retune applied: each changed part takes the new value (a library part:
 * its effective value at the design frequency, which Realize from the library maps back to it;
 * a placed library part is replaced by the new one).
 */
export function withRetune(design: Design, changes: readonly RetuneChange[]): Design {
  const elements = design.elements.map((el, i): DesignElement => {
    const ch = changes.find((c) => c.index === i);
    if (!ch) return el;
    const to = ch.to;
    if (to.kind === 'part') {
      if (el.kind === 'part') return { ...el, part: to.part };
      const v = partAt(to.part, design.frequency)?.value;
      return v && v > 0 ? withPrimaryValue(el, v) : el;
    }
    if (to.kind === 'R' || to.kind === 'L' || to.kind === 'C')
      return withPrimaryValue(el, to.value);
    return el;
  });
  return { ...design, elements };
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
