import { evaluateAt, usableBandwidth, type Ladder, type UsableBandwidth } from '@smithonline/core';

/** VSWR limit the usable bandwidth is measured against until the user changes it. */
export const DEFAULT_VSWR_LIMIT = 2;

/** Usable bandwidth of a ladder about its design frequency, with VSWR referred to its Z0. */
export function ladderBandwidth(ladder: Ladder, limit: number): UsableBandwidth | null {
  const vswrAt = (f: number): number => {
    const r = evaluateAt(ladder, f, ladder.load, { arcSteps: 0 });
    return r.info[r.info.length - 1]?.vswr ?? Infinity;
  };
  return usableBandwidth(vswrAt, ladder.frequency, limit);
}
