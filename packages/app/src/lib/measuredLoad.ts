/**
 * The measured load as the app uses it: the points of an imported file
 * (Touchstone, CITI, VNA CSV, EZNEC) as one load across frequency for every
 * band tool, the words for its model's quality, and the flag for a band that
 * reaches past the data. The model itself is core's interpolatedLoad: the
 * fitted rational model from six points up, linear interpolation otherwise.
 */
import {
  beyondData,
  FIT_MIN_POINTS,
  interpolatedLoad,
  measuredLoadInfo,
  type Complex,
  type LoadModel,
  type MeasuredLoadInfo,
  type SweepLoad,
} from '@smithonline/core';
import type { Design } from './design';
import { fmtFrequency, fmtSig } from './format';

type LoadPart = Pick<Design, 'load' | 'z0' | 'sweep'>;

/** The imported points of the design when there are two or more, else null. */
export function measuredPoints(design: Pick<Design, 'sweep'>): readonly SweepLoad[] | null {
  const loads = design.sweep.loads;
  return loads && loads.length >= 2 ? loads : null;
}

/**
 * True when the band tools judge the design against its measured load: there
 * are imported points and the sweep runs over them (Back to frequency sweep
 * keeps the points but returns to the fixed load).
 */
export function hasMeasuredLoad(design: Pick<Design, 'sweep'>): boolean {
  return measuredPoints(design) !== null && design.sweep.mode !== 'frequency';
}

/** The load model of a point list at the design's Z0 (cached per list by core). */
export function pointsLoadModel(points: readonly SweepLoad[], z0: number): LoadModel {
  return interpolatedLoad(points, { z0 });
}

/**
 * The load across frequency the band tools use: the measured load when
 * `measured` (default: whenever hasMeasuredLoad), else the design's fixed load.
 */
export function designLoadModel(design: LoadPart, measured = hasMeasuredLoad(design)): LoadModel {
  const points = measuredPoints(design);
  return measured && points ? pointsLoadModel(points, design.z0) : design.load;
}

/** The model's information when the load is measured, else null. */
export function designLoadInfo(design: LoadPart): MeasuredLoadInfo | null {
  return measuredLoadInfo(designLoadModel(design));
}

/** A residual in Gamma for a sentence: two significant digits, "below 0.0001" for a fit that is exact. */
export function fmtResidual(v: number): string {
  if (!Number.isFinite(v)) return 'not finite';
  return v < 1e-4 ? 'below 0.0001' : fmtSig(v, 2);
}

/**
 * The quality of the load model in a few words: "fitted, order 6, max
 * residual 0.003 in Γ" or "linear interpolation: the fit's residual was 0.04".
 */
export function loadModelText(info: MeasuredLoadInfo): string {
  const fit = info.fit;
  switch (info.reason) {
    case 'fitted':
      return `fitted, order ${fit?.order ?? 0}, max residual ${fmtResidual(fit?.maxResidual ?? NaN)} in Γ`;
    case 'residual':
      return `linear interpolation: the fit's residual was ${fmtResidual(fit?.maxResidual ?? NaN)} in Γ (above 0.01)`;
    case 'few-points':
      return `linear interpolation: ${info.points} points (a fit needs ${FIT_MIN_POINTS})`;
    case 'failed':
      return 'linear interpolation: the fit failed';
    case 'disabled':
      return 'linear interpolation';
  }
}

/** One line on the measured load for a panel: where it comes from and how it is modelled. */
export function measuredLoadLine(info: MeasuredLoadInfo, name?: string): string {
  const from = name ? ` of ${name}` : '';
  return `Load: the ${info.points} measured points${from}, ${fmtFrequency(info.band[0])} to ${fmtFrequency(info.band[1])}, ${loadModelText(info)}.`;
}

/**
 * Null when the band lies inside the measured data; otherwise the sentence
 * that flags it: the fitted model is held at its value 5 percent past the
 * data, linear interpolation at the end points.
 */
export function beyondDataText(info: MeasuredLoadInfo, f1: number, f2: number): string | null {
  const { below, above } = beyondData(info, f1, f2);
  if (!below && !above) return null;
  const side = below && above ? 'both ends' : below ? 'below' : 'above';
  const held =
    info.mode === 'fitted'
      ? 'the fitted model is followed 5 % past the data and held at its value there'
      : 'the load is held at the end point';
  return `The band reaches ${side === 'both ends' ? 'past both ends of' : `${side}`} the measured ${fmtFrequency(info.band[0])} to ${fmtFrequency(info.band[1])}: ${held}.`;
}

/**
 * The imported points sorted by frequency, a repeated frequency kept once
 * (its first row) and non-positive frequencies dropped; null without two.
 */
export function sortedMeasured(sweep: Design['sweep']): SweepLoad[] | null {
  const points = measuredPoints({ sweep });
  if (!points) return null;
  const out: SweepLoad[] = [];
  for (const p of [...points].sort((a, b) => a.frequency - b.frequency)) {
    if (!(p.frequency > 0) || !Number.isFinite(p.frequency)) continue;
    if (out.length > 0 && (out[out.length - 1] as SweepLoad).frequency === p.frequency) continue;
    out.push(p);
  }
  return out.length >= 2 ? out : null;
}

/** The load at one frequency from a model. */
export function loadAt(load: LoadModel, f: number): Complex {
  return typeof load === 'function' ? load(f) : load;
}

/**
 * The band the band tools work over: the measured band (lowest to highest
 * imported point) while the design is judged against its measured load,
 * otherwise the sweep range in either order.
 */
export function designBand(design: Pick<Design, 'sweep'>): {
  readonly start: number;
  readonly stop: number;
  readonly measured: boolean;
} {
  const points = hasMeasuredLoad(design) ? measuredPoints(design) : null;
  if (points) {
    let lo = Infinity;
    let hi = -Infinity;
    for (const p of points) {
      if (!(p.frequency > 0) || !Number.isFinite(p.frequency)) continue;
      lo = Math.min(lo, p.frequency);
      hi = Math.max(hi, p.frequency);
    }
    if (hi > lo) return { start: lo, stop: hi, measured: true };
  }
  const { start, stop } = design.sweep;
  return { start: Math.min(start, stop), stop: Math.max(start, stop), measured: false };
}
