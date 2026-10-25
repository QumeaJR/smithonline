/**
 * Two-port S-parameter analysis on the Smith chart: stability (K, Delta, mu),
 * gains (MAG, MSG, simultaneous conjugate match) and the circle families the
 * original draws: input and output stability, operating and available power
 * gain, unilateral gain, and noise figure.
 *
 * Formulas follow Gonzalez, "Microwave Transistor Amplifiers", and HP
 * application note 95-1; see docs/01-original-analysis.md section 6.
 * All gains are linear unless the name says dB.
 */
import { cabs, cdiv, cmul, complex, conj, csub, cadd, cscale, type Complex } from './complex.js';

export interface SParameters {
  readonly s11: Complex;
  readonly s12: Complex;
  readonly s21: Complex;
  readonly s22: Complex;
}

export interface NoiseParameters {
  /** Minimum noise figure, dB. */
  readonly nfMinDb: number;
  /** Source reflection coefficient for minimum noise. */
  readonly gammaOpt: Complex;
  /** Equivalent noise resistance normalized to Z0 (rn = Rn / Z0). */
  readonly rn: number;
}

/** A circle in the reflection-coefficient plane. */
export interface Circle {
  readonly center: Complex;
  readonly radius: number;
}

export function dbToLinear(db: number): number {
  return 10 ** (db / 10);
}

export function linearToDb(x: number): number {
  return 10 * Math.log10(x);
}

export interface Stability {
  /** Rollett stability factor. */
  readonly k: number;
  readonly delta: Complex;
  readonly deltaMag: number;
  /** B1 = 1 + |S11|^2 - |S22|^2 - |Delta|^2; B1 > 0 selects the minus root of the conjugate match. */
  readonly b1: number;
  /** Edwards and Sinsky mu (source side) and mu prime (load side); > 1 means unconditionally stable. */
  readonly mu: number;
  readonly muPrime: number;
  readonly unconditionallyStable: boolean;
}

/**
 * K, mu and mu prime within this of 1 are 1. A lossless two-port has K = mu
 * = 1 exactly; computed from its S-parameters they come out a few units of
 * rounding either side, and the side decides between "unconditionally
 * stable" and "potentially unstable" and whether MAG exists. A real device
 * this close to the boundary is on it for every practical purpose.
 */
export const STABILITY_UNITY_TOLERANCE = 1e-9;

/** v, or exactly 1 when v is within STABILITY_UNITY_TOLERANCE of 1. */
export function snapToUnity(v: number): number {
  return Math.abs(v - 1) < STABILITY_UNITY_TOLERANCE ? 1 : v;
}

export function stability(s: SParameters): Stability {
  const delta = csub(cmul(s.s11, s.s22), cmul(s.s12, s.s21));
  const deltaMag = cabs(delta);
  const m11 = cabs(s.s11) ** 2;
  const m22 = cabs(s.s22) ** 2;
  const m1221 = cabs(cmul(s.s12, s.s21));
  const k = snapToUnity((1 - m11 - m22 + deltaMag * deltaMag) / (2 * m1221));
  const b1 = 1 + m11 - m22 - deltaMag * deltaMag;
  const mu = snapToUnity((1 - m11) / (cabs(csub(s.s22, cmul(delta, conj(s.s11)))) + m1221));
  const muPrime = snapToUnity((1 - m22) / (cabs(csub(s.s11, cmul(delta, conj(s.s22)))) + m1221));
  return { k, delta, deltaMag, b1, mu, muPrime, unconditionallyStable: k > 1 && deltaMag < 1 };
}

export interface StabilityCircle extends Circle {
  /** The side of the circle on which the device is stable. */
  readonly stableInside: boolean;
}

/**
 * Input (source) plane stability circle: the source reflection coefficients
 * for which |Gamma_out| = 1. Stable side: the origin (Gamma_S = 0) is stable
 * when |S22| < 1, so the side containing the origin is stable in that case.
 */
export function sourceStabilityCircle(s: SParameters): StabilityCircle {
  const { delta } = stability(s);
  const c1 = csub(s.s11, cmul(delta, conj(s.s22)));
  const denom = cabs(s.s11) ** 2 - cabs(delta) ** 2;
  const center = cscale(conj(c1), 1 / denom);
  const radius = Math.abs(cabs(cmul(s.s12, s.s21)) / denom);
  return { center, radius, stableInside: stableSide(center, radius, cabs(s.s22) < 1) };
}

/** Output (load) plane stability circle: the load reflection coefficients for which |Gamma_in| = 1. */
export function loadStabilityCircle(s: SParameters): StabilityCircle {
  const { delta } = stability(s);
  const c2 = csub(s.s22, cmul(delta, conj(s.s11)));
  const denom = cabs(s.s22) ** 2 - cabs(delta) ** 2;
  const center = cscale(conj(c2), 1 / denom);
  const radius = Math.abs(cabs(cmul(s.s12, s.s21)) / denom);
  return { center, radius, stableInside: stableSide(center, radius, cabs(s.s11) < 1) };
}

function stableSide(center: Complex, radius: number, originStable: boolean): boolean {
  const originInside = cabs(center) < radius;
  return originInside === originStable;
}

/** Maximum stable gain |S21 / S12|, linear. */
export function msg(s: SParameters): number {
  return cabs(s.s21) / cabs(s.s12);
}

/**
 * Maximum available gain for K > 1, linear: |S21 / S12| (K - sqrt(K^2 - 1)).
 * For K < 1 the device is potentially unstable and MSG applies instead; NaN is returned.
 */
export function mag(s: SParameters): number {
  const { k } = stability(s);
  if (!(k >= 1)) return NaN;
  return msg(s) * (k - Math.sqrt(k * k - 1));
}

/** The gain the original calls Gmax: MAG when K > 1, otherwise MSG. In dB. */
export function gmaxDb(s: SParameters): number {
  const { k } = stability(s);
  return linearToDb(k >= 1 ? mag(s) : msg(s));
}

export interface ConjugateMatch {
  readonly gammaSource: Complex;
  readonly gammaLoad: Complex;
}

/** Simultaneous conjugate match, defined for an unconditionally stable device (K > 1). */
export function conjugateMatch(s: SParameters): ConjugateMatch | null {
  const st = stability(s);
  if (!(st.k >= 1)) return null;
  const c1 = csub(s.s11, cmul(st.delta, conj(s.s22)));
  const c2 = csub(s.s22, cmul(st.delta, conj(s.s11)));
  const b2 = 1 + cabs(s.s22) ** 2 - cabs(s.s11) ** 2 - st.deltaMag ** 2;
  const root = (b: number, c: Complex): Complex => {
    const disc = Math.max(b * b - 4 * cabs(c) ** 2, 0);
    const sign = b > 0 ? -1 : 1;
    return cdiv(complex(b + sign * Math.sqrt(disc)), cscale(c, 2));
  };
  return { gammaSource: root(st.b1, c1), gammaLoad: root(b2, c2) };
}

/**
 * Operating power gain circle in the load plane for Gp (linear):
 * gp = Gp / |S21|^2, C2 = S22 - Delta conj(S11).
 */
export function operatingGainCircle(s: SParameters, gpLinear: number): Circle {
  const st = stability(s);
  const gp = gpLinear / cabs(s.s21) ** 2;
  const c2 = csub(s.s22, cmul(st.delta, conj(s.s11)));
  const m1221 = cabs(cmul(s.s12, s.s21));
  const denom = 1 + gp * (cabs(s.s22) ** 2 - st.deltaMag ** 2);
  const center = cscale(conj(c2), gp / denom);
  const radius =
    Math.sqrt(Math.max(1 - 2 * st.k * gp * m1221 + gp * gp * m1221 * m1221, 0)) / Math.abs(denom);
  return { center, radius };
}

/**
 * Available power gain circle in the source plane for Ga (linear):
 * ga = Ga / |S21|^2, C1 = S11 - Delta conj(S22).
 */
export function availableGainCircle(s: SParameters, gaLinear: number): Circle {
  const st = stability(s);
  const ga = gaLinear / cabs(s.s21) ** 2;
  const c1 = csub(s.s11, cmul(st.delta, conj(s.s22)));
  const m1221 = cabs(cmul(s.s12, s.s21));
  const denom = 1 + ga * (cabs(s.s11) ** 2 - st.deltaMag ** 2);
  const center = cscale(conj(c1), ga / denom);
  const radius =
    Math.sqrt(Math.max(1 - 2 * st.k * ga * m1221 + ga * ga * m1221 * m1221, 0)) / Math.abs(denom);
  return { center, radius };
}

export interface UnilateralGain {
  /** Gs,max = 1 / (1 - |S11|^2), Gl,max = 1 / (1 - |S22|^2), G0 = |S21|^2, all linear. */
  readonly gsMax: number;
  readonly glMax: number;
  readonly g0: number;
  /** Maximum unilateral transducer gain, linear. */
  readonly gtuMax: number;
  /** Unilateral figure of merit U and the error bounds of the unilateral approximation, linear. */
  readonly u: number;
  readonly errorLow: number;
  readonly errorHigh: number;
}

export function unilateralGain(s: SParameters): UnilateralGain {
  const m11 = cabs(s.s11) ** 2;
  const m22 = cabs(s.s22) ** 2;
  const gsMax = 1 / (1 - m11);
  const glMax = 1 / (1 - m22);
  const g0 = cabs(s.s21) ** 2;
  const u = (cabs(s.s11) * cabs(s.s22) * cabs(s.s12) * cabs(s.s21)) / ((1 - m11) * (1 - m22));
  return {
    gsMax,
    glMax,
    g0,
    gtuMax: gsMax * g0 * glMax,
    u,
    errorLow: 1 / (1 + u) ** 2,
    errorHigh: 1 / (1 - u) ** 2,
  };
}

/**
 * Unilateral constant gain circle for the source (`plane` 'source', uses S11)
 * or the load ('load', uses S22). `gLinear` is Gs or Gl, at most Gs,max or Gl,max.
 */
export function unilateralGainCircle(
  s: SParameters,
  plane: 'source' | 'load',
  gLinear: number,
): Circle {
  const sii = plane === 'source' ? s.s11 : s.s22;
  const m = cabs(sii) ** 2;
  const g = gLinear * (1 - m); // normalized gain g = G / G_max
  const denom = 1 - m * (1 - g);
  return {
    center: cscale(conj(sii), g / denom),
    radius: (Math.sqrt(Math.max(1 - g, 0)) * (1 - m)) / denom,
  };
}

/** Noise figure at a source reflection coefficient, dB. */
export function noiseFigureDb(n: NoiseParameters, gammaSource: Complex): number {
  const fmin = dbToLinear(n.nfMinDb);
  const d = cabs(csub(gammaSource, n.gammaOpt)) ** 2;
  const f =
    fmin +
    (4 * n.rn * d) / ((1 - cabs(gammaSource) ** 2) * cabs(cadd(complex(1), n.gammaOpt)) ** 2);
  return linearToDb(f);
}

/**
 * Constant noise figure circle for `nfDb` (must be at or above NFmin):
 * N = (F - Fmin) |1 + Gamma_opt|^2 / (4 rn), centre Gamma_opt / (1 + N),
 * radius sqrt(N^2 + N (1 - |Gamma_opt|^2)) / (1 + N).
 */
export function noiseCircle(n: NoiseParameters, nfDb: number): Circle {
  const f = dbToLinear(nfDb);
  const fmin = dbToLinear(n.nfMinDb);
  const big = (Math.max(f - fmin, 0) * cabs(cadd(complex(1), n.gammaOpt)) ** 2) / (4 * n.rn);
  const gm = cabs(n.gammaOpt) ** 2;
  return {
    center: cscale(n.gammaOpt, 1 / (1 + big)),
    radius: Math.sqrt(big * big + big * (1 - gm)) / (1 + big),
  };
}
