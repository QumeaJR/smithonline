/**
 * Limit areas: rectangles on a response plot (a frequency range and a value)
 * that the curve must stay below (`max`) or above (`min`). They are drawn as
 * shaded regions, report their margin, and can stand in for the worst-case
 * VSWR as the cost of the band optimizer.
 */
import type { Element } from './elements.js';
import type { Ladder, SweepPoint } from './ladder.js';
import { sweepDatapoints } from './ladder.js';
import { OPTIMIZE_FAIL, type LoadModel } from './optimize.js';
import { sweepResponse, type Response } from './response.js';

/** The response columns a limit can be placed on. */
export type LimitQuantity = keyof Omit<Response, 'frequency'>;

export const LIMIT_QUANTITIES: readonly LimitQuantity[] = [
  's21Db',
  's11Db',
  'vswr',
  'r',
  'x',
  'phaseDeg',
  'groupDelay',
];

export interface LimitArea {
  readonly id: string;
  readonly quantity: LimitQuantity;
  /** Hz, either order. */
  readonly f1: number;
  readonly f2: number;
  /** `max`: the curve must stay at or below the value; `min`: at or above. */
  readonly kind: 'min' | 'max';
  /** In the unit of the quantity: dB, ratio, ohm, degree or second. */
  readonly value: number;
}

export interface LimitStatus {
  /** Worst violation in the unit of the quantity: above 0 is a breach, below 0 is the margin. */
  readonly worst: number;
  /** Frequency of the worst sample, Hz. */
  readonly frequency: number;
  /** Samples inside the area. */
  readonly samples: number;
}

/** Signed violation of one value: positive when it breaks the limit. */
export function violationOf(area: Pick<LimitArea, 'kind' | 'value'>, v: number): number {
  return area.kind === 'max' ? v - area.value : area.value - v;
}

/**
 * The worst violation of the area over the response samples inside its
 * frequency range, or null when no sample falls inside. NaN samples are
 * skipped; an infinite one (VSWR of a total reflection) counts as an infinite breach.
 */
export function limitStatus(area: LimitArea, response: Response): LimitStatus | null {
  const lo = Math.min(area.f1, area.f2);
  const hi = Math.max(area.f1, area.f2);
  const column = response[area.quantity];
  let worst = -Infinity;
  let at = NaN;
  let samples = 0;
  for (let i = 0; i < response.frequency.length; i++) {
    const f = response.frequency[i] as number;
    if (f < lo || f > hi) continue;
    const v = column[i] as number;
    if (Number.isNaN(v)) continue;
    samples++;
    const violation = violationOf(area, v);
    if (violation > worst || (worst === -Infinity && samples === 1)) {
      worst = violation;
      at = f;
    }
  }
  return samples === 0 ? null : { worst, frequency: at, samples };
}

/**
 * What one unit of violation is worth in the cost: a dB, a tenth of VSWR, a
 * tenth of Z0, ten degrees, a nanosecond. The scales make a mix of areas
 * comparable; they only weight the areas against each other.
 */
export function limitScale(quantity: LimitQuantity, z0: number): number {
  switch (quantity) {
    case 's21Db':
    case 's11Db':
      return 1;
    case 'vswr':
      return 0.1;
    case 'r':
    case 'x':
      return z0 / 10;
    case 'phaseDeg':
      return 10;
    case 'groupDelay':
      return 1e-9;
  }
}

/**
 * The band optimizer cost for limit areas: the worst normalized violation
 * over all areas, 0 when every area is respected. The frequencies are the
 * band's; the edges of the areas are added so a narrow area is not skipped.
 * `load` may vary with frequency (measured data).
 */
export function limitCost(
  ladder: Ladder,
  areas: readonly LimitArea[],
  frequencies: readonly number[],
  load: LoadModel = ladder.load,
): (elements: readonly Element[]) => number {
  const edges = areas.flatMap((a) => [a.f1, a.f2]);
  const grid = [...new Set([...frequencies, ...edges].filter((f) => f > 0))].sort((a, b) => a - b);
  const loads = grid.map((frequency) => ({
    frequency,
    z: typeof load === 'function' ? load(frequency) : load,
  }));
  const scales = areas.map((a) => limitScale(a.quantity, ladder.z0));
  return (elements) => {
    if (areas.length === 0 || grid.length === 0) return 0;
    const sweep: SweepPoint[] = sweepDatapoints({ ...ladder, elements }, loads);
    const response = sweepResponse(sweep);
    let worst = 0;
    for (let k = 0; k < areas.length; k++) {
      const status = limitStatus(areas[k] as LimitArea, response);
      if (status === null) continue;
      const cost = status.worst / (scales[k] as number);
      // An infinite margin (a curve at -Infinity dB) counts for nothing; a breach by infinity is a fail.
      if (!Number.isFinite(cost)) {
        if (cost > 0) return OPTIMIZE_FAIL;
        continue;
      }
      if (cost > worst) worst = Math.min(cost, OPTIMIZE_FAIL);
    }
    return worst;
  };
}
