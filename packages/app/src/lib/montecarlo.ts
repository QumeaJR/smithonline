import { track } from './analytics/track';
import type { CornerResult, MonteCarloResult } from '@smithonline/core';
import type { MonteCarloMessage, MonteCarloRequest } from '../workers/montecarlo.worker';

/** What a run brings back: the analysis and the worst-case corner. */
export interface MonteCarloOutcome {
  readonly result: MonteCarloResult;
  readonly corner: CornerResult | null;
}

export interface MonteCarloJob {
  readonly result: Promise<MonteCarloOutcome>;
  /** Stop the run; the promise then rejects with an Error('cancelled'). */
  readonly cancel: () => void;
}

/** What the panel says when the analysis fails, whatever the worker reported. */
export const MONTE_CARLO_FAILED =
  'The tolerance analysis stopped with an error. Try fewer runs, or check the part values.';

/**
 * Run the analysis in a Web Worker; one worker per job, terminated when it
 * ends. A failure rejects with MONTE_CARLO_FAILED, never the raw exception.
 */
export function startMonteCarlo(
  request: MonteCarloRequest,
  onProgress: (done: number, total: number, passed: number) => void,
): MonteCarloJob {
  const worker = new Worker(new URL('../workers/montecarlo.worker.ts', import.meta.url), {
    type: 'module',
  });
  let settle: { resolve: (r: MonteCarloOutcome) => void; reject: (e: Error) => void } | null = null;
  const result = new Promise<MonteCarloOutcome>((resolve, reject) => {
    settle = { resolve, reject };
  });
  worker.onmessage = (e: MessageEvent<MonteCarloMessage>): void => {
    const msg = e.data;
    if (msg.type === 'progress') {
      onProgress(msg.done, msg.total, msg.passed);
    } else if (msg.type === 'error') {
      settle?.reject(new Error(MONTE_CARLO_FAILED));
      worker.terminate();
    } else {
      settle?.resolve({ result: msg.result, corner: msg.corner });
      worker.terminate();
    }
  };
  worker.onerror = (e: ErrorEvent): void => {
    track('error', 'worker');
    e.preventDefault?.();
    settle?.reject(new Error(MONTE_CARLO_FAILED));
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
