/**
 * Design centring as the app runs it: the request built from the design's
 * tolerance settings (the network the Tolerance panel analyses, its band and
 * load, the Realize series to snap to), the job in a Web Worker, and the
 * step that applies the centred values.
 */
import { track } from './analytics/track';
import type { CentreProgress, CentreResult } from '@smithonline/core';
import { create } from 'zustand';
import type { CentreMessage, CentreRequest } from '../workers/centre.worker';
import type { Design } from './design';
import { hasMeasuredLoad, measuredPoints } from './measuredLoad';
import { valueSource } from './realize';
import { toleranceSetup } from './sensitivity';

export interface CentreJob {
  readonly result: Promise<CentreResult>;
  /** Stop the search; the promise then rejects with an Error('cancelled'). */
  readonly cancel: () => void;
}

/**
 * The last centring as the Tolerance panel shows it, for the robust workflow's
 * Apply step: whether a search runs, and the result with the limit it was
 * judged by. `offered` says the panel shows Apply for it.
 */
export const useCentreOutcome = create<{
  running: boolean;
  last: { readonly result: CentreResult; readonly limit: number; readonly offered: boolean } | null;
}>(() => ({ running: false, last: null }));

/** What the panel says when the search fails, whatever the worker reported. */
export const CENTRE_FAILED =
  'Design centring stopped with an error. Check the part values and the VSWR limit.';

/** The request for the design as the Tolerance panel analyses it. */
export function centreRequest(design: Design): CentreRequest {
  const { ladder, band, options } = toleranceSetup(design);
  const loads = band.length > 0 && hasMeasuredLoad(design) ? measuredPoints(design) : null;
  const { runs: _runs, bins: _bins, ...rest } = options;
  void _runs;
  void _bins;
  return {
    ladder,
    options: {
      ...rest,
      seed: options.seed ?? 1,
      ...(design.realize.enabled
        ? { realize: { source: valueSource(design.realize), scope: design.realize.scope } }
        : {}),
    },
    ...(loads ? { loads } : {}),
  };
}

/** Run design centring in a Web Worker; one worker per job, terminated when it ends. */
export function startCentring(
  request: CentreRequest,
  onProgress: (p: CentreProgress) => void,
): CentreJob {
  const worker = new Worker(new URL('../workers/centre.worker.ts', import.meta.url), {
    type: 'module',
  });
  let settle: { resolve: (r: CentreResult) => void; reject: (e: Error) => void } | null = null;
  const result = new Promise<CentreResult>((resolve, reject) => {
    settle = { resolve, reject };
  });
  worker.onmessage = (e: MessageEvent<CentreMessage>): void => {
    const msg = e.data;
    if (msg.type === 'progress') {
      onProgress({ stage: msg.stage, done: msg.done, total: msg.total, best: msg.best });
    } else if (msg.type === 'error') {
      settle?.reject(new Error(CENTRE_FAILED));
      worker.terminate();
    } else {
      settle?.resolve(msg.result);
      worker.terminate();
    }
  };
  worker.onerror = (e: ErrorEvent): void => {
    track('error', 'worker');
    e.preventDefault?.();
    settle?.reject(new Error(CENTRE_FAILED));
    worker.terminate();
  };
  worker.postMessage(request);
  return {
    result,
    cancel: () => {
      worker.terminate();
      settle?.reject(new Error('cancelled'));
    },
  };
}
