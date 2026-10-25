/**
 * Sensitivity and yield as the app uses them (D3): which part dominates the
 * spread of the match under its tolerance (the ranking in the Tolerance
 * panel and the bar on each ladder card), the worst-case corner, design
 * centring, and the yield and dominant part of each Auto match solution.
 *
 * The network is the one the Tolerance panel analyses: the realized values
 * when Realize is on, the loss model when Losses is on. Over the band the
 * load is the measured load model when the design has one (D2), and the
 * judged frequencies are the design frequency and the Tolerance panel's band.
 */
import {
  bandSensitivity,
  elementTolerances,
  parameterValue,
  perPercent,
  spreadShares,
  toleranceSlots,
  yieldEstimate,
  type Complex,
  type Element,
  type Ladder,
  type LoadModel,
  type MonteCarloOptions,
  type ParameterRef,
  type ToleranceCorrelation,
  type YieldEstimate,
} from '@smithonline/core';
import { targetOf, type Design, type DesignElement, type ToleranceSettings } from './design';
import { elementName } from './elements';
import { designLoadModel, hasMeasuredLoad } from './measuredLoad';
import { effectiveElements, realizeDesign } from './realize';
import { exportLadderOf } from './simexport';
import {
  bandFrequencies,
  defaultTolerance,
  monteCarloOptions,
  toleranceSettings,
} from './tolerance';

/** The correlation coefficients of the design's tolerance settings; none set is all 0. */
export function toleranceCorrelation(t: ToleranceSettings): ToleranceCorrelation {
  return t.correlation ?? {};
}

/** True when any part kind has a correlation above 0. */
export function hasCorrelation(t: ToleranceSettings): boolean {
  const c = toleranceCorrelation(t);
  return (c.L ?? 0) > 0 || (c.C ?? 0) > 0 || (c.R ?? 0) > 0;
}

/** One varied quantity with its share of the spread. */
export interface PartShare {
  /** Element index, load side first. */
  readonly index: number;
  readonly ref: ParameterRef;
  /** "Shunt L 1", or "Shunt RLC (series) 2, L" for a part of an RLC block. */
  readonly label: string;
  /** Tolerance as a fraction. */
  readonly tolerance: number;
  /** Share of the variance of Gamma; the shares add up to 1, negative for a part that offsets others. */
  readonly share: number;
  /** Change of the judged VSWR per percent of the part (at the worst frequency over a band). */
  readonly vswrPerPercent: number;
  /** Change of |Gamma| per percent of the part, |dGamma/dp| p / 100, at the same frequency. */
  readonly gammaPerPercent: number;
}

export interface DesignSpread {
  /** Every varied quantity in ladder order. */
  readonly parts: readonly PartShare[];
  /** The same, largest share first. */
  readonly ranking: readonly PartShare[];
  /** Share per element index (the parts of an RLC block added up). */
  readonly byElement: ReadonlyMap<number, number>;
  /** RMS change of Gamma, all parts together, linearized. */
  readonly rms: number;
  /** 'band' when the panel judges over the band, else the design frequency. */
  readonly over: 'band' | 'point';
  /** The frequency the VSWR slopes are taken at: the worst one over the band, or f. */
  readonly at: number;
  /** True when the slopes are taken at a perfect match, where the VSWR has none. */
  readonly matched: boolean;
}

const PARAMETER_LABEL: Partial<Record<ParameterRef['parameter'], string>> = {
  r: 'R',
  l: 'L',
  c: 'C',
};

/** "Shunt L 1": the card's name and number. */
export function partLabel(el: Element, index: number, ref?: ParameterRef): string {
  const suffix = el.kind === 'RLC' && ref ? `, ${PARAMETER_LABEL[ref.parameter] ?? ''}` : '';
  return `${elementName(el)} ${index + 1}${suffix}`;
}

/** The network, load and judged frequencies of the tolerance analysis. */
export interface ToleranceSetup {
  readonly ladder: Ladder;
  /** The load across the band: the measured load model or the fixed load. */
  readonly load: LoadModel;
  /** The band the runs are judged over; empty at the design frequency alone. */
  readonly band: readonly number[];
  readonly options: Omit<MonteCarloOptions, 'onProgress'>;
}

/** The setup of the Tolerance panel for the design as it is shown. */
export function toleranceSetup(design: Design): ToleranceSetup {
  const realization = realizeDesign(design, effectiveElements(design));
  const ladder = exportLadderOf(design, realization);
  const options = monteCarloOptions(design);
  const band = options.band ?? [];
  const load = band.length > 0 && hasMeasuredLoad(design) ? designLoadModel(design) : design.load;
  return { ladder, load, band, options };
}

/**
 * The judged frequencies with their loads: the design frequency with the
 * design's load, then the band (without f itself) with the band's load.
 */
function judged(setup: Pick<ToleranceSetup, 'ladder' | 'load' | 'band'>): {
  readonly freqs: number[];
  readonly loadAt: (f: number) => Complex;
} {
  const f0 = setup.ladder.frequency;
  const freqs = [f0, ...setup.band.filter((f) => f !== f0)];
  const model = setup.load;
  return {
    freqs,
    loadAt: (f) => (f === f0 ? setup.ladder.load : typeof model === 'function' ? model(f) : model),
  };
}

/**
 * Who causes the spread, for a ladder under the given tolerance options.
 * Null when nothing varies.
 */
export function ladderSpread(
  setup: Pick<ToleranceSetup, 'ladder' | 'load' | 'band'> & {
    readonly options: Pick<
      MonteCarloOptions,
      'tolerance' | 'overrides' | 'exact' | 'distribution' | 'correlation' | 'target'
    >;
  },
): DesignSpread | null {
  const { ladder, options } = setup;
  const tols = elementTolerances(ladder.elements, options);
  const slots = toleranceSlots(ladder.elements, tols);
  if (slots.length === 0) return null;
  const refs = slots.map((s) => s.ref);
  const { freqs, loadAt } = judged(setup);
  const sens = bandSensitivity(ladder.elements, loadAt, ladder.z0, freqs, {
    parameters: refs,
    ...(options.target ? { target: options.target } : {}),
  });
  const over = setup.band.length > 0 ? 'band' : 'point';
  // At one frequency the weight is all there; over a band the power-mean weights.
  const weights =
    over === 'point' ? [1] : sens.smooth.weights.map((w) => (Number.isFinite(w) ? w : 0));
  const points = over === 'point' ? [sens.points[0] as (typeof sens.points)[number]] : sens.points;
  const spread = spreadShares(
    points,
    weights,
    refs,
    slots.map((s) => ({
      ref: s.ref,
      tolerance: s.tolerance,
      ...(s.kind ? { group: s.kind, correlation: options.correlation?.[s.kind] ?? 0 } : {}),
    })),
    ladder.elements,
    options.distribution ?? 'uniform',
  );
  const at = sens.points[sens.worst.index] as (typeof sens.points)[number];
  const parts = slots.map((s, i): PartShare => {
    const el = ladder.elements[s.ref.index] as Element;
    const value = parameterValue(el, s.ref.parameter);
    const dg = at.dGamma[i] as Complex;
    return {
      index: s.ref.index,
      ref: s.ref,
      label: partLabel(el, s.ref.index, s.ref),
      tolerance: s.tolerance,
      share: spread.shares[i]?.share ?? 0,
      vswrPerPercent: perPercent(at.dVswr[i] as number, value),
      gammaPerPercent: Math.abs(perPercent(Math.hypot(dg.re, dg.im), value)),
    };
  });
  const byElement = new Map<number, number>();
  for (const p of parts) byElement.set(p.index, (byElement.get(p.index) ?? 0) + p.share);
  return {
    parts,
    ranking: [...parts].sort((a, b) => b.share - a.share),
    byElement,
    rms: spread.rms,
    over,
    at: at.frequency,
    matched: at.gammaMag < 1e-9,
  };
}

/** The spread of the design as the Tolerance panel analyses it; null when nothing varies. */
export function designSpread(design: Design): DesignSpread | null {
  const setup = toleranceSetup(design);
  return ladderSpread(setup);
}

/** "Shunt L 1 contributes 62 % of the spread": the sentence for the top part. */
export function spreadSentence(spread: DesignSpread): string {
  const top = spread.ranking[0];
  if (!top) return '';
  return `${top.label} contributes ${fmtShare(top.share)} of the spread`;
}

/** A share as a whole percentage, "62 %"; "below 1 %" for a small positive one. */
export function fmtShare(share: number): string {
  if (!Number.isFinite(share)) return '-';
  const pct = share * 100;
  if (pct > 0 && pct < 0.5) return 'below 1 %';
  return `${Math.round(pct)} %`;
}

/* ------------------------------------------------- Auto match robustness */

/** Runs of the yield estimate of each Auto match solution. */
export const MATCH_YIELD_RUNS = 200;
/** Most band points the estimate judges a solution over. */
const MATCH_BAND_POINTS = 21;

/** How Auto match judges a solution's yield: the tolerance, the limit and where. */
export interface MatchYieldSetup {
  /** Default tolerance of a part as a fraction: the typed one, Realize's series, or 5 %. */
  readonly tolerance: number;
  /** Where it comes from, for the explanation. */
  readonly toleranceLabel: string;
  readonly vswrLimit: number;
  readonly band: readonly number[];
  readonly load: LoadModel;
  /** The target the VSWR is referred to; absent for Z0. */
  readonly target?: Complex;
  readonly correlation: ToleranceCorrelation;
  readonly distribution: 'uniform' | 'normal';
}

/**
 * The yield setup of Auto match: the Tolerance panel's limit, distribution,
 * correlation and band (thinned to 21 points), with the tolerance of the
 * Realize series when Realize is on and 5 percent when it is off (a typed
 * default tolerance wins over both).
 */
export function matchYieldSetup(design: Design): MatchYieldSetup {
  const t = toleranceSettings(design);
  const tolerance =
    t.percent !== null ? t.percent / 100 : design.realize.enabled ? defaultTolerance(design) : 0.05;
  const toleranceLabel =
    t.percent !== null
      ? `${t.percent} % parts (typed in Tolerance)`
      : design.realize.enabled
        ? `${Math.round(tolerance * 1000) / 10} % parts (${design.realize.series === 'stock' ? 'your stock, assumed' : design.realize.series})`
        : '5 % parts (Realize is off)';
  const full = t.overBand ? bandFrequencies(design) : [];
  const step = Math.max(1, Math.ceil(full.length / MATCH_BAND_POINTS));
  const band = full.filter((_, i) => i % step === 0 || i === full.length - 1);
  const target = design.target ? targetOf(design) : undefined;
  return {
    tolerance,
    toleranceLabel,
    vswrLimit: t.vswrLimit,
    band,
    load: band.length > 0 && hasMeasuredLoad(design) ? designLoadModel(design) : design.load,
    ...(target ? { target } : {}),
    correlation: toleranceCorrelation(t),
    distribution: t.distribution,
  };
}

export interface SolutionRobustness {
  readonly yield: YieldEstimate;
  /** The part with the largest share of the spread; null when nothing varies. */
  readonly dominant: PartShare | null;
  /** RMS change of Gamma under the tolerances, linearized: lower is less sensitive. */
  readonly rms: number;
}

/**
 * The yield and the dominant part of a whole network (the parts already in
 * the ladder and an Auto match solution appended to them): `existing` are
 * the design's elements (for their tolerance overrides and locks), `ladder`
 * the network as evaluated, the solution's parts after them.
 */
export function networkRobustness(
  design: Design,
  existing: readonly DesignElement[],
  ladder: Ladder,
  setup: MatchYieldSetup,
): SolutionRobustness {
  const t = toleranceSettings(design);
  const overrides: Record<number, number> = {};
  const exact: number[] = [];
  existing.forEach((el, i) => {
    const pct = t.overrides[el.id];
    if (pct !== undefined) overrides[i] = pct / 100;
    if (el.locked) exact.push(i);
  });
  const options = {
    tolerance: setup.tolerance,
    overrides,
    exact,
    distribution: setup.distribution,
    correlation: setup.correlation,
    ...(setup.target ? { target: setup.target } : {}),
  };
  const y = yieldEstimate(ladder, {
    ...options,
    vswrLimit: setup.vswrLimit,
    runs: MATCH_YIELD_RUNS,
    seed: t.seed,
    ...(setup.band.length > 0 ? { band: setup.band, load: setup.load } : {}),
  });
  const spread = ladderSpread({ ladder, load: setup.load, band: setup.band, options });
  return { yield: y, dominant: spread?.ranking[0] ?? null, rms: spread?.rms ?? 0 };
}

/** The ladder of the design's network with extra elements appended (Realize off). */
export function appendedLadder(design: Design, elements: readonly Element[]): Ladder {
  return {
    z0: design.z0,
    frequency: design.frequency,
    load: design.load,
    elements,
  };
}
