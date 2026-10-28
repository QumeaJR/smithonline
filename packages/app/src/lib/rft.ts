/**
 * The real frequency technique as the app uses it (docs/08, D7): the run in a
 * Web Worker, and the numbers the Broadband panel puts side by side.
 */
import { track } from './analytics/track';
import {
  cabs,
  cadd,
  cdiv,
  complex,
  csub,
  gainOfVswr,
  ladderAbcd,
  throughAbcd,
  topologyLabel,
  type Complex,
  type Element,
  type LoadModel,
  type RftProgress,
  type RftSolution,
  type TopologySlot,
} from '@smithonline/core';
import type { RftAnswer, RftMessage, RftRequest } from '../workers/rft.worker';
import { fmtNum } from './format';

export interface RftJob {
  readonly result: Promise<RftAnswer>;
  /** Stop the run; the promise then rejects with an Error('cancelled'). */
  readonly cancel: () => void;
}

/** Run the real frequency technique in a Web Worker; one worker per job. */
export function startRft(request: RftRequest, onProgress: (p: RftProgress) => void): RftJob {
  const worker = new Worker(new URL('../workers/rft.worker.ts', import.meta.url), {
    type: 'module',
  });
  let settle: { resolve: (r: RftAnswer) => void; reject: (e: Error) => void } | null = null;
  const result = new Promise<RftAnswer>((resolve, reject) => {
    settle = { resolve, reject };
  });
  worker.onmessage = (e: MessageEvent<RftMessage>): void => {
    const msg = e.data;
    if (msg.type === 'progress') onProgress({ done: msg.done, total: msg.total });
    else {
      settle?.resolve(msg.answer);
      worker.terminate();
    }
  };
  worker.onerror = (e: ErrorEvent): void => {
    track('error', 'worker');
    settle?.reject(new Error(e.message || 'Real frequency run failed'));
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

/** "series L + shunt C", the words the ladder cards and the search use, for a solution's parts. */
export function rftLabel(elements: readonly Element[]): string {
  const slots: TopologySlot[] = elements.flatMap((e) =>
    e.kind === 'L' || e.kind === 'C' ? [{ orientation: e.orientation, kind: e.kind }] : [],
  );
  return topologyLabel(slots);
}

/** "lowpass", "highpass" or "bandpass (2 zeros at DC)": the prototype in words. */
export function prototypeText(s: Pick<RftSolution, 'prototype' | 'zerosAtDc'>): string {
  return s.prototype === 'bandpass'
    ? `bandpass (${s.zerosAtDc} of the parts block DC)`
    : `${s.prototype}`;
}

/** Gain in dB, 10 log10 T. */
export const gainDb = (t: number): number => 10 * Math.log10(Math.max(t, 1e-12));

/**
 * Transducer gain 1 - |Gamma_in|^2 of a lossless ladder (the prefix and the new
 * parts, load side first) on the load, towards the source resistance r0, at
 * each frequency: the curve of the search's best ladder beside the gain shape.
 */
export function ladderGains(
  elements: readonly Element[],
  load: LoadModel,
  r0: number,
  frequencies: readonly number[],
): number[] {
  const r = complex(r0, 0);
  return frequencies.map((f) => {
    const zl: Complex = typeof load === 'function' ? load(f) : load;
    const zin = throughAbcd(ladderAbcd(elements, f), zl);
    const g = cabs(cdiv(csub(zin, r), cadd(zin, r)));
    return Number.isFinite(g) ? 1 - g * g : 0;
  });
}

/** A row of the comparison: the worst VSWR and the worst mismatch loss it means. */
export interface Figure {
  readonly vswr: number;
  /** Worst mismatch loss, dB (positive). */
  readonly lossDb: number;
}

export const figureOf = (vswr: number): Figure => ({ vswr, lossDb: -gainDb(gainOfVswr(vswr)) });

/** Below this VSWR difference two snapped ladders count as about the same: values on a series
 * step by a few percent, which moves the worst VSWR of a broadband ladder by about this much. */
export const SNAPPED_SAME_VSWR = 0.02;

/**
 * How the real frequency ladder compares with the search's: "0.470 lower
 * VSWR, 0.50 dB more worst-case gain than the search", or "the same as the
 * search" below a thousandth of VSWR and 0.005 dB. With snapped values
 * (`snapped`), "about the same" below SNAPPED_SAME_VSWR, and the text says
 * that threshold.
 */
export function comparisonText(rft: Figure, search: Figure, snapped = false): string {
  const dv = search.vswr - rft.vswr;
  const dl = search.lossDb - rft.lossDb;
  if (Math.abs(dv) < 1e-3 && Math.abs(dl) < 0.005) return 'the same as the search';
  if (snapped && Math.abs(dv) < SNAPPED_SAME_VSWR) {
    return `about the same as the search (within ${SNAPPED_SAME_VSWR} VSWR, less than snapping to your values moves it)`;
  }
  const vswr = `${fmtNum(Math.abs(dv), 3)} ${dv > 0 ? 'lower' : 'higher'} VSWR`;
  const gain = `${fmtNum(Math.abs(dl), 2)} dB ${dl > 0 ? 'more' : 'less'} worst-case gain`;
  return `${vswr}, ${gain} than the search`;
}
