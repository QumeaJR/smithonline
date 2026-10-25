/**
 * Design centring off the main thread (D3): a few hundred yield estimates on
 * a fixed set of draws, then the check on fresh draws. It posts its progress
 * and the result, as the band optimizer does.
 */
import {
  centreDesign,
  interpolatedLoad,
  type CentreOptions,
  type CentreProgress,
  type CentreResult,
  type Ladder,
  type SweepLoad,
} from '@smithonline/core';

export interface CentreRequest {
  readonly ladder: Ladder;
  readonly options: Omit<CentreOptions, 'onProgress' | 'load'>;
  /**
   * The measured points the load over the band is modelled from (at the ladder's Z0); without
   * them the ladder's fixed load. Functions do not cross the worker boundary.
   */
  readonly loads?: readonly SweepLoad[];
}

export type CentreMessage =
  | ({ readonly type: 'progress' } & CentreProgress)
  | { readonly type: 'result'; readonly result: CentreResult }
  /** The search threw; the panel shows a short message of its own. */
  | { readonly type: 'error'; readonly detail: string };

const post = (message: CentreMessage): void => self.postMessage(message);

self.onmessage = (e: MessageEvent<CentreRequest>): void => {
  const { ladder, options, loads } = e.data;
  try {
    const load = loads && loads.length >= 2 ? interpolatedLoad(loads, { z0: ladder.z0 }) : null;
    const result = centreDesign(ladder, {
      ...options,
      ...(load ? { load } : {}),
      onProgress: (p) => post({ type: 'progress', ...p }),
    });
    post({ type: 'result', result });
  } catch (err) {
    post({ type: 'error', detail: err instanceof Error ? err.message : String(err) });
  }
};
