/**
 * The broadband topology search off the main thread. Hundreds of candidate
 * ladders are optimized one after the other; this posts a progress message
 * per candidate and the ranked result when done.
 */
import {
  broadbandMatch,
  interpolatedLoad,
  type BroadbandProgress,
  type BroadbandResult,
  type Complex,
  type Element,
  type SweepLoad,
} from '@smithonline/core';

export interface BroadbandRequest {
  readonly frequencies: readonly number[];
  /**
   * A fixed load, or the measured points the load model is built from (the fitted model from
   * six points, at Z0; functions do not cross the worker boundary).
   */
  readonly load: Complex | readonly SweepLoad[];
  readonly z0: number;
  readonly target: Complex;
  readonly prefix: readonly Element[];
  readonly maxElements: number;
  readonly allowLine: boolean;
}

export type BroadbandMessage =
  | ({ readonly type: 'progress' } & BroadbandProgress)
  | { readonly type: 'result'; readonly result: BroadbandResult };

const post = (message: BroadbandMessage): void => self.postMessage(message);

self.onmessage = (e: MessageEvent<BroadbandRequest>): void => {
  const { frequencies, load, z0, target, prefix, maxElements, allowLine } = e.data;
  const result = broadbandMatch(frequencies, {
    load: Array.isArray(load)
      ? interpolatedLoad(load as readonly SweepLoad[], { z0 })
      : (load as Complex),
    z0,
    target,
    prefix,
    maxElements,
    allowLine,
    onProgress: (p) => post({ type: 'progress', ...p }),
  });
  post({ type: 'result', result });
};
