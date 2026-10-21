/**
 * Preferred number series after IEC 60063 and nearest-value lookup.
 *
 * E24 and E96 are the published tables. E6 and E12 are every fourth and every
 * second E24 value, E48 every second E96 value. The E24 family keeps its
 * historical rounding (2.7, 3.0, 3.3, 3.9, 4.3, 4.7 and so on), so it is
 * stored as a table rather than computed from 10^(k/24).
 */

export type ESeries = 'E6' | 'E12' | 'E24' | 'E48' | 'E96';

export const E_SERIES: readonly ESeries[] = ['E6', 'E12', 'E24', 'E48', 'E96'];

/** Nominal tolerance each series was designed for, as a fraction. */
export const E_SERIES_TOLERANCE: Readonly<Record<ESeries, number>> = {
  E6: 0.2,
  E12: 0.1,
  E24: 0.05,
  E48: 0.02,
  E96: 0.01,
};

const E24_BASE: readonly number[] = [
  1.0, 1.1, 1.2, 1.3, 1.5, 1.6, 1.8, 2.0, 2.2, 2.4, 2.7, 3.0, 3.3, 3.6, 3.9, 4.3, 4.7, 5.1, 5.6,
  6.2, 6.8, 7.5, 8.2, 9.1,
];

const E96_BASE: readonly number[] = [
  1.0, 1.02, 1.05, 1.07, 1.1, 1.13, 1.15, 1.18, 1.21, 1.24, 1.27, 1.3, 1.33, 1.37, 1.4, 1.43, 1.47,
  1.5, 1.54, 1.58, 1.62, 1.65, 1.69, 1.74, 1.78, 1.82, 1.87, 1.91, 1.96, 2.0, 2.05, 2.1, 2.15, 2.21,
  2.26, 2.32, 2.37, 2.43, 2.49, 2.55, 2.61, 2.67, 2.74, 2.8, 2.87, 2.94, 3.01, 3.09, 3.16, 3.24,
  3.32, 3.4, 3.48, 3.57, 3.65, 3.74, 3.83, 3.92, 4.02, 4.12, 4.22, 4.32, 4.42, 4.53, 4.64, 4.75,
  4.87, 4.99, 5.11, 5.23, 5.36, 5.49, 5.62, 5.76, 5.9, 6.04, 6.19, 6.34, 6.49, 6.65, 6.81, 6.98,
  7.15, 7.32, 7.5, 7.68, 7.87, 8.06, 8.25, 8.45, 8.66, 8.87, 9.09, 9.31, 9.53, 9.76,
];

function every(base: readonly number[], step: number): number[] {
  return base.filter((_, i) => i % step === 0);
}

const BASES: Readonly<Record<ESeries, readonly number[]>> = {
  E6: every(E24_BASE, 4),
  E12: every(E24_BASE, 2),
  E24: E24_BASE,
  E48: every(E96_BASE, 2),
  E96: E96_BASE,
};

/** The values of one decade, from 1 inclusive to 10 exclusive. */
export function eSeriesBase(series: ESeries): readonly number[] {
  return BASES[series];
}

/** The series values between min and max inclusive, ascending. */
export function eSeriesValues(series: ESeries, min: number, max: number): number[] {
  const out: number[] = [];
  if (!(min > 0) || !(max >= min)) return out;
  const base = BASES[series];
  const lo = Math.floor(Math.log10(min)) - 1;
  const hi = Math.ceil(Math.log10(max)) + 1;
  for (let e = lo; e <= hi; e++) {
    const decade = 10 ** e;
    for (const b of base) {
      const v = roundValue(b * decade);
      if (v >= min && v <= max) out.push(v);
    }
  }
  return out;
}

/**
 * Clean up the floating point noise of mantissa times decade so that 2.2 nF
 * is exactly 2.2e-9 and not 2.1999999999999997e-9.
 */
function roundValue(v: number): number {
  return Number(v.toPrecision(12));
}

/** The two series values that bracket `value`: the largest not above it and the smallest not below it. */
export function seriesNeighbors(
  value: number,
  series: ESeries,
): { readonly lower: number; readonly upper: number } {
  return neighborsIn(BASES[series], value);
}

function neighborsIn(
  base: readonly number[],
  value: number,
): { readonly lower: number; readonly upper: number } {
  if (!(value > 0) || !Number.isFinite(value)) return { lower: value, upper: value };
  const e = Math.floor(Math.log10(value));
  const decade = 10 ** e;
  const m = value / decade;
  // A mantissa can land on 10 through rounding; the ladder below handles it.
  let lower = roundValue((base[base.length - 1] as number) * decade * 0.1);
  let upper = roundValue(decade * 10);
  for (const b of base) {
    const v = roundValue(b * decade);
    if (b <= m + 1e-12) lower = v;
    if (b >= m - 1e-12) {
      upper = v;
      break;
    }
  }
  return { lower, upper };
}

/** Geometric (log) distance between two positive values. */
export function logDistance(a: number, b: number): number {
  return Math.abs(Math.log(a / b));
}

/** The series value nearest to `value` in log distance. Non-positive values are returned unchanged. */
export function nearestInSeries(value: number, series: ESeries): number {
  const { lower, upper } = seriesNeighbors(value, series);
  return pickNearest(value, lower, upper);
}

/**
 * Nearest in log distance among two candidates; a tie goes to the lower value
 * so the choice is deterministic.
 */
export function pickNearest(value: number, lower: number, upper: number): number {
  if (!(value > 0)) return value;
  return logDistance(value, upper) < logDistance(value, lower) ? upper : lower;
}

/** Neighbors in a sorted custom stock list: the nearest at or below and the nearest at or above. */
export function stockNeighbors(
  value: number,
  stock: readonly number[],
): { readonly lower: number; readonly upper: number } | null {
  const sorted = stock.filter((v) => v > 0 && Number.isFinite(v)).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  let lower: number | undefined;
  let upper: number | undefined;
  for (const v of sorted) {
    if (v <= value) lower = v;
    if (v >= value) {
      upper = v;
      break;
    }
  }
  return {
    lower: lower ?? (upper as number),
    upper: upper ?? (lower as number),
  };
}

/** The stock value nearest to `value` in log distance, or null for an empty stock. */
export function nearestInStock(value: number, stock: readonly number[]): number | null {
  const n = stockNeighbors(value, stock);
  return n ? pickNearest(value, n.lower, n.upper) : null;
}
