import { create } from 'zustand';

/**
 * The Bode-Fano limit of the last Broadband search over a measured load, for
 * the dashed line on the Response view's VSWR plot (docs/09 section 2). It
 * belongs to the rows it was found for: another import, or the fixed load,
 * and the line goes.
 */
export interface BandLimit {
  /** The lowest worst VSWR any lossless network can reach over the band (exact, or an estimate). */
  readonly floor: number;
  /** An estimate from the load Q, not a hard limit: the plot labels it so. */
  readonly estimate?: boolean;
  readonly start: number;
  readonly stop: number;
  /** The measured rows the search used (by identity). */
  readonly loads: readonly unknown[];
}

/** The best worst VSWR the last Broadband search found with a given number of parts. */
export interface BandBest {
  readonly count: number;
  readonly vswr: number;
}

interface BandLimitState {
  readonly limit: BandLimit | null;
  /** The last search's best per part count, fewest parts first; empty before a search. */
  readonly bests: readonly BandBest[];
  setLimit: (limit: BandLimit | null) => void;
  setBests: (bests: readonly BandBest[]) => void;
}

export const useBandLimit = create<BandLimitState>()((set) => ({
  limit: null,
  bests: [],
  setLimit: (limit) => set({ limit }),
  setBests: (bests) => set({ bests }),
}));
