/**
 * Monte Carlo tolerance analysis: every part value is drawn from its
 * tolerance band, the ladder is evaluated, and what comes out is the cloud of
 * input impedances at the design frequency, the spread of the VSWR and the
 * yield against a VSWR limit.
 *
 * Each lumped part (the three parts of an RLC block count separately) is
 * multiplied by 1 + d, with d uniform in the band or normal with the band as
 * three standard deviations. Lines and stubs vary in length and transformers
 * in ratio only when given a tolerance of their own. A part kept exact
 * (locked) has none. The draws come from a seeded generator, so the same seed
 * and settings reproduce the same cloud.
 *
 * Correlated parts (D3): parts from one reel drift together. A correlation
 * coefficient per part kind (L, C, R; the parts of an RLC block count by
 * their kind) makes the draws of every two parts of that kind correlated
 * with that coefficient, through one common normal factor per kind and run:
 * z_i = sqrt(r) c + sqrt(1 - r) e_i. A normal draw is z_i / 3; a uniform
 * draw is 2 Phi(z_i) - 1 (a Gaussian copula), whose Pearson correlation is
 * (6 / pi) asin(r / 2), so r is set to 2 sin(pi rho / 6) to give the
 * requested rho exactly. With every coefficient 0 the draws are the ones the
 * analysis always made, in the same order, so a seed keeps its cloud.
 *
 * The yield comes with its Wilson 95 % interval: 870 passes in 1000 runs is
 * a yield between 84.8 and 88.9 %, not 87.0 %.
 */
import { cabs, type Complex } from './complex.js';
import { vswr as vswrOf, zToGamma } from './conversions.js';
import { ladderAbcd, type Element } from './elements.js';
import { throughAbcd } from './abcd.js';
import type { Ladder } from './ladder.js';
import { OPTIMIZE_FAIL, worstVswr, type LoadModel } from './optimize.js';
import { vswrTowards } from './realize/mismatch.js';
import type { PartKind } from './realize/snap.js';
import type { ParameterRef, SensitivityParameter } from './sensitivity.js';

export type ToleranceDistribution = 'uniform' | 'normal';

/** Correlation coefficient per part kind, 0 to 1; a missing kind is 0 (independent parts). */
export type ToleranceCorrelation = Partial<Readonly<Record<PartKind, number>>>;

export interface MonteCarloOptions {
  /** Number of runs. */
  readonly runs: number;
  readonly seed?: number;
  readonly distribution?: ToleranceDistribution;
  /** Tolerance of every lumped part as a fraction (0.05 for 5 percent). */
  readonly tolerance: number;
  /** Tolerance per element index as a fraction, replacing the default (0 keeps the element exact; lines and transformers only vary with an entry here). */
  readonly overrides?: Readonly<Record<number, number>>;
  /** Elements kept exact whatever the default says. */
  readonly exact?: readonly number[];
  /** Parts of one kind drift together with this correlation coefficient (see the file comment). */
  readonly correlation?: ToleranceCorrelation;
  /**
   * The impedance the VSWR is referred to (see vswrTowards); default the real
   * Z0, computed as it always was.
   */
  readonly target?: Complex;
  /** VSWR a run must stay at or below to count as a pass. */
  readonly vswrLimit: number;
  /** When given, a run passes only if its worst VSWR over these frequencies is within the limit. */
  readonly band?: readonly number[];
  /** The load over the band (a measured load); default the ladder's fixed load. The design frequency always uses the ladder's load. */
  readonly load?: LoadModel;
  /** Histogram bins. Default 20. */
  readonly bins?: number;
  /** Progress every 2 percent of the runs: runs done, runs in all, runs passed so far. */
  readonly onProgress?: (done: number, total: number, passed: number) => void;
}

export interface VswrHistogram {
  /** bins + 1 edges from 1 upwards. */
  readonly edges: readonly number[];
  readonly counts: readonly number[];
  /** Runs above the last edge, counted in the last bin as well. */
  readonly overflow: number;
}

export interface MonteCarloResult {
  readonly runs: number;
  /** Input impedance of each run at the design frequency, ohm. */
  readonly re: Float64Array;
  readonly im: Float64Array;
  /** VSWR of each run at the design frequency. */
  readonly vswr: Float64Array;
  /** Worst VSWR over `band` per run; empty without a band. */
  readonly worst: Float64Array;
  /** The same quantities for the unperturbed ladder. */
  readonly nominal: { readonly zin: Complex; readonly vswr: number; readonly worst: number | null };
  readonly vswrLimit: number;
  /** Runs within the limit. */
  readonly passed: number;
  /**
   * The run with the largest judged VSWR (the one the yield counts: the band worst case when
   * judged over a band), 0-based; the first such run on a tie.
   */
  readonly worstRun: number;
  /** passed / runs. */
  readonly yield: number;
  /** Wilson 95 % confidence interval of the yield. */
  readonly interval: { readonly lo: number; readonly hi: number };
  readonly histogram: VswrHistogram;
  /** Statistics of the VSWR at the design frequency; the yield uses the band when one is given. */
  readonly stats: {
    readonly min: number;
    readonly max: number;
    readonly mean: number;
    readonly median: number;
    /** 95th percentile of the VSWR at the design frequency. */
    readonly p95: number;
  };
}

/** xorshift32, uniform in [0, 1). */
export function seededRandom(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

/**
 * The standard normal cumulative distribution, Phi(x) = erfc(-x / sqrt 2) / 2,
 * with erfc from the Chebyshev fit of Numerical Recipes (relative error below
 * 1.2e-7 everywhere).
 */
export function normalCdf(x: number): number {
  const z = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.5 * z);
  const poly =
    -1.26551223 +
    t *
      (1.00002368 +
        t *
          (0.37409196 +
            t *
              (0.09678418 +
                t *
                  (-0.18628806 +
                    t *
                      (0.27886807 +
                        t *
                          (-1.13520398 +
                            t * (1.48851587 + t * (-0.82215223 + t * 0.17087277))))))));
  const erfc = t * Math.exp(-z * z + poly);
  return x >= 0 ? 1 - erfc / 2 : erfc / 2;
}

const CORRELATED_KINDS: readonly PartKind[] = ['L', 'C', 'R'];

/** A correlation coefficient as used: finite and clamped to 0 to 0.999; anything else is 0. */
export function usableCorrelation(r: number | undefined): number {
  return r !== undefined && Number.isFinite(r) && r > 0 ? Math.min(r, 0.999) : 0;
}

export interface SamplerOptions {
  readonly seed?: number;
  readonly distribution?: ToleranceDistribution;
  readonly correlation?: ToleranceCorrelation;
}

/**
 * A generator of relative deviations: each call returns one run, a value in
 * [-1, 1] (uniform) or with standard deviation 1/3 (normal) per slot, the
 * slots correlated by kind as the options say (null: never correlated, a
 * line, stub or transformer). Seeded and deterministic.
 */
export function toleranceSampler(
  kinds: readonly (PartKind | null)[],
  options: SamplerOptions = {},
): () => number[] {
  const rand = seededRandom(options.seed ?? 20261023);
  const normal = options.distribution === 'normal';
  const gauss = (): number => {
    // Box-Muller.
    const u = Math.max(rand(), 1e-12);
    const v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  // The draw the analysis always made: uniform in the band, or normal with the band as 3 sigma.
  const plain = (): number => (normal ? gauss() / 3 : 2 * rand() - 1);
  // The correlation of the normal factors that gives the requested one in the draws.
  const latent = new Map<PartKind, number>();
  for (const k of CORRELATED_KINDS) {
    const rho = usableCorrelation(options.correlation?.[k]);
    if (rho > 0 && kinds.includes(k)) {
      latent.set(k, normal ? rho : 2 * Math.sin((Math.PI * rho) / 6));
    }
  }
  return () => {
    const common = new Map<PartKind, number>();
    for (const k of CORRELATED_KINDS) if (latent.has(k)) common.set(k, gauss());
    return kinds.map((k) => {
      const r = k === null ? undefined : latent.get(k);
      if (k === null || r === undefined) return plain();
      const z = Math.sqrt(r) * (common.get(k) as number) + Math.sqrt(1 - r) * gauss();
      return normal ? z / 3 : 2 * normalCdf(z) - 1;
    });
  };
}

/** One varied quantity: which element, which of its parameters, its kind for correlation. */
export interface ToleranceSlot {
  readonly ref: ParameterRef;
  readonly kind: PartKind | null;
  /** Tolerance as a fraction. */
  readonly tolerance: number;
}

/**
 * The tolerance of each element as the analysis applies it: 0 for a part
 * kept exact, its own entry in `overrides` when it has one, the default for
 * a lumped part, 0 for lines, stubs and transformers without an entry.
 * Tolerances that are not positive finite numbers count as 0.
 */
export function elementTolerances(
  elements: readonly Element[],
  options: Pick<MonteCarloOptions, 'tolerance' | 'overrides' | 'exact'>,
): number[] {
  const exact = new Set(options.exact ?? []);
  return elements.map((el, i) => {
    if (exact.has(i)) return 0;
    const own = options.overrides?.[i];
    if (own !== undefined) return Number.isFinite(own) && own > 0 ? own : 0;
    if (
      el.kind === 'transformer' ||
      el.kind === 'line' ||
      el.kind === 'openStub' ||
      el.kind === 'shortStub' ||
      el.kind === 'microstrip'
    ) {
      return 0;
    }
    return Number.isFinite(options.tolerance) && options.tolerance > 0 ? options.tolerance : 0;
  });
}

/**
 * The quantities a run varies, in the order the draws are made: every
 * element with a tolerance, an RLC block's r, l and c in that order (each
 * one that is set), a line's or stub's length, a transformer's ratio. A
 * quantity that is not a positive finite number (a part typed as 0, a
 * zero-length line, a ratio of 0) has no relative draw and no slot: 5 % of
 * nothing is nothing, and its derivative is not finite.
 */
export function toleranceSlots(
  elements: readonly Element[],
  tols: readonly number[],
): ToleranceSlot[] {
  const out: ToleranceSlot[] = [];
  elements.forEach((el, index) => {
    const tolerance = tols[index] ?? 0;
    if (!(tolerance > 0)) return;
    const slot = (
      parameter: SensitivityParameter,
      kind: PartKind | null,
      value: number | undefined,
    ): void => {
      if (value === undefined || !Number.isFinite(value) || value === 0) return;
      // Only a ratio may be negative (a phase inversion); a part value or a length may not.
      if (value < 0 && parameter !== 'n') return;
      out.push({ ref: { index, parameter }, kind, tolerance });
    };
    switch (el.kind) {
      case 'R':
      case 'L':
      case 'C':
        slot('value', el.kind, el.value);
        break;
      case 'RLC':
        slot('r', 'R', el.r);
        slot('l', 'L', el.l);
        slot('c', 'C', el.c);
        break;
      case 'transformer':
        slot('n', null, el.n);
        break;
      case 'line':
      case 'openStub':
      case 'shortStub':
      case 'microstrip':
        slot('length', null, el.length);
        break;
    }
  });
  return out;
}

function scaleParameter(el: Element, p: SensitivityParameter, k: number): Element {
  switch (el.kind) {
    case 'R':
    case 'L':
    case 'C':
      return p === 'value' ? { ...el, value: el.value * k } : el;
    case 'RLC':
      if (p === 'r' && el.r !== undefined) return { ...el, r: el.r * k };
      if (p === 'l' && el.l !== undefined) return { ...el, l: el.l * k };
      if (p === 'c' && el.c !== undefined) return { ...el, c: el.c * k };
      return el;
    case 'transformer':
      return p === 'n' ? { ...el, n: el.n * k } : el;
    case 'line':
    case 'openStub':
    case 'shortStub':
    case 'microstrip':
      return p === 'length' ? { ...el, length: el.length * k } : el;
  }
}

/** The ladder with each slot's quantity multiplied by max(1e-3, 1 + tolerance * deviation). */
export function applyDeviations(
  elements: readonly Element[],
  slots: readonly ToleranceSlot[],
  deviations: ArrayLike<number>,
): Element[] {
  const out = elements.slice();
  slots.forEach((s, k) => {
    const factor = Math.max(1e-3, 1 + s.tolerance * (deviations[k] as number));
    out[s.ref.index] = scaleParameter(out[s.ref.index] as Element, s.ref.parameter, factor);
  });
  return out;
}

/** z for a two-sided 95 % interval. */
export const Z95 = 1.959963984540054;

/**
 * The Wilson score interval of a pass fraction: `passed` of `n` runs, at the
 * normal quantile z (95 % by default). Unlike p +/- z sqrt(p (1 - p) / n) it
 * stays inside [0, 1] and is not empty at 0 or n passes.
 */
export function wilsonInterval(
  passed: number,
  n: number,
  z = Z95,
): { readonly lo: number; readonly hi: number } {
  if (!(n > 0)) return { lo: 0, hi: 1 };
  const p = Math.min(1, Math.max(0, passed / n));
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return { lo: Math.max(0, centre - half), hi: Math.min(1, centre + half) };
}

function zinAt(elements: readonly Element[], ladder: Ladder): Complex {
  return throughAbcd(ladderAbcd(elements, ladder.frequency), ladder.load);
}

function vswrAt(z: Complex, z0: number, target?: Complex): number {
  if (target) return vswrTowards(z, target);
  const g = cabs(zToGamma(z, z0));
  return Number.isFinite(g) && g < 1 ? vswrOf(g) : Infinity;
}

/** What a run is judged by. */
export interface JudgeOptions {
  readonly band?: readonly number[];
  readonly load?: LoadModel;
  readonly target?: Complex;
}

/**
 * The number a run is judged by: the VSWR at the design frequency, or the
 * larger of it and the worst VSWR over the band when one is given (Infinity
 * for a total reflection). The corners and design centring judge the same way.
 */
export function judgedVswr(
  elements: readonly Element[],
  ladder: Ladder,
  options: JudgeOptions = {},
): number {
  const v = vswrAt(zinAt(elements, ladder), ladder.z0, options.target);
  const band = options.band && options.band.length > 0 ? options.band : null;
  if (!band) return v;
  const w = worstVswr(elements, options.load ?? ladder.load, ladder.z0, band, options.target);
  return Math.max(v, w >= OPTIMIZE_FAIL ? Infinity : w);
}

function percentile(sorted: ArrayLike<number>, p: number): number {
  if (sorted.length === 0) return NaN;
  const pos = (sorted.length - 1) * p;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return (sorted[lo] as number) + ((sorted[hi] as number) - (sorted[lo] as number)) * (pos - lo);
}

/**
 * Histogram of VSWR values between 1 and `hi`; values above `hi` land in the
 * last bin. Plain loops throughout: a spread of 100000 runs into Math.max
 * overflows the call stack.
 */
export function vswrHistogram(values: ArrayLike<number>, bins: number, cap = 10): VswrHistogram {
  const n = Number.isFinite(bins) && bins >= 1 ? Math.floor(bins) : 20;
  let largest = -Infinity;
  for (let i = 0; i < values.length; i++) {
    const v = values[i] as number;
    if (Number.isFinite(v) && v > largest) largest = v;
  }
  const top = Math.min(cap, largest > -Infinity ? largest : 1);
  const hi = top > 1.0001 ? top : 1.01;
  const edges = Array.from({ length: n + 1 }, (_, i) => 1 + ((hi - 1) * i) / n);
  const counts = new Array<number>(n).fill(0);
  let overflow = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i] as number;
    let bin: number;
    if (!Number.isFinite(v) || v > hi) {
      bin = n - 1;
      overflow++;
    } else {
      bin = Math.min(n - 1, Math.max(0, Math.floor(((v - 1) / (hi - 1)) * n)));
    }
    counts[bin] = (counts[bin] as number) + 1;
  }
  return { edges, counts, overflow };
}

/** The sampler options of an analysis. */
export function samplerOptions(
  options: Pick<MonteCarloOptions, 'seed' | 'distribution' | 'correlation'>,
): SamplerOptions {
  return {
    ...(options.seed !== undefined ? { seed: options.seed } : {}),
    ...(options.distribution ? { distribution: options.distribution } : {}),
    ...(options.correlation ? { correlation: options.correlation } : {}),
  };
}

/** Run the analysis. Tolerances that are not positive finite numbers count as 0. */
export function monteCarlo(ladder: Ladder, options: MonteCarloOptions): MonteCarloResult {
  const runs = Number.isFinite(options.runs)
    ? Math.max(1, Math.min(1e6, Math.floor(options.runs)))
    : 1;
  const tols = elementTolerances(ladder.elements, options);
  const slots = toleranceSlots(ladder.elements, tols);
  const sample = toleranceSampler(
    slots.map((sl) => sl.kind),
    samplerOptions(options),
  );
  const band = options.band && options.band.length > 0 ? options.band : null;
  const target = options.target;

  const re = new Float64Array(runs);
  const im = new Float64Array(runs);
  const vswr = new Float64Array(runs);
  const worst = new Float64Array(band ? runs : 0);
  let passed = 0;
  let worstRun = 0;
  let worstValue = -Infinity;

  const loadOf: LoadModel = options.load ?? ladder.load;
  const progressEvery = Math.max(1, Math.floor(runs / 50));
  for (let r = 0; r < runs; r++) {
    const els = applyDeviations(ladder.elements, slots, sample());
    const z = zinAt(els, ladder);
    re[r] = z.re;
    im[r] = z.im;
    const v = vswrAt(z, ladder.z0, target);
    vswr[r] = v;
    let value = v;
    if (band) {
      const w = worstVswr(els, loadOf, ladder.z0, band, target);
      worst[r] = w >= OPTIMIZE_FAIL ? Infinity : w;
      value = Math.max(v, worst[r] as number);
    }
    if (value <= options.vswrLimit) passed++;
    // NaN never wins; Infinity (a total reflection) does.
    if (value > worstValue) {
      worstValue = value;
      worstRun = r;
    }
    if ((r + 1) % progressEvery === 0) options.onProgress?.(r + 1, runs, passed);
  }
  options.onProgress?.(runs, runs, passed);

  const nominalZ = zinAt(ladder.elements, ladder);
  const nominalWorst = band ? worstVswr(ladder.elements, loadOf, ladder.z0, band, target) : null;
  const sorted = Float64Array.from(vswr).sort();
  let sum = 0;
  let finiteCount = 0;
  for (let i = 0; i < sorted.length; i++) {
    const v = sorted[i] as number;
    if (Number.isFinite(v)) {
      sum += v;
      finiteCount++;
    }
  }
  return {
    runs,
    re,
    im,
    vswr,
    worst,
    nominal: {
      zin: nominalZ,
      vswr: vswrAt(nominalZ, ladder.z0, target),
      worst: nominalWorst === null ? null : nominalWorst >= OPTIMIZE_FAIL ? Infinity : nominalWorst,
    },
    vswrLimit: options.vswrLimit,
    passed,
    worstRun,
    yield: passed / runs,
    interval: wilsonInterval(passed, runs),
    histogram: vswrHistogram(vswr, options.bins ?? 20),
    stats: {
      min: sorted[0] as number,
      max: sorted[sorted.length - 1] as number,
      mean: finiteCount > 0 ? sum / finiteCount : Infinity,
      median: percentile(sorted, 0.5),
      p95: percentile(sorted, 0.95),
    },
  };
}
