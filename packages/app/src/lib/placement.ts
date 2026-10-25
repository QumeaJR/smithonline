/**
 * Placing an armed part on the chart (docs/07 section 6): the value that moves the network's
 * input point towards where the part was aimed, or a refusal where the part cannot move it
 * there. A part only moves the point along its own locus and only one way (a series L adds
 * reactance, a shunt C adds susceptance), so a point on the far side of the input point has
 * no positive value; clamping such a value to a floor would insert a near-zero part (a
 * series L of a few attohenry under the axis), which is never what was meant.
 */
import { cinv, tuneElement, type Complex, type Element } from '@smithonline/core';

/** The smallest value a placed part may have, SI units (1 fH, 1 fF, 1 fΩ). */
export const PLACE_MIN = 1e-15;
/** The largest placed inductance or capacitance, SI units (1000 H, 1000 F). */
export const PLACE_MAX_LC = 1e3;
/** The largest placed resistance, Ω: a teraohm is an open, not a part. */
export const PLACE_MAX_R = 1e12;

export type Placement =
  | { readonly kind: 'ok'; readonly element: Element }
  | {
      readonly kind: 'unreachable';
      /** Where to aim instead, for the message ("aim above the axis"). */
      readonly hint: string;
    };

/** A reactance this close to zero (relative to the resistance scale) is on the axis. */
const onAxis = (z: Complex): boolean => Math.abs(z.im) <= 1e-9 * Math.max(1, Math.abs(z.re));

/** Where an inductor (upper half) or a capacitor (lower half) can always go from `before`. */
function sideHint(inductive: boolean, before: Complex): string {
  if (inductive && (before.im < 0 || onAxis(before))) return 'aim above the axis';
  if (!inductive && (before.im > 0 || onAxis(before))) return 'aim below the axis';
  return 'aim along the dashed line';
}

const ALONG = 'aim along the dashed line';

/**
 * The part `base` tuned to move `before` towards `target` at frequency f, or why it cannot:
 * no positive value solves it, or the value lies below PLACE_MIN or above PLACE_MAX_LC
 * (PLACE_MAX_R for a resistor). Lines and stubs reach every point of their circle; a block
 * that cannot be tuned (RLC) is placed at its default value, as before.
 */
export function placement(base: Element, before: Complex, target: Complex, f: number): Placement {
  const w = 2 * Math.PI * f;
  const refuse = (hint: string): Placement => ({ kind: 'unreachable', hint });
  const lumped = (value: number, max: number, hint: string): Placement =>
    Number.isFinite(value) && value >= PLACE_MIN && value <= max
      ? { kind: 'ok', element: { ...base, value } as Element }
      : refuse(hint);
  switch (base.kind) {
    case 'L': {
      const hint = sideHint(true, before);
      if (base.orientation === 'series') {
        const dx = target.im - before.im;
        return dx > 0 ? lumped(dx / w, PLACE_MAX_LC, hint) : refuse(hint);
      }
      const b = cinv(target).im - cinv(before).im;
      return -b > 0 ? lumped(1 / (w * -b), PLACE_MAX_LC, hint) : refuse(hint);
    }
    case 'C': {
      const hint = sideHint(false, before);
      if (base.orientation === 'series') {
        const dx = before.im - target.im;
        return dx > 0 ? lumped(1 / (w * dx), PLACE_MAX_LC, hint) : refuse(hint);
      }
      const b = cinv(target).im - cinv(before).im;
      return b > 0 ? lumped(b / w, PLACE_MAX_LC, hint) : refuse(hint);
    }
    case 'R': {
      if (base.orientation === 'series') {
        const dr = target.re - before.re;
        return dr > 0 ? lumped(dr, PLACE_MAX_R, ALONG) : refuse(ALONG);
      }
      const g = cinv(target).re - cinv(before).re;
      return g > 0 ? lumped(1 / g, PLACE_MAX_R, ALONG) : refuse(ALONG);
    }
    case 'RLC':
      return { kind: 'ok', element: tuneElement(base, before, target, f) ?? base };
    default: {
      const tuned = tuneElement(base, before, target, f);
      return tuned ? { kind: 'ok', element: tuned } : refuse(ALONG);
    }
  }
}
