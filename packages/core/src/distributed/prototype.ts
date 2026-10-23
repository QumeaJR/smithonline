/**
 * Low-pass prototype element values g0 .. g_{N+1} for a 1 ohm, 1 rad/s
 * ladder (Matthaei, Young and Jones; Pozar, Microwave Engineering, 8.3).
 * g0 is the source, g1 .. gN alternate between series inductors and shunt
 * capacitors, g_{N+1} is the load: a resistance after a shunt capacitor, a
 * conductance after a series inductor.
 */

export type PrototypeResponse = 'butterworth' | 'chebyshev';

export const MAX_FILTER_ORDER = 9;

export interface PrototypeOptions {
  readonly response: PrototypeResponse;
  /** Passband ripple in dB for Chebyshev; default 0.5. */
  readonly rippleDb?: number;
}

/**
 * g1 .. g_{N+1} (index 0 is g1) of a Butterworth (3 dB at the cutoff) or
 * Chebyshev (equal ripple up to the cutoff) prototype of order 1 to 9.
 */
export function lowpassPrototype(order: number, options: PrototypeOptions): number[] {
  if (!Number.isInteger(order) || order < 1 || order > MAX_FILTER_ORDER) {
    throw new RangeError(`The filter order must be 1 to ${MAX_FILTER_ORDER}.`);
  }
  const n = order;
  if (options.response === 'butterworth') {
    const g = Array.from({ length: n }, (_, i) => 2 * Math.sin(((2 * i + 1) * Math.PI) / (2 * n)));
    return [...g, 1];
  }
  const ripple = options.rippleDb ?? 0.5;
  if (!(ripple > 0) || !Number.isFinite(ripple)) {
    throw new RangeError('The Chebyshev ripple must be a positive number of dB.');
  }
  // beta = ln coth(ripple / 17.37), with 17.37 = 40 / ln 10.
  const beta = Math.log(1 / Math.tanh((ripple * Math.LN10) / 40));
  const gamma = Math.sinh(beta / (2 * n));
  const a = (k: number): number => Math.sin(((2 * k - 1) * Math.PI) / (2 * n));
  const b = (k: number): number => gamma * gamma + Math.sin((k * Math.PI) / n) ** 2;
  const g: number[] = [(2 * a(1)) / gamma];
  for (let k = 2; k <= n; k++) {
    const prev = g[k - 2] as number;
    g.push((4 * a(k - 1) * a(k)) / (b(k - 1) * prev));
  }
  const last = n % 2 === 1 ? 1 : 1 / Math.tanh(beta / 4) ** 2;
  return [...g, last];
}
