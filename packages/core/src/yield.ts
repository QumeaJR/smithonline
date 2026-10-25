/**
 * Worst-case corners and design centring (D3).
 *
 * Corners. Every varied part at one end of its tolerance band, in the
 * direction that hurts. The directions come from the sensitivities
 * (sensitivity.ts): at each judged frequency the change of Gamma is
 * linearized, dGamma = sum_i a_i delta_i with a_i = dGamma/dp_i p_i tol_i,
 * and the corner that pushes Gamma furthest along a direction theta takes
 * delta_i = sign(Re(a_i e^(-j theta))). Theta along the nominal Gamma gives
 * the first-order worst |Gamma|; at a perfect match, where Gamma has no
 * direction, sixteen directions round the circle are tried. The corners of
 * the gradient signs of the worst VSWR and of its smooth power mean are
 * added. Every candidate is then evaluated with the full network (no
 * linearization in the answer), and with at most `exhaustive` varied
 * quantities (10 by default, 1024 corners) every corner is evaluated as
 * well, so the reported corner is the worst of all of them and the report
 * says whether the sensitivities found it. Correlation does not change the
 * corners: the worst case is the worst case.
 *
 * A corner is not a bound. When the response is monotonic in every part
 * across the tolerance box, the worst draw is at a corner; when it is not
 * (a resonance inside the box, a line whose length tolerance swings the
 * impedance through its peak, a resistor that is best at its nominal value,
 * low-Q parts with a large tolerance) a draw inside the box, or the nominal
 * network itself, is worse than every corner. A normal draw (the band is 3
 * sigma) can also go past a corner. The worst case reported is therefore
 * the largest of the nominal network, every corner evaluated and, when the
 * caller gives them, the Monte Carlo runs of the same analysis, and it says
 * which of them it is (`source`).
 *
 * Design centring. Moves the nominal values to maximize the yield over the
 * judged band within the tolerances, the way it is done in practice:
 *
 * 1. A fixed set of draws (300 by default; common random numbers, seeded, correlated as the
 *    tolerance settings say) is used for every candidate, so two candidates
 *    are compared on the same parts and the yield estimate is a
 *    deterministic function of the nominal values.
 * 2. Mean shifting: the nominal moves to the mean (in log) of the draws that
 *    pass, the centre of gravity of the acceptable region (Soin and Spence),
 *    while that raises the yield on the fixed draws.
 * 3. Nelder-Mead in log coordinates on the smoothed yield, the mean of a
 *    logistic of the margin (Gamma limit minus the run's worst |Gamma|) over
 *    the fixed draws, first with a wide logistic and then a narrow one; the
 *    count of passes is a step function the simplex could not walk on.
 * 4. Each value stays within its realizable range (the optimizer's bounds:
 *    lumped parts between Z0 / 25 and 10 Z0 of reactance at band centre,
 *    lengths between 10 and 170 degrees) and within half to twice its value.
 * 5. With a value source (Realize), the centred values snap to the series
 *    or the stock afterwards: each snapped part takes the series value just
 *    below or just above its centred value, or keeps its value as given, and
 *    the combination with the best yield on the fixed draws wins.
 * 6. The yield before and after is measured again on a fresh, larger set of
 *    draws (a different seed), with Wilson intervals, so the reported gain is
 *    not the optimism of the set it was optimized on. The gain counts
 *    (`significant`) only when the after interval lies above the before
 *    interval, or the gain exceeds the two half-widths together; a smaller
 *    difference is within what 2000 runs can tell apart.
 */
import { cabs, type Complex } from './complex.js';
import { throughAbcd } from './abcd.js';
import { ladderAbcd, type Element } from './elements.js';
import type { Ladder } from './ladder.js';
import {
  applyDeviations,
  elementTolerances,
  judgedVswr,
  samplerOptions,
  toleranceSampler,
  toleranceSlots,
  wilsonInterval,
  type JudgeOptions,
  type MonteCarloOptions,
  type ToleranceSlot,
} from './montecarlo.js';
import {
  nelderMead,
  parameterBound,
  primaryValueOf,
  withPrimaryValue,
  type LoadModel,
} from './optimize.js';
import { gammaTowards } from './realize/mismatch.js';
import { seriesNeighbors, stockNeighbors } from './realize/eSeries.js';
import type { RealizeScope, ValueSource } from './realize/snap.js';
import { zToGamma } from './conversions.js';
import {
  bandSensitivity,
  parameterValue,
  type BandSensitivity,
  type PointSensitivity,
} from './sensitivity.js';

/** How the parts vary: the tolerance settings of the Monte Carlo analysis. */
export type ToleranceSpec = Pick<
  MonteCarloOptions,
  'tolerance' | 'overrides' | 'exact' | 'distribution' | 'correlation'
>;

/* ---------------------------------------------------------------- corners */

export interface CornerOptions extends ToleranceSpec, JudgeOptions {
  /** Evaluate every corner as well when there are at most this many varied quantities. Default 10. */
  readonly exhaustive?: number;
  /**
   * Monte Carlo runs of the same analysis (same seed and settings as monteCarlo): every run is
   * drawn and judged here and the worst joins the worst case. A caller that has run the
   * analysis already passes `worstRun` instead.
   */
  readonly runs?: number;
  readonly seed?: number;
  /**
   * The run of the same Monte Carlo analysis with the largest judged VSWR, as monteCarlo
   * reports it (`worstRun`): only that run is drawn again and judged.
   */
  readonly worstRun?: number;
}

/** Where the worst case came from. */
export type WorstCaseSource = 'nominal' | 'corner' | 'sample';

export interface Corner {
  /**
   * The relative deviation of each slot, -1 to +1 of its tolerance band: -1 or +1 at a
   * corner, 0 for the nominal network, the drawn value for a Monte Carlo run.
   */
  readonly signs: readonly number[];
  /** The judged VSWR there (Infinity for a total reflection). */
  readonly vswr: number;
  readonly elements: readonly Element[];
  readonly source: WorstCaseSource;
  /** The Monte Carlo run (0-based), for a sample. */
  readonly run?: number;
}

export interface CornerResult {
  readonly slots: readonly ToleranceSlot[];
  /** The network analysed, nominal values: the slots' references index into it. */
  readonly elements: readonly Element[];
  /** The judged VSWR of the nominal network. */
  readonly nominal: number;
  /**
   * The worst case: the largest judged VSWR of the nominal network, every corner evaluated
   * and the Monte Carlo runs given (see the file comment), with its source.
   */
  readonly worst: Corner;
  /** The worst corner found (every part at a tolerance limit). */
  readonly corner: Corner;
  /** The worst of the corners the sensitivities proposed. */
  readonly fromSensitivity: Corner;
  /** The worst Monte Carlo run, when runs were given. */
  readonly sample?: Corner;
  /** True when every corner was evaluated (2^slots of them). */
  readonly exhaustive: boolean;
  /** Corners evaluated in all. */
  readonly evaluated: number;
}

function judgeFrequencies(ladder: Ladder, options: JudgeOptions): { f: number; z: Complex }[] {
  const out = [{ f: ladder.frequency, z: ladder.load }];
  const load: LoadModel = options.load ?? ladder.load;
  for (const f of options.band ?? []) {
    out.push({ f, z: typeof load === 'function' ? load(f) : load });
  }
  return out;
}

/**
 * The corners the sensitivities propose (see the file comment), as -1 / +1 per parameter of
 * `sens`: the gradient signs of the worst VSWR and of its smooth power mean, then at every
 * judged frequency the corner pushing Gamma furthest along its own direction (where Gamma is
 * not 0) and along sixteen directions round the circle. `scale` is each parameter's value
 * times its tolerance (its sign flips the direction).
 */
export function cornerCandidates(sens: BandSensitivity, scale: readonly number[]): number[][] {
  const sign = (v: number): number => (v < 0 ? -1 : 1);
  const candidates: number[][] = [];
  candidates.push(sens.worst.dVswr.map(sign));
  candidates.push(sens.smooth.dValue.map(sign));
  const directions = Array.from({ length: 16 }, (_, j) => (2 * Math.PI * j) / 16);
  sens.points.forEach((pt: PointSensitivity) => {
    const thetas =
      pt.gammaMag > 0 ? [Math.atan2(pt.gamma.im, pt.gamma.re), ...directions] : directions;
    for (const theta of thetas) {
      const c = Math.cos(theta);
      const s = Math.sin(theta);
      candidates.push(pt.dGamma.map((d, i) => sign((d.re * c + d.im * s) * (scale[i] as number))));
    }
  });
  return candidates;
}

/**
 * The worst case of the network under its tolerances (see the file comment). Null when
 * nothing varies.
 */
export function worstCorner(ladder: Ladder, options: CornerOptions): CornerResult | null {
  const tols = elementTolerances(ladder.elements, options);
  const slots = toleranceSlots(ladder.elements, tols);
  if (slots.length === 0) return null;
  const refs = slots.map((s) => s.ref);
  const judge: JudgeOptions = {
    ...(options.band ? { band: options.band } : {}),
    ...(options.load ? { load: options.load } : {}),
    ...(options.target ? { target: options.target } : {}),
  };
  const nominal = judgedVswr(ladder.elements, ladder, judge);
  const seen = new Map<string, Corner>();
  const evaluate = (signs: readonly number[]): Corner => {
    const key = signs.map((s) => (s > 0 ? '+' : '-')).join('');
    const hit = seen.get(key);
    if (hit) return hit;
    const elements = applyDeviations(ladder.elements, slots, signs);
    const corner: Corner = {
      signs,
      vswr: judgedVswr(elements, ladder, judge),
      elements,
      source: 'corner',
    };
    seen.set(key, corner);
    return corner;
  };

  // Candidates from the sensitivities at every judged frequency.
  const points = judgeFrequencies(ladder, options);
  const sens = bandSensitivity(
    ladder.elements,
    (f: number) => (points.find((p) => p.f === f) as { z: Complex }).z,
    ladder.z0,
    points.map((p) => p.f),
    { parameters: refs, ...(options.target ? { target: options.target } : {}) },
  );
  const scale = slots.map(
    (s) => parameterValue(ladder.elements[s.ref.index] as Element, s.ref.parameter) * s.tolerance,
  );
  const candidates = cornerCandidates(sens, scale);
  let fromSensitivity: Corner | null = null;
  for (const signs of candidates) {
    const corner = evaluate(signs);
    if (!fromSensitivity || corner.vswr > fromSensitivity.vswr) fromSensitivity = corner;
  }
  let corner = fromSensitivity as Corner;
  const limit = options.exhaustive ?? 10;
  const exhaustive = slots.length <= limit;
  if (exhaustive) {
    for (let mask = 0; mask < 1 << slots.length; mask++) {
      const c = evaluate(slots.map((_, i) => ((mask >> i) & 1 ? 1 : -1)));
      if (c.vswr > corner.vswr) corner = c;
    }
  }
  const evaluated = seen.size;

  // The Monte Carlo runs of the same analysis: the draws monteCarlo makes, in its order.
  let sample: Corner | undefined;
  const only = options.worstRun;
  const runs =
    only !== undefined && Number.isFinite(only) && only >= 0
      ? Math.floor(only) + 1
      : options.runs !== undefined && Number.isFinite(options.runs)
        ? Math.max(0, Math.min(1e6, Math.floor(options.runs)))
        : 0;
  if (runs > 0) {
    const next = toleranceSampler(
      slots.map((s) => s.kind),
      samplerOptions(options),
    );
    const every = only === undefined;
    for (let r = 0; r < runs; r++) {
      const d = next();
      if (!every && r < runs - 1) continue;
      const elements = applyDeviations(ladder.elements, slots, d);
      const vswr = judgedVswr(elements, ladder, judge);
      if (!sample || vswr > sample.vswr) {
        sample = { signs: d, vswr, elements, source: 'sample', run: r };
      }
    }
  }

  // The worst case: the worst corner unless the nominal network or a run is worse.
  let worst = corner;
  if (nominal > worst.vswr) {
    worst = {
      signs: slots.map(() => 0),
      vswr: nominal,
      elements: ladder.elements,
      source: 'nominal',
    };
  }
  if (sample && sample.vswr > worst.vswr) worst = sample;
  return {
    slots,
    elements: ladder.elements,
    nominal,
    worst,
    corner,
    fromSensitivity: fromSensitivity as Corner,
    ...(sample ? { sample } : {}),
    exhaustive,
    evaluated,
  };
}

/* ------------------------------------------------------------- centring */

export interface YieldEstimate {
  readonly passed: number;
  readonly runs: number;
  readonly yield: number;
  /** Wilson 95 % interval. */
  readonly interval: { readonly lo: number; readonly hi: number };
}

export interface CentreProgress {
  readonly stage: 'centring' | 'snapping' | 'checking';
  /** Yield evaluations so far and the budget. */
  readonly done: number;
  readonly total: number;
  /** Best yield on the fixed draws so far. */
  readonly best: number;
}

export interface CentreOptions extends ToleranceSpec, JudgeOptions {
  /** VSWR a run must stay at or below to pass. */
  readonly vswrLimit: number;
  /** Draws in the fixed set the search compares candidates on. Default 300. */
  readonly samples?: number;
  readonly seed?: number;
  /** Draws for the before and after check. Default 2000. */
  readonly validationRuns?: number;
  /** Seed of the check; default the search seed plus 7919. */
  readonly validationSeed?: number;
  /** Snap the centred values to this series or stock afterwards (Realize on). */
  readonly realize?: { readonly source: ValueSource; readonly scope: RealizeScope };
  /** Budget of yield evaluations on the fixed draws. Default 600. */
  readonly maxEvaluations?: number;
  readonly onProgress?: (p: CentreProgress) => void;
}

/** A centred part at the edge of the range it may move in. */
export interface CentreEdge {
  readonly index: number;
  readonly side: 'low' | 'high';
  /** The edge as a factor of the value as given: 0.5 or 2 at half or twice it, else the realizable bound. */
  readonly factor: number;
}

export interface CentreResult {
  /** The elements whose values the search moved (the result's value differs from the one given). */
  readonly indices: readonly number[];
  /** The elements the search could move (unlocked, with a primary value; RLC blocks stay). */
  readonly movable: readonly number[];
  /** The ladder's elements with the centred (and snapped) values. */
  readonly elements: readonly Element[];
  /** Yield of the network as given and as centred, on the fresh check draws. */
  readonly before: YieldEstimate;
  readonly after: YieldEstimate;
  /** The same on the fixed draws the search used. */
  readonly searchBefore: number;
  readonly searchAfter: number;
  /** The centred values before snapping and their yield on the check draws (with a value source). */
  readonly continuous?: { readonly elements: readonly Element[]; readonly yield: YieldEstimate };
  /** True when the check draws give more passes after than before. */
  readonly improved: boolean;
  /**
   * True when the gain is more than the check can resolve: the after interval lies above the
   * before interval, or the gain exceeds the sum of their half-widths.
   */
  readonly significant: boolean;
  /** The judged VSWR of the nominal network as given and as centred: what centring trades. */
  readonly nominal: { readonly before: number; readonly after: number };
  /** Centred values (before snapping) that sit at the edge of their range. */
  readonly edges: readonly CentreEdge[];
  readonly evaluations: number;
}

/** Whether `after` is better than `before` by more than the two Wilson intervals can tell apart. */
export function significantGain(before: YieldEstimate, after: YieldEstimate): boolean {
  if (after.interval.lo > before.interval.hi) return true;
  const half = (y: YieldEstimate): number => (y.interval.hi - y.interval.lo) / 2;
  return after.yield - before.yield > half(before) + half(after);
}

/** |Gamma| of a VSWR. */
function gammaLimit(vswr: number): number {
  return vswr === Infinity ? 1 : (vswr - 1) / (vswr + 1);
}

/** An evaluator of the judged worst |Gamma| over fixed frequencies and loads. */
function makeJudge(
  ladder: Ladder,
  options: JudgeOptions,
): (elements: readonly Element[], stopAbove: number) => number {
  const points = judgeFrequencies(ladder, options);
  const target = options.target;
  return (elements, stopAbove) => {
    let worst = 0;
    for (const { f, z } of points) {
      const zin = throughAbcd(ladderAbcd(elements, f), z);
      const g = target ? gammaTowards(zin, target) : cabs(zToGamma(zin, ladder.z0));
      if (!Number.isFinite(g) || g >= 1) return 1;
      if (g > worst) {
        worst = g;
        if (worst > stopAbove) return worst;
      }
    }
    return worst;
  };
}

function estimate(passed: number, runs: number): YieldEstimate {
  return { passed, runs, yield: passed / runs, interval: wilsonInterval(passed, runs) };
}

/** Whether a part kind is in the Realize scope. */
function inScope(scope: RealizeScope, kind: 'R' | 'L' | 'C'): boolean {
  return scope === 'all' || scope === 'pairs' || scope === kind;
}

/**
 * Centre the design for the best yield under its tolerances (see the file
 * comment). Elements kept exact (`exact`, the locked parts) do not move;
 * RLC blocks stay as they are, as in the band optimizer.
 */
export function centreDesign(ladder: Ladder, options: CentreOptions): CentreResult {
  const tols = elementTolerances(ladder.elements, options);
  const slots = toleranceSlots(ladder.elements, tols);
  const exact = new Set(options.exact ?? []);
  const movable = ladder.elements
    .map((el, i) => ({ el, i }))
    .filter(({ el, i }) => {
      const v = primaryValueOf(el);
      return !exact.has(i) && v !== null && v > 0 && Number.isFinite(v);
    })
    .map(({ i }) => i);
  const judgeOptions: JudgeOptions = {
    ...(options.band ? { band: options.band } : {}),
    ...(options.load ? { load: options.load } : {}),
    ...(options.target ? { target: options.target } : {}),
  };
  const judge = makeJudge(ladder, judgeOptions);
  const gLim = gammaLimit(options.vswrLimit);
  const samples = Math.max(16, Math.floor(options.samples ?? 300));
  const seed = options.seed ?? 20261025;
  const kinds = slots.map((s) => s.kind);
  const draw = toleranceSampler(kinds, { ...samplerOptions(options), seed });
  const draws = Array.from({ length: samples }, draw);
  const budget = Math.max(20, Math.floor(options.maxEvaluations ?? 600));
  const runs = Math.max(100, Math.floor(options.validationRuns ?? 2000));
  // The check costs about runs / samples evaluations per network checked (two or three).
  const checkCost = Math.ceil((runs * (options.realize ? 3 : 2)) / samples);
  const total = budget + checkCost;
  let evaluations = 0;
  let bestPassed = 0;
  let stage: CentreProgress['stage'] = 'centring';
  const report = (done: number): void =>
    options.onProgress?.({
      stage,
      done: Math.min(done, total),
      total,
      best: bestPassed / samples,
    });

  /** Passes and smoothed yield of a ladder on the fixed draws, with logistic width w. */
  const score = (elements: readonly Element[], w: number): { passed: number; smooth: number } => {
    evaluations++;
    // Every evaluation is counted, so the bar moves steadily also over a long band.
    report(Math.min(evaluations, budget));
    let passed = 0;
    let smooth = 0;
    const cutoff = gLim + 12 * w;
    for (const d of draws) {
      const g = judge(applyDeviations(elements, slots, d), Math.max(gLim, cutoff));
      if (g <= gLim) passed++;
      const m = (gLim - g) / w;
      smooth += m > 40 ? 1 : m < -40 ? 0 : 1 / (1 + Math.exp(-m));
    }
    return { passed, smooth: smooth / samples };
  };

  const indices = movable;
  const values0 = indices.map((i) => primaryValueOf(ladder.elements[i] as Element) as number);
  const freqs = (options.band ?? []).filter((f) => f > 0);
  const f0 =
    freqs.length > 0
      ? ((freqs[0] as number) + (freqs[freqs.length - 1] as number)) / 2
      : ladder.frequency;
  const bounds = indices.map((i, k) => {
    const v = values0[k] as number;
    const b = parameterBound(ladder.elements[i] as Element, ladder.z0, f0);
    let lo = v / 2;
    let hi = v * 2;
    if (b && v >= b.lo && v <= b.hi) {
      lo = Math.max(lo, b.lo);
      hi = Math.min(hi, b.hi);
    }
    return { lo: Math.log(lo / v), hi: Math.log(hi / v) };
  });
  const build = (x: readonly number[]): Element[] => {
    const out = ladder.elements.slice();
    indices.forEach((i, k) => {
      out[i] = withPrimaryValue(
        out[i] as Element,
        (values0[k] as number) * Math.exp(x[k] as number),
      );
    });
    return out;
  };
  const inside = (x: readonly number[]): boolean =>
    x.every(
      (u, k) =>
        u >= (bounds[k] as { lo: number }).lo - 1e-12 &&
        u <= (bounds[k] as { hi: number }).hi + 1e-12,
    );
  const clamp = (x: readonly number[]): number[] =>
    x.map((u, k) =>
      Math.min((bounds[k] as { hi: number }).hi, Math.max((bounds[k] as { lo: number }).lo, u)),
    );

  const wWide = Math.max(0.15 * gLim, 1e-4);
  const wNarrow = Math.max(0.04 * gLim, 1e-5);

  const x0 = indices.map(() => 0);
  const start = score(ladder.elements, wNarrow);
  let best = { x: x0, passed: start.passed, smooth: start.smooth };
  bestPassed = best.passed;
  const better = (
    a: { passed: number; smooth: number },
    b: { passed: number; smooth: number },
  ): boolean => a.passed > b.passed || (a.passed === b.passed && a.smooth > b.smooth + 1e-12);

  if (indices.length > 0 && slots.length > 0) {
    // 2. Mean shifting: towards the centre of gravity of the passing draws.
    const slotOf = new Map(slots.map((s, k) => [s.ref.index, { s, k }]));
    let x = x0;
    for (let it = 0; it < 8 && evaluations < budget; it++) {
      const elements = build(x);
      const shift = indices.map(() => 0);
      let count = 0;
      for (const d of draws) {
        const g = judge(applyDeviations(elements, slots, d), gLim);
        if (g > gLim) continue;
        count++;
        indices.forEach((i, k) => {
          const hit = slotOf.get(i);
          if (!hit || hit.s.ref.parameter !== primaryParameter(ladder.elements[i] as Element))
            return;
          const factor = Math.max(1e-3, 1 + hit.s.tolerance * (d[hit.k] as number));
          shift[k] = (shift[k] as number) + Math.log(factor);
        });
      }
      evaluations++;
      if (count === 0) break;
      const next = clamp(x.map((u, k) => u + (shift[k] as number) / count));
      const got = score(build(next), wNarrow);
      if (!better(got, best)) break;
      best = { x: next, ...got };
      bestPassed = best.passed;
      x = next;
    }

    // 3. Nelder-Mead on the smoothed yield, wide then narrow.
    for (const [w, frac] of [
      [wWide, 0.5],
      [wNarrow, 0.25],
    ] as const) {
      if (evaluations >= budget) break;
      const step = indices.map((i) => {
        const t = tols[i] ?? 0;
        return t > 0 ? Math.max(frac * t, 1e-3) : 0.05 * frac * 2;
      });
      const got = nelderMead(
        (x) => {
          if (!inside(x)) return 2;
          if (evaluations >= budget) return 2;
          const s = score(build(x), w);
          return -s.smooth;
        },
        best.x,
        step,
        Math.max(10, Math.floor(budget / 3)),
      );
      const s = score(build(got.x), wNarrow);
      if (inside(got.x) && better(s, best)) best = { x: got.x, ...s };
      bestPassed = best.passed;
    }
  }

  const centred = build(best.x);
  let result: readonly Element[] = centred;
  let searchAfter = best.passed;
  const edges: CentreEdge[] = [];
  indices.forEach((i, k) => {
    const u = best.x[k] as number;
    const b = bounds[k] as { lo: number; hi: number };
    // Within 0.1 % of the bound: the simplex presses against it without quite reaching it.
    const near = (a: number): boolean => Math.abs(u - a) <= 1e-3;
    if (b.hi > b.lo && near(b.lo)) edges.push({ index: i, side: 'low', factor: Math.exp(b.lo) });
    else if (b.hi > b.lo && near(b.hi))
      edges.push({ index: i, side: 'high', factor: Math.exp(b.hi) });
  });

  // 5. Snap to the series or the stock: the best combination of the neighbours.
  if (options.realize) {
    stage = 'snapping';
    report(evaluations);
    const { source, scope } = options.realize;
    const choices = indices.map((i) => {
      const el = centred[i] as Element;
      const original = primaryValueOf(ladder.elements[i] as Element) as number;
      if (el.kind !== 'R' && el.kind !== 'L' && el.kind !== 'C')
        return [primaryValueOf(el) as number];
      if (!inScope(scope, el.kind)) return [el.value];
      const nb =
        source.kind === 'series'
          ? seriesNeighbors(el.value, source.series)
          : stockNeighbors(el.value, source.stock[el.kind]);
      // An empty stock for the kind leaves the part as given.
      if (!nb) return [original];
      return [
        ...new Set([nb.lower, nb.upper, original].filter((v) => v > 0 && Number.isFinite(v))),
      ];
    });
    const assemble = (pick: readonly number[]): Element[] => {
      const out = centred.slice();
      indices.forEach((i, k) => {
        out[i] = withPrimaryValue(
          out[i] as Element,
          (choices[k] as number[])[pick[k] as number] as number,
        );
      });
      return out;
    };
    const combos = choices.reduce((n, c) => n * c.length, 1);
    let bestPick = choices.map(() => 0);
    let bestScore = score(assemble(bestPick), wNarrow);
    if (combos <= 729) {
      for (let c = 1; c < combos; c++) {
        let rest = c;
        const pick = choices.map((ch) => {
          const k = rest % ch.length;
          rest = Math.floor(rest / ch.length);
          return k;
        });
        const s = score(assemble(pick), wNarrow);
        if (better(s, bestScore)) {
          bestScore = s;
          bestPick = pick;
        }
      }
    } else {
      // Coordinate passes until nothing changes.
      for (let pass = 0, changed = true; changed && pass < 6; pass++) {
        changed = false;
        for (let k = 0; k < choices.length; k++) {
          for (let j = 0; j < (choices[k] as number[]).length; j++) {
            if (j === bestPick[k]) continue;
            const pick = bestPick.slice();
            pick[k] = j;
            const s = score(assemble(pick), wNarrow);
            if (better(s, bestScore)) {
              bestScore = s;
              bestPick = pick;
              changed = true;
            }
          }
        }
      }
    }
    result = assemble(bestPick);
    searchAfter = bestScore.passed;
  }

  // 6. The check on fresh draws.
  stage = 'checking';
  bestPassed = searchAfter;
  let checked = 0;
  const checkRuns = runs * (options.realize ? 3 : 2);
  const tick = Math.max(1, Math.floor(runs / 20));
  report(budget);
  const check = (elements: readonly Element[]): YieldEstimate => {
    const next = toleranceSampler(kinds, {
      ...samplerOptions(options),
      seed: options.validationSeed ?? seed + 7919,
    });
    let passed = 0;
    for (let r = 0; r < runs; r++) {
      if (judge(applyDeviations(elements, slots, next()), gLim) <= gLim) passed++;
      checked++;
      if (checked % tick === 0) report(budget + Math.round((checked / checkRuns) * checkCost));
    }
    return estimate(passed, runs);
  };
  const before = check(ladder.elements);
  const after = check(result);
  const continuous = options.realize ? { elements: centred, yield: check(centred) } : null;
  const original = ladder.elements;
  const moved = indices.filter(
    (i) => primaryValueOf(result[i] as Element) !== primaryValueOf(original[i] as Element),
  );
  const judgeNominal = (elements: readonly Element[]): number => {
    const g = judge(elements, Infinity);
    return g >= 1 ? Infinity : (1 + g) / (1 - g);
  };
  return {
    indices: moved,
    movable: indices,
    elements: result,
    before,
    after,
    searchBefore: start.passed / samples,
    searchAfter: searchAfter / samples,
    ...(continuous ? { continuous } : {}),
    improved: after.passed > before.passed,
    significant: significantGain(before, after),
    nominal: { before: judgeNominal(original), after: judgeNominal(result) },
    edges,
    evaluations,
  };
}

/** The parameter primaryValueOf reads, as the tolerance slots name it. */
function primaryParameter(el: Element): string {
  switch (el.kind) {
    case 'R':
    case 'L':
    case 'C':
      return 'value';
    case 'transformer':
      return 'n';
    case 'line':
    case 'openStub':
    case 'shortStub':
    case 'microstrip':
      return 'length';
    case 'RLC':
      return '';
  }
}

/** Yield of a network on draws from the tolerance settings: the Monte Carlo pass count without the cloud. */
export function yieldEstimate(
  ladder: Ladder,
  options: ToleranceSpec &
    JudgeOptions & { readonly vswrLimit: number; readonly runs: number; readonly seed?: number },
): YieldEstimate {
  const tols = elementTolerances(ladder.elements, options);
  const slots = toleranceSlots(ladder.elements, tols);
  const next = toleranceSampler(
    slots.map((s) => s.kind),
    samplerOptions(options),
  );
  const judge = makeJudge(ladder, options);
  const gLim = gammaLimit(options.vswrLimit);
  const runs = Math.max(1, Math.floor(options.runs));
  let passed = 0;
  for (let r = 0; r < runs; r++) {
    if (judge(applyDeviations(ladder.elements, slots, next()), gLim) <= gLim) passed++;
  }
  return estimate(passed, runs);
}
