/**
 * Broadband matching as the app uses it: the search in a Web Worker, the
 * load the band is judged against, and what Realize does to a result.
 */
import { track } from './analytics/track';
import {
  FLOOR_MIN_POINTS,
  OPTIMIZE_FAIL,
  realizeLadder,
  worstVswr,
  type BroadbandCandidate,
  type BroadbandProgress,
  type BroadbandResult,
  type Complex,
  type Element,
  type Feasibility,
  type LoadModel,
} from '@smithonline/core';
import type { BroadbandMessage, BroadbandRequest } from '../workers/broadband.worker';
import type { Design } from './design';
import { pointsLoadModel } from './measuredLoad';
import { fmtNum } from './format';
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
    track('error', 'worker');
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

/** The load model of bandLoad's answer: the measured load (fitted from six points, at z0) or the fixed one. */
export function loadModelOf(load: Complex | BandPoints, z0: number): LoadModel {
  return Array.isArray(load) ? pointsLoadModel(load as BandPoints, z0) : (load as Complex);
}

/** A candidate with Realize on: the new parts snapped, and the worst VSWR the band then shows. */
export interface SnappedCandidate {
  readonly elements: readonly Element[];
  readonly worstVswr: number;
  readonly sourceLabel: string;
  /**
   * True when the values on hand cannot build the ladder (a stock list without
   * a value for some part): worstVswr is then not a VSWR to show or apply.
   */
  readonly unbuildable: boolean;
}

/**
 * The candidate's parts snapped to the design's series or stock. The parts
 * already in the design (`prefix`) are kept exactly as they are, so only the
 * new ones move; the worst VSWR is measured on the whole ladder over the
 * frequencies given (the result's dense scoringFrequencies, the grid the
 * search scored its candidates on), and each new part may move to a
 * neighbouring value when that lowers it.
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
    unbuildable: !Number.isFinite(score) || score >= OPTIMIZE_FAIL,
  };
}

/**
 * The line under the progress bar, counted in the same ladders as the band
 * note above it: "Searching ladder 12 of 40" over the first pass, then
 * "Refining the best, 3 of 16" over the second pass of the larger searches;
 * a search with one pass (total no more than its ladders) never says
 * refining. With `best` (a finite worst VSWR found so far) it ends in
 * ", best worst-case VSWR 1.42".
 */
export function broadbandProgressText(
  progress: { readonly done: number; readonly total: number },
  ladders: number,
  best?: number,
): string {
  const tail =
    best !== undefined && Number.isFinite(best) ? `, best worst-case VSWR ${fmtNum(best, 2)}` : '';
  if (ladders <= 0 || progress.done < ladders || progress.total <= ladders) {
    const of = ladders > 0 ? ladders : progress.total;
    return `Searching ladder ${Math.min(progress.done + 1, of)} of ${of}${tail}`;
  }
  const refine = Math.max(1, progress.total - ladders);
  return `Refining the best, ${Math.min(progress.done - ladders + 1, refine)} of ${refine}${tail}`;
}

/**
 * The bar's value and maximum in the same count as broadbandProgressText: the ladders done
 * of all ladders over the first pass, then the refinements done of all refinements, so the
 * bar and its words say the same thing ("Searching ladder 12 of 40" is 11 of 40 done).
 */
export function broadbandProgressBar(
  progress: { readonly done: number; readonly total: number },
  ladders: number,
): { readonly done: number; readonly total: number } {
  const done = Number.isFinite(progress.done) ? Math.max(0, progress.done) : 0;
  if (ladders <= 0) return { done, total: progress.total };
  if (done < ladders || progress.total <= ladders) {
    return { done: Math.min(done, ladders), total: ladders };
  }
  const refine = Math.max(1, progress.total - ladders);
  return { done: Math.min(done - ladders, refine), total: refine };
}

/**
 * Points the broadband panel judges the band at: the sweep's own count,
 * within what a search can afford (5 to 101), and at least four per part of
 * the cap plus one, so a long ladder has no room to fit the points and swing
 * between them. The result is scored on a denser grid still.
 */
export function bandPointCount(points: number, maxElements: number): number {
  const n = Number.isFinite(points) ? Math.floor(points) : 0;
  return Math.max(5, 4 * Math.max(1, Math.floor(maxElements)) + 1, Math.min(101, n));
}

/** The tooltip of the Bode-Fano limit wherever it is quoted (docs/09 section 5). */
export const BODE_FANO_TIP =
  'The lowest worst VSWR any lossless network can reach over this band, for this load';

/** The tooltip of a limit: what it is, and for an estimate how far to trust it. */
export const bodeFanoTip = (estimate: boolean): string =>
  estimate
    ? `${BODE_FANO_TIP}. Here an estimate from the load Q at the band centre, not a hard limit: it may be off either way, most for a load of low Q or with several resonances in the band.`
    : BODE_FANO_TIP;

/**
 * "exact for a parallel RC load", "estimated from the load Q 2.3 (Yaghjian-Best)", and for a
 * measured load the same from the fitted model ("exact for a series RL load, from the fitted
 * model").
 */
export function floorMethodText(floor: Feasibility, fmt: (v: number) => string): string {
  if (floor.fromFit) {
    return floor.method === 'exact'
      ? `exact for a ${floor.model ?? 'single-reactance'} load, from the fitted model`
      : `from the fitted model: load Q ${fmt(floor.q)} at band centre from its exact slope (Yaghjian-Best), an estimate that can be off either way for a low-Q load`;
  }
  return floor.method === 'exact'
    ? `exact for a ${floor.model ?? 'single-reactance'} load`
    : `estimated from the load Q ${fmt(floor.q)} at band centre (Yaghjian-Best), which can be off either way for a low-Q load`;
}

/**
 * Why the panel shows no Bode-Fano limit for a band of `bandPoints` points. A fitted measured
 * load (`fitted`) has no minimum number of band points: its floor is read from the model.
 */
export function noFloorReason(usesDatapoints: boolean, bandPoints: number, fitted = false): string {
  if (!usesDatapoints) {
    return 'No Bode-Fano limit: a fixed impedance has no bandwidth of its own, so only the number of parts limits it. Import datapoints to give the load a frequency behaviour.';
  }
  if (!fitted && bandPoints < FLOOR_MIN_POINTS) {
    return `No Bode-Fano limit: the band has ${bandPoints} points, and below ${FLOOR_MIN_POINTS} the load Q behind the floor is too rough to trust (it can put the floor above what physics allows). Give the sweep more points.`;
  }
  return 'No Bode-Fano limit: the load has no resistance at some band point, so its Q over the band is not defined.';
}
