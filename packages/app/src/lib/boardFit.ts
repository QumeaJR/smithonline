/**
 * The closed loop as the app runs it (phase D6): Compare with the design from
 * the import dialog, Fit what moved in a Web Worker with progress and Stop,
 * Suggest retune, and Apply as one step of Undo. The fit and the retune are
 * kept for the design they were computed for; a change to the network, the
 * build, the load or the measurement makes them stale (they then say so).
 */
import { fitBuild, type BuildFitOutcome, type Retune, type SweepLoad } from '@smithonline/core';
import { create } from 'zustand';
import type { BoardFitMessage, BoardFitRequest } from '../workers/boardfit.worker';
import { useDesignStore } from '../store/useDesignStore';
import type { Design } from './design';
import { fmtFrequency, fmtNum } from './format';
import type { ImportedFile } from './import';
import { usableRows, useImported } from './importDialog';
import {
  boardComparison,
  boardKey,
  boardModel,
  boardReflections,
  MAX_BOARD_POINTS,
  retuneFor,
  retuneLabel,
  withRetune,
  type MeasuredBoard,
} from './measuredBoard';
import { refusal } from './messageKind';
import { emitTourEvent } from './tourEvents';

export interface BoardFitProgress {
  readonly pass: number;
  readonly iteration: number;
  readonly rms: number;
}

interface BoardFitState {
  /** The ids the user chose to fit; null: the defaults of the model. */
  readonly free: readonly string[] | null;
  readonly running: boolean;
  readonly progress: BoardFitProgress | null;
  /** The last outcome and the design key it belongs to. */
  readonly outcome: BuildFitOutcome | null;
  readonly key: string | null;
  /** The last retune, for the same key. */
  readonly retune: Retune | null;
  readonly retuneKey: string | null;
  /** The design a retune was applied to, and its step name: the measurement is of the board before it. */
  readonly applied: { readonly design: Design; readonly label: string } | null;
}

export const useBoardFit = create<BoardFitState>(() => ({
  free: null,
  running: false,
  progress: null,
  outcome: null,
  key: null,
  retune: null,
  retuneKey: null,
  applied: null,
}));

let cancelJob: (() => void) | null = null;

/** Forget the fit and the retune (a new measurement, a new design). */
export function resetBoardFit(): void {
  cancelJob?.();
  cancelJob = null;
  useBoardFit.setState({
    running: false,
    progress: null,
    outcome: null,
    key: null,
    retune: null,
    retuneKey: null,
    free: null,
    applied: null,
  });
}

/** Run the fit in a Web Worker, or in this thread where there is none (tests). */
function startJob(
  request: BoardFitRequest,
  onProgress: (p: BoardFitProgress) => void,
): { result: Promise<BuildFitOutcome>; cancel: () => void } {
  if (typeof Worker === 'undefined') {
    let fail: ((e: Error) => void) | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const result = new Promise<BuildFitOutcome>((resolve, reject) => {
      fail = reject;
      timer = setTimeout(() => {
        timer = null;
        resolve(
          fitBuild(request.model, request.measured, {
            ...(request.free ? { free: request.free } : {}),
            onProgress,
          }),
        );
      });
    });
    return {
      result,
      cancel: () => {
        if (timer !== null) clearTimeout(timer);
        timer = null;
        fail?.(new Error('cancelled'));
      },
    };
  }
  const worker = new Worker(new URL('../workers/boardfit.worker.ts', import.meta.url), {
    type: 'module',
  });
  let settle: { resolve: (r: BuildFitOutcome) => void; reject: (e: Error) => void } | null = null;
  const result = new Promise<BuildFitOutcome>((resolve, reject) => {
    settle = { resolve, reject };
  });
  worker.onmessage = (e: MessageEvent<BoardFitMessage>): void => {
    const msg = e.data;
    if (msg.type === 'progress')
      onProgress({ pass: msg.pass, iteration: msg.iteration, rms: msg.rms });
    else {
      settle?.resolve(msg.outcome);
      worker.terminate();
    }
  };
  worker.onerror = (e: ErrorEvent): void => {
    e.preventDefault?.();
    settle?.reject(new Error('The fit stopped with an error.'));
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

/** Fit what moved, for the design on show. */
export function runBoardFit(): void {
  const design = useDesignStore.getState().design;
  if (!design.measurement) return;
  cancelJob?.();
  const key = boardKey(design);
  const request: BoardFitRequest = {
    model: boardModel(design),
    measured: boardReflections(design),
    free: useBoardFit.getState().free,
  };
  useBoardFit.setState({ running: true, progress: null, retune: null, retuneKey: null });
  const job = startJob(request, (p) => useBoardFit.setState({ progress: p }));
  cancelJob = job.cancel;
  job.result.then(
    (outcome) => {
      cancelJob = null;
      useBoardFit.setState({ running: false, progress: null, outcome, key });
      const store = useDesignStore.getState();
      if (outcome.ok) {
        const moved = outcome.fit.parameters.filter((p) => p.status === 'fitted').length;
        const unresolved = outcome.fit.parameters.filter((p) => p.status === 'unresolved').length;
        store.setMessage(
          `Fit: |ΔΓ| RMS ${fmtNum(outcome.fit.rmsBefore, 4)} to ${fmtNum(outcome.fit.rmsAfter, 4)}, ${moved} ${moved === 1 ? 'parameter' : 'parameters'} fitted${unresolved > 0 ? `, ${unresolved} not resolved by this data` : ''}`,
        );
      } else {
        store.setMessage(refusal(`Fit refused: ${outcome.reason}`));
      }
      emitTourEvent('board-fit');
    },
    (err: unknown) => {
      cancelJob = null;
      useBoardFit.setState({ running: false, progress: null });
      if (err instanceof Error && err.message === 'cancelled') {
        useDesignStore.getState().setMessage('Fit stopped');
      } else {
        useDesignStore
          .getState()
          .setMessage(err instanceof Error ? err.message : String(err), { error: true });
      }
    },
  );
}

/** Stop a running fit. */
export function stopBoardFit(): void {
  cancelJob?.();
}

/** Choose whether a parameter is fitted. */
export function setFitFree(id: string, on: boolean, defaults: readonly string[]): void {
  const now = new Set(useBoardFit.getState().free ?? defaults);
  if (on) now.add(id);
  else now.delete(id);
  useBoardFit.setState({ free: [...now] });
}

/** The fit for the design on show, when it is not stale. */
export function currentFit(design: Design): BuildFitOutcome | null {
  const s = useBoardFit.getState();
  return s.outcome && s.key === boardKey(design) ? s.outcome : null;
}

/** Suggest a retune from the last fit (no drift when there is none). */
export function runRetune(): Retune | null {
  const design = useDesignStore.getState().design;
  const fit = currentFit(design);
  const drifts = fit && fit.ok ? fit.fit.drifts : {};
  const retune = retuneFor(design, drifts);
  useBoardFit.setState({ retune, retuneKey: boardKey(design) });
  const store = useDesignStore.getState();
  const s = retune.suggestion;
  if (!s || s.changes.length === 0) {
    store.setMessage(
      `Retune: no change of the parts in reach does better than the board as built (worst VSWR ${fmtNum(retune.before.vswr, 3)})`,
    );
  } else {
    store.setMessage(
      `Retune: ${retuneLabel(design, s.changes).replace(/^Retuned /, '')} gives a worst VSWR of ${fmtNum(s.worst.vswr, 3)} at ${fmtFrequency(s.worst.frequency)} (was ${fmtNum(retune.before.vswr, 3)})${s.inside ? ', inside the target' : ', still outside the target'}`,
    );
  }
  emitTourEvent('board-retune');
  return retune;
}

/** The retune for the design on show, when it is not stale. */
export function currentRetune(design: Design): Retune | null {
  const s = useBoardFit.getState();
  return s.retune && s.retuneKey === boardKey(design) ? s.retune : null;
}

/** Apply the suggested retune as one step of Undo. */
export function applyRetune(): void {
  const store = useDesignStore.getState();
  const retune = currentRetune(store.design);
  const changes = retune?.suggestion?.changes ?? [];
  if (changes.length === 0) return;
  const label = retuneLabel(store.design, changes);
  store.step(label, (d) => withRetune(d, changes));
  useBoardFit.setState({ applied: { design: useDesignStore.getState().design, label } });
  emitTourEvent('board-retuned');
}

/* ------------------------------------------------------------- compare */

/**
 * "Compare with the design": the imported rows become the design's measured board, the
 * dialog closes and the Response view shows measured and designed. A two-port file is taken
 * as measured with port 2 on the VNA's reference (its S11 with port 2 terminated); the device
 * panel the import filled is put back as it was.
 */
export function compareWithDesign(file: ImportedFile): boolean {
  const store = useDesignStore.getState();
  const rows = usableRows(file);
  if (rows.length < 2) {
    store.setMessage(refusal(`${file.fileName} has fewer than two rows to compare`));
    return false;
  }
  if (rows.length > MAX_BOARD_POINTS) {
    store.setMessage(
      refusal(
        `${file.fileName} has ${rows.length} rows; a measured board holds at most ${MAX_BOARD_POINTS}`,
      ),
    );
    return false;
  }
  const points: SweepLoad[] = [...rows].sort((a, b) => a.frequency - b.frequency);
  const measurement: MeasuredBoard = {
    name: file.fileName,
    points,
    ...(file.kind === 'twoPort' ? { termination: file.data.z0 } : {}),
  };
  // The import filled the device panel from a two-port file: that was not what it was for.
  const before = file.kind === 'twoPort' ? deviceBefore(file.fileName) : undefined;
  store.step(
    `Comparing ${file.fileName} with the design (${rows.length} points${file.kind === 'twoPort' ? ', port 2 on the VNA reference' : ''})`,
    (d) => ({
      ...d,
      measurement,
      ...(before !== undefined ? { twoPort: before } : {}),
    }),
  );
  resetBoardFit();
  useImported.setState({ imported: null });
  store.setView('response');
  const c = boardComparison(useDesignStore.getState().design);
  if (c && c.points.length > 0 && c.measuredWorst && c.designedWorst) {
    store.setMessage(
      `Measured against designed: |ΔΓ| worst ${fmtNum(c.worstDelta, 3)} at ${fmtFrequency(c.worstDeltaAt)}; worst VSWR measured ${fmtNum(c.measuredWorst.vswr, 3)}, designed ${fmtNum(c.designedWorst.vswr, 3)}`,
    );
  } else if (c && c.points.length === 0) {
    store.setMessage(
      refusal(`${file.fileName}: no measured frequency lies where the design's load is known`),
    );
  }
  return true;
}

/** The device panel as it was before a two-port file of this name filled it, or undefined. */
function deviceBefore(fileName: string): Design['twoPort'] | undefined {
  const s = useDesignStore.getState();
  if (s.design.twoPort?.source?.fileName !== fileName) return undefined;
  const prev = s.past[s.past.length - 1];
  return prev && prev.twoPort?.source?.fileName !== fileName ? prev.twoPort : undefined;
}

/** Stop comparing: the measurement leaves the design (one step). */
export function clearMeasurement(): void {
  const store = useDesignStore.getState();
  const m = store.design.measurement;
  if (!m) return;
  store.step(`Stopped comparing ${m.name}`, (d) => {
    const { measurement: _m, ...rest } = d;
    void _m;
    return rest;
  });
  resetBoardFit();
}
