/**
 * The real frequency technique off the main thread (docs/08, D7): one
 * optimization per prototype, a progress message after each, then the
 * result with the Bode-Fano floor of the same load on the same grid.
 */
import {
  feasibility,
  interpolatedLoad,
  realFrequencyMatch,
  type Complex,
  type Element,
  type Feasibility,
  type RftResult,
  type SweepLoad,
} from '@smithonline/core';

export interface RftRequest {
  readonly frequencies: readonly number[];
  /** A fixed load, or the measured points the load model is built from (fitted at z0). */
  readonly load: Complex | readonly SweepLoad[];
  /** The design's Z0: the measured load is fitted at it. */
  readonly z0: number;
  /** The source resistance the equalizer works from (a real target, or Z0). */
  readonly r0: number;
  readonly prefix: readonly Element[];
  readonly parts: number;
}

export interface RftAnswer {
  readonly result: RftResult;
  readonly floor: Feasibility | null;
}

export type RftMessage =
  | { readonly type: 'progress'; readonly done: number; readonly total: number }
  | { readonly type: 'result'; readonly answer: RftAnswer };

const post = (message: RftMessage): void => self.postMessage(message);

self.onmessage = (e: MessageEvent<RftRequest>): void => {
  const { frequencies, load, z0, r0, prefix, parts } = e.data;
  const model = Array.isArray(load)
    ? interpolatedLoad(load as readonly SweepLoad[], { z0 })
    : (load as Complex);
  const result = realFrequencyMatch(frequencies, {
    load: model,
    z0: r0,
    prefix,
    parts,
    onProgress: (p) => post({ type: 'progress', done: p.done, total: p.total }),
  });
  const floor = feasibility(model, result.scoringFrequencies);
  post({ type: 'result', answer: { result, floor } });
};
