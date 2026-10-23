/**
 * Microstrip and coax: dimensions instead of ohms.
 *
 * Portions derived from QuickSmith-Web, copyright 2017 Nathan Iyer, MIT license
 * (line.js, commit ca1b69e612f3e7c753591e2a09c38e19110136ef): Hammerstad's
 * quasi-static microstrip model, the closed-form coax model and the synthesis
 * of a width by bisecting the analysis, which gives an exact round trip
 * (a width fed back through the analysis returns the impedance asked for).
 *
 * Differences from line.js:
 * - Lengths use the true speed of light (the same SPEED_OF_LIGHT as
 *   physicalLength in elements.ts), not QuickSmith's 299 800 000 m/s, so the
 *   length shown with a line's dimensions equals the line's own physical
 *   length. The two differ by 25 parts per million.
 * - An optional conductor thickness t widens the track electrically with the
 *   Hammerstad-Jensen effective width correction. With t = 0 (the default) the
 *   model is exactly line.js.
 *
 * Everything is in metres, hertz and ohms.
 */
import { SPEED_OF_LIGHT } from './elements.js';

/** Impedance of free space, ohm. */
export const ETA0 = 376.730313668;

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

/** Width extension of a track of ratio u = W/h by its thickness t/h, as ratio of h. */
function thicknessExtension(u: number, er: number, tOverH: number): number {
  if (!(tOverH > 0)) return 0;
  const x = Math.sqrt(6.517 * u);
  const coth = 1 / Math.tanh(x);
  const du1 = (tOverH / Math.PI) * Math.log(1 + (4 * Math.E) / (tOverH * coth * coth));
  return 0.5 * (1 + 1 / Math.cosh(Math.sqrt(Math.max(er - 1, 0)))) * du1;
}

/**
 * Effective permittivity of a track u = W/h wide on substrate er: the field
 * is partly in the substrate and partly in the air above it, so the wave sees
 * something between 1 and er. A narrow track leans further into the air.
 */
export function microstripEeff(u: number, er: number, tOverH = 0): number {
  const ue = u + thicknessExtension(u, er, tOverH);
  let f = (1 + 12 / ue) ** -0.5;
  if (ue < 1) f += 0.04 * (1 - ue) * (1 - ue);
  return (er + 1) / 2 + ((er - 1) / 2) * f;
}

/** Characteristic impedance of a track u = W/h wide on substrate er, ohm. */
export function microstripZ0(u: number, er: number, tOverH = 0): number {
  const ue = u + thicknessExtension(u, er, tOverH);
  const e = microstripEeff(u, er, tOverH);
  if (ue <= 1) return (ETA0 / (2 * Math.PI * Math.sqrt(e))) * Math.log(8 / ue + ue / 4);
  return ETA0 / (Math.sqrt(e) * (ue + 1.393 + 0.667 * Math.log(ue + 1.444)));
}

/**
 * The width ratio W/h that gives a wanted impedance. Z0 falls as the track
 * widens, without a kink or a turning point, so a bisection cannot get lost;
 * the bracket spans everything buildable and then some.
 *
 * Null when the impedance is outside what the bracket (W/h from 0.001 to 1000)
 * can reach. The two Hammerstad branches also leave a small gap in Z0 at
 * W/h = 1 (under 0.6 %); an impedance inside that gap is answered with the
 * nearest width, so the round trip is exact except within that gap.
 */
export function microstripWidth(
  z0: number,
  er: number,
  tOverH = 0,
): { readonly wOverH: number; readonly eeff: number } | null {
  let lo = 1e-3;
  let hi = 1e3;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (microstripZ0(mid, er, tOverH) > z0) lo = mid;
    else hi = mid;
  }
  const wOverH = (lo + hi) / 2;
  // Out of reach: the bisection ended on an end of the bracket. The tolerance is wide enough
  // for the step at W/h = 1 and far below the error of any out-of-range answer.
  if (!(Math.abs(microstripZ0(wOverH, er, tOverH) - z0) <= 0.01 * z0)) return null;
  return { wOverH, eeff: microstripEeff(wOverH, er, tOverH) };
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
