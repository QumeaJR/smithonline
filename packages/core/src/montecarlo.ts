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
 */
import { cabs, type Complex } from './complex.js';
import { vswr as vswrOf, zToGamma } from './conversions.js';
import { ladderAbcd, type Element } from './elements.js';
import { throughAbcd } from './abcd.js';
import type { Ladder } from './ladder.js';
import { OPTIMIZE_FAIL, worstVswr } from './optimize.js';

export type ToleranceDistribution = 'uniform' | 'normal';

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
  /** VSWR a run must stay at or below to count as a pass. */
  readonly vswrLimit: number;
  /** When given, a run passes only if its worst VSWR over these frequencies is within the limit. */
  readonly band?: readonly number[];
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
  /** passed / runs. */
  readonly yield: number;
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
function seeded(seed: number): () => number {
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

function perturb(el: Element, d: () => number, tol: number): Element {
  if (!(tol > 0)) return el;
  const k = (): number => Math.max(1e-3, 1 + tol * d());
  switch (el.kind) {
    case 'R':
    case 'L':
    case 'C':
      return { ...el, value: el.value * k() };
    case 'RLC':
      return {
        ...el,
        ...(el.r !== undefined ? { r: el.r * k() } : {}),
        ...(el.l !== undefined ? { l: el.l * k() } : {}),
        ...(el.c !== undefined ? { c: el.c * k() } : {}),
      };
    case 'transformer':
      return { ...el, n: el.n * k() };
    case 'line':
    case 'openStub':
    case 'shortStub':
      return { ...el, length: el.length * k() };
  }
}

function zinAt(elements: readonly Element[], ladder: Ladder): Complex {
  return throughAbcd(ladderAbcd(elements, ladder.frequency), ladder.load);
}

function vswrAt(z: Complex, z0: number): number {
  const g = cabs(zToGamma(z, z0));
  return Number.isFinite(g) && g < 1 ? vswrOf(g) : Infinity;
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

/** Run the analysis. Tolerances that are not positive finite numbers count as 0. */
export function monteCarlo(ladder: Ladder, options: MonteCarloOptions): MonteCarloResult {
  const runs = Number.isFinite(options.runs)
    ? Math.max(1, Math.min(1e6, Math.floor(options.runs)))
    : 1;
  const rand = seeded(options.seed ?? 20261023);
  const normal = options.distribution === 'normal';
  const draw = (): number => {
    if (!normal) return 2 * rand() - 1;
    // Box-Muller; the band is three standard deviations.
    const u = Math.max(rand(), 1e-12);
    const v = rand();
    return (Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)) / 3;
  };
  const exact = new Set(options.exact ?? []);
  const tolOf = (el: Element, i: number): number => {
    if (exact.has(i)) return 0;
    const own = options.overrides?.[i];
    if (own !== undefined) return Number.isFinite(own) && own > 0 ? own : 0;
    if (
      el.kind === 'transformer' ||
      el.kind === 'line' ||
      el.kind === 'openStub' ||
      el.kind === 'shortStub'
    ) {
      return 0;
    }
    return Number.isFinite(options.tolerance) && options.tolerance > 0 ? options.tolerance : 0;
  };
  const tols = ladder.elements.map(tolOf);
  const band = options.band && options.band.length > 0 ? options.band : null;

  const re = new Float64Array(runs);
  const im = new Float64Array(runs);
  const vswr = new Float64Array(runs);
  const worst = new Float64Array(band ? runs : 0);
  let passed = 0;

  const loadOf = ladder.load;
  const progressEvery = Math.max(1, Math.floor(runs / 50));
  for (let r = 0; r < runs; r++) {
    const els = ladder.elements.map((el, i) => perturb(el, draw, tols[i] as number));
    const z = zinAt(els, ladder);
    re[r] = z.re;
    im[r] = z.im;
    const v = vswrAt(z, ladder.z0);
    vswr[r] = v;
    let value = v;
    if (band) {
      const w = worstVswr(els, loadOf, ladder.z0, band);
      worst[r] = w >= OPTIMIZE_FAIL ? Infinity : w;
      value = Math.max(v, worst[r] as number);
    }
    if (value <= options.vswrLimit) passed++;
    if ((r + 1) % progressEvery === 0) options.onProgress?.(r + 1, runs, passed);
  }
  options.onProgress?.(runs, runs, passed);

  const nominalZ = zinAt(ladder.elements, ladder);
  const nominalWorst = band ? worstVswr(ladder.elements, loadOf, ladder.z0, band) : null;
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
      vswr: vswrAt(nominalZ, ladder.z0),
      worst: nominalWorst === null ? null : nominalWorst >= OPTIMIZE_FAIL ? Infinity : nominalWorst,
    },
    vswrLimit: options.vswrLimit,
    passed,
    yield: passed / runs,
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
