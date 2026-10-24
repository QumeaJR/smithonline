/**
 * Broadband matching as the app uses it: the search in a Web Worker, the
 * load the band is judged against, and what Realize does to a result.
 */
import {
  interpolatedLoad,
  realizeLadder,
  worstVswr,
  type BroadbandCandidate,
  type BroadbandProgress,
  type BroadbandResult,
  type Complex,
  type Element,
  type LoadModel,
} from '@smithonline/core';
import type { BroadbandMessage, BroadbandRequest } from '../workers/broadband.worker';
import type { Design } from './design';
import { primaryValue, withPrimaryValue } from './elements';
import { realizeOptions, sliderSteps } from './realize';

export interface BroadbandJob {
  readonly result: Promise<BroadbandResult>;
  /** Stop the search; the promise then rejects with an Error('cancelled'). */
  readonly cancel: () => void;
}

/** Run the topology search in a Web Worker; one worker per job, terminated when it ends. */
export function startBroadband(
  request: BroadbandRequest,
  onProgress: (p: BroadbandProgress) => void,
): BroadbandJob {
  const worker = new Worker(new URL('../workers/broadband.worker.ts', import.meta.url), {
    type: 'module',
  });
  let settle: { resolve: (r: BroadbandResult) => void; reject: (e: Error) => void } | null = null;
  const result = new Promise<BroadbandResult>((resolve, reject) => {
    settle = { resolve, reject };
  });
  worker.onmessage = (e: MessageEvent<BroadbandMessage>): void => {
    const msg = e.data;
    if (msg.type === 'progress') {
      onProgress({ done: msg.done, total: msg.total, best: msg.best, label: msg.label });
    } else {
      settle?.resolve(msg.result);
      worker.terminate();
    }
  };
  worker.onerror = (e: ErrorEvent): void => {
    settle?.reject(new Error(e.message || 'Broadband search failed'));
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

/**
 * The load the band is judged against: the design's datapoint loads
 * interpolated over frequency when asked for and there are at least two,
 * else the design's fixed load.
 */
export function bandLoad(design: Design, useDatapoints: boolean): Complex | BandPoints {
  const points = design.sweep.loads;
  return useDatapoints && points && points.length >= 2 ? points : design.load;
}

type BandPoints = NonNullable<Design['sweep']['loads']>;

export function loadModelOf(load: Complex | BandPoints): LoadModel {
  return Array.isArray(load) ? interpolatedLoad(load as BandPoints) : (load as Complex);
}

/** A candidate with Realize on: the new parts snapped, and the worst VSWR the band then shows. */
export interface SnappedCandidate {
  readonly elements: readonly Element[];
  readonly worstVswr: number;
  readonly sourceLabel: string;
}

/**
 * The candidate's parts snapped to the design's series or stock. The parts
 * already in the design (`prefix`) are kept exactly as they are, so only the
 * new ones move; the worst VSWR is measured on the whole ladder over the same
 * band the search used, and each new part may move to a neighbouring value when
 * that lowers it.
 */
export function snapCandidate(
  design: Design,
  prefix: readonly Element[],
  candidate: BroadbandCandidate,
  load: LoadModel,
  frequencies: readonly number[],
  target: Complex,
): SnappedCandidate | null {
  if (!design.realize.enabled) return null;
  const f0 =
    ((frequencies[0] ?? design.frequency) + (frequencies[frequencies.length - 1] ?? 0)) / 2;
  const elements = [...prefix, ...candidate.elements];
  const options = realizeOptions(design, []);
  const r = realizeLadder(
    {
      z0: design.z0,
      frequency: f0,
      load: typeof load === 'function' ? load(f0) : load,
      elements,
    },
    { ...options, locked: prefix.map((_, i) => i), target },
  );
  // realizeLadder picks the neighbour that is better at band centre; across a band the other
  // neighbour is often better, so each new part gets to try the values around its own.
  const worst = (els: readonly Element[]): number =>
    worstVswr(els, load, design.z0, frequencies, target);
  let current = r.ladder.elements.slice();
  let score = worst(current);
  for (let pass = 0; pass < 2; pass++) {
    for (let i = prefix.length; i < current.length; i++) {
      const el = current[i] as Element;
      const v = primaryValue(el);
      const steps = v
        ? sliderSteps(design.realize, { ...el, id: '', color: '' }, v.value, 2)
        : null;
      if (!steps) continue;
      for (const value of steps) {
        const trial = current.slice();
        trial[i] = withPrimaryValue(el, value);
        const w = worst(trial);
        if (w < score - 1e-9) {
          current = trial;
          score = w;
        }
      }
    }
  }
  return {
    elements: current.slice(prefix.length),
    worstVswr: score,
    sourceLabel: r.sourceLabel,
  };
}

/**
 * The line under the progress bar, counted in the same ladders as the band
 * note above it: "Searching ladder 12 of 40" over the first pass, then
 * "Refining the best, 3 of 16" over the second pass of the larger searches.
 */
export function broadbandProgressText(
  progress: { readonly done: number; readonly total: number },
  ladders: number,
): string {
  if (ladders <= 0 || progress.done < ladders) {
    const of = ladders > 0 ? ladders : progress.total;
    return `Searching ladder ${Math.min(progress.done + 1, of)} of ${of}`;
  }
  const refine = Math.max(1, progress.total - ladders);
  return `Refining the best, ${Math.min(progress.done - ladders + 1, refine)} of ${refine}`;
}
