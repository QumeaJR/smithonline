/**
 * Network parameter conversions: S to and from Z, Y, H and ABCD, normalized
 * to the reference impedance or in ohm and siemens.
 *
 * Z and Y work for any port count (matrix inversion, n up to a handful), H
 * and ABCD are two-port only. The formulas are the textbook ones tabulated
 * in HP application note 95-1 (S-parameter design) and Pozar, "Microwave
 * Engineering", table 4.2, for equal reference impedances at both ports.
 * Every function takes and returns row-major matrices of `Complex`:
 * `m[i * n + j]` is element (i + 1, j + 1).
 *
 * Normalized values are divided or multiplied by the reference impedance
 * z0: z = Z / z0, y = Y z0, h11 = H11 / z0, h22 = H22 z0, B = B / z0 and
 * C = C z0 (A, D, h12 and h21 are dimensionless).
 */
import {
  cadd,
  cdiv,
  cmul,
  complex,
  cscale,
  csub,
  cabs,
  ONE,
  ZERO,
  type Complex,
} from './complex.js';
import { reciprocalWithinRounding } from './abcd.js';

export class NetworkParameterError extends Error {
  override readonly name = 'NetworkParameterError';
}

export type NetworkParameter = 'S' | 'Z' | 'Y' | 'H' | 'ABCD';

/** Pivots below this fraction of the largest entry count as zero. */
const SINGULAR = 1e-12;

function identity(n: number): Complex[] {
  const m: Complex[] = [];
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) m.push(i === j ? ONE : ZERO);
  return m;
}

function matMul(a: readonly Complex[], b: readonly Complex[], n: number): Complex[] {
  const out: Complex[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      let sum = ZERO;
      for (let k = 0; k < n; k++)
        sum = cadd(sum, cmul(a[i * n + k] as Complex, b[k * n + j] as Complex));
      out.push(sum);
    }
  }
  return out;
}

/** Inverse by Gauss-Jordan elimination with partial pivoting; null when singular. */
function matInverse(m: readonly Complex[], n: number): Complex[] | null {
  const a = m.map((c) => ({ ...c }) as { re: number; im: number });
  const inv = identity(n).map((c) => ({ ...c }) as { re: number; im: number });
  const scale = Math.max(...m.map((c) => cabs(c)), 0);
  if (scale === 0) return null;
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (cabs(a[r * n + col] as Complex) > cabs(a[pivot * n + col] as Complex)) pivot = r;
    }
    if (cabs(a[pivot * n + col] as Complex) < SINGULAR * scale) return null;
    if (pivot !== col) {
      for (let j = 0; j < n; j++) {
        [a[col * n + j], a[pivot * n + j]] = [
          a[pivot * n + j] as Complex,
          a[col * n + j] as Complex,
        ];
        [inv[col * n + j], inv[pivot * n + j]] = [
          inv[pivot * n + j] as Complex,
          inv[col * n + j] as Complex,
        ];
      }
    }
    const p = a[col * n + col] as Complex;
    for (let j = 0; j < n; j++) {
      a[col * n + j] = cdiv(a[col * n + j] as Complex, p);
      inv[col * n + j] = cdiv(inv[col * n + j] as Complex, p);
    }
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = a[r * n + col] as Complex;
      if (f.re === 0 && f.im === 0) continue;
      for (let j = 0; j < n; j++) {
        a[r * n + j] = csub(a[r * n + j] as Complex, cmul(f, a[col * n + j] as Complex));
        inv[r * n + j] = csub(inv[r * n + j] as Complex, cmul(f, inv[col * n + j] as Complex));
      }
    }
  }
  return inv;
}

function plus(a: readonly Complex[], b: readonly Complex[]): Complex[] {
  return a.map((c, i) => cadd(c, b[i] as Complex));
}

function minus(a: readonly Complex[], b: readonly Complex[]): Complex[] {
  return a.map((c, i) => csub(c, b[i] as Complex));
}

function portsOf(m: readonly Complex[]): number {
  const n = Math.round(Math.sqrt(m.length));
  if (n < 1 || n * n !== m.length) {
    throw new NetworkParameterError(`A matrix of ${m.length} values is not square`);
  }
  return n;
}

/** Normalized impedance matrix z = (I + S)(I - S)^-1. */
export function sToZ(s: readonly Complex[]): Complex[] {
  const n = portsOf(s);
  const i = identity(n);
  const inv = matInverse(minus(i, s), n);
  if (!inv) {
    throw new NetworkParameterError('I - S is singular: the network has no impedance matrix');
  }
  return matMul(plus(i, s), inv, n);
}

/** Normalized admittance matrix y = (I - S)(I + S)^-1. */
export function sToY(s: readonly Complex[]): Complex[] {
  const n = portsOf(s);
  const i = identity(n);
  const inv = matInverse(plus(i, s), n);
  if (!inv) {
    throw new NetworkParameterError('I + S is singular: the network has no admittance matrix');
  }
  return matMul(minus(i, s), inv, n);
}

/** S = (z - I)(z + I)^-1 from the normalized impedance matrix. */
export function zToS(z: readonly Complex[]): Complex[] {
  const n = portsOf(z);
  const i = identity(n);
  const inv = matInverse(plus(z, i), n);
  if (!inv) throw new NetworkParameterError('z + I is singular');
  return matMul(minus(z, i), inv, n);
}

/** S = (I - y)(I + y)^-1 from the normalized admittance matrix. */
export function yToS(y: readonly Complex[]): Complex[] {
  const n = portsOf(y);
  const i = identity(n);
  const inv = matInverse(plus(i, y), n);
  if (!inv) throw new NetworkParameterError('I + y is singular');
  return matMul(minus(i, y), inv, n);
}

function twoPortOnly(m: readonly Complex[], what: string): [Complex, Complex, Complex, Complex] {
  if (m.length !== 4) throw new NetworkParameterError(`${what} is defined for two-ports only`);
  return [m[0] as Complex, m[1] as Complex, m[2] as Complex, m[3] as Complex];
}

function nonZero(d: Complex, what: string): Complex {
  if (cabs(d) < 1e-14) throw new NetworkParameterError(`${what} does not exist: zero denominator`);
  return d;
}

/**
 * Normalized hybrid matrix [h11 h12; h21 h22] of a two-port S matrix
 * `[s11 s12; s21 s22]`. The denominator is (1 - s11)(1 + s22) + s12 s21.
 */
export function sToH(s: readonly Complex[]): Complex[] {
  const [s11, s12, s21, s22] = twoPortOnly(s, 'The H matrix');
  const s1221 = cmul(s12, s21);
  const d = nonZero(cadd(cmul(csub(ONE, s11), cadd(ONE, s22)), s1221), 'The H matrix');
  return [
    cdiv(csub(cmul(cadd(ONE, s11), cadd(ONE, s22)), s1221), d),
    cdiv(cscale(s12, 2), d),
    cdiv(cscale(s21, -2), d),
    cdiv(csub(cmul(csub(ONE, s11), csub(ONE, s22)), s1221), d),
  ];
}

export function hToS(h: readonly Complex[]): Complex[] {
  const [h11, h12, h21, h22] = twoPortOnly(h, 'The H matrix');
  const h1221 = cmul(h12, h21);
  const d = nonZero(
    csub(cmul(cadd(h11, ONE), cadd(h22, ONE)), h1221),
    'The S matrix of this H matrix',
  );
  return [
    cdiv(csub(cmul(csub(h11, ONE), cadd(h22, ONE)), h1221), d),
    cdiv(cscale(h12, 2), d),
    cdiv(cscale(h21, -2), d),
    cdiv(cadd(cmul(cadd(h11, ONE), csub(ONE, h22)), h1221), d),
  ];
}

/**
 * Normalized chain matrix [A B; C D] of a two-port, in the order A, B, C, D
 * (not the order of S). Needs S21 not zero.
 */
export function sToAbcd(s: readonly Complex[]): Complex[] {
  const [s11, s12, s21, s22] = twoPortOnly(s, 'The ABCD matrix');
  const d = nonZero(cscale(s21, 2), 'The ABCD matrix (S21 is zero)');
  const s1221 = cmul(s12, s21);
  return [
    cdiv(cadd(cmul(cadd(ONE, s11), csub(ONE, s22)), s1221), d),
    cdiv(csub(cmul(cadd(ONE, s11), cadd(ONE, s22)), s1221), d),
    cdiv(csub(cmul(csub(ONE, s11), csub(ONE, s22)), s1221), d),
    cdiv(cadd(cmul(csub(ONE, s11), cadd(ONE, s22)), s1221), d),
  ];
}

/**
 * S from the normalized [A B; C D] given in the order A, B, C, D. S12 is S21
 * when the determinant is 1 to within its rounding (a reciprocal network,
 * where 2 det / sum would only add the cancellation error of AD - BC), else
 * 2 det / sum.
 */
export function abcdToS(m: readonly Complex[]): Complex[] {
  const [a, b, c, dd] = twoPortOnly(m, 'The ABCD matrix');
  const sum = nonZero(cadd(cadd(a, b), cadd(c, dd)), 'The S matrix of this ABCD matrix');
  const s21 = cdiv(complex(2), sum);
  return [
    cdiv(csub(cadd(a, b), cadd(c, dd)), sum),
    reciprocalWithinRounding(a, b, c, dd)
      ? s21
      : cdiv(cscale(csub(cmul(a, dd), cmul(b, c)), 2), sum),
    s21,
    cdiv(cadd(csub(dd, a), csub(b, c)), sum),
  ];
}

/**
 * Per-entry factors that turn a normalized matrix of kind `kind` into ohm,
 * siemens or the mixed units of H and ABCD (multiply by the factor).
 */
function unnormalizedFactors(kind: NetworkParameter, n: number, z0: number): number[] {
  const all = (v: number): number[] => Array.from({ length: n * n }, () => v);
  switch (kind) {
    case 'S':
      return all(1);
    case 'Z':
      return all(z0);
    case 'Y':
      return all(1 / z0);
    case 'H':
      return [z0, 1, 1, 1 / z0];
    case 'ABCD':
      return [1, z0, 1 / z0, 1];
  }
}

/**
 * Convert one S matrix (row-major, `ports` by `ports`) to another parameter
 * type. `normalized` false returns ohm, siemens and the mixed H and ABCD
 * units for the reference impedance `z0`.
 */
export function convertS(
  s: readonly Complex[],
  to: NetworkParameter,
  z0: number,
  normalized = true,
): Complex[] {
  const n = portsOf(s);
  let m: Complex[];
  switch (to) {
    case 'S':
      m = [...s];
      break;
    case 'Z':
      m = sToZ(s);
      break;
    case 'Y':
      m = sToY(s);
      break;
    case 'H':
      m = sToH(s);
      break;
    case 'ABCD':
      m = sToAbcd(s);
      break;
  }
  if (normalized) return m;
  const f = unnormalizedFactors(to, n, z0);
  return m.map((c, i) => cscale(c, f[i] as number));
}

/** The inverse of `convertS`: any parameter type back to S. */
export function convertToS(
  m: readonly Complex[],
  from: NetworkParameter,
  z0: number,
  normalized = true,
): Complex[] {
  const n = portsOf(m);
  const f = unnormalizedFactors(from, n, z0);
  const norm = normalized ? [...m] : m.map((c, i) => cscale(c, 1 / (f[i] as number)));
  switch (from) {
    case 'S':
      return norm;
    case 'Z':
      return zToS(norm);
    case 'Y':
      return yToS(norm);
    case 'H':
      return hToS(norm);
    case 'ABCD':
      return abcdToS(norm);
  }
}

/** Which parameter types a port count supports. */
export function supportedParameters(ports: number): readonly NetworkParameter[] {
  if (ports === 2) return ['S', 'Z', 'Y', 'H', 'ABCD'];
  return ['S', 'Z', 'Y'];
}
