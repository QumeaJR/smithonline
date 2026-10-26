/**
 * Sensitivity and yield as the app uses them (D3): which part dominates the
 * spread of the match under its tolerance (the ranking in the Tolerance
 * panel and the bar on each ladder card), the worst-case corner, design
 * centring, and the yield and dominant part of each Auto match solution.
 *
 * The network is the one the Tolerance panel analyses: the realized values
 * when Realize is on, the loss model when Losses is on, towards the design
 * target. Over the band the load is the measured load model when the design
 * has one (D2), and the judged frequencies are the design frequency and the
 * Tolerance panel's band.
 *
 * What the spread ranking ranks: the variance of the quantity the yield is
 * judged by, linearized. At the design frequency that is the VSWR (its
 * derivative is that of |Gamma| times a common factor, so the shares are
 * those of |Gamma|); over the band it is the smooth band VSWR, the power
 * mean of order 32 of the VSWR across the band. The phase part of the change
 * of Gamma does not move |Gamma| away from a match, so it is not counted.
 * At or near a perfect match (the nominal |Gamma| below the RMS change of
 * Gamma, where |Gamma| is not linear in the parts and has no slope at the
 * match itself) the ranking falls back to the mean square of the change of
 * Gamma, the second-order term of |Gamma|^2 there, and says so.
 */
import {
  bandSensitivity,
  elementTolerances,
  monteCarlo,
  parameterValue,
  perPercent,
  scalarSpread,
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
  defaultToleranceSource,
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
  /**
   * Share of the variance of the ranked quantity (the VSWR, the smooth band VSWR over a band,
   * or Gamma at a match: see `measure`); the shares add up to 1, negative for a part that
   * offsets others.
   */
  readonly share: number;
  /**
   * Change of the VSWR per percent of the part: at the design frequency, or of the smooth band
   * VSWR (the power mean) over a band. 0 at a perfect match, where the VSWR has no slope.
   */
  readonly vswrPerPercent: number;
  /**
   * Change of |Gamma| per percent of the part at the design frequency (the worst frequency
   * over a band); at a perfect match |dGamma/dp| p / 100, the slope of the cone.
   */
  readonly gammaPerPercent: number;
}

export interface DesignSpread {
  /** Every varied quantity in ladder order. */
  readonly parts: readonly PartShare[];
  /** The same, largest share first. */
  readonly ranking: readonly PartShare[];
  /** Share per element index (the parts of an RLC block added up). */
  readonly byElement: ReadonlyMap<number, number>;
  /** RMS change of Gamma, all parts together, linearized (over a band, weighted). */
  readonly rms: number;
  /** 'band' when the panel judges over the band, else the design frequency. */
  readonly over: 'band' | 'point';
  /**
   * What the shares divide: 'vswr' the variance of the VSWR (of the smooth band VSWR over a
   * band), 'gamma' the mean square change of Gamma, the fallback at or near a perfect match.
   */
  readonly measure: 'vswr' | 'gamma';
  /** The frequency of the worst VSWR over the band, or f. */
  readonly at: number;
  /** True at a perfect match at the design frequency, where the VSWR has no slope. */
  readonly matched: boolean;
}

/** |Gamma| below this is a perfect match: the VSWR within 1.000002 has no usable slope. */
const MATCHED = 1e-6;

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
 * A quick look at what a Tolerance run would say: the VSWR the panel judges the nominal
 * network by (at the design frequency, and the worst across the band when it judges over
 * one) and the yield of a short run of `runs` boards with the panel's settings.
 */
export function quickTolerance(
  design: Design,
  runs = 200,
): { readonly nominal: number; readonly yieldFraction: number } {
  const { ladder, load, band, options } = toleranceSetup(design);
  const r = monteCarlo(ladder, { ...options, runs, ...(band.length > 0 ? { load } : {}) });
  return { nominal: Math.max(r.nominal.vswr, r.nominal.worst ?? 0), yieldFraction: r.yield };
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
  // At one frequency the weight is all there; over a band the power-mean weights (0 where the
  // VSWR is not finite).
  const weights =
    over === 'point' ? [1] : sens.smooth.weights.map((w) => (Number.isFinite(w) ? w : 0));
  const points = over === 'point' ? [sens.points[0] as (typeof sens.points)[number]] : sens.points;
  const tolerances = slots.map((s) => ({
    ref: s.ref,
    tolerance: s.tolerance,
    ...(s.kind ? { group: s.kind, correlation: options.correlation?.[s.kind] ?? 0 } : {}),
  }));
  const distribution = options.distribution ?? 'uniform';
  const gamma = spreadShares(points, weights, refs, tolerances, ladder.elements, distribution);
  const f0 = sens.points[0] as (typeof sens.points)[number];
  const matched = over === 'point' && f0.gammaMag < MATCHED;
  // The slope the yield sees: of the VSWR at f, of the smooth band VSWR over the band.
  const slope = over === 'point' ? f0.dVswr : sens.smooth.dValue;
  // Near the match |Gamma| is not linear in the parts: the weighted nominal |Gamma| is below
  // the RMS change of Gamma the tolerances cause.
  let nominalMag = 0;
  let weightSum = 0;
  points.forEach((pt, k) => {
    const w = weights[k] ?? 0;
    if (w > 0 && Number.isFinite(pt.gammaMag)) {
      nominalMag += w * pt.gammaMag;
      weightSum += w;
    }
  });
  if (weightSum > 0) nominalMag /= weightSum;
  const scalar = scalarSpread(slope, refs, tolerances, ladder.elements, distribution);
  const measure: 'vswr' | 'gamma' =
    matched || !(nominalMag > gamma.rms) || !(scalar.rms > 0) || !Number.isFinite(scalar.rms)
      ? 'gamma'
      : 'vswr';
  const spread = measure === 'vswr' ? scalar : gamma;
  const at = sens.points[sens.worst.index] as (typeof sens.points)[number];
  const parts = slots.map((s, i): PartShare => {
    const el = ladder.elements[s.ref.index] as Element;
    const value = parameterValue(el, s.ref.parameter);
    const ref = over === 'point' ? f0 : at;
    const dg = ref.dGamma[i] as Complex;
    const dMag = ref.gammaMag < MATCHED ? Math.hypot(dg.re, dg.im) : (ref.dGammaMag[i] as number);
    return {
      index: s.ref.index,
      ref: s.ref,
      label: partLabel(el, s.ref.index, s.ref),
      tolerance: s.tolerance,
      share: spread.shares[i]?.share ?? 0,
      vswrPerPercent: matched ? 0 : perPercent(slope[i] as number, value),
      gammaPerPercent: Math.abs(perPercent(dMag, value)),
    };
  });
  const byElement = new Map<number, number>();
  for (const p of parts) byElement.set(p.index, (byElement.get(p.index) ?? 0) + p.share);
  return {
    parts,
    ranking: [...parts].sort((a, b) => b.share - a.share),
    byElement,
    rms: gamma.rms,
    over,
    measure,
    at: at.frequency,
    matched,
  };
}

/** The spread of the design as the Tolerance panel analyses it; null when nothing varies. */
export function designSpread(design: Design): DesignSpread | null {
  const setup = toleranceSetup(design);
  return ladderSpread(setup);
}

const COUNT_WORDS = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];

/**
 * "Shunt L 1 contributes 62 % of the spread": the sentence for the top part; "The five parts
 * share the spread about equally" when every share is within a fifth of an equal share.
 */
export function spreadSentence(spread: DesignSpread): string {
  const top = spread.ranking[0];
  if (!top) return '';
  const n = spread.ranking.length;
  const even = 1 / n;
  if (n >= 2 && spread.ranking.every((p) => p.share >= 0.8 * even && p.share <= 1.2 * even)) {
    return `The ${COUNT_WORDS[n] ?? String(n)} parts share the spread about equally`;
  }
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
  /** Default tolerance of a part as a fraction, the Tolerance panel's (defaultTolerance). */
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
 * correlation, target, default tolerance (one rule, defaultTolerance) and
 * band (thinned to 21 points).
 */
export function matchYieldSetup(design: Design): MatchYieldSetup {
  const t = toleranceSettings(design);
  const tolerance = defaultTolerance(design);
  const toleranceLabel = `${Math.round(tolerance * 1000) / 10} % parts (${defaultToleranceSource(design)})`;
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
 * the network as evaluated, the solution's parts after them. Built as the
 * Tolerance panel builds it (appendedLadder), the yield is the panel's on
 * the same seed run for run.
 */
export function networkRobustness(
  design: Design,
  existing: readonly DesignElement[],
  ladder: Ladder,
  setup: MatchYieldSetup,
): SolutionRobustness {
  // The Tolerance panel's options for the network after Add: the parts added have no
  // tolerance of their own and no lock, so the options of the existing parts are theirs.
  const {
    runs: _runs,
    band: _band,
    ...options
  } = monteCarloOptions({
    ...design,
    elements: [...existing],
  });
  void _runs;
  void _band;
  const y = yieldEstimate(ladder, {
    ...options,
    runs: MATCH_YIELD_RUNS,
    ...(setup.band.length > 0 ? { band: setup.band, load: setup.load } : {}),
  });
  const spread = ladderSpread({ ladder, load: setup.load, band: setup.band, options });
  return { yield: y, dominant: spread?.ranking[0] ?? null, rms: spread?.rms ?? 0 };
}

/** Ids of the parts a solution would add; no tolerance override names them. */
const APPENDED_ID = '\u0000appended-';

/**
 * The design with an Auto match solution's parts added after the parts given (the design's
 * own by default), as Add would leave it.
 */
export function withAppended(
  design: Design,
  added: readonly Element[],
  existing: readonly DesignElement[] = design.elements,
): Design {
  return {
    ...design,
    elements: [
      ...existing,
      ...added.map((el, k) => ({ ...el, id: `${APPENDED_ID}${k}`, color: '' }) as DesignElement),
    ],
  };
}

/**
 * The network the Tolerance panel analyses for the design with `elements` as its parts (the
 * design's parts, then a solution's): the loss model when Losses is on and the realized values
 * when Realize is on, exactly as toleranceSetup builds it.
 */
export function appendedLadder(design: Design, elements: readonly Element[]): Ladder {
  // The design's own parts (by id; the loss model may have copied them) keep their locks and
  // tolerance overrides; everything after them is added.
  const own = design.elements;
  const keep =
    own.length <= elements.length &&
    own.every((el, i) => (elements[i] as Partial<DesignElement>).id === el.id);
  const next = keep
    ? withAppended(
        design,
        elements.slice(own.length),
        elements.slice(0, own.length) as DesignElement[],
      )
    : withAppended({ ...design, elements: [] }, elements);
  return toleranceSetup(next).ladder;
}
