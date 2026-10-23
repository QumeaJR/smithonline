import type { MonteCarloResult } from '@smithonline/core';
import { create } from 'zustand';

/** The last Monte Carlo run: its numbers for the panel and the cloud path for the chart. */
interface MonteCarloState {
  result: MonteCarloResult | null;
  /** SVG path of the cloud in chart coordinates. */
  cloud: string;
  /** The design has changed since the run. */
  stale: boolean;
  set: (result: MonteCarloResult, cloud: string) => void;
  markStale: (stale: boolean) => void;
  clear: () => void;
}

export const useMonteCarlo = create<MonteCarloState>()((set) => ({
  result: null,
  cloud: '',
  stale: false,
  set: (result, cloud) => set({ result, cloud, stale: false }),
  markStale: (stale) => set({ stale }),
  clear: () => set({ result: null, cloud: '', stale: false }),
}));
