import type { Design } from './design';
import { userDatapoints } from './datapoints';

export interface StartSteps {
  /** The load differs from the default (Z0 + j0) or a datapoint was added. */
  readonly load: boolean;
  /** A target other than the default Z0 is set. */
  readonly target: boolean;
  /** The ladder has a part. */
  readonly match: boolean;
}

/** Which of the three steps of a match are done for a design. */
export function startSteps(design: Design): StartSteps {
  return {
    load: design.load.re !== design.z0 || design.load.im !== 0 || userDatapoints(design).length > 1,
    target: design.target !== null,
    match: design.elements.length > 0,
  };
}
