/**
 * The closed loop as the app runs it (phase D6): Compare with the design from
 * the import dialog, Fit what moved in a Web Worker with progress and Stop,
 * Suggest retune, and Apply as one step of Undo. The fit and the retune are
 * kept for the design they were computed for; a change to the network, the
 * build, the load, the part library or the measurement makes them stale (they
 * then say so).
 */
import { track } from './analytics/track';
import { fitBuild, type BuildFitOutcome, type Worst } from '@smithonline/core';
import { create } from 'zustand';
import type { BoardFitMessage, BoardFitRequest } from '../workers/boardfit.worker';
import { useDesignStore } from '../store/useDesignStore';
import type { Design } from './design';
import { fmtFrequency, fmtNum, fmtSig } from './format';
import type { ImportedFile } from './import';
import { usableRows, useImported } from './importDialog';
import {
  boardComparison,
  boardKey,
  boardModel,
  boardPoints,
  boardReflections,
  buildSource,
  coverageNote,
  designMisses,
  fitVerdict,
  marginNote,
  MAX_BOARD_POINTS,
  retuneCause,
  retuneFor,
  retuneLabel,
  withRetune,
  VNA_ACCURACY,
  VNA_NAME,
  vnaFromFile,
  vnaOf,
  worstVswrText,
  type BoardRetune,
  type MeasuredBoard,
  type VnaClass,
} from './measuredBoard';
import { refusal } from './messageKind';
import { withdraw } from './nextSteps';
import { emitTourEvent } from './tourEvents';
import { designVswrLimit } from './tolerance';

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
  /** The last outcome, the design key it belongs to and the ids it was asked to fit. */
  readonly outcome: BuildFitOutcome | null;
  readonly key: string | null;
  readonly fitFree: readonly string[] | null;
  /** The last retune, for the same key. */
  readonly retune: BoardRetune | null;
  readonly retuneKey: string | null;
  /**
   * The design a retune was applied to, its step name and what the reworked board should
   * measure (the worst VSWR expected over the band): the measurement is of the board before it.
   */
  readonly applied: {
    readonly design: Design;
    readonly label: string;
    readonly expected: Worst;
  } | null;
}

export const useBoardFit = create<BoardFitState>(() => ({
  free: null,
  running: false,
  progress: null,
  outcome: null,
  key: null,
  fitFree: null,
  retune: null,
  retuneKey: null,
  applied: null,
}));

let cancelJob: ((why: 'stopped' | 'replaced') => void) | null = null;

/** Forget the fit and the retune (a new measurement, a new design); a running fit ends quietly. */
export function resetBoardFit(): void {
  cancelJob?.('replaced');
  cancelJob = null;
  useBoardFit.setState({
    running: false,
    progress: null,
    outcome: null,
    key: null,
    fitFree: null,
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
): { result: Promise<BuildFitOutcome>; cancel: (why: 'stopped' | 'replaced') => void } {
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
            accuracy: request.accuracy,
            onProgress,
          }),
        );
      });
    });
    return {
      result,
      cancel: (why) => {
        if (timer !== null) clearTimeout(timer);
        timer = null;
        fail?.(new Error(why));
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
    track('error', 'worker');
    e.preventDefault?.();
    settle?.reject(new Error('The fit stopped with an error.'));
    worker.terminate();
  };
  worker.postMessage(request);
  return {
    result,
    cancel: (why) => {
      worker.terminate();
      settle?.reject(new Error(why));
    },
  };
}

/** The ids a fit of this design takes: the user's ticks, else the model's defaults. */
function freeIds(): readonly string[] | null {
  return useBoardFit.getState().free;
}

/** Fit what moved, for the design on show. */
export function runBoardFit(): void {
  const design = useDesignStore.getState().design;
  if (!design.measurement) return;
  cancelJob?.('replaced');
  const key = boardKey(design);
  const free = freeIds();
  const request: BoardFitRequest = {
    model: boardModel(design),
    measured: boardReflections(design),
    free,
    accuracy: VNA_ACCURACY[vnaOf(design)],
  };
  useBoardFit.setState({ running: true, progress: null, retune: null, retuneKey: null });
  const job = startJob(request, (p) => useBoardFit.setState({ progress: p }));
  cancelJob = job.cancel;
  job.result.then(
    (outcome) => {
      cancelJob = null;
      track('job', 'fit', 'done');
      track('retune', 'fit', outcome.ok ? 'ok' : 'refused');
      useBoardFit.setState({ running: false, progress: null, outcome, key, fitFree: free });
      const store = useDesignStore.getState();
      if (outcome.ok) {
        const moved = outcome.fit.parameters.filter((p) => p.status === 'fitted').length;
        const unresolved = outcome.fit.parameters.filter((p) => p.status === 'unresolved').length;
        const verdict = fitVerdict(design, outcome.fit);
        const head = `Fit: |ΔΓ| RMS ${fmtNum(outcome.fit.rmsBefore, 4)} to ${fmtNum(outcome.fit.rmsAfter, 4)}, ${moved} ${moved === 1 ? 'parameter' : 'parameters'} fitted${unresolved > 0 ? `, ${unresolved} not resolved by this data` : ''}`;
        // The status line gives the first finding; Build, Measured board has them all.
        const first = verdict.text.split(/(?<=[.?]) /)[0] ?? '';
        if (verdict.level === 'ok') store.setMessage(head);
        else if (verdict.level === 'caution') store.setMessage(`${head}. ${first}`);
        else
          store.setMessage(
            `${head}. ${first} Do not act on these drifts; the checks are in Build, Measured board.`,
            { error: true },
          );
      } else {
        store.setMessage(refusal(`Fit refused: ${outcome.reason}`));
      }
      emitTourEvent('board-fit');
    },
    (err: unknown) => {
      if (err instanceof Error && err.message === 'replaced') return;
      cancelJob = null;
      useBoardFit.setState({ running: false, progress: null });
      track('job', 'fit', err instanceof Error && err.message === 'stopped' ? 'stopped' : 'error');
      if (err instanceof Error && err.message === 'stopped') {
        useDesignStore.getState().setMessage('Fit stopped');
      } else {
        useDesignStore
          .getState()
          .setMessage(err instanceof Error ? err.message : String(err), { error: true });
      }
    },
  );
}

/** Hold the measurement to another VNA class (one step of Undo): the fit is then of the old floor. */
export function setVnaClass(vna: VnaClass): void {
  const store = useDesignStore.getState();
  const m = store.design.measurement;
  if (!m || (m.vna ?? 'lab') === vna) return;
  store.step(`VNA class: ${VNA_NAME[vna]}`, (d) =>
    d.measurement ? { ...d, measurement: { ...d.measurement, vna } } : d,
  );
  store.setMessage(
    `The fit is now held against the ${VNA_NAME[vna]} accuracy floor, ${fmtSig(VNA_ACCURACY[vna], 2)}: fit again`,
  );
}

/** Stop a running fit. */
export function stopBoardFit(): void {
  cancelJob?.('stopped');
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

/** True when the ticks changed since the fit on show: it is of other parameters. */
export function ticksChanged(defaults: readonly string[]): boolean {
  const s = useBoardFit.getState();
  if (!s.outcome) return false;
  const a = new Set(s.fitFree ?? defaults);
  const b = new Set(s.free ?? defaults);
  return a.size !== b.size || [...a].some((id) => !b.has(id));
}

/** Suggest a retune from the last fit (no drift when there is none). */
export function runRetune(): BoardRetune | null {
  const design = useDesignStore.getState().design;
  const fit = currentFit(design);
  const retune = retuneFor(design, fit && fit.ok ? fit.fit : {});
  useBoardFit.setState({ retune, retuneKey: boardKey(design) });
  const store = useDesignStore.getState();
  const s = retune.suggestion;
  const cause = retuneCause(design, retune);
  const where =
    retune.bandOutside > 0 && retune.judged.length > 0
      ? ` (judged from ${fmtFrequency(Math.min(...retune.judged))} to ${fmtFrequency(Math.max(...retune.judged))}, where the board was measured)`
      : '';
  track('retune', 'suggest', retune.refused ? 'refused' : 'ok');
  if (retune.refused) {
    store.setMessage(refusal(`Retune refused: ${retune.refused}`));
  } else if (s && s.changes.length === 0 && s.inside) {
    store.setMessage(
      `Retune: the board is inside the target already (worst VSWR ${fmtNum(retune.before.vswr, 3)} against ${fmtSig(designVswrLimit(design))}${where}): no change needed`,
    );
  } else if (!s || s.changes.length === 0) {
    store.setMessage(
      `Retune: no change of the parts in reach does better than the board as it is (worst VSWR ${fmtNum(retune.before.vswr, 3)}${where})`,
    );
  } else {
    const margin = marginNote(design, retune);
    store.setMessage(
      `Retune: ${retuneLabel(design, s.changes).replace(/^Retuned /, '')} gives a worst VSWR of ${fmtNum(s.worst.vswr, 3)} at ${fmtFrequency(s.worst.frequency)} (was ${fmtNum(retune.before.vswr, 3)})${s.inside ? ', inside the target' : ', still outside the target'}${where}${cause ? `. ${cause}` : ''}${margin ? ` ${margin}` : ''}`,
    );
  }
  emitTourEvent('board-retune');
  return retune;
}

/** The retune for the design on show, when it is not stale. */
export function currentRetune(design: Design): BoardRetune | null {
  const s = useBoardFit.getState();
  return s.retune && s.retuneKey === boardKey(design) ? s.retune : null;
}

let applying = false;
/** True while Apply puts its step in (the design changes before the applied state is set). */
export const applyingRetune = (): boolean => applying;

/** Apply the suggested retune as one step of Undo: exactly what it evaluated, or nothing and why. */
export function applyRetune(): void {
  const store = useDesignStore.getState();
  const retune = currentRetune(store.design);
  const s = retune?.suggestion;
  const changes = s?.changes ?? [];
  if (!s || changes.length === 0) return;
  const out = withRetune(store.design, changes);
  if ('reason' in out) {
    track('retune', 'apply', 'refused');
    store.setMessage(refusal(`Apply refused: ${out.reason}`));
    return;
  }
  track('retune', 'apply', 'ok');
  const label = retuneLabel(store.design, changes);
  const before = store.design;
  applying = true;
  try {
    store.step(label, () => out.design);
  } finally {
    applying = false;
  }
  useBoardFit.setState({
    applied: { design: useDesignStore.getState().design, label, expected: s.worst },
  });
  const kept =
    out.pinned.length > 0
      ? ` Kept as the board has them (Realize would have picked again): ${out.pinned.join(', ')}.`
      : '';
  useDesignStore.getState().setMessage(`${label}: ${expectedText(s.worst, before)}.${kept}`);
  emitTourEvent('board-retuned');
}

/** What the reworked board should measure after an applied retune, in words. */
export function expectedText(expected: Worst, design: Design): string {
  return `the reworked board should measure a worst VSWR of about ${fmtNum(expected.vswr, 3)} at ${fmtFrequency(expected.frequency)} (target ${fmtSig(designVswrLimit(design))})`;
}

/* ------------------------------------------------------------- compare */

/** Why a file cannot be compared with the design, or null when it can. */
export function compareProblem(file: ImportedFile): string | null {
  if (file.kind === 'twoPort' && file.data.ports > 2)
    return `${file.fileName} has ${file.data.ports} ports: Compare takes the S11 of a one-port, or of a two-port with port 2 on the VNA's reference; save S11 or the two-port from the VNA`;
  const n = boardPoints(usableRows(file)).points.length;
  if (n < 2)
    return `${file.fileName} has ${n === 1 ? 'one usable row' : 'no usable row'}; Compare needs two at least`;
  return null;
}

/**
 * "Compare with the design": the imported rows become the design's measured board, the
 * dialog closes and the Response view shows measured and designed. The points are taken by
 * the rule every reader uses (boardPoints), so a saved file gives them back as they are. A
 * two-port file is taken as measured with port 2 on the VNA's reference (its S11 with port 2
 * terminated); the device panel the import filled is put back, in the same step of Undo.
 */
export function compareWithDesign(file: ImportedFile): boolean {
  const store = useDesignStore.getState();
  const problem = compareProblem(file);
  if (problem) {
    track('retune', 'compare', 'refused');
    store.setMessage(refusal(problem));
    return false;
  }
  const taken = boardPoints(usableRows(file));
  if (taken.points.length > MAX_BOARD_POINTS) {
    store.setMessage(
      refusal(
        `${file.fileName} has ${taken.points.length} rows; a measured board holds at most ${MAX_BOARD_POINTS}`,
      ),
    );
    return false;
  }
  const twoPort = file.kind === 'twoPort';
  const vna = vnaFromFile(file.fileName, file.description);
  const measurement: MeasuredBoard = {
    name: file.fileName,
    points: taken.points,
    ...(twoPort ? { termination: file.data.z0 } : {}),
    ...(vna === 'hobby' ? { vna } : {}),
    source: buildSource(store.design),
  };
  // The import filled the device panel from a two-port file: that was not what it was for.
  const filled = twoPort ? deviceFill(file.fileName) : null;
  const label = `Comparing ${file.fileName} with the design (${taken.points.length} points${twoPort ? ', port 2 on the VNA reference' : ''})`;
  store.step(label, (d) => ({
    ...d,
    measurement,
    ...(filled ? { twoPort: filled.before.twoPort } : {}),
  }));
  // One step of Undo goes back to the design before the file was opened.
  if (filled) useDesignStore.getState().squashSince(filled.before, label);
  withdraw();
  resetBoardFit();
  useImported.setState({ imported: null });
  store.setView('response');
  const design = useDesignStore.getState().design;
  const c = boardComparison(design);
  const notes: string[] = [];
  if (taken.repeated > 0)
    notes.push(
      `${taken.repeated} ${taken.repeated === 1 ? 'row repeats a frequency' : 'rows repeat a frequency'}: the last row at each is kept`,
    );
  if (taken.dropped > 0)
    notes.push(
      `${taken.dropped} ${taken.dropped === 1 ? 'row has' : 'rows have'} no finite frequency or impedance and ${taken.dropped === 1 ? 'is' : 'are'} left out`,
    );
  const tail = notes.length > 0 ? `. ${notes.join('; ')}` : '';
  if (c && c.points.length === 0) {
    store.setMessage(
      refusal(`${file.fileName}: no measured frequency lies where the design's load is known`),
    );
    return true;
  }
  const coverage = c ? coverageNote(design, c) : null;
  if (c && c.points.length > 0 && c.designedWorst) {
    const worst = worstVswrText(design, c) ?? '';
    const misses = designMisses(design, c)
      ? ` The design as built misses the target already (${fmtNum(c.designedWorst.vswr, 3)} against ${fmtSig(designVswrLimit(design))}).`
      : '';
    const noted = tail ? ` ${tail.slice(2).charAt(0).toUpperCase()}${tail.slice(3)}.` : '';
    store.setMessage(
      `Measured against designed: |ΔΓ| worst ${fmtNum(c.worstDelta, 3)} at ${fmtFrequency(c.worstDeltaAt)}. ${worst}${noted}${misses}${coverage ? ` ${coverage}` : ''}`,
      coverage ? { error: true } : undefined,
    );
  } else if (coverage) {
    store.setMessage(`${coverage}${tail}`, { error: true });
  }
  track('retune', 'compare', 'ok');
  return true;
}

/**
 * The design before a two-port file of this name filled the device panel, when the design on
 * show is that fill (the step just before it); null otherwise.
 */
function deviceFill(fileName: string): { readonly before: Design } | null {
  const s = useDesignStore.getState();
  if (s.design.twoPort?.source?.fileName !== fileName) return null;
  const prev = s.past[s.past.length - 1];
  return prev && prev.twoPort?.source?.fileName !== fileName ? { before: prev } : null;
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
