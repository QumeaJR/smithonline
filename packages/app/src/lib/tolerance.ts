/**
 * Monte Carlo tolerance analysis as the app uses it: the default tolerance
 * from the active E series, the options built from the design's settings, and
 * the path the cloud of input impedances is drawn with on the chart.
 */
import {
  E_SERIES_TOLERANCE,
  sweepPoints,
  zToGamma,
  type MonteCarloOptions,
} from '@smithonline/core';
import { targetOf, type Design, type ToleranceSettings } from './design';
import { fmtFrequency } from './format';
import { designBand, hasMeasuredLoad } from './measuredLoad';

export const DEFAULT_TOLERANCE: ToleranceSettings = {
  runs: 1000,
  seed: 1,
  distribution: 'uniform',
  percent: null,
  vswrLimit: 2,
  overBand: false,
  overrides: {},
};

export function toleranceSettings(design: Pick<Design, 'tolerance'>): ToleranceSettings {
  return design.tolerance ?? DEFAULT_TOLERANCE;
}

/**
 * The tolerance every lumped part gets unless set otherwise, as a fraction:
 * the typed percentage, else that of the series chosen in Realize (E24 is 5
 * percent), whether Realize is on or off, else 5 percent for a stock list,
 * whose tolerance nobody has written down. The one rule: the Tolerance
 * panel, design centring and Auto match's yield all use it.
 */
export function defaultTolerance(design: Design): number {
  const { percent } = toleranceSettings(design);
  if (percent !== null) return percent / 100;
  const { series } = design.realize;
  return series === 'stock' || series === 'library' ? 0.05 : E_SERIES_TOLERANCE[series];
}

/** Where the default comes from, for the panel. */
export function defaultToleranceLabel(design: Design): string {
  const { percent } = toleranceSettings(design);
  if (percent !== null) return `${percent} % typed`;
  const { series } = design.realize;
  if (series === 'library') return '5 % (assumed; library parts are not varied)';
  return series === 'stock'
    ? '5 % (your stock, assumed)'
    : `${Math.round(E_SERIES_TOLERANCE[series] * 100)} % from ${series}`;
}

/**
 * Where the default comes from, in a few words for a parenthesis: "typed in Tolerance",
 * "your stock, assumed", "E24", or "E24 tolerance, Realize is off".
 */
export function defaultToleranceSource(design: Design): string {
  const { percent } = toleranceSettings(design);
  if (percent !== null) return 'typed in Tolerance';
  const { series, enabled } = design.realize;
  if (series === 'stock') return 'your stock, assumed';
  if (series === 'library') return 'assumed; library parts are not varied';
  return enabled ? series : `${series} tolerance, Realize is off`;
}

/** What the empty default tolerance field shows: "E24: 5 %", or "stock: 5 %". */
export function defaultTolerancePlaceholder(design: Pick<Design, 'realize'>): string {
  const { series } = design.realize;
  if (series === 'library') return 'library: 5 %';
  return series === 'stock'
    ? 'stock: 5 %'
    : `${series}: ${Math.round(E_SERIES_TOLERANCE[series] * 1000) / 10} %`;
}

/**
 * The frequencies that judge a run when "over the sweep range" is on: the sweep range, or the
 * measured band while the design is judged against its measured load; empty when the range is
 * unusable.
 */
export function bandFrequencies(design: Design): number[] {
  const { points } = design.sweep;
  const { start: lo, stop: hi } = designBand(design);
  if (!(lo > 0) || !(hi > lo)) return [];
  return sweepPoints(lo, hi, Math.min(41, Math.max(5, Math.round(points))));
}

/**
 * Where a run is judged, for a sentence after "within VSWR 1.5": " at the design frequency",
 * " over the measured band, 70 MHz to 130 MHz" or " over the sweep range, ...", with
 * " towards the target" first when a target is set.
 */
export function judgedRangeText(design: Design): string {
  const towards = design.target ? ' towards the target' : '';
  const band = toleranceSettings(design).overBand ? bandFrequencies(design) : [];
  if (band.length === 0) return `${towards} at the design frequency`;
  const lo = fmtFrequency(band[0] as number);
  const hi = fmtFrequency(band[band.length - 1] as number);
  return `${towards} over the ${hasMeasuredLoad(design) ? 'measured band' : 'sweep range'}, ${lo} to ${hi}`;
}

/**
 * The core options for a run, without the progress callback. Runs are judged towards the
 * design target when one is set (towards Z0 otherwise), as Auto match judges, and the spread
 * ranking, the corners and design centring take the same options.
 */
export function monteCarloOptions(design: Design): Omit<MonteCarloOptions, 'onProgress'> {
  const t = toleranceSettings(design);
  const overrides: Record<number, number> = {};
  const exact: number[] = [];
  design.elements.forEach((el, i) => {
    const pct = t.overrides[el.id];
    if (pct !== undefined) overrides[i] = pct / 100;
    if (el.locked) exact.push(i);
  });
  const band = t.overBand ? bandFrequencies(design) : [];
  return {
    runs: t.runs,
    seed: t.seed,
    distribution: t.distribution,
    tolerance: defaultTolerance(design),
    overrides,
    exact,
    ...(t.correlation && Object.values(t.correlation).some((r) => (r ?? 0) > 0)
      ? { correlation: t.correlation }
      : {}),
    vswrLimit: t.vswrLimit,
    ...(band.length > 0 ? { band } : {}),
    ...(design.target ? { target: targetOf(design) } : {}),
  };
}

/**
 * The cloud as one SVG path of zero-length segments, in chart coordinates
 * (reflection coefficient, imaginary axis down). A round cap turns each into
 * a dot, so thousands of points stay one element. Points far outside the
 * chart are pulled in to 3 times the unit radius.
 */
export function cloudPath(
  re: ArrayLike<number>,
  im: ArrayLike<number>,
  z0: number,
  maxPoints = 20000,
): string {
  const n = Math.min(re.length, im.length);
  const step = Math.max(1, Math.ceil(n / maxPoints));
  const parts: string[] = [];
  for (let i = 0; i < n; i += step) {
    const g = zToGamma({ re: re[i] as number, im: im[i] as number }, z0);
    if (!Number.isFinite(g.re) || !Number.isFinite(g.im)) continue;
    const m = Math.hypot(g.re, g.im);
    const k = m > 3 ? 3 / m : 1;
    parts.push(`M${(g.re * k).toFixed(4)} ${(-g.im * k).toFixed(4)}h0`);
  }
  return parts.join('');
}

/**
 * The top of the cloud in chart coordinates (x right, y down), the median of its points
 * across: where the chart writes "stale" over a cloud that no longer fits the design. Null
 * for an empty cloud.
 */
export function cloudAnchor(
  re: ArrayLike<number>,
  im: ArrayLike<number>,
  z0: number,
): { readonly x: number; readonly y: number } | null {
  const n = Math.min(re.length, im.length);
  const step = Math.max(1, Math.ceil(n / 2000));
  const xs: number[] = [];
  let top = Infinity;
  for (let i = 0; i < n; i += step) {
    const g = zToGamma({ re: re[i] as number, im: im[i] as number }, z0);
    if (!Number.isFinite(g.re) || !Number.isFinite(g.im) || Math.hypot(g.re, g.im) > 1.2) continue;
    xs.push(g.re);
    top = Math.min(top, -g.im);
  }
  if (xs.length === 0) return null;
  xs.sort((a, b) => a - b);
  return { x: xs[Math.floor(xs.length / 2)] as number, y: top };
}
