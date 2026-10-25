/**
 * The ranking of Auto match's "Add parts" solutions (D3): by loaded Q as
 * before, by estimated yield under the tolerances, or by VSWR. Every
 * solution carries its yield (200 seeded Monte Carlo runs of the whole
 * network with the solution appended, judged as the Tolerance panel judges)
 * and the part that dominates its spread, whatever the ranking.
 */
import {
  judgedVswr,
  type Element,
  type Ladder,
  type MatchSolution,
  type RealizedSolution,
} from '@smithonline/core';
import type { Design, DesignElement } from './design';
import { fmtFrequency, fmtSig } from './format';
import {
  appendedLadder,
  MATCH_YIELD_RUNS,
  networkRobustness,
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

/** The whole network a solution gives: the realized one with Realize on, else the parts appended. */
function networkOf(
  design: Design,
  elements: readonly DesignElement[],
  solution: MatchSolution,
  snapped: RealizedSolution | null,
): Ladder {
  return snapped
    ? snapped.realization.ladder
    : appendedLadder(design, [...elements, ...solution.elements] as Element[]);
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
    const ladder = networkOf(design, elements, s ? s.solution : solution, s);
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

/** The one line that says how the list is ranked. */
export function rankingExplanation(
  ranking: MatchRanking,
  setup: MatchYieldSetup,
  realized: boolean,
): string {
  switch (ranking) {
    case 'q':
      return 'Ranked by loaded Q, lowest (widest bandwidth) first.';
    case 'yield':
      return `Ranked by estimated yield: ${MATCH_YIELD_RUNS} Monte Carlo runs of the whole network with ${setup.toleranceLabel}, within VSWR ${fmtSig(setup.vswrLimit)}${whereText(setup)}; ties go to the less sensitive network, then the lower Q.`;
    case 'vswr':
      return `Ranked by VSWR${realized ? ' with the snapped values' : ''}${whereText(setup)}, lowest first; ties by Q.`;
  }
}
