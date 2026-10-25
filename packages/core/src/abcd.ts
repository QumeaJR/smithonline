/**
 * ABCD (transmission) two-port matrices.
 *
 * Port 1 faces the source, port 2 faces the load, so that
 * Zin = (A Zload + B) / (C Zload + D).
 *
 * Portions derived from QuickSmith-Web, copyright 2017 Nathan Iyer, MIT license
 * (engine.js, commit ca1b69e612f3e7c753591e2a09c38e19110136ef): cascade,
 * throughABCD and the transmission (S21) derivation.
 */
import {
  cabs,
  cadd,
  cargDeg,
  cdiv,
  cinv,
  cmul,
  complex,
  csub,
  ONE,
  ZERO,
  type Complex,
} from './complex.js';

export interface Abcd {
  readonly a: Complex;
  readonly b: Complex;
  readonly c: Complex;
  readonly d: Complex;
}

/**
 * True when det = AD - BC is 1 to within its own rounding error. Then S12 =
 * 2 det / Delta is no more accurate than S21 = 2 / Delta and often much less:
 * the determinant is the difference of two products, and through a lossy
 * line both grow as exp(2 alpha l), so beyond about 160 dB of line loss it
 * has no correct digit left (it rounds to 0 where it is 1). A reciprocal
 * network has det = 1 exactly, and this is how such an input is recognized
 * from its numbers alone; a non-reciprocal one, whose determinant differs
 * from 1 by more than the rounding, keeps the general formula.
 */
export function reciprocalWithinRounding(a: Complex, b: Complex, c: Complex, d: Complex): boolean {
  const ad = cmul(a, d);
  const bc = cmul(b, c);
  const det = csub(ad, bc);
  // Each product carries a few units of rounding of its own size; 64 units is generous.
  const rounding = 64 * Number.EPSILON * (cabs(ad) + cabs(bc));
  return cabs(csub(det, complex(1))) <= Math.max(rounding, 4 * Number.EPSILON);
}

export const IDENTITY: Abcd = { a: ONE, b: ZERO, c: ZERO, d: ONE };

/** A series impedance. */
export function seriesAbcd(z: Complex): Abcd {
  return { a: ONE, b: z, c: ZERO, d: ONE };
}

/** A shunt admittance. */
export function shuntAbcd(y: Complex): Abcd {
  return { a: ONE, b: ZERO, c: y, d: ONE };
}

/** Matrix product m * n: n is nearer the load, m nearer the source. */
export function cascade(m: Abcd, n: Abcd): Abcd {
  return {
    a: cadd(cmul(m.a, n.a), cmul(m.b, n.c)),
    b: cadd(cmul(m.a, n.b), cmul(m.b, n.d)),
    c: cadd(cmul(m.c, n.a), cmul(m.d, n.c)),
    d: cadd(cmul(m.c, n.b), cmul(m.d, n.d)),
  };
}

/** Apply one two-port to the impedance behind it: Zin = (A Z + B) / (C Z + D). */
export function throughAbcd(m: Abcd, z: Complex): Complex {
  return cdiv(cadd(cmul(m.a, z), m.b), cadd(cmul(m.c, z), m.d));
}

export interface Transmission {
  /** |S21| in dB; -Infinity when the load absorbs nothing. */
  readonly db: number;
  readonly mag: number;
  readonly angleDeg: number;
}

/**
 * Transducer gain S21 from a Z0 source through the two-port into the actual
 * load. With V2 held at 1 volt: I2 = YL, V1 = A + B YL, I1 = C + D YL and the
 * source EMF is Vs = V1 + I1 Z0. Then |S21|^2 = 4 Z0 Re(YL) / |Vs|^2.
 */
export function transmissionS21(m: Abcd, zLoad: Complex, z0: number): Transmission {
  if (!(zLoad.re > 0)) return { db: -Infinity, mag: 0, angleDeg: 0 };
  const yl = cinv(zLoad);
  const v1 = cadd(m.a, cmul(m.b, yl));
  const i1 = cadd(m.c, cmul(m.d, yl));
  const vs = cadd(v1, cmul(i1, complex(z0)));
  const gl = yl.re;
  if (!(gl > 0)) return { db: -Infinity, mag: 0, angleDeg: 0 };
  const mag = (2 * Math.sqrt(z0 * gl)) / cabs(vs);
  return { db: 20 * Math.log10(mag), mag, angleDeg: -cargDeg(vs) };
}
