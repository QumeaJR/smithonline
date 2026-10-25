/**
 * A load known at measured frequency points (a Touchstone, CITI or VNA CSV
 * file, or datapoints) as a function of frequency, for the band tools.
 *
 * With at least FIT_MIN_POINTS points the load is a rational model fitted to
 * the reflection coefficient (vectfit.ts, made passive), so the band tools see
 * an honest curve between the points instead of straight lines in R and X.
 * The fit is used only when it follows the data: a largest residual above
 * FIT_MAX_RESIDUAL in Gamma, or a fit that fails, falls back to linear
 * interpolation of R and X, and the reason is kept. A fitted model is used up
 * to EXTRAPOLATION (5 percent) past each end of the data and held at its
 * value there beyond that; the linear fallback is held at the end points, as
 * it always was.
 */
import { complex, cdiv, cmul, type Complex } from './complex.js';
import { zToGamma } from './conversions.js';
import { fitReflection, VectorFitError, type VectorFit } from './vectfit.js';

/** Fewest points a load is fitted from; fewer are interpolated linearly. */
export const FIT_MIN_POINTS = 6;
/** Largest residual in Gamma for the fit to be used. */
export const FIT_MAX_RESIDUAL = 1e-2;
/** How far past the data (fraction of the band edge) a fitted model is evaluated. */
export const EXTRAPOLATION = 0.05;

/** Why the load is what it is. */
export type MeasuredLoadReason =
  /** The fitted model. */
  | 'fitted'
  /** Fewer than FIT_MIN_POINTS distinct points. */
  | 'few-points'
  /** The fit's largest residual is above the threshold. */
  | 'residual'
  /** The fit did not produce a finite model. */
  | 'failed'
  /** Fitting was switched off. */
  | 'disabled';

export interface MeasuredLoadInfo {
  readonly mode: 'fitted' | 'linear';
  readonly reason: MeasuredLoadReason;
  /** Distinct points used. */
  readonly points: number;
  /** Lowest and highest measured frequency, Hz. */
  readonly band: readonly [number, number];
  /** The range the model follows; outside it the load is held at its value at the nearer end, Hz. */
  readonly range: readonly [number, number];
  /** Reference impedance of the fitted reflection coefficient and its residual, ohm. */
  readonly z0: number;
  /** The fit, also when it was rejected (its residual says why); null when none was tried or it failed. */
  readonly fit: VectorFit | null;
  /** dZ/df of the fitted model, ohm per Hz (zero where the load is held); absent for the linear fallback. */
  readonly derivative?: (f: number) => Complex;
}

/** A load as a function of frequency that knows where it came from. */
export type MeasuredLoad = ((f: number) => Complex) & { readonly measured: MeasuredLoadInfo };

/** The measured-load information of a load model, or null for a fixed load or a plain function. */
export function measuredLoadInfo(load: unknown): MeasuredLoadInfo | null {
  if (typeof load !== 'function') return null;
  const info = (load as Partial<MeasuredLoad>).measured;
  return info ?? null;
}

/** Which ends of [f1, f2] reach past the measured data (a fitted model is held 5 percent beyond them). */
export function beyondData(
  info: MeasuredLoadInfo,
  f1: number,
  f2: number,
): { readonly below: boolean; readonly above: boolean } {
  const lo = Math.min(f1, f2);
  const hi = Math.max(f1, f2);
  // A hair of slack: a band typed as the file's own end points is inside it.
  const eps = 1e-9;
  return { below: lo < info.band[0] * (1 - eps), above: hi > info.band[1] * (1 + eps) };
}

export interface MeasuredLoadOptions {
  /** Reference impedance of the fit and its residual, ohm. Default 50. */
  readonly z0?: number;
  /** Fit a rational model when there are enough points. Default true. */
  readonly fit?: boolean;
  /** Largest residual in Gamma for the fit to be used. Default FIT_MAX_RESIDUAL. */
  readonly maxResidual?: number;
}

export interface MeasuredPoint {
  readonly frequency: number;
  readonly z: Complex;
}

/** Sorted by frequency, non-finite and non-positive frequencies dropped, a repeated frequency kept once (its first row). */
function distinct(points: readonly MeasuredPoint[]): MeasuredPoint[] {
  const sorted = points
    .filter((p) => p.frequency > 0 && Number.isFinite(p.frequency))
    .sort((a, b) => a.frequency - b.frequency);
  const out: MeasuredPoint[] = [];
  for (const p of sorted) {
    if (out.length > 0 && (out[out.length - 1] as MeasuredPoint).frequency === p.frequency)
      continue;
    out.push(p);
  }
  return out;
}

/** Linear in R and X between the points, held at the ends. */
function linear(sorted: readonly MeasuredPoint[]): (f: number) => Complex {
  const first = sorted[0] as MeasuredPoint;
  const last = sorted[sorted.length - 1] as MeasuredPoint;
  return (f: number): Complex => {
    if (f <= first.frequency) return first.z;
    if (f >= last.frequency) return last.z;
    let k = 1;
    while (k < sorted.length - 1 && (sorted[k] as MeasuredPoint).frequency < f) k++;
    const a = sorted[k - 1] as MeasuredPoint;
    const b = sorted[k] as MeasuredPoint;
    const t = (f - a.frequency) / (b.frequency - a.frequency);
    return complex(a.z.re + t * (b.z.re - a.z.re), a.z.im + t * (b.z.im - a.z.im));
  };
}

function withInfo(fn: (f: number) => Complex, measured: MeasuredLoadInfo): MeasuredLoad {
  return Object.assign(fn, { measured });
}

/**
 * The load of a set of measured points as a function of frequency: the fitted
 * rational model when there are at least FIT_MIN_POINTS distinct points and
 * the fit follows them within maxResidual in Gamma, else linear interpolation
 * of R and X (also for points that repeat a frequency: the first one counts).
 * Needs at least two points with a positive frequency; the caller handles
 * fewer.
 */
export function measuredLoad(
  points: readonly MeasuredPoint[],
  options: MeasuredLoadOptions = {},
): MeasuredLoad {
  const z0 = options.z0 !== undefined && options.z0 > 0 ? options.z0 : 50;
  const all = distinct(points);
  // A repeated frequency counts once (its first row); with fewer than two distinct points
  // the rows are taken as they are.
  const sorted = all.length >= 2 ? all : [...points].sort((a, b) => a.frequency - b.frequency);
  const band: [number, number] = [
    (sorted[0] as MeasuredPoint).frequency,
    (sorted[sorted.length - 1] as MeasuredPoint).frequency,
  ];
  const fallback = (reason: MeasuredLoadReason, fit: VectorFit | null): MeasuredLoad =>
    withInfo(linear(sorted), {
      mode: 'linear',
      reason,
      points: sorted.length,
      band,
      range: band,
      z0,
      fit,
    });
  if (options.fit === false) return fallback('disabled', null);
  const usable = all.filter((p) => Number.isFinite(p.z.re) && Number.isFinite(p.z.im));
  if (usable.length < FIT_MIN_POINTS) return fallback('few-points', null);

  let fit: VectorFit;
  try {
    fit = fitReflection(
      usable.map((p) => p.frequency),
      usable.map((p) => zToGamma(p.z, z0)),
    );
  } catch (err) {
    if (err instanceof VectorFitError) return fallback('failed', null);
    throw err;
  }
  const limit = options.maxResidual ?? FIT_MAX_RESIDUAL;
  if (!Number.isFinite(fit.maxResidual) || !(fit.maxResidual <= limit)) {
    return fallback(Number.isFinite(fit.maxResidual) ? 'residual' : 'failed', fit);
  }
  const lo = fit.band[0] * (1 - EXTRAPOLATION);
  const hi = fit.band[1] * (1 + EXTRAPOLATION);
  const one = complex(1, 0);
  const zOf = (g: Complex): Complex =>
    cmul(complex(z0, 0), cdiv(complex(1 + g.re, g.im), complex(1 - g.re, -g.im)));
  const clamp = (f: number): number => (f < lo ? lo : f > hi ? hi : f);
  const fn = (f: number): Complex => zOf(fit.evaluate(clamp(f)));
  const derivative = (f: number): Complex => {
    if (f < lo || f > hi) return complex(0, 0);
    const g = fit.evaluate(f);
    const dg = fit.derivative(f);
    // dZ/dGamma = 2 z0 / (1 - Gamma)^2
    const om = complex(one.re - g.re, -g.im);
    const sq = cmul(om, om);
    return cmul(cdiv(complex(2 * z0, 0), sq), dg);
  };
  return withInfo(fn, {
    mode: 'fitted',
    reason: 'fitted',
    points: usable.length,
    band: [fit.band[0], fit.band[1]],
    range: [lo, hi],
    z0,
    fit,
    derivative,
  });
}
