import {
  evaluateAt,
  measuredLoadInfo,
  usableBandwidth,
  type Ladder,
  type LoadModel,
  type UsableBandwidth,
} from '@smithonline/core';

/** VSWR limit the usable bandwidth is measured against until the user changes it. */
export const DEFAULT_VSWR_LIMIT = 2;

/**
 * Usable bandwidth of a ladder about its design frequency, with VSWR referred
 * to its Z0. With a measured `load` (a model across frequency) the load is
 * read per frequency and the search stays inside the range the model follows
 * (the data, and 5 percent past it for a fitted model): an open edge then
 * means the band reaches the end of the measured data.
 */
export function ladderBandwidth(
  ladder: Ladder,
  limit: number,
  load: LoadModel = ladder.load,
): UsableBandwidth | null {
  const vswrAt = (f: number): number => {
    const z = typeof load === 'function' ? load(f) : load;
    const r = evaluateAt(ladder, f, z, { arcSteps: 0 });
    return r.info[r.info.length - 1]?.vswr ?? Infinity;
  };
  const info = measuredLoadInfo(load);
  if (!info) return usableBandwidth(vswrAt, ladder.frequency, limit);
  const [lo, hi] = info.range;
  // The design frequency outside the data: no band can be read from it.
  if (!(ladder.frequency >= lo && ladder.frequency <= hi)) return null;
  // A centre on the edge of the range: a hair inside it, so the search has room on that side.
  return usableBandwidth(vswrAt, ladder.frequency, limit, {
    min: Math.min(lo, ladder.frequency * (1 - 1e-12)),
    max: Math.max(hi, ladder.frequency * (1 + 1e-12)),
  });
}
