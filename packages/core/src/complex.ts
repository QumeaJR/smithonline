/**
 * Minimal complex number type for the core library.
 * Phase 1 extends this with the full operation set (see PLAN.md).
 */
export interface Complex {
  readonly re: number;
  readonly im: number;
}

export function complex(re: number, im = 0): Complex {
  return { re, im };
}

/** Magnitude |z|, computed with Math.hypot to avoid overflow. */
export function cabs(z: Complex): number {
  return Math.hypot(z.re, z.im);
}
