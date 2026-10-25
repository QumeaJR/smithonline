/**
 * The measured load's rational fit off the main thread: a point list of a
 * few thousand rows can take half a second to fit, longer than the UI may
 * block. Answers each request with the fit as plain data (null when the fit
 * fails or none is made); the main thread rebuilds the model from it.
 */
import { measuredFitOf, type SweepLoad, type VectorFitData } from '@smithonline/core';

export interface FitRequest {
  readonly id: number;
  readonly points: readonly SweepLoad[];
  readonly z0: number;
}

export interface FitResponse {
  readonly id: number;
  readonly fit: VectorFitData | null;
}

self.onmessage = (e: MessageEvent<FitRequest>): void => {
  const { id, points, z0 } = e.data;
  const fitOf = (): VectorFitData | null => {
    try {
      return measuredFitOf(points, { z0 });
    } catch {
      return null;
    }
  };
  const answer: FitResponse = { id, fit: fitOf() };
  self.postMessage(answer);
};
