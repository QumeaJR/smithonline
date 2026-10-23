/**
 * Multi-section quarter-wave transformers by the small-reflection theory
 * (Pozar, Microwave Engineering, sections 5.6 and 5.7).
 *
 * The steps are taken in the logarithm of the impedance: section n to n + 1
 * reflects Gamma_n = ln(Z_{n+1} / Z_n) / 2, so the reflections add up to
 * Gamma(0) = ln(ZL / Z0) / 2 and the last section lands exactly on the load.
 * The total reflection is Gamma(theta) = sum Gamma_n exp(-2 j n theta), with
 * theta the electrical length of one section. Binomial coefficients make it
 * maximally flat at the centre; a Chebyshev polynomial T_N(sec(theta_m) cos theta)
 * makes it ripple at the allowed maximum over the widest band.
 *
 * The theory is first order in the reflections, so for a large step (above
 * about 2:1) the built ladder ripples higher than the limit. The bandwidth
 * reported is therefore taken from the exact response of the lines; the
 * textbook figure is kept beside it, with the worst |Gamma| inside it.
 */
import { cabs, cadd, cdiv, cmul, complex, csub, type Complex } from '../complex.js';
import type { LineElement } from '../elements.js';

export type TransformerType = 'binomial' | 'chebyshev';

export const MAX_TRANSFORMER_SECTIONS = 6;

export interface TransformerOptions {
  readonly type: TransformerType;
  /** Centre frequency, Hz: every section is a quarter wave here. */
  readonly frequency: number;
  /**
   * Largest reflection magnitude allowed in the band, 0 to 1. It is the
   * Chebyshev ripple level and the level the bandwidth is given for. Default 0.05.
   */
  readonly gammaMax?: number;
  /** The same limit as a passband insertion-loss ripple in dB; overrides gammaMax. */
  readonly rippleDb?: number;
}

export interface TransformerDesign {
  readonly type: TransformerType;
  readonly sections: number;
  /** Section impedances, ohm, load side first. */
  readonly impedances: readonly number[];
  /** The reflection level the bandwidth and the Chebyshev ripple refer to. */
  readonly gammaMax: number;
  /**
   * The ripple level the Chebyshev sections were synthesized for: gammaMax,
   * or lower for a large step, where the textbook design would ripple above
   * the limit inside its band. Equals gammaMax for binomial.
   */
  readonly designGamma: number;
  /**
   * Fractional bandwidth (delta f / f0) around f0 over which |Gamma| of the
   * built lines stays at or below gammaMax; 0 when |Gamma| at f0 is already
   * above it, null when it never leaves the limit (the step is that small).
   */
  readonly bandwidth: number | null;
  /** The same bandwidth by the small-reflection theory (the textbook figure). */
  readonly theoryBandwidth: number | null;
  /** The highest |Gamma| of the textbook design inside its theory band; near gammaMax when the theory holds. */
  readonly peakGamma: number;
  /** |Gamma| of the built lines at f0: 0, or the ripple for an even-order Chebyshev. */
  readonly centreGamma: number;
  /** Quarter-wave lines at the centre frequency, load side first, ready for the ladder. */
  readonly elements: readonly LineElement[];
}

/** |Gamma| of a passband insertion-loss ripple in dB: 1 - |Gamma|^2 = 10^(-dB / 10). */
export function gammaFromRippleDb(db: number): number {
  return Math.sqrt(1 - 10 ** (-db / 10));
}

/** Insertion-loss ripple in dB of a reflection magnitude. */
export function rippleDbFromGamma(gamma: number): number {
  return -10 * Math.log10(1 - gamma * gamma);
}

/** Chebyshev polynomial T_n(x) for any real x. */
export function chebyshevT(n: number, x: number): number {
  if (Math.abs(x) <= 1) return Math.cos(n * Math.acos(x));
  const t = Math.cosh(n * Math.acosh(Math.abs(x)));
  return x < 0 && n % 2 === 1 ? -t : t;
}

function binomial(n: number, k: number): number {
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return r;
}

/**
 * The cosine coefficients a_k of T_N(s cos theta) = sum a_k cos(k theta), by
 * sampling the polynomial: it is a cosine series of degree N, so 4N + 4
 * points recover it exactly up to rounding.
 */
function chebyshevCosineSeries(n: number, s: number): number[] {
  const m = 4 * n + 4;
  const out: number[] = [];
  for (let k = 0; k <= n; k++) {
    let sum = 0;
    for (let j = 0; j < m; j++) {
      const th = (2 * Math.PI * j) / m;
      sum += chebyshevT(n, s * Math.cos(th)) * Math.cos(k * th);
    }
    out.push(((k === 0 ? 1 : 2) * sum) / m);
  }
  return out;
}

function checkTransformer(z0: number, zl: number, sections: number, gammaMax: number): void {
  if (!(z0 > 0) || !Number.isFinite(z0)) throw new RangeError('Z0 must be a positive number.');
  if (!(zl > 0) || !Number.isFinite(zl)) throw new RangeError('ZL must be a positive number.');
  if (!Number.isInteger(sections) || sections < 1 || sections > MAX_TRANSFORMER_SECTIONS) {
    throw new RangeError(`The number of sections must be 1 to ${MAX_TRANSFORMER_SECTIONS}.`);
  }
  if (!(gammaMax > 0) || !(gammaMax < 1)) {
    throw new RangeError('The maximum reflection must lie between 0 and 1.');
  }
}

/** The section reflections Gamma_0 .. Gamma_N, source side first, and the band edge theta_m. */
function reflections(
  type: TransformerType,
  n: number,
  gamma0: number,
  gammaMax: number,
): { readonly gammas: number[]; readonly thetaM: number | null } {
  const mag = Math.abs(gamma0);
  if (type === 'binomial') {
    // Gamma(theta) = A (1 + exp(-2 j theta))^N with 2^N A = Gamma(0).
    const a = gamma0 / 2 ** n;
    const gammas = Array.from({ length: n + 1 }, (_, k) => a * binomial(n, k));
    const c = mag > 0 ? (gammaMax / mag) ** (1 / n) : Infinity;
    return { gammas, thetaM: c < 1 ? Math.acos(c) : null };
  }
  // Gamma(theta) exp(j N theta) = A T_N(sec(theta_m) cos theta) with A T_N(sec theta_m) = Gamma(0).
  // A step already inside the limit has nothing to ripple; the binomial split keeps it matched at f0.
  const ratio = mag / gammaMax;
  if (!(ratio > 1))
    return { gammas: reflections('binomial', n, gamma0, gammaMax).gammas, thetaM: null };
  const s = Math.cosh(Math.acosh(ratio) / n);
  const a = gamma0 / chebyshevT(n, s);
  const series = chebyshevCosineSeries(n, s);
  // 2 sum_{k < N/2} Gamma_k cos((N - 2k) theta) + Gamma_{N/2} (N even) = A T_N(...).
  const gammas = Array.from({ length: n + 1 }, (_, k) => {
    const order = Math.abs(n - 2 * k);
    const coefficient = series[order] ?? 0;
    return order === 0 ? a * coefficient : (a * coefficient) / 2;
  });
  return { gammas, thetaM: Math.acos(1 / s) };
}

/**
 * |Gamma| towards a z0 source of the quarter-wave cascade (impedances
 * normalized to z0, source side first) on the normalized load, at x = f / f0.
 */
function cascadeGamma(fromSource: readonly number[], load: number, x: number): number {
  const t = Math.tan((Math.PI / 2) * x);
  let z: Complex = complex(load);
  for (let k = fromSource.length - 1; k >= 0; k--) {
    const zc = complex(fromSource[k] as number);
    // Zin = Zc (Z + j Zc t) / (Zc + j Z t)
    z = cmul(zc, cdiv(cadd(z, cmul(zc, complex(0, t))), cadd(zc, cmul(z, complex(0, t)))));
  }
  return cabs(cdiv(csub(z, complex(1)), cadd(z, complex(1))));
}

/** The normalized section impedances, source side first, and the theory band edge. */
function synthesize(
  type: TransformerType,
  n: number,
  gamma0: number,
  gammaMax: number,
): { readonly normalized: number[]; readonly thetaM: number | null } {
  const { gammas, thetaM } = reflections(type, n, gamma0, gammaMax);
  // Z_{n+1} = Z_n exp(2 Gamma_n), from the source; the last step reaches ZL.
  const normalized: number[] = [];
  let lnz = 0;
  for (let k = 0; k < n; k++) {
    lnz += 2 * (gammas[k] as number);
    normalized.push(Math.exp(lnz));
  }
  return { normalized, thetaM };
}

/** The band of the built lines: the continuous span around f0 with |Gamma| <= limit. */
function exactBand(
  fromSource: readonly number[],
  load: number,
  gammaMax: number,
): { readonly bandwidth: number | null; readonly centre: number } {
  const g = (x: number): number => cascadeGamma(fromSource, load, x);
  const centre = g(1);
  if (centre > gammaMax) return { bandwidth: 0, centre };
  // The response is symmetric about f0; walk down from f0 to the first excursion.
  const step = 1e-3;
  let inside = 1;
  for (let x = 1 - step; x > 0; x -= step) {
    if (g(x) > gammaMax) {
      let lo = x;
      let hi = inside;
      for (let i = 0; i < 50; i++) {
        const mid = (lo + hi) / 2;
        if (g(mid) > gammaMax) lo = mid;
        else hi = mid;
      }
      return { bandwidth: 2 * (1 - hi), centre };
    }
    inside = x;
  }
  return { bandwidth: null, centre };
}

/**
 * A binomial or Chebyshev transformer of 1 to 6 quarter-wave sections from
 * a real load ZL to a real source Z0. The impedances come back load side
 * first, as the ladder runs.
 */
export function multisectionTransformer(
  z0: number,
  zl: number,
  sections: number,
  options: TransformerOptions,
): TransformerDesign {
  const gammaMax =
    options.rippleDb !== undefined
      ? gammaFromRippleDb(options.rippleDb)
      : (options.gammaMax ?? 0.05);
  checkTransformer(z0, zl, sections, gammaMax);
  if (!(options.frequency > 0) || !Number.isFinite(options.frequency)) {
    throw new RangeError('The centre frequency must be a positive number.');
  }
  // Logarithms of each impedance, so a quotient that over- or underflows never forms.
  const gamma0 = (Math.log(zl) - Math.log(z0)) / 2;
  const plain = synthesize(options.type, sections, gamma0, gammaMax);
  const thetaM = plain.thetaM;
  const fromPlain = plain.normalized.map((r) => r * z0);
  const load = Math.exp(2 * gamma0);
  if (
    !fromPlain.every((zc) => zc > 0 && Number.isFinite(zc)) ||
    !(load > 0 && Number.isFinite(load))
  ) {
    throw new RangeError('The impedance step is too large for a transformer.');
  }
  const theoryBandwidth = thetaM === null ? null : 2 - (4 * thetaM) / Math.PI;
  // The worst |Gamma| of the textbook design inside its band (the whole band when it has no edge).
  const half = theoryBandwidth === null ? 1 : theoryBandwidth / 2;
  let peakGamma = 0;
  for (let i = 0; i <= 400; i++) {
    peakGamma = Math.max(peakGamma, cascadeGamma(plain.normalized, load, 1 - (half * i) / 400));
  }
  // Past about 2:1 the textbook Chebyshev ripples above the limit and its band splits. Synthesize
  // at a lower ripple level instead, the one whose built lines stay under the limit the widest.
  let designGamma = gammaMax;
  let normalized = plain.normalized;
  let exact = exactBand(normalized, load, gammaMax);
  if (options.type === 'chebyshev' && peakGamma > gammaMax * (1 + 1e-3)) {
    const width = (b: number | null): number => (b === null ? 2 : b);
    for (let i = 1; i <= 80; i++) {
      const g = gammaMax * 0.01 ** (i / 80);
      const trial = synthesize('chebyshev', sections, gamma0, g).normalized;
      const band = exactBand(trial, load, gammaMax);
      if (width(band.bandwidth) > width(exact.bandwidth) + 1e-9) {
        designGamma = g;
        normalized = trial;
        exact = band;
      }
    }
  }
  const impedances = normalized.map((r) => r * z0).reverse();
  return {
    type: options.type,
    sections,
    impedances,
    gammaMax,
    designGamma,
    bandwidth: exact.bandwidth,
    theoryBandwidth,
    peakGamma,
    centreGamma: exact.centre,
    elements: impedances.map((zc) => ({
      kind: 'line',
      z0: zc,
      length: 0.25,
      refFrequency: options.frequency,
      er: 1,
      alphaDbPerM: 0,
    })),
  };
}
