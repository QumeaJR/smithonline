/**
 * Mismatch towards a design target, not only towards Z0.
 *
 * `gammaTowards` is the power-wave reflection coefficient with the target's
 * conjugate as reference, (z - t) / (z + t*). It is zero exactly when z is
 * the target and equals the ordinary |Gamma| whenever the target is real,
 * so VSWR numbers stay the familiar ones at the chart centre.
 */
import { cabs, cadd, conj, csub, type Complex } from '../complex.js';

/** |Gamma| of z referred to the target; 0 when z is the target. */
export function gammaTowards(z: Complex, target: Complex): number {
  const g = cabs(csub(z, target)) / cabs(cadd(z, conj(target)));
  return Number.isFinite(g) ? g : 1;
}

/** VSWR of z referred to the target; Infinity for |Gamma| >= 1. */
export function vswrTowards(z: Complex, target: Complex): number {
  const g = gammaTowards(z, target);
  return g >= 1 ? Infinity : (1 + g) / (1 - g);
}
