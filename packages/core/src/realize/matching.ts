/**
 * Realize-aware matching: the standard or stocked values a match solution
 * ends up with, the mismatch that leaves, and the values a tuning slider
 * steps through.
 */
import { complex, type Complex } from '../complex.js';
import type { Element } from '../elements.js';
import type { Ladder } from '../ladder.js';
import type { MatchSolution } from '../match.js';
import { eSeriesBase, roundSeriesValue, type ESeries } from './eSeries.js';
import { vswrTowards } from './mismatch.js';
import { realizeLadder, type PartKind, type Realization, type RealizeOptions } from './snap.js';

/**
 * The `span` series values below and above the one nearest to `center`
 * (which sits in the middle), ascending across decade boundaries.
 */
export function seriesWindow(center: number, series: ESeries, span: number): number[] {
  if (!(center > 0) || !Number.isFinite(center) || !(span >= 0)) return [];
  const base = eSeriesBase(series);
  const n = base.length;
  let e = Math.floor(Math.log10(center));
  let m = center / 10 ** e;
  if (m >= 10 - 1e-9) {
    e += 1;
    m = 1;
  } else if (m < 1) {
    e -= 1;
    m *= 10;
  }
  // The largest base value not above the mantissa, then the nearer of it and its successor.
  let k = 0;
  for (let i = 0; i < n; i++) if ((base[i] as number) <= m * (1 + 1e-9)) k = i;
  const lower = (base[k] as number) * 10 ** e;
  const upper = (base[(k + 1) % n] as number) * 10 ** (k + 1 === n ? e + 1 : e);
  if (Math.abs(Math.log(upper / center)) < Math.abs(Math.log(lower / center))) k += 1;
  const out: number[] = [];
  for (let d = -Math.floor(span); d <= Math.floor(span); d++) {
    const idx = k + d;
    const shift = Math.floor(idx / n);
    const b = base[((idx % n) + n) % n] as number;
    out.push(roundSeriesValue(b * 10 ** (e + shift)));
  }
  return out;
}

/**
 * The stock values around `center`: up to `span` below and above the nearest
 * one, ascending. Empty for an empty stock.
 */
export function stockWindow(center: number, stock: readonly number[], span: number): number[] {
  const sorted = [...new Set(stock.filter((v) => v > 0 && Number.isFinite(v)))].sort(
    (a, b) => a - b,
  );
  if (sorted.length === 0 || !(center > 0) || !(span >= 0)) return sorted;
  let k = 0;
  sorted.forEach((v, i) => {
    if (Math.abs(Math.log(v / center)) < Math.abs(Math.log((sorted[k] as number) / center))) k = i;
  });
  const s = Math.floor(span);
  return sorted.slice(Math.max(0, k - s), Math.min(sorted.length, k + s + 1));
}

/**
 * The values a part can take around `center` with the given source: the
 * series window, or the stock values of that part kind. Empty when the
 * source has nothing for the part, and for the part library (whose parts are
 * not values on a scale).
 */
export function realizableValues(
  source: RealizeOptions['source'],
  part: PartKind,
  center: number,
  span = 10,
): number[] {
  if (source.kind === 'library') return [];
  return source.kind === 'series'
    ? seriesWindow(center, source.series, span)
    : stockWindow(center, source.stock[part], span);
}

/** Index of the value nearest to `value` in log distance, or 0 for an empty list. */
export function nearestIndex(values: readonly number[], value: number): number {
  let k = 0;
  values.forEach((v, i) => {
    if (
      value > 0 &&
      v > 0 &&
      Math.abs(Math.log(v / value)) < Math.abs(Math.log((values[k] as number) / value))
    )
      k = i;
  });
  return k;
}

export interface RealizedSolution {
  /** The solution as synthesized, ideal values. */
  readonly solution: MatchSolution;
  /** The added elements with their realized values, in the solution's order. */
  readonly elements: readonly Element[];
  /** Zin of the realized network with the elements appended. */
  readonly zin: Complex;
  /** VSWR of that Zin referred to the target (options.target, else Z0). */
  readonly vswr: number;
  readonly realization: Realization;
}

/**
 * Append each solution to the ladder, realize the whole network with the
 * given options and rank the solutions by the VSWR they actually give.
 * Ties keep the synthesized order (lowest Q first).
 */
export function realizeSolutions(
  ladder: Ladder,
  solutions: readonly MatchSolution[],
  options: RealizeOptions,
): RealizedSolution[] {
  const target = options.target ?? complex(ladder.z0, 0);
  const n = ladder.elements.length;
  const out = solutions.map((solution, order) => {
    const realization = realizeLadder(
      { ...ladder, elements: [...ladder.elements, ...solution.elements] },
      options,
    );
    const zin = realization.result.zin;
    return {
      order,
      item: {
        solution,
        elements: realization.ladder.elements.slice(n),
        zin,
        vswr: vswrTowards(zin, target),
        realization,
      },
    };
  });
  out.sort((a, b) => {
    const d = a.item.vswr - b.item.vswr;
    if (Number.isNaN(d)) return 0;
    return d !== 0 ? d : a.order - b.order;
  });
  return out.map((o) => o.item);
}
