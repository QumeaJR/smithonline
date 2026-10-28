/**
 * The frequency zoom of a response plot (docs/10 section 4.2): pure maths on
 * an x range in Hz, linear or logarithmic. A range that covers the whole data
 * is no zoom (null); a zoom never goes past the data or below 1/1000 of its
 * span (in log f, of its span in decades).
 */
import { formatEngineering } from '@smithonline/core';

export type Range = readonly [number, number];

/** A frequency as the plot axes write it: "2.45 GHz". */
export function fmtPlotFrequency(v: number): string {
  return formatEngineering(v, { unit: 'Hz', digits: 3 });
}

/** The smallest zoomed span as a share of the data span. */
export const MIN_SPAN = 1e-3;

const fwd = (v: number, log: boolean): number => (log ? Math.log10(v) : v);
const back = (v: number, log: boolean): number => (log ? 10 ** v : v);

/** Whether the range is usable on this axis: finite, ascending, positive in log f. */
export function validRange(r: Range | null | undefined, log: boolean): r is Range {
  if (!r) return false;
  const [a, b] = r;
  return Number.isFinite(a) && Number.isFinite(b) && b > a && (!log || a > 0);
}

/**
 * Clamp a range into the data's and keep at least the smallest span; a range
 * that reaches both ends of the data is no zoom.
 */
export function clampRange(r: Range, full: Range, log: boolean): Range | null {
  if (!validRange(full, log)) return null;
  let a = fwd(Math.min(r[0], r[1]), log);
  let b = fwd(Math.max(r[0], r[1]), log);
  const fa = fwd(full[0], log);
  const fb = fwd(full[1], log);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  const span = fb - fa;
  const min = span * MIN_SPAN;
  if (b - a < min) {
    const c = (a + b) / 2;
    a = c - min / 2;
    b = c + min / 2;
  }
  // Shift a range that sticks out back in, then cut it to the data.
  if (a < fa) {
    b += fa - a;
    a = fa;
  }
  if (b > fb) {
    a -= b - fb;
    b = fb;
  }
  a = Math.max(a, fa);
  const eps = span * 1e-9;
  if (a <= fa + eps && b >= fb - eps) return null;
  return [back(a, log), back(b, log)];
}

/** Zoom by `factor` (below 1 zooms in) about `at`, Hz. */
export function zoomAbout(
  current: Range | null,
  full: Range,
  at: number,
  factor: number,
  log: boolean,
): Range | null {
  const r = current ?? full;
  if (!validRange(r, log) || !(factor > 0)) return current;
  const c = fwd(Math.min(Math.max(at, r[0]), r[1]), log);
  const a = fwd(r[0], log);
  const b = fwd(r[1], log);
  return clampRange([back(c - (c - a) * factor, log), back(c + (b - c) * factor, log)], full, log);
}

/** Move the range by `share` of its own span (positive: to higher frequencies). */
export function panBy(
  current: Range | null,
  full: Range,
  share: number,
  log: boolean,
): Range | null {
  if (!current || !validRange(current, log)) return current ?? null;
  const a = fwd(current[0], log);
  const b = fwd(current[1], log);
  const d = (b - a) * share;
  const fa = fwd(full[0], log);
  const fb = fwd(full[1], log);
  // Keep the span: stop at the ends of the data instead of shrinking.
  const shift = Math.min(Math.max(d, fa - a), fb - b);
  return clampRange([back(a + shift, log), back(b + shift, log)], full, log);
}

/** The range between two pointer positions given as values (a box), or null for a sliver. */
export function boxRange(v1: number, v2: number, full: Range, log: boolean): Range | null {
  if (!Number.isFinite(v1) || !Number.isFinite(v2) || v1 === v2) return null;
  return clampRange([Math.min(v1, v2), Math.max(v1, v2)], full, log);
}

/** The pinch of two fingers: the range the start range becomes when their gap goes from d0 to d1 px. */
export function pinchRange(
  start: Range,
  full: Range,
  midValue: number,
  d0: number,
  d1: number,
  log: boolean,
): Range | null {
  if (!(d0 > 0) || !(d1 > 0)) return start;
  return zoomAbout(start, full, midValue, d0 / d1, log);
}

/** "2.30 to 2.55 GHz": the zoom chip's words, with the unit once. */
export function rangeText(r: Range, fmt: (hz: number) => string): string {
  const a = fmt(r[0]);
  const b = fmt(r[1]);
  const unit = (s: string): string => s.replace(/^[-\d.,\s]+/, '');
  const num = (s: string): string => s.slice(0, s.length - unit(s).length).trim();
  return unit(a) === unit(b) && unit(a) !== '' ? `${num(a)} to ${b}` : `${a} to ${b}`;
}
