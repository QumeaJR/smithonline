/**
 * Impedance, admittance and reflection coefficient conversions for a real
 * reference impedance Z0, plus the derived values shown for a datapoint.
 *
 * Portions derived from QuickSmith-Web, copyright 2017 Nathan Iyer, MIT license
 * (engine.js, commit ca1b69e612f3e7c753591e2a09c38e19110136ef): gammaToZ,
 * zToGamma and the VSWR, return loss and mismatch loss expressions.
 */
import { cabs, cadd, cdiv, cinv, cmul, complex, csub, cargDeg, ONE, type Complex } from './complex.js';

/** Gamma = (Z - Z0) / (Z + Z0). */
export function zToGamma(z: Complex, z0: number): Complex {
  return cdiv(csub(z, complex(z0)), cadd(z, complex(z0)));
}

/** Z = Z0 (1 + Gamma) / (1 - Gamma). */
export function gammaToZ(gamma: Complex, z0: number): Complex {
  return cmul(complex(z0), cdiv(cadd(ONE, gamma), csub(ONE, gamma)));
}

/** Y = 1 / Z. */
export function zToY(z: Complex): Complex {
  return cinv(z);
}

/** Z = 1 / Y. */
export function yToZ(y: Complex): Complex {
  return cinv(y);
}

/** Gamma = (Y0 - Y) / (Y0 + Y) with Y0 = 1 / Z0. */
export function yToGamma(y: Complex, z0: number): Complex {
  const y0 = complex(1 / z0);
  return cdiv(csub(y0, y), cadd(y0, y));
}

/** Y = Y0 (1 - Gamma) / (1 + Gamma). */
export function gammaToY(gamma: Complex, z0: number): Complex {
  return cmul(complex(1 / z0), cdiv(csub(ONE, gamma), cadd(ONE, gamma)));
}

/** z = Z / Z0. */
export function normalize(z: Complex, z0: number): Complex {
  return complex(z.re / z0, z.im / z0);
}

/** Z = z Z0. */
export function denormalize(z: Complex, z0: number): Complex {
  return complex(z.re * z0, z.im * z0);
}

/** VSWR = (1 + |Gamma|) / (1 - |Gamma|); Infinity for |Gamma| >= 1. */
export function vswr(gammaMag: number): number {
  return gammaMag >= 1 ? Infinity : (1 + gammaMag) / (1 - gammaMag);
}

/** Return loss in dB as a positive number, -20 log10 |Gamma|; Infinity for a perfect match. */
export function returnLossDb(gammaMag: number): number {
  return gammaMag <= 0 ? Infinity : -20 * Math.log10(gammaMag);
}

/** Mismatch loss in dB as a positive number, -10 log10 (1 - |Gamma|^2). */
export function mismatchLossDb(gammaMag: number): number {
  return gammaMag >= 1 ? Infinity : -10 * Math.log10(1 - gammaMag * gammaMag) + 0;
}

/** Q = |X| / R of an impedance; Infinity on the chart rim (R = 0). */
export function qFactor(z: Complex): number {
  return z.re === 0 ? Infinity : Math.abs(z.im) / z.re;
}

/** Everything the cursor window shows for one impedance. */
export interface DatapointInfo {
  readonly z: Complex;
  readonly y: Complex;
  readonly gamma: Complex;
  readonly gammaMag: number;
  readonly gammaAngleDeg: number;
  readonly vswr: number;
  readonly returnLossDb: number;
  readonly mismatchLossDb: number;
  readonly q: number;
}

export function datapointInfo(z: Complex, z0: number): DatapointInfo {
  const gamma = zToGamma(z, z0);
  const gammaMag = cabs(gamma);
  return {
    z,
    y: zToY(z),
    gamma,
    gammaMag,
    gammaAngleDeg: gammaMag === 0 ? 0 : cargDeg(gamma),
    vswr: vswr(gammaMag),
    returnLossDb: returnLossDb(gammaMag),
    mismatchLossDb: mismatchLossDb(gammaMag),
    q: qFactor(z),
  };
}
