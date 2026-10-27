/**
 * Fit what moved (phase D6) off the main thread: Levenberg-Marquardt over the
 * drift parameters of the network as built against the measured board. Posts
 * its progress per iteration and the outcome when done; Stop terminates it.
 */
import {
  fitBuild,
  type BuildFitOutcome,
  type BuildModel,
  type MeasuredReflection,
} from '@smithonline/core';

export interface BoardFitRequest {
  readonly model: BuildModel;
  readonly measured: readonly MeasuredReflection[];
  readonly free: readonly string[] | null;
  /** The VNA's accuracy floor, |ΔΓ| RMS. */
  readonly accuracy: number;
}

export type BoardFitMessage =
  | {
      readonly type: 'progress';
      readonly pass: number;
      readonly iteration: number;
      readonly rms: number;
    }
  | { readonly type: 'result'; readonly outcome: BuildFitOutcome };

const post = (message: BoardFitMessage): void => self.postMessage(message);

self.onmessage = (e: MessageEvent<BoardFitRequest>): void => {
  const { model, measured, free, accuracy } = e.data;
  let outcome: BuildFitOutcome;
  try {
    outcome = fitBuild(model, measured, {
      ...(free ? { free } : {}),
      accuracy,
      onProgress: (p) => post({ type: 'progress', ...p }),
    });
  } catch (err) {
    outcome = { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
  post({ type: 'result', outcome });
};
