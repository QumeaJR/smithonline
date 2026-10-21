/**
 * The band optimizer off the main thread. A search is thousands of ladder
 * evaluations and would freeze the chart for seconds; here it posts its
 * progress per restart and the result when done.
 */
import {
  optimizeBand,
  type Ladder,
  type OptimizeOptions,
  type OptimizeResult,
} from '@smithonline/core';

export interface OptimizeRequest {
  readonly ladder: Ladder;
  readonly frequencies: readonly number[];
  readonly options?: Omit<OptimizeOptions, 'onProgress' | 'load'>;
}

export type OptimizeMessage =
  | {
      readonly type: 'progress';
      readonly done: number;
      readonly total: number;
      readonly best: number;
    }
  | { readonly type: 'result'; readonly result: OptimizeResult };

const post = (message: OptimizeMessage): void => self.postMessage(message);

self.onmessage = (e: MessageEvent<OptimizeRequest>): void => {
  const { ladder, frequencies, options } = e.data;
  const result = optimizeBand(ladder, frequencies, {
    ...options,
    onProgress: (p) => post({ type: 'progress', ...p }),
  });
  post({ type: 'result', result });
};
