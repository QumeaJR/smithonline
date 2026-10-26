/**
 * Microstrip and coax: dimensions instead of ohms, and the microstrip as a
 * line on a real board.
 *
 * Portions derived from QuickSmith-Web, copyright 2017 Nathan Iyer, MIT license
 * (line.js, commit ca1b69e612f3e7c753591e2a09c38e19110136ef): the closed-form
 * coax model and the synthesis of a width by bisecting the analysis, which
 * gives an exact round trip (a width fed back through the analysis returns
 * the impedance asked for).
 *
 * The microstrip model (phase D4 of docs/08-depth-plan.md) is a line-by-line
 * port of scikit-rf 2.2.0, skrf/media/mline.py (class MLine with model
 * 'hammerstadjensen', disp 'kirschningjansen', diel 'djordjevicsvensson', no
 * compatibility mode): the static solution with the thickness correction, the
 * two dispersion formulas, the losses and the way the complex permittivity is
 * carried through them. Copyright (c) 2010 Alexander Arsenovic, copyright (c)
 * 2020 scikit-rf Developers, BSD 3-clause license (the text is in
 * THIRD_PARTY_NOTICES.md). Like scikit-rf, and unlike Qucs, which evaluates
 * them at the strip width w, the Kirschning-Jansen and Jansen-Kirschning
 * dispersion formulas are evaluated at the thickness-corrected width ratio ur
 * of the dielectric-filled line. Agreement with scikit-rf (the tests and the
 * oracle, 1e-9 and better) therefore shows that the port is faithful, not
 * that the model is right; the checks independent of scikit-rf are the review
 * of each formula against its published form (below) and Keysight ADS's MLIN
 * on scikit-rf's own regression data (packages/core/test/qa-d4-ads.test.ts:
 * within 0.014 dB and 0.26 degrees in S21 and 0.56 dB and 2.0 degrees in S11
 * from 0.2 to 20 GHz).
 *
 * - Static characteristic impedance and effective permittivity: Hammerstad
 *   and Jensen, "Accurate models for microstrip computer-aided design",
 *   IEEE MTT-S Symposium Digest 1980, pp. 407-409, with their strip thickness
 *   correction (u1 for the air-filled line, ur for the dielectric-filled one).
 *   The paper gives Z01 within 0.01 % of the exact value for u <= 1 and
 *   0.03 % up to u = 1000, eeff within 0.2 % for er < 128 and
 *   0.01 <= u <= 100. QuickSmith used Hammerstad's earlier, simpler formulas
 *   (1975), which differ from these by up to about 1 % and step by 0.6 % at
 *   W/h = 1; this model has no step.
 * - Frequency dispersion of eeff: Kirschning and Jansen, "Accurate model for
 *   effective dielectric constant of microstrip with validity up to
 *   millimetre-wave frequencies", Electronics Letters 18 (6), 1982,
 *   pp. 272-273 (better than 0.6 % for 0.1 <= u <= 100, 1 <= er <= 20,
 *   h / lambda0 <= 0.13, as the Qucs technical documentation quotes it), with
 *   the constants for f h in GHz mm as the Qucs technical documentation and
 *   qucsator give them.
 * - Frequency dispersion of Z0: Jansen and Kirschning, "Arguments and an
 *   accurate model for the power-current formulation of microstrip
 *   characteristic impedance", AEU 37, 1983, pp. 108-112, with R1, R2 and R6
 *   capped at 20 as qucsator does. The Qucs technical documentation gives its
 *   range as 0.1 <= u <= 10, 1 <= er <= 18, h / lambda0 <= 0.1 and no
 *   accuracy figure; the paper itself was not available to check it.
 * - Conductor loss: the Hammerstad-Jensen form Rs / (Z0 W) Ki Kr, with the
 *   current distribution factor Ki = exp(-1.2 (Z0 / eta0)^0.7) and the
 *   Hammerstad-Jensen roughness factor Kr = 1 + (2 / pi) atan(1.4 (D / delta)^2)
 *   (D the RMS roughness, delta the skin depth), which saturates at 2. No
 *   conductor loss without a copper thickness. The Groiss factor (a smoother
 *   rise, also saturating at 2) is not used: Hammerstad's is the one
 *   scikit-rf, Qucs and ADS's default use, so the oracle can check it. The
 *   form is good while the copper is thicker than about three skin depths
 *   (above about 30 MHz for 35 um copper); below that it is optimistic.
 * - Dielectric loss: pi er / (er - 1) (eeff - 1) / sqrt(eeff) tanD / lambda0,
 *   with er and tanD from the Djordjevic-Sarkar model (stackup.ts).
 * - The complex permittivity of the Djordjevic-Sarkar model is carried
 *   through the static and dispersion formulas, so Z0 and eeff are complex
 *   (the dielectric loss gives Z0 a small imaginary part, as it physically
 *   does); beta uses the real part of eeff.
 *
 * These are exactly the choices of scikit-rf's MLine with model =
 * 'hammerstadjensen', disp = 'kirschningjansen', diel = 'djordjevicsvensson'
 * and no compatibility mode (its ADS-like default), which the oracle
 * (tools/oracle) recomputes to show that the port is faithful.
 *
 * Not modelled: radiation, surface waves, coupling to other traces, the
 * conductor's internal inductance, discontinuities (steps, bends, tees, the
 * open end of a line element) and anything else a field solver would see.
 * Everything is in metres, hertz and ohms.
 */
import {
  cadd,
  ccosh,
  cdiv,
  cexp,
  clog,
  cmul,
  complex,
  cpow,
  cscale,
  csinh,
  csqrt,
  csub,
  type Complex,
} from './complex.js';
import { SPEED_OF_LIGHT } from './constants.js';
import type { Abcd } from './abcd.js';
import { COPPER_RESISTIVITY, isUsableStackup, stackupDielectric, type Stackup } from './stackup.js';

/** Vacuum permeability, H/m (CODATA 2022). */
export const MU0 = 1.25663706127e-6;

/** Impedance of free space, ohm: sqrt(mu0 / eps0), CODATA 2022. */
export const ETA0 = 376.730313412;

/** Substrate of a microstrip line; lengths in metres. */
export interface Microstrip {
  readonly medium: 'microstrip';
  /** Relative permittivity of the substrate. */
  readonly er: number;
  /** Substrate height. */
  readonly h: number;
  /** Conductor thickness, 0 for none. */
  readonly t?: number;
}

/**
 * A coax line. The characteristic impedance fixes the ratio of the two
 * diameters, so one of them is given and the other follows.
 */
export interface Coax {
  readonly medium: 'coax';
  /** Relative permittivity of the dielectric. */
  readonly er: number;
  /** Which diameter is given. */
  readonly given: 'inner' | 'outer';
  /** The given diameter: inner conductor, or outer conductor bore. */
  readonly diameter: number;
}

export type LineMedium = Microstrip | Coax;

/* ------------------------------------------------ complex helpers */

type N = Complex | number;
const C = (x: N): Complex => (typeof x === 'number' ? complex(x, 0) : x);
const add = (a: N, b: N): Complex => cadd(C(a), C(b));
const sub = (a: N, b: N): Complex => csub(C(a), C(b));
const mul = (a: N, b: N): Complex => cmul(C(a), C(b));
const div = (a: N, b: N): Complex => cdiv(C(a), C(b));
const pow = (a: N, b: N): Complex => {
  const base = C(a);
  // A real non-negative base to a real power stays exactly real.
  if (typeof b === 'number' && base.im === 0 && base.re >= 0) return complex(base.re ** b, 0);
  return cpow(base, b);
};
const exp = (a: N): Complex => cexp(C(a));
const log = (a: N): Complex => clog(C(a));
const sqrt = (a: N): Complex => csqrt(C(a));
/** numpy's minimum of a complex value and a real cap: lexicographic, the real part first. */
const capAt = (z: Complex, cap: number): Complex =>
  z.re < cap || (z.re === cap && z.im <= 0) ? z : complex(cap, 0);

/* ------------------------------------------------ static model */

/** Hammerstad-Jensen impedance of the air-filled line of width ratio u, ohm. */
function hjZ01(u: Complex): Complex {
  const fu = add(6, mul(2 * Math.PI - 6, exp(mul(-1, pow(div(30.666, u), 0.7528)))));
  return mul(ETA0 / (2 * Math.PI), log(add(div(fu, u), sqrt(add(1, pow(div(2, u), 2))))));
}

/** Hammerstad-Jensen effective permittivity of the zero-thickness line. */
function hjEeff(u: Complex, er: Complex): Complex {
  const u4 = pow(u, 4);
  const a = add(
    add(1, div(log(div(add(u4, pow(div(u, 52), 2)), add(u4, 0.432))), 49)),
    div(log(add(1, pow(div(u, 18.1), 3))), 18.7),
  );
  const b = mul(0.564, pow(div(sub(er, 0.9), add(er, 3)), 0.053));
  return add(
    div(add(er, 1), 2),
    mul(div(sub(er, 1), 2), pow(add(1, div(10, u)), mul(-1, mul(a, b)))),
  );
}

/** The static (zero frequency) solution of a microstrip. */
export interface MicrostripStatic {
  /** Characteristic impedance, ohm. */
  readonly z0: Complex;
  /** Effective permittivity. */
  readonly eeff: Complex;
  /** Width ratio of the dielectric-filled line with its thickness correction (W_eff / h). */
  readonly ur: Complex;
}

/**
 * Hammerstad-Jensen static solution for a strip u = W/h wide, of thickness
 * t/h, on a substrate of (complex) relative permittivity er.
 */
export function microstripStatic(u: number, er: Complex | number, tOverH = 0): MicrostripStatic {
  const e = C(er);
  const t = tOverH > 0 && Number.isFinite(tOverH) ? tOverH : 0;
  const du1 =
    t > 0
      ? (t / Math.PI) * Math.log(1 + ((4 * Math.E) / t) * Math.tanh(Math.sqrt(6.517 * u)) ** 2)
      : 0;
  const dur = mul(du1 / 2, add(1, div(1, ccosh(sqrt(sub(e, 1))))));
  const u1 = complex(u + du1, 0);
  const ur = add(u, dur);
  const zr = hjZ01(ur);
  const z1 = hjZ01(u1);
  const ee = hjEeff(ur, e);
  return { z0: div(zr, sqrt(ee)), eeff: mul(ee, pow(div(z1, zr), 2)), ur };
}

/**
 * Effective permittivity of a track u = W/h wide on substrate er (static,
 * Hammerstad-Jensen 1980): the field is partly in the substrate and partly in
 * the air above it, so the wave sees something between 1 and er.
 */
export function microstripEeff(u: number, er: number, tOverH = 0): number {
  return microstripStatic(u, er, tOverH).eeff.re;
}

/** Characteristic impedance of a track u = W/h wide on substrate er, ohm (static, Hammerstad-Jensen 1980). */
export function microstripZ0(u: number, er: number, tOverH = 0): number {
  return microstripStatic(u, er, tOverH).z0.re;
}

/** W/h in [1e-3, 1e3] where a falling impedance function meets z0; null out of reach. */
function bisectWidth(z0: number, zOf: (u: number) => number): number | null {
  if (!(z0 > 0) || !Number.isFinite(z0)) return null;
  // Bisection in log(W/h), over which the impedance is smooth and falling.
  let lo = Math.log(1e-3);
  let hi = Math.log(1e3);
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (zOf(Math.exp(mid)) > z0) lo = mid;
    else hi = mid;
  }
  const u = Math.exp((lo + hi) / 2);
  // Out of reach: the bisection ended on an end of the bracket.
  if (!(Math.abs(zOf(u) - z0) <= 1e-9 * z0)) return null;
  return u;
}

/**
 * The width ratio W/h that gives a wanted static impedance. Z0 falls as the
 * track widens, without a kink or a turning point, so a bisection cannot get
 * lost; the bracket spans everything buildable and then some.
 *
 * Null when the impedance is outside what the bracket (W/h from 0.001 to
 * 1000) can reach.
 */
export function microstripWidth(
  z0: number,
  er: number,
  tOverH = 0,
): { readonly wOverH: number; readonly eeff: number } | null {
  const wOverH = bisectWidth(z0, (u) => microstripZ0(u, er, tOverH));
  if (wOverH === null) return null;
  return { wOverH, eeff: microstripEeff(wOverH, er, tOverH) };
}

/* ------------------------------------------------ dispersion */

/** Kirschning-Jansen eeff(f) from the static eeff; fn = f h in GHz mm. */
export function kirschningJansenEeff(u: N, fn: number, er: N, eeff0: N): Complex {
  const P1 = add(
    add(0.27488, mul(0.6315 + 0.525 / (1 + 0.0157 * fn) ** 20, u)),
    mul(-0.065683, exp(mul(-8.7513, u))),
  );
  const P2 = mul(0.33622, sub(1, exp(mul(-0.03442, er))));
  const P3 = mul(mul(0.0363, exp(mul(-4.6, u))), 1 - Math.exp(-((fn / 38.7) ** 4.97)));
  const P4 = add(1, mul(2.751, sub(1, exp(mul(-1, pow(div(er, 15.916), 8))))));
  const P = mul(mul(P1, P2), pow(mul(add(0.1844, mul(P3, P4)), fn), 1.5763));
  return sub(er, div(sub(er, eeff0), add(1, P)));
}

/** Jansen-Kirschning Z0(f) from the static Z0 and both eeff values; fn = f h in GHz mm. */
export function jansenKirschningZ0(
  u: N,
  fn: number,
  er: N,
  eeff0: N,
  eeffF: N,
  z0Static: N,
): Complex {
  const R1 = capAt(mul(0.03891, pow(er, 1.4)), 20);
  const R2 = capAt(mul(0.2671, pow(u, 7)), 20);
  const R3 = mul(4.766, exp(mul(-3.228, pow(u, 0.641))));
  const R4 = add(0.016, pow(mul(0.0514, er), 4.524));
  const R5 = (fn / 28.843) ** 12;
  const R6 = capAt(mul(22.2, pow(u, 1.92)), 20);
  const R7 = sub(1.206, mul(mul(0.3144, exp(mul(-1, R1))), sub(1, exp(mul(-1, R2)))));
  const R8 = add(
    1,
    mul(1.275, sub(1, exp(mul(mul(mul(-0.004625, R3), pow(er, 1.674)), (fn / 18.365) ** 2.745)))),
  );
  const em1 = pow(sub(er, 1), 6);
  const R9 = mul(
    mul(
      div(mul(mul(5.086, R4), R5), add(0.3838, mul(0.386, R4))),
      div(exp(mul(-1, R6)), 1 + 1.2992 * R5),
    ),
    div(em1, add(1, mul(10, em1))),
  );
  const R10 = add(mul(0.00044, pow(er, 2.136)), 0.0184);
  const x11 = (fn / 19.47) ** 6;
  const R11 = x11 / (1 + 0.0962 * x11);
  const R12 = div(1, add(1, mul(0.00245, pow(u, 2))));
  const R13 = sub(mul(0.9408, pow(eeffF, R8)), 0.9603);
  const R14 = sub(mul(sub(0.9408, R9), pow(eeff0, R8)), 0.9603);
  const R15 = mul(mul(0.707, R10), (fn / 12.3) ** 1.097);
  const R16 = add(
    1,
    mul(mul(mul(0.0503, pow(er, 2)), R11), sub(1, exp(mul(-1, pow(div(u, 15), 6))))),
  );
  const R17 = mul(
    R7,
    sub(1, mul(div(mul(1.1241, R12), R16), exp(sub(-0.026 * fn ** 1.15656, R15)))),
  );
  return mul(z0Static, pow(div(R13, R14), R17));
}

/* ------------------------------------------------ the line on a board */

/**
 * The range inside which both dispersion formulas are stated to hold (see
 * MicrostripProperties.inRange).
 */
export const MICROSTRIP_RANGE = { uMin: 0.1, uMax: 10, erMax: 18, hOverLambdaMax: 0.1 } as const;

/**
 * The width of a microstrip the model takes, m: from 1 um to 1 m, and W/h from
 * 0.001 to 1000 (the bracket of the width search). Narrower strips give a
 * conductor loss without bound; outside the ratio the formulas are far beyond
 * anything they were fitted to.
 */
export const MICROSTRIP_WIDTH = { min: 1e-6, max: 1, uMin: 1e-3, uMax: 1e3 } as const;

/** True when a strip of this width on this stackup is inside MICROSTRIP_WIDTH. */
export function isUsableWidth(width: number, stackup: Stackup): boolean {
  const u = width / stackup.h;
  return (
    Number.isFinite(width) &&
    width >= MICROSTRIP_WIDTH.min &&
    width <= MICROSTRIP_WIDTH.max &&
    u >= MICROSTRIP_WIDTH.uMin &&
    u <= MICROSTRIP_WIDTH.uMax
  );
}

/**
 * The physical length of a microstrip element, m: 0 to 1 km. One rule for every way a
 * length is made (the field, the tune slider, a chart drag, Dimensions, a new element, a move
 * to another stackup, Optimize band, centring) and for every reader (share links, design files,
 * the autosave), so the application never makes a line its own readers refuse. The readers
 * took 10 m before 0.6.0's third QA round, which the application itself went past (a quarter
 * wave at 3.5 MHz on FR-4 is 11.8 m); a kilometre covers a quarter wave down to about 40 kHz
 * and still bounds what a link may carry.
 */
export const MICROSTRIP_LENGTH = { min: 0, max: 1000 } as const;

/** True when a microstrip element may have this physical length (MICROSTRIP_LENGTH). */
export function isUsableMicrostripLength(length: number): boolean {
  return (
    Number.isFinite(length) && length >= MICROSTRIP_LENGTH.min && length <= MICROSTRIP_LENGTH.max
  );
}

/** A microstrip length pinned inside MICROSTRIP_LENGTH (a slider or a drag past the end stops there). */
export function clampMicrostripLength(length: number): number {
  return Math.min(MICROSTRIP_LENGTH.max, Math.max(MICROSTRIP_LENGTH.min, length));
}

/** A microstrip line at one frequency. */
export interface MicrostripProperties {
  readonly frequency: number;
  /** Characteristic impedance at the frequency, ohm. */
  readonly z0: Complex;
  /** Effective permittivity at the frequency. */
  readonly eeff: Complex;
  /** The static (quasi-static) solution, without dispersion. */
  readonly z0Static: Complex;
  readonly eeffStatic: Complex;
  /** The substrate's permittivity at the frequency (Djordjevic-Sarkar). */
  readonly er: Complex;
  /** Conductor loss, Np/m. */
  readonly alphaConductor: number;
  /** Dielectric loss, Np/m. */
  readonly alphaDielectric: number;
  /** Phase constant, rad/m. */
  readonly beta: number;
  /** alpha + j beta, 1/m. */
  readonly gamma: Complex;
  /** W/h. */
  readonly u: number;
  /**
   * True inside the stated ranges of both dispersion formulas:
   * 0.1 <= W/h <= 10, er <= 18 and h / lambda0 <= 0.1 (the Jansen-Kirschning
   * Z0 range as the Qucs technical documentation gives it; the
   * Kirschning-Jansen eeff range, 0.1 <= W/h <= 100, er <= 20, h / lambda0 <=
   * 0.13, holds within it).
   */
  readonly inRange: boolean;
}

/**
 * The microstrip of width w (m) on the stackup at frequency f (Hz): Z0 and
 * eeff with dispersion, and the losses. At f = 0 the static solution without
 * loss.
 */
export function microstripProperties(
  stackup: Stackup,
  width: number,
  f: number,
): MicrostripProperties {
  const { h, t } = stackup;
  const fp = f > 0 ? f : 0;
  const u = width / h;
  const diel = stackupDielectric(stackup, fp);
  const st = microstripStatic(u, diel.er, t / h);
  const fn = fp * h * 1e-6;
  const eeff = kirschningJansenEeff(st.ur, fn, diel.er, st.eeff);
  const z0 = jansenKirschningZ0(st.ur, fn, diel.er, st.eeff, eeff, st.z0);
  let alphaC = 0;
  let alphaD = 0;
  if (fp > 0) {
    const z0r = z0.re;
    if (t > 0) {
      const rho = stackup.rho ?? COPPER_RESISTIVITY;
      const delta = Math.sqrt(rho / (Math.PI * fp * MU0));
      const rs = rho / delta;
      const ki = Math.exp(-1.2 * (z0r / ETA0) ** 0.7);
      const kr = 1 + (2 / Math.PI) * Math.atan(1.4 * (stackup.roughness / delta) ** 2);
      alphaC = (rs / (z0r * width)) * ki * kr;
    }
    const erR = diel.er.re;
    const eR = eeff.re;
    const lambda0 = SPEED_OF_LIGHT / fp;
    alphaD = (((Math.PI * erR) / (erR - 1)) * (eR - 1) * diel.tanD) / (Math.sqrt(eR) * lambda0);
  }
  const beta = (2 * Math.PI * fp * Math.sqrt(eeff.re)) / SPEED_OF_LIGHT;
  const hOverLambda = (h * fp) / SPEED_OF_LIGHT;
  return {
    frequency: f,
    z0,
    eeff,
    z0Static: st.z0,
    eeffStatic: st.eeff,
    er: diel.er,
    alphaConductor: alphaC,
    alphaDielectric: alphaD,
    beta,
    gamma: complex(alphaC + alphaD, beta),
    u,
    inRange:
      u >= MICROSTRIP_RANGE.uMin &&
      u <= MICROSTRIP_RANGE.uMax &&
      stackup.er <= MICROSTRIP_RANGE.erMax &&
      hOverLambda <= MICROSTRIP_RANGE.hOverLambdaMax,
  };
}

/** The two-port of a line of characteristic impedance zc and propagation gamma, length l. */
export function lineAbcdOf(zc: Complex, gamma: Complex, length: number): Abcd {
  const gl = cscale(gamma, length);
  const ch = ccosh(gl);
  const sh = csinh(gl);
  return { a: ch, b: cmul(zc, sh), c: cdiv(sh, zc), d: ch };
}

/**
 * The ABCD matrix of a microstrip of width w and physical length l (m) on the
 * stackup at frequency f:
 *   [ cosh(gl)        Zc sinh(gl) ]
 *   [ sinh(gl) / Zc   cosh(gl)    ]
 * with the complex, frequency-dependent Zc and gamma of microstripProperties.
 */
export function microstripAbcd(stackup: Stackup, width: number, length: number, f: number): Abcd {
  const p = microstripProperties(stackup, width, f);
  return lineAbcdOf(p.z0, p.gamma, length);
}

/**
 * The track width (m) whose characteristic impedance (real part) is z0 at
 * frequency f on the stackup, dispersion included. Null out of reach (W/h
 * outside 0.001 to 1000, or a width outside 1 um to 1 m) and for a stackup
 * the model cannot use (isUsableStackup), whose eeff can be below 1 or
 * negative.
 */
export function microstripWidthAt(stackup: Stackup, z0: number, f: number): number | null {
  if (!isUsableStackup(stackup) || !(f >= 0) || !Number.isFinite(f)) return null;
  const u = bisectWidth(z0, (x) => microstripProperties(stackup, x * stackup.h, f).z0.re);
  if (u === null) return null;
  const width = u * stackup.h;
  return isUsableWidth(width, stackup) ? width : null;
}

/** Track width, length and line data for a wanted line on the stackup. */
export interface MicrostripDimensions {
  /** Track width, m. */
  readonly width: number;
  readonly wOverH: number;
  /** Physical length, m, for the electrical length at f with the dispersed eeff. */
  readonly length: number;
  /** The line at f (dispersion and loss). */
  readonly at: MicrostripProperties;
  /** Loss of the whole line at f, dB. */
  readonly lossDb: number;
}

/**
 * The microstrip that realizes a line of characteristic impedance z0 and
 * electrical length `wavelengths` at frequency f on the stackup: the width
 * whose dispersed Z0 (real part) is z0 at f, and the length from the dispersed
 * eeff at f. Null when an input is not usable or the width is out of reach.
 */
export function microstripDimensions(
  stackup: Stackup,
  z0: number,
  wavelengths: number,
  f: number,
): MicrostripDimensions | null {
  if (!(f > 0) || !Number.isFinite(f) || !(wavelengths >= 0) || !Number.isFinite(wavelengths)) {
    return null;
  }
  if (!isUsableStackup(stackup)) return null;
  const width = microstripWidthAt(stackup, z0, f);
  if (width === null) return null;
  const at = microstripProperties(stackup, width, f);
  const length = lengthFromWavelengths(wavelengths, f, at.eeff.re);
  return {
    width,
    wOverH: width / stackup.h,
    length,
    at,
    lossDb: (20 / Math.LN10) * at.gamma.re * length,
  };
}

/** Static capacitance per metre of a microstrip of width w on the stackup (er at fRef), F/m. */
export function microstripCapacitancePerMetre(stackup: Stackup, width: number): number {
  const st = microstripStatic(width / stackup.h, stackup.er, stackup.t / stackup.h);
  return Math.sqrt(st.eeff.re) / (SPEED_OF_LIGHT * st.z0.re);
}

/**
 * Capacitance to ground of a rectangular land (pad) of the given length and
 * width (m) on the stackup, F: the parallel plate capacitance plus the
 * fringing at its four edges,
 *
 *   C = C'(W) L + C'(L) W - eps0 er W L / h,
 *
 * where C'(x) = sqrt(eeff) / (c Z0) is the static capacitance per metre of a
 * microstrip x wide (Hammerstad-Jensen, with the copper thickness): C'(W) L
 * holds the plate and the fringing at the two long edges, C'(L) W the plate
 * and the fringing at the two short edges, and the plate, counted twice, is
 * taken off once. For a land much larger than h it is the parallel plate plus
 * the edge fringing of a wide microstrip along the perimeter. Quasi-static, at
 * the stackup's er; no coupling to the other land, traces or a ground pour.
 *
 * For lands much smaller than h that edge estimate is low (it leaves out the
 * field above and around the land): without copper thickness a land 0.3 mm
 * square on 1.6 mm FR-4 comes out 28 % and a 0402 land (0.5 x 0.6 mm) 19 %
 * below the estimate of an isolated thin disc of equal area at the
 * air-dielectric interface with the ground plane's image,
 *
 *   C0 = 8 eps0 (er + 1) / 2 r,  C = C0 / (1 - C0 / (4 pi eps0 (er + 1) / 2 2h)),
 *
 * r = sqrt(L W / pi). For a land whose equal-area side sqrt(L W) is below h
 * the larger of the two estimates is taken. Both remain estimates: the disc
 * puts the whole half-space above the land at (er + 1) / 2 and treats the
 * ground plane as a single image, so a small land is still uncertain by
 * perhaps 10 to 20 %; a field solver is the reference. Where sqrt(L W) passes
 * h the disc gives way to the edge estimate, a step of at most 1.6 % on the
 * presets (packages/core/test/board.test.ts).
 */
export function landCapacitance(stackup: Stackup, length: number, width: number): number {
  const { h, er } = stackup;
  if (!(length > 0) || !(width > 0) || !(h > 0) || !(er >= 1)) return 0;
  const eps0 = 1 / (MU0 * SPEED_OF_LIGHT * SPEED_OF_LIGHT);
  const edge =
    microstripCapacitancePerMetre(stackup, width) * length +
    microstripCapacitancePerMetre(stackup, length) * width -
    (eps0 * er * width * length) / h;
  if (!(Math.sqrt(length * width) < h)) return edge;
  return Math.max(edge, discLandCapacitance(stackup, length, width));
}

/**
 * The isolated-disc estimate of a land's capacitance to ground, F: a thin disc
 * of the land's area at the air-dielectric interface, C0 = 8 eps_a r with
 * eps_a = eps0 (er + 1) / 2, raised by its image in the ground plane 2h away,
 * C = C0 / (1 - C0 / (4 pi eps_a 2h)). Meant for lands smaller than h (see
 * landCapacitance); 0 where the image term leaves no physical value.
 */
export function discLandCapacitance(stackup: Stackup, length: number, width: number): number {
  const { h, er } = stackup;
  if (!(length > 0) || !(width > 0) || !(h > 0) || !(er >= 1)) return 0;
  const eps0 = 1 / (MU0 * SPEED_OF_LIGHT * SPEED_OF_LIGHT);
  const ea = (eps0 * (er + 1)) / 2;
  const c0 = 8 * ea * Math.sqrt((length * width) / Math.PI);
  const den = 1 - c0 / (4 * Math.PI * ea * 2 * h);
  return den > 0 ? c0 / den : 0;
}

/**
 * Coax is fully filled, so the wave sees er itself and the impedance comes
 * out in closed form both ways. The ratio is outer bore over inner diameter;
 * a 50 ohm air line is the familiar 2.30.
 */
export function coaxZ0(ratio: number, er: number): number {
  return (ETA0 / (2 * Math.PI * Math.sqrt(er))) * Math.log(ratio);
}

/** Outer bore over inner diameter for a wanted impedance. */
export function coaxRatio(
  z0: number,
  er: number,
): { readonly ratio: number; readonly eeff: number } {
  return { ratio: Math.exp((z0 * 2 * Math.PI * Math.sqrt(er)) / ETA0), eeff: er };
}

/** Metres of line for a wanted electrical length in wavelengths, at frequency f (Hz). */
export function lengthFromWavelengths(wavelengths: number, f: number, eeff: number): number {
  return (wavelengths * SPEED_OF_LIGHT) / (f * Math.sqrt(eeff));
}

/** Electrical length in wavelengths of a physical length, so a board that exists can be read off. */
export function wavelengthsFromLength(metres: number, f: number, eeff: number): number {
  return (metres * f * Math.sqrt(eeff)) / SPEED_OF_LIGHT;
}

/** Velocity factor of a line with effective permittivity eeff. */
export function velocityFactor(eeff: number): number {
  return 1 / Math.sqrt(eeff);
}

/** The dimensions of one line or stub on a medium. */
export interface LineDimensions {
  readonly medium: 'microstrip' | 'coax';
  /** Effective relative permittivity the wave sees. */
  readonly eeff: number;
  /** Physical length in metres at the given electrical length and frequency. */
  readonly length: number;
  /** Microstrip: track width, m. */
  readonly width?: number;
  /** Microstrip: width over substrate height. */
  readonly wOverH?: number;
  /** Coax: inner conductor diameter, m. */
  readonly inner?: number;
  /** Coax: outer conductor bore, m. */
  readonly outer?: number;
  /** Coax: outer over inner diameter. */
  readonly ratio?: number;
}

/**
 * Track width (or coax diameters) and physical length for a line of
 * characteristic impedance z0 and electrical length `wavelengths` at
 * frequency f. Null when an input is not a usable positive number.
 */
export function lineDimensions(
  medium: LineMedium,
  z0: number,
  wavelengths: number,
  f: number,
): LineDimensions | null {
  const ok = (v: number): boolean => Number.isFinite(v) && v > 0;
  if (
    !ok(z0) ||
    !ok(f) ||
    !Number.isFinite(wavelengths) ||
    wavelengths < 0 ||
    !(medium.er >= 1) ||
    !Number.isFinite(medium.er)
  ) {
    return null;
  }
  if (medium.medium === 'microstrip') {
    if (!ok(medium.h)) return null;
    const t = medium.t ?? 0;
    if (!(t >= 0) || !Number.isFinite(t)) return null;
    const solved = microstripWidth(z0, medium.er, t / medium.h);
    if (!solved) return null;
    const { wOverH, eeff } = solved;
    return {
      medium: 'microstrip',
      eeff,
      length: lengthFromWavelengths(wavelengths, f, eeff),
      width: wOverH * medium.h,
      wOverH,
    };
  }
  if (!ok(medium.diameter)) return null;
  const { ratio, eeff } = coaxRatio(z0, medium.er);
  if (!Number.isFinite(ratio) || !(ratio > 1)) return null;
  const outer = medium.given === 'outer' ? medium.diameter : medium.diameter * ratio;
  const inner = medium.given === 'inner' ? medium.diameter : medium.diameter / ratio;
  return {
    medium: 'coax',
    eeff,
    length: lengthFromWavelengths(wavelengths, f, eeff),
    inner,
    outer,
    ratio,
  };
}
