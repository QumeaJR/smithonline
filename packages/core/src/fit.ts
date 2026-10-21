/**
 * Matching with the parts already in the ladder.
 *
 * The synthesis in match.ts adds new parts. This keeps the topology the user
 * built and asks a different question: which values of the existing parts put
 * Zin on the target at the design frequency? Two free reactances usually have
 * an exact answer, more than two have a family of answers and the search
 * returns the one nearest the current values, fewer than two usually cannot
 * reach the target and the search returns the closest point.
 *
 * The cost is the distance on the chart between Zin and the target, the
 * length of the vector between their reflection coefficients. It is zero only
 * when Zin equals the target, it is bounded, and it does not care whether the
 * target has a reactive part, so a conjugate match is just a target with the
 * sign of X flipped.
 *
 * The search is the same Nelder-Mead over the same bounds as the band
 * optimizer in optimize.ts (log coordinates for lumped parts, linear for
 * lengths), started from the current values first so a design that already
 * matches is returned untouched, then from seeded random points so a start on
 * the wrong side of a stub's resonance still finds the answer.
 */
import { cabs, csub, type Complex } from './complex.js';
import { zToGamma } from './conversions.js';
import { ladderAbcd, type Element } from './elements.js';
import { throughAbcd } from './abcd.js';
import type { Ladder } from './ladder.js';
import {
  nelderMead,
  parameterBound,
  primaryValueOf,
  withPrimaryValue,
  type ParameterBound,
} from './optimize.js';

/** Chart distance below which a fit counts as exact. */
export const FIT_EXACT = 1e-4;

export interface FitOptions {
  /** Which elements may change; default every element with a single primary value. */
  readonly indices?: readonly number[];
  readonly iterations?: number;
  readonly restarts?: number;
  readonly seed?: number;
}

export interface FitResult {
  /** The ladder's elements with the fitted values in place. */
  readonly elements: readonly Element[];
  /** The elements that were allowed to change. */
  readonly indices: readonly number[];
  /** Chart distance between Zin and the target before and after. */
  readonly before: number;
  readonly after: number;
  /** Zin after the fit. */
  readonly zin: Complex;
  readonly exact: boolean;
  readonly evaluations: number;
}

/** |Gamma(zin) - Gamma(target)|, the distance on the chart. */
export function chartDistance(zin: Complex, target: Complex, z0: number): number {
  const d = cabs(csub(zToGamma(zin, z0), zToGamma(target, z0)));
  return Number.isFinite(d) ? d : 2;
}

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

/** The elements that can take part: one primary value and a bound. */
export function fittableIndices(ladder: Ladder): number[] {
  const out: number[] = [];
  ladder.elements.forEach((el, i) => {
    if (primaryValueOf(el) !== null && parameterBound(el, ladder.z0, ladder.frequency)) out.push(i);
  });
  return out;
}

/**
 * Fit the free elements so that Zin lands on `target` at the ladder's
 * frequency. Returns null when nothing can be varied.
 */
export function fitToTarget(
  ladder: Ladder,
  target: Complex,
  options: FitOptions = {},
): FitResult | null {
  const { z0, frequency, load } = ladder;
  const indices = (options.indices ?? fittableIndices(ladder)).filter((i) => {
    const el = ladder.elements[i];
    return el !== undefined && primaryValueOf(el) !== null && parameterBound(el, z0, frequency);
  });
  if (indices.length === 0) return null;
  const iterations = options.iterations ?? 400;
  const restarts = options.restarts ?? 4;

  const bounds = indices.map(
    (i) => parameterBound(ladder.elements[i] as Element, z0, frequency) as ParameterBound,
  );
  const toX = (value: number, b: ParameterBound): number => (b.log ? Math.log(value) : value);
  const fromX = (x: number, b: ParameterBound): number => {
    const v = b.log ? Math.exp(x) : x;
    return Math.min(b.hi, Math.max(b.lo, v));
  };

  let evaluations = 0;
  const build = (x: readonly number[]): Element[] => {
    const elements = ladder.elements.slice();
    indices.forEach((idx, k) => {
      elements[idx] = withPrimaryValue(
        elements[idx] as Element,
        fromX(x[k] as number, bounds[k] as ParameterBound),
      );
    });
    return elements;
  };
  const zinOf = (elements: readonly Element[]): Complex =>
    throughAbcd(ladderAbcd(elements, frequency), load);
  const cost = (x: readonly number[]): number => {
    evaluations++;
    const zin = zinOf(build(x));
    if (!Number.isFinite(zin.re) || !Number.isFinite(zin.im)) return 4;
    return chartDistance(zin, target, z0);
  };

  const x0 = indices.map((i, k) => {
    const b = bounds[k] as ParameterBound;
    const v = Math.min(
      b.hi,
      Math.max(b.lo, primaryValueOf(ladder.elements[i] as Element) as number),
    );
    return toX(v, b);
  });
  const before = cost(x0);
  const untouched = (): FitResult => ({
    elements: ladder.elements,
    indices,
    before,
    after: before,
    zin: zinOf(ladder.elements),
    exact: before <= FIT_EXACT,
    evaluations,
  });
  if (before <= FIT_EXACT) return untouched();
  const step = bounds.map((b) => (b.log ? 0.3 : (b.hi - b.lo) / 8));

  let best = nelderMead(cost, x0, step, iterations);
  const random = seeded(options.seed ?? 12345);
  for (let r = 0; r < restarts && best.value > FIT_EXACT; r++) {
    const start = bounds.map((b) => {
      const t = random();
      return b.log
        ? Math.log(b.lo) + t * (Math.log(b.hi) - Math.log(b.lo))
        : b.lo + t * (b.hi - b.lo);
    });
    const m = nelderMead(cost, start, step, iterations);
    if (m.value < best.value) best = m;
  }
  // Polish the winner from its own position with smaller steps.
  const polished = nelderMead(
    cost,
    best.value < before ? best.x : x0,
    step.map((s) => s / 10),
    iterations,
  );
  if (polished.value < best.value) best = polished;
  if (best.value >= before) return untouched();
  const elements = build(best.x);
  return {
    elements,
    indices,
    before,
    after: best.value,
    zin: zinOf(elements),
    exact: best.value <= FIT_EXACT,
    evaluations,
  };
}
