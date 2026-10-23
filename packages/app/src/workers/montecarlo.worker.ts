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
  | { readonly type: 'progress'; readonly done: number; readonly total: number }
  | { readonly type: 'result'; readonly result: MonteCarloResult };

self.onmessage = (e: MessageEvent<MonteCarloRequest>): void => {
  const { ladder, options } = e.data;
  const result = monteCarlo(ladder, {
    ...options,
    onProgress: (done, total) => {
      const msg: MonteCarloMessage = { type: 'progress', done, total };
      self.postMessage(msg);
    },
  });
  const msg: MonteCarloMessage = { type: 'result', result };
  self.postMessage(msg);
};
