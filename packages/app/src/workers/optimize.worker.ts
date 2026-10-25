/**
 * The band optimizer off the main thread. A search is thousands of ladder
 * evaluations and would freeze the chart for seconds; here it posts its
 * progress per restart and the result when done.
 */
import {
  interpolatedLoad,
  limitCost,
  optimizeBand,
  type SweepLoad,
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
  /**
   * The measured points the load across the band is modelled from (fitted from six points, at
   * the ladder's Z0); without them the ladder's fixed load. Functions do not cross the worker
   * boundary, so the model is built again here, the same way.
   */
  readonly loads?: readonly SweepLoad[];
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
  const { ladder, frequencies, options, limits, loads } = e.data;
  const load =
    loads && loads.length >= 2 ? interpolatedLoad(loads, { z0: ladder.z0 }) : ladder.load;
  const result = optimizeBand(ladder, frequencies, {
    ...options,
    load,
    ...(limits && limits.length > 0 ? { cost: limitCost(ladder, limits, frequencies, load) } : {}),
    onProgress: (p) => post({ type: 'progress', ...p }),
  });
  post({ type: 'result', result });
};
