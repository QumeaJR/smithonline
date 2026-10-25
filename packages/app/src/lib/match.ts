import {
  applyElement,
  chartDistance,
  cinv,
  type Element,
  lMatch,
  microstripProperties,
  piMatch,
  singleMatch,
  teeMatch,
  type Complex,
  type MatchSolution,
} from '@smithonline/core';
import { elementName, elementSummary, PALETTE } from './elements';
import { fmtComplex, fmtNum } from './format';

export type Topology = 'L' | 'Pi' | 'T';

/**
 * Every one- or two-element network from zin to the target, lowest Q first:
 * the palette's single parts tuned towards it, then the exact L-networks.
 */
export function lSolutions(zin: Complex, target: Complex, z0: number, f: number): MatchSolution[] {
  const candidates = PALETTE.filter((p) => !p.id.includes('RLC')).map((p) => p.make(z0, f));
  const singles = singleMatch(candidates, zin, target, f);
  const pairs = lMatch(zin, target, f);
  // Lossless networks first; a resistor or a transformer with loss is a pad, listed after them.
  const lossy = (s: MatchSolution): number => (s.elements.some((el) => el.kind === 'R') ? 1 : 0);
  return distinctSolutions(
    buildable([...singles, ...pairs], zin, z0, f).sort((a, b) => lossy(a) - lossy(b) || a.q - b.q),
  );
}

/** A number to four significant digits, so two solvers' roundings of one value compare equal. */
const sig = (v: unknown): unknown =>
  typeof v === 'number' && Number.isFinite(v) && v !== 0 ? Number(v.toPrecision(4)) : v;

/** What a network is: its parts in order with their kinds, orientations and values. */
export function networkSignature(elements: readonly Element[]): string {
  return JSON.stringify(
    elements.map((el) =>
      Object.fromEntries(
        Object.entries(el)
          .filter(([key]) => key !== 'id' && key !== 'color')
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([key, value]) => [key, sig(value)]),
      ),
    ),
  );
}

/**
 * One row per distinct network, the first (best ranked) one kept: an
 * L-network whose second part comes out at zero collapses to the single part
 * the single-part search offers too, and both orderings of the L can collapse
 * to the same part.
 */
export function distinctSolutions(solutions: readonly MatchSolution[]): MatchSolution[] {
  const seen = new Set<string>();
  return solutions.filter((s) => {
    const key = networkSignature(s.elements);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * The status message of an added match solution, the same from the match
 * suggestions and from Auto match; it names the step for Undo and Redo.
 */
export function addedMessage(sol: MatchSolution): string {
  return `Added ${sol.elements.map((el) => `${elementName(el)} ${elementSummary(el)}`).join(' + ')}; Zin = ${fmtComplex(sol.result, 1)} Ω (Q ${fmtNum(sol.q, 2)})`;
}

/** The networks of one topology from zin to the target; Pi and T need the loaded Q they are built for. */
export function matchSolutions(
  topology: Topology,
  zin: Complex,
  target: Complex,
  z0: number,
  f: number,
  q: number,
): MatchSolution[] {
  switch (topology) {
    case 'L':
      return lSolutions(zin, target, z0, f);
    case 'Pi':
      return buildable(piMatch(zin, target, f, q), zin, z0, f);
    case 'T':
      return buildable(teeMatch(zin, target, f, q), zin, z0, f);
  }
}

/**
 * The lowest Q a Pi or T can be asked for between zin and the target: the Q
 * of the plain L-network between the two resistances (series resistances for
 * the T, parallel resistances for the Pi). Below it there is no virtual
 * resistance to go through and the synthesis returns nothing.
 */
export function minimumQ(topology: 'Pi' | 'T', zin: Complex, target: Complex): number {
  const a = topology === 'T' ? zin.re : 1 / cinv(zin).re;
  const b = topology === 'T' ? target.re : 1 / cinv(target).re;
  if (!(a > 0) || !(b > 0)) return Infinity;
  return Math.sqrt(Math.max(a, b) / Math.min(a, b) - 1);
}

/**
 * A part whose effect at f is below what can be built or measured: a series
 * reactance or resistance under Z0 / 1000, a shunt one above 1000 Z0, a line
 * or stub shorter than a thousandth of a wavelength, a transformer ratio
 * within a thousandth of 1. Such parts show up when Zin already sits on the
 * target and a solver still returns "a solution".
 */
export function negligibleElement(el: Element, z0: number, f: number): boolean {
  const w = 2 * Math.PI * f;
  const tiny = z0 * 1e-3;
  const huge = z0 * 1e3;
  switch (el.kind) {
    case 'L': {
      const x = w * el.value;
      return el.orientation === 'series' ? x < tiny : x > huge;
    }
    case 'C': {
      const x = 1 / (w * el.value);
      return el.orientation === 'series' ? x < tiny : x > huge;
    }
    case 'R':
      return el.orientation === 'series' ? el.value < tiny : el.value > huge;
    case 'transformer':
      return Math.abs(el.n - 1) < 1e-3;
    case 'line':
    case 'openStub':
    case 'shortStub':
      return el.length < 1e-3;
    case 'microstrip':
      return (
        (el.length * microstripProperties(el.stackup, el.width, f).beta) / (2 * Math.PI) < 1e-3
      );
    case 'RLC':
    case 'part':
      return false;
  }
}

/**
 * True when any of the parts, applied in order from `start`, moves the point by less than
 * a thousandth of the chart (VSWR 1.002): a quarter-wave shorted stub, a half-wave line, a
 * transformer with n near 1 or a milliohm resistor change nothing and are not offered.
 */
export function negligibleEffect(
  elements: readonly Element[],
  start: Complex,
  z0: number,
  f: number,
): boolean {
  let z = start;
  for (const el of elements) {
    const next = applyElement(el, z, f);
    if (chartDistance(z, next, z0) < 1e-3) return true;
    z = next;
  }
  return false;
}

/** True when the whole network, applied from `start`, leaves the point where it was. */
export function solutionDoesNothing(
  elements: readonly Element[],
  start: Complex,
  z0: number,
  f: number,
): boolean {
  const end = elements.reduce((z, el) => applyElement(el, z, f), start);
  return chartDistance(start, end, z0) < 1e-3;
}

/**
 * Solutions without a part that is too small to build and that move the point:
 * a network that lands where it started (Zin already on the target) is not offered,
 * while an exact network whose last part is a small but real correction is kept.
 */
export function buildable(
  solutions: readonly MatchSolution[],
  zin: Complex,
  z0: number,
  f: number,
): MatchSolution[] {
  return solutions.filter(
    (s) =>
      !s.elements.some((el) => negligibleElement(el, z0, f)) &&
      !solutionDoesNothing(s.elements, zin, z0, f),
  );
}
