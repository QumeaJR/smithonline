/**
 * The band optimizer off the main thread. A search is thousands of ladder
 * evaluations and would freeze the chart for seconds; here it posts its
 * progress per restart and the result when done.
 */
import {
  limitCost,
  optimizeBand,
  type Ladder,
  type LimitArea,
  type OptimizeOptions,
  type OptimizeResult,
} from '@smithonline/core';

export interface OptimizeRequest {
  readonly ladder: Ladder;
  readonly frequencies: readonly number[];
  readonly options?: Omit<OptimizeOptions, 'onProgress' | 'load' | 'cost'>;
  /** Judge the band by these limit areas (worst violation) instead of the worst VSWR. */
  readonly limits?: readonly LimitArea[];
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
  const { ladder, frequencies, options, limits } = e.data;
  const result = optimizeBand(ladder, frequencies, {
    ...options,
    ...(limits && limits.length > 0 ? { cost: limitCost(ladder, limits, frequencies) } : {}),
    onProgress: (p) => post({ type: 'progress', ...p }),
  });
  post({ type: 'result', result });
};
