import type { OptimizeProgress, OptimizeResult } from '@smithonline/core';
import type { OptimizeMessage, OptimizeRequest } from '../workers/optimize.worker';

export interface OptimizeJob {
  readonly result: Promise<OptimizeResult>;
  /** Stop the search; the promise then rejects with an Error('cancelled'). */
  readonly cancel: () => void;
}

/** Run the band optimizer in a Web Worker; one worker per job, terminated when it ends. */
export function startOptimizer(
  request: OptimizeRequest,
  onProgress: (p: OptimizeProgress) => void,
): OptimizeJob {
  const worker = new Worker(new URL('../workers/optimize.worker.ts', import.meta.url), {
    type: 'module',
  });
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
    settle?.reject(new Error(e.message || 'Optimizer failed'));
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
