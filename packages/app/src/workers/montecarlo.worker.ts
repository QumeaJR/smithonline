/**
 * The Monte Carlo analysis off the main thread: thousands of ladder
 * evaluations that would freeze the chart for a moment. It posts its progress
 * and then the result.
 */
import {
  interpolatedLoad,
  monteCarlo,
  type SweepLoad,
  type Ladder,
  type MonteCarloOptions,
  type MonteCarloResult,
} from '@smithonline/core';

export interface MonteCarloRequest {
  readonly ladder: Ladder;
  readonly options: Omit<MonteCarloOptions, 'onProgress' | 'load'>;
  /**
   * The measured points the load over the band is modelled from (fitted from six points, at
   * the ladder's Z0); without them the band uses the ladder's fixed load. The model is built
   * here because functions do not cross the worker boundary.
   */
  readonly loads?: readonly SweepLoad[];
}

export type MonteCarloMessage =
  | {
      readonly type: 'progress';
      readonly done: number;
      readonly total: number;
      /** Runs within the limit so far. */
      readonly passed: number;
    }
  | { readonly type: 'result'; readonly result: MonteCarloResult }
  /** The analysis threw; the panel shows a short message of its own, not this text. */
  | { readonly type: 'error'; readonly detail: string };

self.onmessage = (e: MessageEvent<MonteCarloRequest>): void => {
  const { ladder, options, loads } = e.data;
  let msg: MonteCarloMessage;
  try {
    const result = monteCarlo(ladder, {
      ...options,
      ...(loads && loads.length >= 2 ? { load: interpolatedLoad(loads, { z0: ladder.z0 }) } : {}),
      onProgress: (done, total, passed) => {
        const progress: MonteCarloMessage = { type: 'progress', done, total, passed };
        self.postMessage(progress);
      },
    });
    msg = { type: 'result', result };
  } catch (err) {
    msg = { type: 'error', detail: err instanceof Error ? err.message : String(err) };
  }
  self.postMessage(msg);
};
