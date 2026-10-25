/**
 * The ranking of Auto match's "Add parts" solutions (D3): by loaded Q as
 * before, by estimated yield under the tolerances, or by VSWR. Every
 * solution carries its yield (200 seeded Monte Carlo runs of the whole
 * network with the solution appended, built and judged exactly as the
 * Tolerance panel builds and judges it after Add: the loss model, the
 * realized values, the target, the measured load) and the part that
 * dominates its spread, whatever the ranking.
 */
import {
  judgedVswr,
  type Element,
  type Ladder,
  type MatchSolution,
  type RealizedSolution,
} from '@smithonline/core';
import type { Design, DesignElement } from './design';
import { fmtFrequency, fmtNum, fmtSig } from './format';
import {
  MATCH_YIELD_RUNS,
  networkRobustness,
  toleranceSetup,
  withAppended,
  type MatchYieldSetup,
  type SolutionRobustness,
} from './sensitivity';

export type MatchRanking = 'q' | 'yield' | 'vswr';

export const MATCH_RANKINGS: readonly { readonly value: MatchRanking; readonly label: string }[] = [
  { value: 'q', label: 'Q' },
  { value: 'yield', label: 'Yield' },
  { value: 'vswr', label: 'VSWR' },
];

export interface RankedSolution {
  /** The solution as listed: realized values when Realize is on. */
  readonly solution: MatchSolution;
  /** The realized solution behind it, when Realize is on. */
  readonly snapped: RealizedSolution | null;
  readonly robustness: SolutionRobustness;
  /** The nominal VSWR, judged as the yield is (towards the target, at f or over the band). */
  readonly vswr: number;
}

/**
 * The whole network a solution gives, as the Tolerance panel analyses it after Add: the
 * design's parts and the parts Add appends (the snapped values with Realize on), through the
 * loss model and Realize as toleranceSetup applies them.
 */
function networkOf(
  design: Design,
  elements: readonly DesignElement[],
  added: readonly Element[],
): Ladder {
  return toleranceSetup(withAppended(design, added, elements)).ladder;
}

/**
 * The solutions with their yield, dominant part and VSWR, in the order of
 * the ranking. `ideal` are the synthesized solutions, `snapped` the same
 * with Realize's values (null when Realize is off). Ties keep the order of
 * the loaded Q.
 */
export function rankSolutions(
  design: Design,
  elements: readonly DesignElement[],
  ideal: readonly MatchSolution[],
  snapped: readonly RealizedSolution[] | null,
  setup: MatchYieldSetup,
  ranking: MatchRanking,
): RankedSolution[] {
  const rows = (snapped ?? ideal).map((item, order) => {
    const s = snapped ? (item as RealizedSolution) : null;
    const solution: MatchSolution = s
      ? { ...s.solution, elements: s.elements, result: s.zin }
      : (item as MatchSolution);
    // What Add appends: the listed values (the snapped ones with Realize on).
    const ladder = networkOf(design, elements, solution.elements);
    const robustness = networkRobustness(design, elements, ladder, setup);
    const vswr = judgedVswr(ladder.elements, ladder, {
      ...(setup.band.length > 0 ? { band: setup.band, load: setup.load } : {}),
      ...(setup.target ? { target: setup.target } : {}),
    });
    return { row: { solution, snapped: s, robustness, vswr }, order };
  });
  const byQ = (a: (typeof rows)[number], b: (typeof rows)[number]): number =>
    a.row.solution.q - b.row.solution.q || a.order - b.order;
  const cmp = {
    q: byQ,
    yield: (a: (typeof rows)[number], b: (typeof rows)[number]): number =>
      b.row.robustness.yield.passed - a.row.robustness.yield.passed ||
      a.row.robustness.rms - b.row.robustness.rms ||
      byQ(a, b),
    vswr: (a: (typeof rows)[number], b: (typeof rows)[number]): number =>
      (Number.isFinite(a.row.vswr) ? a.row.vswr : 1e300) -
        (Number.isFinite(b.row.vswr) ? b.row.vswr : 1e300) || byQ(a, b),
  }[ranking];
  return rows.sort(cmp).map((r) => r.row);
}

/** Where the yield and the VSWR are judged, for a sentence. */
function whereText(setup: MatchYieldSetup): string {
  const towards = setup.target ? ' towards the target' : '';
  if (setup.band.length === 0) return `${towards} at the design frequency`;
  const lo = setup.band[0] as number;
  const hi = setup.band[setup.band.length - 1] as number;
  return `${towards} over the band, ${fmtFrequency(lo)} to ${fmtFrequency(hi)}`;
}

/**
 * A yield of Auto match's 200 runs, to the precision they give: "about 77 %", "≥ 99 %" when
 * every run passed, "≤ 1 %" when none did; never 100 % or 0 %.
 */
export function fmtMatchYield(passed: number, runs: number): string {
  if (!(runs > 0) || !Number.isFinite(passed) || passed < 0 || passed > runs) return 'not known';
  if (passed === runs) return '≥ 99 %';
  if (passed === 0) return '≤ 1 %';
  const pct = Math.min(99, Math.max(1, Math.round((passed * 100) / runs)));
  return `about ${pct} %`;
}

/** The tooltip of an Auto match yield: the run count behind it. */
export function matchYieldTitle(passed: number, runs: number, setup: MatchYieldSetup): string {
  return `${passed} of ${runs} Monte Carlo runs within VSWR ${fmtSig(setup.vswrLimit)}${whereText(setup)}`;
}

/** Where the yields in the notes come from, when the list is not ranked by them. */
function yieldNote(setup: MatchYieldSetup): string {
  return `Yields: ${MATCH_YIELD_RUNS} runs within VSWR ${fmtSig(setup.vswrLimit)}, set in Tolerance.`;
}

/** True when every row has the same key (and there are two rows or more). */
function allTie(rows: readonly RankedSolution[], key: (r: RankedSolution) => number): boolean {
  if (rows.length < 2) return false;
  const first = key(rows[0] as RankedSolution);
  return rows.every((r) => {
    const v = key(r);
    return v === first || (Number.isFinite(v) && Math.abs(v - first) <= 1e-9 * Math.abs(first));
  });
}

/**
 * The one line that says how the list is ranked. With the ranked rows it says when every row
 * ties, so the order comes from the tie-break.
 */
export function rankingExplanation(
  ranking: MatchRanking,
  setup: MatchYieldSetup,
  realized: boolean,
  rows: readonly RankedSolution[] = [],
): string {
  switch (ranking) {
    case 'q':
      return `Ranked by loaded Q, lowest (widest bandwidth) first. ${yieldNote(setup)}`;
    case 'yield': {
      const how = `Ranked by estimated yield: ${MATCH_YIELD_RUNS} Monte Carlo runs of the whole network with ${setup.toleranceLabel}, within VSWR ${fmtSig(setup.vswrLimit)}, set in Tolerance,${whereText(setup)}`;
      if (allTie(rows, (r) => r.robustness.yield.passed)) {
        const y = (rows[0] as RankedSolution).robustness.yield;
        return `${how}. Every network passes ${y.passed} of ${y.runs} runs, so the order comes from the spread: the less sensitive network first, then the lower Q.`;
      }
      return `${how}; ties go to the less sensitive network, then the lower Q.`;
    }
    case 'vswr': {
      const how = `Ranked by VSWR${realized ? ' with the snapped values' : ''}${whereText(setup)}, lowest first`;
      if (allTie(rows, (r) => r.vswr)) {
        const v = (rows[0] as RankedSolution).vswr;
        return `${how}. Every network reaches VSWR ${fmtNum(v, 3)}, so the order comes from Q, lowest first. ${yieldNote(setup)}`;
      }
      return `${how}; ties by Q. ${yieldNote(setup)}`;
    }
  }
}
