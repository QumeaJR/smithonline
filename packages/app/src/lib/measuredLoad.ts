/**
 * The measured load as the app uses it: the points of an imported file
 * (Touchstone, CITI, VNA CSV, EZNEC) as one load across frequency for every
 * band tool, the words for its model's quality, and the flag for a band that
 * reaches past the data. The model itself is core's measured load: the
 * fitted rational model from six points up, linear interpolation otherwise.
 *
 * The fit runs in a Web Worker (a few thousand rows can take half a second),
 * once per point list and Z0: until it is ready the load is the linear
 * interpolation of the rows (reason 'pending', "fitting the model"), and
 * when it arrives fitVersion moves on so the views that use the load
 * recompute (useFitVersion). Without Web Workers (tests) the fit is made at
 * once, as before.
 */
import {
  beyondData,
  FIT_MIN_POINTS,
  FIT_MAX_RESIDUAL,
  interpolatedLoad,
  measuredLoadFromFit,
  measuredLoadInfo,
  pendingMeasuredLoad,
  vectorFitFromData,
  type Complex,
  type LoadModel,
  type MeasuredLoadInfo,
  type SweepLoad,
} from '@smithonline/core';
import { useSyncExternalStore } from 'react';
import type { FitRequest, FitResponse } from '../workers/fit.worker';
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

/* ------------------------------------------------------- the fit off the main thread */

interface FitEntry {
  model: LoadModel;
  ready: boolean;
}

/** The models by point list and Z0. */
const fitCache = new WeakMap<readonly SweepLoad[], Map<number, FitEntry>>();
let fitWorker: Worker | null = null;
let nextId = 1;
const waiting = new Map<number, { points: readonly SweepLoad[]; z0: number; entry: FitEntry }>();
let version = 0;
const listeners = new Set<() => void>();

/** Moves on each time a fit arrives from the worker. */
export function fitVersion(): number {
  return version;
}

/** Called each time a fit arrives; returns the unsubscribe. */
export function subscribeFits(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** fitVersion as React state: a view that uses a measured load lists it with its inputs. */
export function useFitVersion(): number {
  return useSyncExternalStore(subscribeFits, fitVersion, fitVersion);
}

function settle(id: number, fit: FitResponse['fit'], failed: boolean): void {
  const job = waiting.get(id);
  if (!job) return;
  waiting.delete(id);
  job.entry.model = measuredLoadFromFit(
    job.points,
    { z0: job.z0 },
    failed || !fit ? null : vectorFitFromData(fit),
  );
  job.entry.ready = true;
  version++;
  for (const l of [...listeners]) l();
}

function worker(): Worker | null {
  if (fitWorker) return fitWorker;
  try {
    fitWorker = new Worker(new URL('../workers/fit.worker.ts', import.meta.url), {
      type: 'module',
    });
  } catch {
    return null;
  }
  fitWorker.onmessage = (e: MessageEvent<FitResponse>): void =>
    settle(e.data.id, e.data.fit, false);
  fitWorker.onerror = (): void => {
    // Every waiting fit falls back to linear interpolation ('failed'); a new worker next time.
    for (const id of [...waiting.keys()]) settle(id, null, true);
    fitWorker?.terminate();
    fitWorker = null;
  };
  return fitWorker;
}

/** Rows with a positive frequency and a finite impedance, counted once per frequency. */
function usableCount(points: readonly SweepLoad[]): number {
  const seen = new Set<number>();
  for (const p of points) {
    if (
      p.frequency > 0 &&
      Number.isFinite(p.frequency) &&
      Number.isFinite(p.z.re) &&
      Number.isFinite(p.z.im)
    )
      seen.add(p.frequency);
  }
  return seen.size;
}

/**
 * The load model of a point list at the design's Z0: the fitted model from
 * six rows (fitted in the worker; linear interpolation, reason 'pending',
 * until it is ready), linear interpolation below that.
 */
export function pointsLoadModel(points: readonly SweepLoad[], z0: number): LoadModel {
  if (typeof Worker === 'undefined' || usableCount(points) < FIT_MIN_POINTS)
    return interpolatedLoad(points, { z0 });
  let byZ0 = fitCache.get(points);
  const hit = byZ0?.get(z0);
  if (hit) return hit.model;
  const w = worker();
  if (!w) return interpolatedLoad(points, { z0 });
  const entry: FitEntry = { model: pendingMeasuredLoad(points, { z0 }), ready: false };
  if (!byZ0) {
    byZ0 = new Map();
    fitCache.set(points, byZ0);
  }
  byZ0.set(z0, entry);
  const id = nextId++;
  waiting.set(id, { points, z0, entry });
  const request: FitRequest = {
    id,
    points: points.map((p) => ({ frequency: p.frequency, z: { re: p.z.re, im: p.z.im } })),
    z0,
  };
  w.postMessage(request);
  return entry.model;
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

/** How the linear fallback joins the rows. */
const LINEAR = 'joined by linear interpolation of R and X';

/**
 * The quality of the load model in a few words: "fitted, order 6, max
 * residual 0.003 in Γ", or for the fallback "joined by linear interpolation
 * of R and X; the best fit missed a row by 0.11 in Γ (limit 0.01)". No colon
 * inside, so it reads in a sentence that has one.
 */
export function loadModelText(info: MeasuredLoadInfo): string {
  const fit = info.fit;
  const limit = fmtSig(FIT_MAX_RESIDUAL, 2);
  switch (info.reason) {
    case 'fitted':
      return `fitted, order ${fit?.order ?? 0}, max residual ${fmtResidual(fit?.maxResidual ?? NaN)} in Γ`;
    case 'residual':
      return `${LINEAR}; the best fit missed a row by ${fmtResidual(fit?.maxResidual ?? NaN)} in Γ (limit ${limit})`;
    case 'between-points': {
      const v = fit?.validation;
      return v
        ? `${LINEAR}; the best fit strays ${fmtResidual(v.worst)} in Γ from the rows near ${fmtFrequency(v.at)}, where they are too far apart to show it`
        : `${LINEAR}; the best fit strays from the rows between them`;
    }
    case 'few-points':
      return `${LINEAR}; ${info.points} ${info.points === 1 ? 'point' : 'points'}, a fit needs ${FIT_MIN_POINTS}`;
    case 'failed':
      return `${LINEAR}; the fit failed`;
    case 'pending':
      return `fitting the model, ${LINEAR} until it is ready`;
    case 'disabled':
      return LINEAR;
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

/** The row nearest f (the first of equally near ones), or null for no row with a positive frequency. */
export function nearestRow(points: readonly SweepLoad[], f: number): SweepLoad | null {
  let best: SweepLoad | null = null;
  for (const p of points) {
    if (!(p.frequency > 0) || !Number.isFinite(p.frequency)) continue;
    if (!best || Math.abs(p.frequency - f) < Math.abs(best.frequency - f)) best = p;
  }
  return best;
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
