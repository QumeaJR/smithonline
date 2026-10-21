import {
  cinv,
  lMatch,
  piMatch,
  singleMatch,
  teeMatch,
  type Complex,
  type MatchSolution,
} from '@smithonline/core';
import { PALETTE } from './elements';

export type Topology = 'L' | 'Pi' | 'T';

/**
 * Every one- or two-element network from zin to the target, lowest Q first:
 * the palette's single parts tuned towards it, then the exact L-networks.
 */
export function lSolutions(zin: Complex, target: Complex, z0: number, f: number): MatchSolution[] {
  const candidates = PALETTE.filter((p) => !p.id.includes('RLC')).map((p) => p.make(z0, f));
  const singles = singleMatch(candidates, zin, target, f);
  const pairs = lMatch(zin, target, f);
  return [...singles, ...pairs].sort((a, b) => a.q - b.q);
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
      return piMatch(zin, target, f, q);
    case 'T':
      return teeMatch(zin, target, f, q);
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
