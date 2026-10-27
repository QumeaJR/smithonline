import { track } from './analytics/track';
import type { OptimizeProgress, OptimizeResult } from '@smithonline/core';
import type { OptimizeMessage, OptimizeRequest } from '../workers/optimize.worker';

export interface OptimizeJob {
  readonly result: Promise<OptimizeResult>;
  /** Stop the search; the promise then rejects with an Error('cancelled'). */
  readonly cancel: () => void;
}

/** What the panel says when the worker cannot load or dies without a message of its own. */
export const OPTIMIZER_NO_WORKER =
  'Optimize band could not start its background worker (the script did not load). Reload the page and run it again.';

/** Run the band optimizer in a Web Worker; one worker per job, terminated when it ends. */
export function startOptimizer(
  request: OptimizeRequest,
  onProgress: (p: OptimizeProgress) => void,
): OptimizeJob {
  let worker: Worker;
  try {
    worker = new Worker(new URL('../workers/optimize.worker.ts', import.meta.url), {
      type: 'module',
    });
  } catch {
    return { result: Promise.reject(new Error(OPTIMIZER_NO_WORKER)), cancel: () => undefined };
  }
  let settle: { resolve: (r: OptimizeResult) => void; reject: (e: Error) => void } | null = null;
  const result = new Promise<OptimizeResult>((resolve, reject) => {
    settle = { resolve, reject };
  });
  worker.onmessage = (e: MessageEvent<OptimizeMessage>): void => {
    const msg = e.data;
    if (msg.type === 'progress') {
      onProgress({ done: msg.done, total: msg.total, best: msg.best });
    } else {
      settle?.resolve(msg.result);
      worker.terminate();
    }
  };
  worker.onerror = (e: ErrorEvent): void => {
    track('error', 'worker');
    // A worker that cannot load reports an error event without a message.
    settle?.reject(
      new Error(e.message ? `Optimize band stopped: ${e.message}` : OPTIMIZER_NO_WORKER),
    );
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
