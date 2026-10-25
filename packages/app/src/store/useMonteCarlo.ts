import type { CornerResult, MonteCarloResult } from '@smithonline/core';
import { create } from 'zustand';

/** A point in chart coordinates (x right, y down). */
export interface ChartPoint {
  readonly x: number;
  readonly y: number;
}

/** The last Monte Carlo run: its numbers for the panel and the cloud path for the chart. */
interface MonteCarloState {
  result: MonteCarloResult | null;
  /** The worst-case corner of the same run's network; null when nothing varies or no run. */
  corner: CornerResult | null;
  /** SVG path of the cloud in chart coordinates. */
  cloud: string;
  /** The top of the cloud in chart coordinates: a stale cloud says so there. */
  anchor: ChartPoint | null;
  /** The design has changed since the run. */
  stale: boolean;
  set: (
    result: MonteCarloResult,
    cloud: string,
    anchor?: ChartPoint | null,
    corner?: CornerResult | null,
  ) => void;
  markStale: (stale: boolean) => void;
  clear: () => void;
}

export const useMonteCarlo = create<MonteCarloState>()((set) => ({
  result: null,
  corner: null,
  cloud: '',
  anchor: null,
  stale: false,
  set: (result, cloud, anchor = null, corner = null) =>
    set({ result, cloud, anchor, corner, stale: false }),
  markStale: (stale) => set({ stale }),
  clear: () => set({ result: null, corner: null, cloud: '', anchor: null, stale: false }),
}));
