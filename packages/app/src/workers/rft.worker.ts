/**
 * The real frequency technique off the main thread (docs/08, D7): one
 * optimization per prototype, a progress message after each, then the
 * result with the Bode-Fano limit it may be shown beside (rftBandLimit:
 * none through kept parts with loss, none that the result or the load
 * itself beats).
 */
import {
  interpolatedLoad,
  realFrequencyMatch,
  rftBandLimit,
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
  /** The topology search's best ladder of each size up to parts: exact starts and candidates. */
  readonly ladders?: readonly (readonly Element[])[];
}

export interface RftAnswer {
  readonly result: RftResult;
  /** The Bode-Fano limit to show beside the result, or null. */
  readonly floor: Feasibility | null;
  /** Why no limit is shown, when there is a reason worth saying. */
  readonly limitNote: string | null;
}

export type RftMessage =
  | { readonly type: 'progress'; readonly done: number; readonly total: number }
  | { readonly type: 'result'; readonly answer: RftAnswer };

const post = (message: RftMessage): void => self.postMessage(message);

self.onmessage = (e: MessageEvent<RftRequest>): void => {
  const { frequencies, load, z0, r0, prefix, parts, ladders } = e.data;
  const model = Array.isArray(load)
    ? interpolatedLoad(load as readonly SweepLoad[], { z0 })
    : (load as Complex);
  const result = realFrequencyMatch(frequencies, {
    load: model,
    z0: r0,
    prefix,
    parts,
    // The search's part window is referred to the design's Z0.
    windowZ0: z0,
    ...(ladders && ladders.length > 0 ? { ladders } : {}),
    onProgress: (p) => post({ type: 'progress', done: p.done, total: p.total }),
  });
  const limit = rftBandLimit(result, model, prefix);
  post({ type: 'result', answer: { result, floor: limit.floor, limitNote: limit.note } });
};
