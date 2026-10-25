/**
 * Broadband matching with a search over topologies.
 *
 * match.ts is exact at one frequency and optimize.ts improves the values of a
 * ladder somebody already built. Neither answers the question "what is the
 * best network for this band, and is it worth one more part?". More parts do
 * buy bandwidth (a longer ladder follows the load's frequency behaviour more
 * closely), up to the Bode-Fano wall, so the honest answer is a table:
 * the best network found at each size, ranked by the worst VSWR it gives
 * anywhere in the band.
 *
 * The search enumerates ladders of alternating series and shunt parts, each
 * slot an inductor or a capacitor (and optionally one series line), from one
 * part up to a cap. The cap is a manufacturing limit rather than a
 * mathematical one: it is not worth building eight parts to move a VSWR from
 * 1.12 to 1.10. Every topology is seeded from the closed-form synthesis at
 * band centre where one exists (L, Pi and T sections, chained through an
 * intermediate resistance for longer ladders) and then handed to the band
 * optimizer with its usual bounds and worst-case cost.
 *
 * Scoring: the search measures a candidate at a few band points only (fast),
 * and a ladder of many parts can fit those points while its response swings
 * between them. Every candidate's final score is therefore its worst VSWR on
 * a dense grid inside the band (at least max(201, 25 per part) points, the
 * band points included), with the same load model the search used; that is
 * the number reported and ranked. Where the load is a single reactance with
 * a resistance, a candidate that would beat Fano's exact floor (a peak
 * narrower than the grid) is dropped rather than listed.
 *
 * Determinism and time: every candidate gets its own seed derived from its
 * topology, so the result does not depend on the order candidates are tried
 * in, and its own budget of ladder evaluations, so the total is a number you
 * can read off before pressing the button. Large searches run a cheap first
 * pass over everything and spend the full budget only on the best few.
 */
import { complex, type Complex } from './complex.js';
import { ladderAbcd, applyElement, type Element, type Orientation } from './elements.js';
import { throughAbcd } from './abcd.js';
import { sweepPoints, type SweepLoad } from './ladder.js';
import { lMatch, piMatch, teeMatch } from './match.js';
import {
  feasibility,
  optimizeBand,
  OPTIMIZE_FAIL,
  parameterBound,
  worstVswr,
  type Feasibility,
  type LoadModel,
} from './optimize.js';
import { tuneElement } from './tune.js';
import { measuredLoad, type MeasuredLoadOptions } from './measured.js';

export type SlotKind = 'L' | 'C' | 'line';

/** One position in a candidate ladder. */
export interface TopologySlot {
  readonly orientation: Orientation;
  readonly kind: SlotKind;
}

/** A ladder shape, from the load side towards the source, before any values. */
export interface Topology {
  readonly slots: readonly TopologySlot[];
  /** "series L + shunt C", the same words the ladder cards use. */
  readonly label: string;
}

export const MAX_ELEMENTS_LIMIT = 8;
export const DEFAULT_MAX_ELEMENTS = 4;

function slotLabel(s: TopologySlot): string {
  return `${s.orientation} ${s.kind}`;
}

export function topologyLabel(slots: readonly TopologySlot[]): string {
  return slots.map(slotLabel).join(' + ');
}

export interface EnumerateOptions {
  /** Also offer a series transmission line in place of one series part (at most one per ladder). */
  readonly allowLine?: boolean;
}

/**
 * Every alternating ladder of 1 to `maxElements` parts: series first or
 * shunt first (both orders), inductor or capacitor in each slot. Two series
 * parts or two shunt parts next to each other are one part, so the
 * orientation alternates. Ordered by size, then deterministically.
 */
export function enumerateTopologies(
  maxElements: number,
  options: EnumerateOptions = {},
): Topology[] {
  const cap = clampElements(maxElements);
  const out: Topology[] = [];
  for (let n = 1; n <= cap; n++) {
    for (const first of ['series', 'shunt'] as const) {
      const orientations: Orientation[] = Array.from({ length: n }, (_, i) =>
        (i % 2 === 0) === (first === 'series') ? 'series' : 'shunt',
      );
      // Bit k of `mask` picks C over L in slot k.
      for (let mask = 0; mask < 1 << n; mask++) {
        const slots: TopologySlot[] = orientations.map((orientation, k) => ({
          orientation,
          kind: (mask >> k) & 1 ? 'C' : 'L',
        }));
        out.push({ slots, label: topologyLabel(slots) });
        if (options.allowLine) {
          orientations.forEach((o, k) => {
            if (o !== 'series') return;
            const withLine = slots.map((s, j) => (j === k ? { ...s, kind: 'line' as const } : s));
            // The same ladder comes up for every L/C choice of the other slots; the line
            // replaces slot k once, when slot k would have been an L.
            if (slots[k]?.kind !== 'L') return;
            out.push({ slots: withLine, label: topologyLabel(withLine) });
          });
        }
      }
    }
  }
  return out;
}

function clampElements(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_MAX_ELEMENTS;
  return Math.min(MAX_ELEMENTS_LIMIT, Math.max(1, Math.floor(n)));
}

/** Interpolated loads by their point list, per option set: the fit runs once per list. */
const loadCache = new WeakMap<readonly SweepLoad[], Map<string, LoadModel>>();

/**
 * A load known at a few frequencies as a function. With at least
 * FIT_MIN_POINTS (6) points it is the rational model fitted to the reflection
 * coefficient (see measured.ts), with linear interpolation of R and X as the
 * fallback when the fit's largest residual is above 1e-2 in Gamma or the fit
 * fails; fewer points are interpolated linearly. The returned function
 * carries how it was made (measuredLoadInfo). A fitted model is held at its
 * value 5 percent past the data, the linear one at the end points. No points
 * give a fixed 50 ohm, one point that impedance as a constant.
 */
export function interpolatedLoad(
  points: readonly SweepLoad[],
  options: MeasuredLoadOptions = {},
): LoadModel {
  const first = points[0];
  if (!first) return complex(50, 0);
  if (points.length === 1) return first.z;
  const key = `${options.z0 ?? 50}|${options.fit ?? true}|${options.maxResidual ?? ''}`;
  let byKey = loadCache.get(points);
  const hit = byKey?.get(key);
  if (hit) return hit;
  const model = measuredLoad(points, options);
  if (!byKey) {
    byKey = new Map();
    loadCache.set(points, byKey);
  }
  byKey.set(key, model);
  return model;
}

/* -------------------------------------------------------------------- seeds
 *
 * The closed forms take the impedance the network starts from, which is
 * where the ladder stands at band centre: the load seen through the parts
 * that are already there.
 */
function elementOf(slot: TopologySlot, value: number, z0: number, f0: number): Element {
  switch (slot.kind) {
    case 'L':
      return { kind: 'L', orientation: slot.orientation, value };
    case 'C':
      return { kind: 'C', orientation: slot.orientation, value };
    case 'line':
      return { kind: 'line', z0, length: value, refFrequency: f0 };
  }
}

function matchesSlots(els: readonly Element[], slots: readonly TopologySlot[]): boolean {
  return (
    els.length === slots.length &&
    els.every((e, i) => {
      const s = slots[i] as TopologySlot;
      return (
        (e.kind === 'L' || e.kind === 'C') && e.kind === s.kind && e.orientation === s.orientation
      );
    })
  );
}

const SEED_QS = [0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 10];

/** Closed-form parts of exactly the given shape (1 to 3 slots) from zin to target at f, if there are any. */
function directSeed(
  slots: readonly TopologySlot[],
  zin: Complex,
  target: Complex,
  f: number,
): Element[] | null {
  if (slots.length === 1) {
    const slot = slots[0] as TopologySlot;
    if (slot.kind === 'line') return null;
    const tuned = tuneElement(elementOf(slot, 1e-9, 50, f), zin, target, f);
    return tuned ? [tuned] : null;
  }
  if (slots.length === 2) {
    const hit = lMatch(zin, target, f).find((s) => matchesSlots(s.elements, slots));
    return hit ? [...hit.elements] : null;
  }
  if (slots.length === 3) {
    for (const q of SEED_QS) {
      const hit = [...teeMatch(zin, target, f, q), ...piMatch(zin, target, f, q)].find((s) =>
        matchesSlots(s.elements, slots),
      );
      if (hit) return [...hit.elements];
    }
  }
  return null;
}

/**
 * Starting values for a ladder shape: the exact synthesis when the shape is
 * one the closed forms produce, and for longer ladders a chain of such
 * sections that steps the resistance geometrically from zin to the target.
 * Null when no exact answer has this shape, and for ladders with a line.
 */
export function seedValues(
  slots: readonly TopologySlot[],
  zin: Complex,
  target: Complex,
  f: number,
): Element[] | null {
  if (slots.length === 0) return [];
  if (slots.some((s) => s.kind === 'line')) return null;
  if (slots.length <= 3) return directSeed(slots, zin, target, f);
  const head = slots.length % 2 === 0 ? 2 : 3;
  if (!(zin.re > 0) || !(target.re > 0)) return null;
  const rMid = zin.re * (target.re / zin.re) ** (head / slots.length);
  const first = directSeed(slots.slice(0, head), zin, complex(rMid, 0), f);
  if (!first) return null;
  let z = zin;
  for (const e of first) z = applyElement(e, z, f);
  const rest = seedValues(slots.slice(head), z, target, f);
  return rest ? [...first, ...rest] : null;
}

/* ------------------------------------------------------------------- search */

export interface BroadbandOptions {
  /** Largest number of new parts, 1 to 8. Default 4. */
  readonly maxElements?: number;
  /** Offer one series line as an alternative to a series part. Default false. */
  readonly allowLine?: boolean;
  /** Parts already in the design; the new ones go after them (towards the source). Default none. */
  readonly prefix?: readonly Element[];
  /** The load, or the load per frequency. */
  readonly load: LoadModel;
  readonly z0: number;
  /** Where the network should land; default the real reference impedance Z0. */
  readonly target?: Complex;
  /** Ladder evaluations per candidate. Default 600 per free value. */
  readonly evaluationsPerCandidate?: number;
  /** How many ranked candidates to return. Default 20. */
  readonly limit?: number;
  readonly seed?: number;
  readonly onProgress?: (p: BroadbandProgress) => void;
}

export interface BroadbandProgress {
  readonly done: number;
  readonly total: number;
  /** Best worst-case VSWR found so far. */
  readonly best: number;
  /** The topology just finished. */
  readonly label: string;
}

export interface BroadbandCandidate {
  readonly topology: Topology;
  /** The new parts only, load side first. The prefix is not included. */
  readonly elements: readonly Element[];
  /** Worst VSWR on the dense scoring grid (scoringFrequencies) with the prefix and these parts. */
  readonly worstVswr: number;
  readonly count: number;
  /** True when the starting values came from the closed-form synthesis. */
  readonly seeded: boolean;
  readonly evaluations: number;
}

export interface BroadbandResult {
  /** Ranked by worst VSWR (equal to three decimals counts as equal), then by number of parts. */
  readonly candidates: readonly BroadbandCandidate[];
  /** Worst VSWR of the design without any new part, on the scoring grid. Candidates that do not beat it are dropped. */
  readonly baseline: number;
  /**
   * The wall for this load over the band points; null for a load without a
   * bandwidth of its own and for fewer than FLOOR_MIN_POINTS band points.
   */
  readonly floor: Feasibility | null;
  /**
   * Fano's exact floor when the load is a single reactance with a resistance
   * on the scoring grid, else null. No listed candidate is below it (by more
   * than 1e-3 when the floor comes from a fitted model, whose element values
   * are known to the fit's precision).
   */
  readonly exactFloor: number | null;
  readonly maxElements: number;
  /** Topologies searched. */
  readonly topologies: number;
  /** Ladder evaluations spent in all. */
  readonly evaluations: number;
  readonly frequencies: readonly number[];
  /** The dense grid every candidate is scored on: the band points and a uniform grid between the edges. */
  readonly scoringFrequencies: readonly number[];
}

/** The ladder evaluations the search is allowed per candidate of n free values. */
export function defaultBudget(n: number): number {
  return 600 * Math.max(1, n);
}

/**
 * Points the optimizer measures a candidate at: 21, and at least four per part
 * plus one, so a long ladder cannot fit the points and swing between them.
 * The answer is re-measured on the dense scoring grid.
 */
const SEARCH_POINTS = 21;

/** Points of the search grid for ladders of up to `maxElements` new parts. */
export function searchPointCount(maxElements: number): number {
  return Math.max(SEARCH_POINTS, 4 * clampElements(maxElements) + 1);
}

/** Points of the uniform part of the scoring grid for a ladder of `parts` parts in all. */
export function scoringPointCount(parts: number): number {
  return Math.max(201, 25 * Math.max(1, Math.floor(parts)));
}

/** The band points and `count` evenly spaced points from the lowest to the highest, sorted, no repeats. */
function withUniform(freqs: readonly number[], count: number): number[] {
  const lo = freqs[0] as number;
  const hi = freqs[freqs.length - 1] as number;
  return [...new Set([...freqs, ...sweepPoints(lo, hi, count)])].sort((a, b) => a - b);
}

/**
 * The dense grid a broadband result is scored on: the band points (ascending)
 * and scoringPointCount(parts) evenly spaced points between the band edges.
 */
export function scoringFrequencies(band: readonly number[], parts: number): number[] {
  const freqs = band.filter((f) => f > 0 && Number.isFinite(f)).sort((a, b) => a - b);
  if (freqs.length < 2) return freqs;
  return withUniform(freqs, scoringPointCount(parts));
}
/** First pass over this many topologies or fewer uses the full budget directly. */
const TWO_PASS_ABOVE = 48;
const REFINE = 16;

/**
 * The steps a search over `topologies` ladder topologies reports in its
 * progress: one per topology, plus the refinement of the best ones when the
 * search runs in two passes. A caller can show this total before the first
 * report, so a progress bar never steps back.
 */
export function broadbandSteps(topologies: number): number {
  return topologies + (topologies > TWO_PASS_ABOVE ? Math.min(REFINE, topologies) : 0);
}

/** `count` of the band points, evenly picked; a band with fewer gets evenly spaced points added. */
function searchSubset(freqs: readonly number[], count: number): number[] {
  if (freqs.length === count) return [...freqs];
  if (freqs.length < count) return withUniform(freqs, count);
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    out.push(freqs[Math.round((i * (freqs.length - 1)) / (count - 1))] as number);
  }
  return out;
}

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * The best broadband networks for `load` over `frequencies`, found by
 * searching ladder topologies up to `maxElements` parts. See the header for
 * the method; the result lists the candidates that beat the design as it
 * stands, best first, with the Bode-Fano floor next to them when the load has
 * one.
 */
export function broadbandMatch(
  frequencies: readonly number[],
  options: BroadbandOptions,
): BroadbandResult {
  // Ascending whatever order the caller used; a band given high to low is the same band.
  const freqs = frequencies.filter((f) => f > 0 && Number.isFinite(f)).sort((a, b) => a - b);
  const prefix = options.prefix ?? [];
  const { load, z0, target } = options;
  const maxElements = clampElements(options.maxElements ?? DEFAULT_MAX_ELEMENTS);
  const scoring = scoringFrequencies(freqs, prefix.length + maxElements);
  const baseline = worstVswr(prefix, load, z0, scoring, target);
  const onGrid = freqs.length >= 2 ? feasibility(load, scoring) : null;
  const exactFloor = onGrid?.method === 'exact' ? onGrid.floor : null;
  // An exact floor read from a fitted model holds the element values to the fit's 1e-3, not to
  // the last digit: a candidate within that of it is kept.
  const floorSlack = onGrid?.fromFit ? 1e-3 : 1e-9;
  const empty: BroadbandResult = {
    candidates: [],
    baseline,
    floor: feasibility(load, freqs),
    exactFloor,
    maxElements,
    topologies: 0,
    evaluations: 0,
    frequencies: freqs,
    scoringFrequencies: scoring,
  };
  if (freqs.length < 2 || !((freqs[freqs.length - 1] as number) > (freqs[0] as number))) {
    return empty;
  }

  const topologies = enumerateTopologies(
    maxElements,
    options.allowLine === undefined ? {} : { allowLine: options.allowLine },
  );
  const searchFreqs = searchSubset(freqs, searchPointCount(maxElements));
  const f0 = ((freqs[0] as number) + (freqs[freqs.length - 1] as number)) / 2;
  const goal = target ?? complex(z0, 0);
  const loadAtCentre = typeof load === 'function' ? load(f0) : load;
  const start = throughAbcd(ladderAbcd(prefix, f0), loadAtCentre);
  const baseSeed = options.seed ?? 20260927;
  const budgetFor = (n: number): number => options.evaluationsPerCandidate ?? defaultBudget(n);

  /** Midpoint of each part's bound: the start when there is no closed form. */
  const midpoints = (slots: readonly TopologySlot[]): Element[] =>
    slots.map((slot) => {
      const probe = elementOf(slot, 1, z0, f0);
      const b = parameterBound(probe, z0, f0);
      if (!b) return probe;
      return elementOf(slot, b.log ? Math.sqrt(b.lo * b.hi) : (b.lo + b.hi) / 2, z0, f0);
    });

  let evaluations = 0;
  const run = (
    topology: Topology,
    initial: readonly Element[],
    budget: number,
    seeded: boolean,
  ): BroadbandCandidate => {
    const n = topology.slots.length;
    const ladder = { z0, frequency: f0, load: loadAtCentre, elements: [...prefix, ...initial] };
    const indices = Array.from({ length: n }, (_, k) => prefix.length + k);
    const res = optimizeBand(ladder, searchFreqs, {
      indices,
      load,
      ...(target ? { target } : {}),
      restarts: 1000,
      iterations: 150 + 50 * n,
      maxEvaluations: budget,
      seed: (baseSeed + hash(topology.label)) >>> 0,
    });
    evaluations += res.evaluations;
    const elements = res.elements.slice(prefix.length);
    return {
      topology,
      elements,
      // Re-measured on the dense scoring grid, not only on the search points.
      worstVswr: worstVswr([...prefix, ...elements], load, z0, scoring, target),
      count: n,
      seeded,
      evaluations: res.evaluations,
    };
  };

  const twoPass = topologies.length > TWO_PASS_ABOVE;
  const total = broadbandSteps(topologies.length);
  let done = 0;
  let best = baseline;
  const tell = (label: string, v: number): void => {
    done++;
    if (v < best) best = v;
    options.onProgress?.({ done, total, best, label });
  };

  let results: BroadbandCandidate[] = topologies.map((topology) => {
    const seeded = seedValues(topology.slots, start, goal, f0);
    const full = budgetFor(topology.slots.length);
    const got = run(
      topology,
      seeded ?? midpoints(topology.slots),
      twoPass ? Math.max(150, Math.floor(full / (topologies.length > 200 ? 8 : 4))) : full,
      seeded !== null,
    );
    tell(topology.label, got.worstVswr);
    return got;
  });

  if (twoPass) {
    const order = rank(results).slice(0, REFINE);
    const refined = new Map<BroadbandCandidate, BroadbandCandidate>();
    for (const c of order) {
      const again = run(c.topology, c.elements, budgetFor(c.count), c.seeded);
      refined.set(
        c,
        again.worstVswr < c.worstVswr
          ? { ...again, evaluations: c.evaluations + again.evaluations }
          : c,
      );
      tell(c.topology.label, again.worstVswr);
    }
    results = results.map((c) => refined.get(c) ?? c);
  }

  // A part pinned at the bound where it does next to nothing (a series part at the smallest
  // reactance, a shunt part at the largest) is dropped and the ladder scored without it; the
  // candidate is then listed with the parts it really has, and each network shape once (the
  // best of the candidates that come to the same parts).
  const effective = new Map<string, BroadbandCandidate>();
  for (const c of results.map((r) => withoutIdleParts(r, prefix, load, z0, scoring, target, f0))) {
    const key = c.topology.label;
    const seen = effective.get(key);
    if (!seen || c.worstVswr < seen.worstVswr) effective.set(key, c);
  }
  results = [...effective.values()];

  const kept = rank(
    results.filter(
      (c) =>
        c.worstVswr < OPTIMIZE_FAIL &&
        c.worstVswr < baseline * (1 - 1e-6) &&
        // Below the exact floor is a peak the grid missed, not a network that exists.
        (exactFloor === null || c.worstVswr >= exactFloor * (1 - floorSlack)),
    ),
  ).slice(0, Math.max(1, Math.floor(options.limit ?? 20)));

  return { ...empty, candidates: kept, topologies: topologies.length, evaluations };
}

/** How close to a bound (relative, on the log scale of the value) a part counts as pinned there. */
const PINNED = 1e-3;

/**
 * True when an inductor or capacitor sits at the end of its reactance bound
 * where it is effectively absent: in series at the smallest reactance (Z0 /
 * 25, nearly a short), in shunt at the largest (10 Z0, nearly an open).
 */
function idlePart(el: Element, z0: number, f0: number): boolean {
  if (el.kind !== 'L' && el.kind !== 'C') return false;
  const b = parameterBound(el, z0, f0);
  if (!b) return false;
  // The value that gives the smallest reactance: lo for an inductor, hi for a capacitor.
  const small = el.kind === 'L' ? b.lo : b.hi;
  const large = el.kind === 'L' ? b.hi : b.lo;
  const at = el.orientation === 'series' ? small : large;
  return Math.abs(Math.log(el.value / at)) <= PINNED;
}

/** The candidate without its idle parts, scored again on the same grid (unchanged when every part is idle). */
function withoutIdleParts(
  c: BroadbandCandidate,
  prefix: readonly Element[],
  load: LoadModel,
  z0: number,
  scoring: readonly number[],
  target: Complex | undefined,
  f0: number,
): BroadbandCandidate {
  const keep = c.elements.map((el) => !idlePart(el, z0, f0));
  if (keep.every(Boolean)) return c;
  const elements = c.elements.filter((_, i) => keep[i]);
  if (elements.length === 0) return c;
  const score = worstVswr([...prefix, ...elements], load, z0, scoring, target);
  const slots = c.topology.slots.filter((_, i) => keep[i]);
  return {
    ...c,
    topology: { slots, label: topologyLabel(slots) },
    elements,
    worstVswr: score,
    count: elements.length,
  };
}

/** Best worst-case VSWR first; within a thousandth of each other the one with fewer parts. */
function rank(list: readonly BroadbandCandidate[]): BroadbandCandidate[] {
  return [...list].sort(
    (a, b) =>
      Math.round(a.worstVswr * 1000) - Math.round(b.worstVswr * 1000) ||
      a.count - b.count ||
      a.worstVswr - b.worstVswr ||
      (a.topology.label < b.topology.label ? -1 : a.topology.label > b.topology.label ? 1 : 0),
  );
}
