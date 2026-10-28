import { track } from '../lib/analytics/track';
import {
  feasibility,
  measuredLoadInfo,
  limitCost,
  primaryValueOf,
  scoringFrequencies,
  sweepPoints,
  worstVswr,
  type OptimizeProgress,
  type OptimizeResult,
} from '@smithonline/core';
import { useEffect, useMemo, useRef, useState } from 'react';
import { BODE_FANO_TIP, floorMethodText, noFloorReason } from '../lib/broadband';
import {
  beyondDataText,
  designBand,
  designLoadModel,
  hasMeasuredLoad,
  useFitVersion,
  measuredLoadLine,
  measuredPoints,
} from '../lib/measuredLoad';
import { elementName } from '../lib/elements';
import { fmtFrequency, fmtNum } from '../lib/format';
import { startOptimizer, type OptimizeJob } from '../lib/optimizer';
import { useDesignStore } from '../store/useDesignStore';
import { emitTourEvent } from '../lib/tourEvents';
import { useReportJob } from '../store/useJobs';
import { Button } from './ui/Button';
import { Progress } from './ui/Progress';
import { EmptyState } from './ui/EmptyState';
import { applyHalfToDoubleSweep, HALF_TO_DOUBLE_LABEL } from '../lib/emptyActions';

/** What the search minimizes: the worst VSWR, or the worst violation of the limit areas. */
type CostMode = 'vswr' | 'limits';

interface Outcome {
  readonly mode: CostMode;
  readonly before: number;
  readonly after: number;
  readonly improved: boolean;
}

/** QuickSmith judges a band at 5 to 401 points whatever the sweep shows. */
function bandPoints(points: number): number {
  return Math.max(5, Math.min(401, Math.floor(points)));
}

/**
 * Improve the ladder's existing parts against the sweep range: Nelder-Mead
 * over their values with the worst VSWR in the band as the cost, run in a
 * Web Worker. The result replaces the values in one history step, so Undo
 * brings the previous design back. The tool head (or the phone's sheet)
 * around it carries its name and close button.
 */
export function BandOptimizer() {
  const design = useDesignStore((s) => s.design);
  const canRedo = useDesignStore((s) => s.future.length > 0);
  const [job, setJob] = useState<OptimizeJob | null>(null);
  const [progress, setProgress] = useState<OptimizeProgress | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [undone, setUndone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wanted, setMode] = useState<CostMode>('vswr');
  const jobRef = useRef<OptimizeJob | null>(null);

  // The sweep range in either order, as the Response view reads it (the store swaps a range
  // typed upside down; a file may still bring one).
  // A datapoint sweep over a measured load works over the measured band instead.
  const band = designBand(design);
  const { start, stop } = band;
  const { points } = design.sweep;
  const validBand = start > 0 && stop > start;
  const frequencies = useMemo(
    () => (validBand ? sweepPoints(start, stop, bandPoints(points)) : []),
    [validBand, start, stop, points],
  );
  const varied = design.elements.filter((el) => primaryValueOf(el) !== null);
  // The load across the band: the measured load of a datapoint sweep (fitted from six points),
  // else the fixed load.
  const measured = hasMeasuredLoad(design);
  const fits = useFitVersion();
  const load = useMemo(
    () => designLoadModel({ load: design.load, z0: design.z0, sweep: design.sweep }),
    // fits: the model arrives from the fitting worker.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [design.load, design.z0, design.sweep, fits],
  );
  const loadInfo = measuredLoadInfo(load);
  /**
   * The grid every worst VSWR this panel prints is measured on: the band points and a dense
   * uniform grid, as Broadband scores its candidates (one number for the same network).
   */
  const dense = useMemo(
    () => (validBand ? scoringFrequencies(frequencies, design.elements.length) : []),
    [validBand, frequencies, design.elements.length],
  );
  const beyond = loadInfo && validBand ? beyondDataText(loadInfo, start, stop) : null;
  const limits = useMemo(() => design.limits ?? [], [design.limits]);
  // Limit areas only count as the cost when there are some.
  const mode: CostMode = wanted === 'limits' && limits.length > 0 ? 'limits' : 'vswr';
  const current = useMemo(() => {
    if (!validBand) return NaN;
    const ladder = {
      z0: design.z0,
      frequency: design.frequency,
      load: design.load,
      elements: design.elements,
    };
    return mode === 'limits'
      ? limitCost(ladder, limits, frequencies, load)(design.elements)
      : worstVswr(design.elements, load, design.z0, dense);
  }, [
    dense,
    validBand,
    mode,
    limits,
    design.frequency,
    design.elements,
    design.load,
    design.z0,
    frequencies,
    load,
  ]);
  const floor = useMemo(() => feasibility(load, frequencies), [load, frequencies]);

  // Stop a running search when the panel goes away.
  useEffect(() => () => jobRef.current?.cancel(), []);

  /** What the best value is: the search minimizes the worst case over the band. */
  const bestName = mode === 'limits' ? 'best worst-case violation' : 'best worst-case VSWR';

  const run = (): void => {
    if (!validBand || varied.length === 0) return;
    setOutcome(null);
    setUndone(false);
    setError(null);
    setProgress({ done: 0, total: 0, best: current });
    const started = startOptimizer(
      {
        ladder: {
          z0: design.z0,
          frequency: design.frequency,
          load: design.load,
          elements: design.elements,
        },
        frequencies,
        ...(mode === 'limits' ? { limits } : {}),
        ...(measured ? { loads: measuredPoints(design) ?? [] } : {}),
      },
      setProgress,
    );
    jobRef.current = started;
    setJob(started);
    started.result
      .then((raw: OptimizeResult) => {
        track('job', 'optimize', 'done');
        // The VSWR re-measured on the dense grid, the number the other band tools print.
        const result: OptimizeResult =
          mode === 'vswr'
            ? {
                ...raw,
                before: worstVswr(design.elements, load, design.z0, dense),
                after: worstVswr(raw.elements, load, design.z0, dense),
              }
            : raw;
        const improved = result.after < result.before;
        if (improved) {
          // One step named by its message, with the inline Undo: it replaces every value.
          useDesignStore.getState().step(
            `Optimized over ${fmtFrequency(start)} to ${fmtFrequency(stop)}: ${mode === 'limits' ? 'worst limit violation' : 'worst VSWR'} ${fmtNum(result.before, 3)} to ${fmtNum(result.after, 3)}`,
            (d) => ({
              ...d,
              elements: d.elements.map((el, i) => ({ ...el, ...result.elements[i] })),
              sweep: { ...d.sweep, enabled: true },
            }),
            { undo: true },
          );
        }
        setOutcome({ mode, before: result.before, after: result.after, improved });
        emitTourEvent('optimize-result');
      })
      .catch((err: Error) => {
        track('job', 'optimize', err.message === 'cancelled' ? 'stopped' : 'error');
        if (err.message !== 'cancelled') setError(err.message);
      })
      .finally(() => {
        jobRef.current = null;
        setJob(null);
        setProgress(null);
      });
  };

  /** Stop the running optimizer: the status line says so. */
  const cancel = (): void => {
    if (!jobRef.current) return;
    jobRef.current.cancel();
    useDesignStore.getState().setMessage('Stopped the optimizer');
  };

  // The job row shows the progress, with Stop, and the header button a dot while the tool is
  // closed (docs/10 section 5.1).
  useReportJob(
    'optimize',
    progress
      ? {
          done: progress.done,
          total: progress.total,
          label:
            progress.total > 0
              ? `Restart ${progress.done} of ${progress.total}, ${bestName} ${fmtNum(progress.best, 3)}`
              : 'Starting the search',
        }
      : null,
    () => cancel(),
  );

  return (
    <div className="tool-panel" onPointerDown={(e) => e.stopPropagation()}>
      <div className="tool-head">
        <span className="muted">Refines the values you have</span>
      </div>
      {validBand ? (
        <div className="row">
          Band {fmtFrequency(start)} to {fmtFrequency(stop)}, {frequencies.length} points (
          {band.measured
            ? 'the measured band of the datapoint sweep'
            : 'the sweep range of the design, set in the sweep panel under Numbers'}
          ).
        </div>
      ) : (
        <EmptyState
          className="optimize-empty"
          title="Set a sweep range"
          line="The optimizer works over the sweep range: two different positive frequencies, set in the sweep panel under Numbers (close this tool with X to see it)."
          action={{
            label: HALF_TO_DOUBLE_LABEL,
            onClick: applyHalfToDoubleSweep,
            title: `Sweep from ${fmtFrequency(design.frequency / 2)} to ${fmtFrequency(design.frequency * 2)}`,
          }}
        />
      )}
      <div className="row">
        {varied.length === 0
          ? 'Nothing to vary: add elements with a single value (RLC blocks stay fixed).'
          : `Varies ${varied.length} of ${design.elements.length} elements: ${varied
              .map((el) => elementName(el))
              .join(
                ', ',
              )}. Lumped parts stay between Z0 / 25 and 10 Z0 of reactance at band centre, lines and stubs between 10° and 170°.`}
      </div>
      {loadInfo && (
        <div className="row measured-load-note">
          {measuredLoadLine(loadInfo, design.sweep.loadsName)}
          {beyond && <span className="warn-text"> {beyond}</span>}
        </div>
      )}
      {validBand && limits.length > 0 && (
        <div className="row">
          Cost{' '}
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as CostMode)}
            aria-label="Optimizer cost"
            disabled={job !== null}
          >
            <option value="vswr">Worst VSWR over the band</option>
            <option value="limits">Worst violation of the {limits.length} limit areas</option>
          </select>
        </div>
      )}
      {validBand && mode === 'limits' && (
        <div className="row">
          Worst violation now <span className="mono">{fmtNum(current, 3)}</span>; 0 means every area
          is respected. One unit is 1 dB, 0.1 of VSWR, a tenth of Z0, 10° or 1 ns, so mixed areas
          weigh against each other.
        </div>
      )}
      {validBand && mode === 'vswr' && (
        <div className="row">
          Worst VSWR now <span className="mono">{fmtNum(current, 3)}</span>{' '}
          <span className="muted">
            (on {dense.length} points across the band, as Broadband scores)
          </span>
          {floor ? (
            <>
              , <span title={BODE_FANO_TIP}>Bode-Fano limit</span>{' '}
              <span className="mono">{fmtNum(floor.floor, 3)}</span>,{' '}
              {floorMethodText(floor, (v) => fmtNum(v, 2))}
            </>
          ) : (
            <span className="muted">
              {' '}
              (
              {measured
                ? lowerFirst(noFloorReason(true, frequencies.length, loadInfo?.mode === 'fitted'))
                : 'no Bode-Fano limit: a fixed R + jX load has no bandwidth of its own'}
              )
            </span>
          )}
          .
        </div>
      )}
      {progress && (
        <Progress
          className="row"
          ariaLabel="Band optimizer"
          done={progress.done}
          total={progress.total}
          label={
            progress.total > 0 ? (
              <>
                Searching: restart {progress.done} of {progress.total}, {bestName}{' '}
                <span className="mono">{fmtNum(progress.best, 3)}</span>
              </>
            ) : (
              <>
                Starting the search, worst now{' '}
                <span className="mono">{fmtNum(progress.best, 3)}</span>
              </>
            )
          }
        />
      )}
      {error && <div className="row danger">{error}</div>}
      {outcome && (
        <div className="row result">
          {outcome.improved ? (
            <>
              {outcome.mode === 'limits' ? 'Worst violation' : 'Worst VSWR'}{' '}
              <span className="mono">{fmtNum(outcome.before, 3)}</span> &#8594;{' '}
              <span className="mono">{fmtNum(outcome.after, 3)}</span>
              {undone ? ' (undone)' : ', applied to the ladder'}
            </>
          ) : (
            <>
              No better values within the bounds; the worst{' '}
              {outcome.mode === 'limits' ? 'violation' : 'VSWR'} stays{' '}
              <span className="mono">{fmtNum(outcome.before, 3)}</span>.
            </>
          )}
        </div>
      )}
      <div className="actions">
        {job ? (
          <Button onClick={cancel}>Stop</Button>
        ) : (
          <Button variant="primary" onClick={run} disabled={!validBand || varied.length === 0}>
            {outcome ? 'Run again' : 'Optimize'}
          </Button>
        )}
        {outcome?.improved && !undone && (
          <Button
            onClick={() => {
              useDesignStore.getState().undo();
              setUndone(true);
            }}
          >
            Undo
          </Button>
        )}
        {outcome?.improved && undone && canRedo && (
          <Button
            onClick={() => {
              useDesignStore.getState().redo();
              setUndone(false);
            }}
          >
            Reapply
          </Button>
        )}
      </div>
    </div>
  );
}

/** A sentence as the inside of a parenthesis: first letter in lower case, no closing stop. */
function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1).replace(/\.$/, '');
}
