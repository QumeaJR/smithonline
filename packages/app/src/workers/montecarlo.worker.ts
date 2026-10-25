/**
 * The Monte Carlo analysis off the main thread: thousands of ladder
 * evaluations that would freeze the chart for a moment. It posts its progress
 * and then the result.
 */
import {
  monteCarlo,
  type Ladder,
  type MonteCarloOptions,
  type MonteCarloResult,
} from '@smithonline/core';

export interface MonteCarloRequest {
  readonly ladder: Ladder;
  readonly options: Omit<MonteCarloOptions, 'onProgress'>;
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
  const { ladder, options } = e.data;
  let msg: MonteCarloMessage;
  try {
    const result = monteCarlo(ladder, {
      ...options,
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
