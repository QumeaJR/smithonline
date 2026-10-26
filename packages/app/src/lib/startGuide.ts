import { evaluateLadder, vswrTowards, type Complex } from '@smithonline/core';
import { targetOf, type Design } from './design';
import { userDatapoints } from './datapoints';
import { designLadder, effectiveElements } from './realize';

export interface StartSteps {
  /** The load differs from the one the design was created with, or a datapoint was added. */
  readonly load: boolean;
  /**
   * A target is set. Any typed target counts, one equal to Z0 too: without one the
   * network matches to Z0, which is the default the guide asks the user to confirm or change.
   */
  readonly target: boolean;
  /** The ladder has a part. */
  readonly match: boolean;
}

/** Z0 a new design starts with unless Settings say otherwise, ohm. */
const FACTORY_Z0 = 50;

const same = (a: Complex, b: Complex): boolean => a.re === b.re && a.im === b.im;

/**
 * Which of the three steps of a match are done for a design. `createdLoad` is
 * the load the design was created with (the store keeps it): a change of Z0
 * alone does not set the load. Without it, the default load of the design's
 * Z0 or of the factory Z0 counts as not set.
 */
export function startSteps(design: Design, createdLoad?: Complex): StartSteps {
  const untouched = createdLoad
    ? same(design.load, createdLoad)
    : same(design.load, { re: design.z0, im: 0 }) || same(design.load, { re: FACTORY_Z0, im: 0 });
  return {
    load: !untouched || userDatapoints(design).length > 1,
    target: design.target !== null,
    match: design.elements.length > 0,
  };
}

/** The VSWR of Zin at the design frequency towards the target (Z0 while none is set). */
export function vswrAtF(d: Design): number {
  const r = evaluateLadder(designLadder(d, effectiveElements(d)), { arcSteps: 0 });
  return vswrTowards(r.zin, targetOf(d));
}

/**
 * Matched: the ladder has a part and Zin at the design frequency is on the target now, within
 * the VSWR limit. Z0 counts as the target while none is typed (the common 50 ohm path).
 */
export function isMatched(d: Design, vswrLimit: number): boolean {
  return d.elements.length > 0 && vswrAtF(d) < vswrLimit;
}
