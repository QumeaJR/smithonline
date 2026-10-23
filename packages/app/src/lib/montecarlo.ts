import type { MonteCarloResult } from '@smithonline/core';
import type { MonteCarloMessage, MonteCarloRequest } from '../workers/montecarlo.worker';

export interface MonteCarloJob {
  readonly result: Promise<MonteCarloResult>;
  /** Stop the run; the promise then rejects with an Error('cancelled'). */
  readonly cancel: () => void;
}

/** Run the analysis in a Web Worker; one worker per job, terminated when it ends. */
export function startMonteCarlo(
  request: MonteCarloRequest,
  onProgress: (done: number, total: number) => void,
): MonteCarloJob {
  const worker = new Worker(new URL('../workers/montecarlo.worker.ts', import.meta.url), {
    type: 'module',
  });
  let settle: { resolve: (r: MonteCarloResult) => void; reject: (e: Error) => void } | null = null;
  const result = new Promise<MonteCarloResult>((resolve, reject) => {
    settle = { resolve, reject };
  });
  worker.onmessage = (e: MessageEvent<MonteCarloMessage>): void => {
    const msg = e.data;
    if (msg.type === 'progress') {
      onProgress(msg.done, msg.total);
    } else {
      settle?.resolve(msg.result);
      worker.terminate();
    }
  };
  worker.onerror = (e: ErrorEvent): void => {
    settle?.reject(new Error(e.message || 'The tolerance analysis failed'));
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
