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
 * Determinism and time: every candidate gets its own seed derived from its
 * topology, so the result does not depend on the order candidates are tried
 * in, and its own budget of ladder evaluations, so the total is a number you
 * can read off before pressing the button. Large searches run a cheap first
 * pass over everything and spend the full budget only on the best few.
 */
import { complex, type Complex } from './complex.js';
import { ladderAbcd, applyElement, type Element, type Orientation } from './elements.js';
import { throughAbcd } from './abcd.js';
import type { SweepLoad } from './ladder.js';
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

/** A load known at a few frequencies as a function: linear in R and X, held flat outside. */
export function interpolatedLoad(points: readonly SweepLoad[]): LoadModel {
  const sorted = [...points].sort((a, b) => a.frequency - b.frequency);
  const first = sorted[0];
  if (!first) return complex(50, 0);
  if (sorted.length === 1) return first.z;
  return (f: number): Complex => {
    const last = sorted[sorted.length - 1] as SweepLoad;
    if (f <= first.frequency) return first.z;
    if (f >= last.frequency) return last.z;
    let k = 1;
    while (k < sorted.length - 1 && (sorted[k] as SweepLoad).frequency < f) k++;
    const a = sorted[k - 1] as SweepLoad;
    const b = sorted[k] as SweepLoad;
    const t = (f - a.frequency) / (b.frequency - a.frequency);
    return complex(a.z.re + t * (b.z.re - a.z.re), a.z.im + t * (b.z.im - a.z.im));
  };
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
  /** Worst VSWR over the whole band with the prefix and these parts. */
  readonly worstVswr: number;
  readonly count: number;
  /** True when the starting values came from the closed-form synthesis. */
  readonly seeded: boolean;
  readonly evaluations: number;
}

export interface BroadbandResult {
  /** Ranked by worst VSWR (equal to three decimals counts as equal), then by number of parts. */
  readonly candidates: readonly BroadbandCandidate[];
  /** Worst VSWR of the design without any new part. Candidates that do not beat it are dropped. */
  readonly baseline: number;
  /** The wall for this load over this band; null for a load without a bandwidth of its own. */
  readonly floor: Feasibility | null;
  readonly maxElements: number;
  /** Topologies searched. */
  readonly topologies: number;
  /** Ladder evaluations spent in all. */
  readonly evaluations: number;
  readonly frequencies: readonly number[];
}

/** The ladder evaluations the search is allowed per candidate of n free values. */
export function defaultBudget(n: number): number {
  return 600 * Math.max(1, n);
}

/** 21 points are plenty to find where a ladder's worst case sits; the answer is re-measured on all. */
const SEARCH_POINTS = 21;
/** First pass over this many topologies or fewer uses the full budget directly. */
const TWO_PASS_ABOVE = 48;
const REFINE = 16;

function searchSubset(freqs: readonly number[]): number[] {
  if (freqs.length <= SEARCH_POINTS) return [...freqs];
  const out: number[] = [];
  for (let i = 0; i < SEARCH_POINTS; i++) {
    out.push(freqs[Math.round((i * (freqs.length - 1)) / (SEARCH_POINTS - 1))] as number);
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
  const baseline = worstVswr(prefix, load, z0, freqs, target);
  const empty: BroadbandResult = {
    candidates: [],
    baseline,
    floor: feasibility(load, freqs),
    maxElements,
    topologies: 0,
    evaluations: 0,
    frequencies: freqs,
  };
  if (freqs.length < 2 || !((freqs[freqs.length - 1] as number) > (freqs[0] as number))) {
    return empty;
  }

  const topologies = enumerateTopologies(
    maxElements,
    options.allowLine === undefined ? {} : { allowLine: options.allowLine },
  );
  const searchFreqs = searchSubset(freqs);
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
      // Re-measured on every point of the band, not only on the search subset.
      worstVswr: worstVswr([...prefix, ...elements], load, z0, freqs, target),
      count: n,
      seeded,
      evaluations: res.evaluations,
    };
  };

  const twoPass = topologies.length > TWO_PASS_ABOVE;
  let done = 0;
  let best = baseline;
  const tell = (label: string, v: number): void => {
    done++;
    if (v < best) best = v;
    options.onProgress?.({
      done,
      total: topologies.length + (twoPass ? Math.min(REFINE, topologies.length) : 0),
      best,
      label,
    });
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

  const kept = rank(
    results.filter((c) => c.worstVswr < OPTIMIZE_FAIL && c.worstVswr < baseline * (1 - 1e-6)),
  ).slice(0, Math.max(1, Math.floor(options.limit ?? 20)));

  return { ...empty, candidates: kept, topologies: topologies.length, evaluations };
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
