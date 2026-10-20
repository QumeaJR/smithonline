/**
 * Complex arithmetic for the core library.
 *
 * Portions derived from QuickSmith-Web, copyright 2017 Nathan Iyer, MIT license
 * (engine.js, commit ca1b69e612f3e7c753591e2a09c38e19110136ef): the plain-object
 * representation and the division convention below. See THIRD_PARTY_NOTICES.md.
 */
export interface Complex {
  readonly re: number;
  readonly im: number;
}

/**
 * Floor substituted for a true zero denominator. A zero denominator in this
 * library always means a short or an open circuit; substituting a tiny real
 * part makes the result blow up (as the physics does) instead of producing
 * NaN that poisons every later step.
 */
export const TINY = 1e-16;

export function complex(re: number, im = 0): Complex {
  return { re, im };
}

export const ZERO: Complex = complex(0, 0);
export const ONE: Complex = complex(1, 0);
export const J: Complex = complex(0, 1);

export function cadd(a: Complex, b: Complex): Complex {
  return complex(a.re + b.re, a.im + b.im);
}

export function csub(a: Complex, b: Complex): Complex {
  return complex(a.re - b.re, a.im - b.im);
}

export function cmul(a: Complex, b: Complex): Complex {
  return complex(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re);
}

/** Multiply by a real scalar. */
export function cscale(a: Complex, k: number): Complex {
  return complex(a.re * k, a.im * k);
}

export function cneg(a: Complex): Complex {
  return complex(-a.re, -a.im);
}

/** a / b. A zero denominator is replaced by TINY, see its documentation. */
export function cdiv(a: Complex, b: Complex): Complex {
  const d = b.re === 0 && b.im === 0 ? complex(TINY, 0) : b;
  const m = d.re * d.re + d.im * d.im;
  return complex((a.re * d.re + a.im * d.im) / m, (a.im * d.re - a.re * d.im) / m);
}

/** 1 / a. */
export function cinv(a: Complex): Complex {
  return cdiv(ONE, a);
}

/** Magnitude |z|, computed with Math.hypot to avoid overflow. */
export function cabs(z: Complex): number {
  return Math.hypot(z.re, z.im);
}

/** Argument in radians, in (-pi, pi]. */
export function carg(z: Complex): number {
  return Math.atan2(z.im, z.re);
}

/** Argument in degrees, in (-180, 180]. */
export function cargDeg(z: Complex): number {
  return (carg(z) * 180) / Math.PI;
}

/** Complex conjugate. */
export function conj(z: Complex): Complex {
  return complex(z.re, -z.im);
}

/** e^z. */
export function cexp(z: Complex): Complex {
  const m = Math.exp(z.re);
  return complex(m * Math.cos(z.im), m * Math.sin(z.im));
}

/** Build from magnitude and angle in radians. */
export function polar(mag: number, angleRad: number): Complex {
  return complex(mag * Math.cos(angleRad), mag * Math.sin(angleRad));
}

/** Build from magnitude and angle in degrees. */
export function polarDeg(mag: number, angleDeg: number): Complex {
  return polar(mag, (angleDeg * Math.PI) / 180);
}

/** cosh(z) for complex z. */
export function ccosh(z: Complex): Complex {
  return complex(Math.cosh(z.re) * Math.cos(z.im), Math.sinh(z.re) * Math.sin(z.im));
}

/** sinh(z) for complex z. */
export function csinh(z: Complex): Complex {
  return complex(Math.sinh(z.re) * Math.cos(z.im), Math.cosh(z.re) * Math.sin(z.im));
}

/** True when both parts agree within an absolute tolerance. */
export function cclose(a: Complex, b: Complex, tol = 1e-12): boolean {
  return Math.abs(a.re - b.re) <= tol && Math.abs(a.im - b.im) <= tol;
}
