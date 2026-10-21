/**
 * Frequency response of a ladder as plot-ready columns: |S21| and |S11| in dB,
 * VSWR, input impedance R and X, unwrapped S21 phase and group delay.
 *
 * Portions derived from QuickSmith-Web, copyright 2017 Nathan Iyer, MIT license
 * (engine.js, commit ca1b69e612f3e7c753591e2a09c38e19110136ef): unwrapPhase.
 */
import type { SweepPoint } from './ladder.js';

/**
 * Remove the 360 degree jumps from a phase column so that the curve is
 * continuous. The first value is kept as given; each later value is shifted by
 * a multiple of 360 so that it stays within 180 degrees of its predecessor.
 * Non-finite values pass through untouched and do not move the offset.
 */
export function unwrapPhase(phasesDeg: readonly number[]): number[] {
  const out: number[] = [];
  let offset = 0;
  let previous: number | null = null;
  for (let i = 0; i < phasesDeg.length; i++) {
    const phase = phasesDeg[i] as number;
    if (!Number.isFinite(phase)) {
      out.push(phase);
      continue;
    }
    if (previous !== null) {
      const jump = phase + offset - previous;
      if (Math.abs(jump) > 180) offset -= 360 * Math.round(jump / 360);
    }
    previous = phase + offset;
    out.push(previous);
  }
  return out;
}

/**
 * Group delay in seconds from a phase column in degrees: tau = -dphi/domega,
 * with phi in radians and omega = 2 pi f, so tau = -(dphi_deg / df) / 360.
 * The phase is unwrapped first. Interior points use the central difference of
 * their neighbours (exact for a linear phase, second order otherwise); the two
 * ends use the one-sided difference. Fewer than two points give NaN.
 */
export function groupDelay(frequencies: readonly number[], phasesDeg: readonly number[]): number[] {
  const n = Math.min(frequencies.length, phasesDeg.length);
  const phi = unwrapPhase(phasesDeg.slice(0, n));
  const out: number[] = new Array<number>(n).fill(NaN);
  if (n < 2) return out;
  const slope = (i: number, j: number): number => {
    const df = (frequencies[j] as number) - (frequencies[i] as number);
    return df === 0 ? NaN : -((phi[j] as number) - (phi[i] as number)) / df / 360;
  };
  for (let i = 0; i < n; i++) {
    const lo = Math.max(0, i - 1);
    const hi = Math.min(n - 1, i + 1);
    out[i] = slope(lo, hi);
  }
  return out;
}

/**
 * Logarithmically spaced sweep frequencies, inclusive of both ends. Both ends
 * must be positive; otherwise the spacing falls back to linear.
 */
export function sweepPointsLog(start: number, stop: number, points: number): number[] {
  const n = Math.max(1, Math.floor(points));
  if (n === 1) return [start];
  if (!(start > 0) || !(stop > 0)) {
    const out: number[] = [];
    for (let i = 0; i < n; i++) out.push(start + ((stop - start) * i) / (n - 1));
    return out;
  }
  const ratio = Math.log(stop / start);
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(start * Math.exp((ratio * i) / (n - 1)));
  // Land exactly on stop; the exponential drifts in the last digit.
  out[n - 1] = stop;
  return out;
}

/** The response of a ladder over a sweep, one column per quantity. */
export interface Response {
  readonly frequency: number[];
  /** |S21| in dB. */
  readonly s21Db: number[];
  /** |S11| in dB, the negative return loss. */
  readonly s11Db: number[];
  readonly vswr: number[];
  /** Input resistance, ohm. */
  readonly r: number[];
  /** Input reactance, ohm. */
  readonly x: number[];
  /** Unwrapped S21 phase, degrees. */
  readonly phaseDeg: number[];
  /** Group delay, seconds. */
  readonly groupDelay: number[];
}

/** Turn sweep points into the columns of a response plot. */
export function sweepResponse(sweep: readonly SweepPoint[]): Response {
  const frequency = sweep.map((p) => p.frequency);
  const rawPhase = sweep.map((p) => (p.s21.mag > 0 ? p.s21.angleDeg : NaN));
  return {
    frequency,
    s21Db: sweep.map((p) => p.s21.db),
    s11Db: sweep.map((p) => (p.info.gammaMag > 0 ? 20 * Math.log10(p.info.gammaMag) : -Infinity)),
    vswr: sweep.map((p) => p.info.vswr),
    r: sweep.map((p) => p.zin.re),
    x: sweep.map((p) => p.zin.im),
    phaseDeg: unwrapPhase(rawPhase),
    groupDelay: groupDelay(frequency, rawPhase),
  };
}
