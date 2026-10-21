import {
  feasibility,
  primaryValueOf,
  sweepPoints,
  worstVswr,
  type OptimizeProgress,
  type OptimizeResult,
} from '@smithonline/core';
import { useEffect, useMemo, useRef, useState } from 'react';
import { elementName } from '../lib/elements';
import { fmtFrequency, fmtNum } from '../lib/format';
import { startOptimizer, type OptimizeJob } from '../lib/optimizer';
import { useDesignStore } from '../store/useDesignStore';

interface BandOptimizerProps {
  readonly onClose: () => void;
}

interface Outcome {
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
 * brings the previous design back.
 */
export function BandOptimizer({ onClose }: BandOptimizerProps) {
  const design = useDesignStore((s) => s.design);
  const canRedo = useDesignStore((s) => s.future.length > 0);
  const [job, setJob] = useState<OptimizeJob | null>(null);
  const [progress, setProgress] = useState<OptimizeProgress | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [undone, setUndone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const jobRef = useRef<OptimizeJob | null>(null);

  const { start, stop, points } = design.sweep;
  const validBand = start > 0 && stop > start;
  const frequencies = useMemo(
    () => (validBand ? sweepPoints(start, stop, bandPoints(points)) : []),
    [validBand, start, stop, points],
  );
  const varied = design.elements.filter((el) => primaryValueOf(el) !== null);
  const current = useMemo(
    () => (validBand ? worstVswr(design.elements, design.load, design.z0, frequencies) : NaN),
    [validBand, design.elements, design.load, design.z0, frequencies],
  );
  const floor = useMemo(() => feasibility(design.load, frequencies), [design.load, frequencies]);

  // Stop a running search when the panel goes away.
  useEffect(() => () => jobRef.current?.cancel(), []);

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
      },
      setProgress,
    );
    jobRef.current = started;
    setJob(started);
    started.result
      .then((result: OptimizeResult) => {
        const improved = result.after < result.before;
        if (improved) {
          const store = useDesignStore.getState();
          store.update((d) => ({
            ...d,
            elements: d.elements.map((el, i) => ({ ...el, ...result.elements[i] })),
            sweep: { ...d.sweep, enabled: true },
          }));
          store.setMessage(
            `Optimized over ${fmtFrequency(start)} to ${fmtFrequency(stop)}: worst VSWR ${fmtNum(result.before, 3)} to ${fmtNum(result.after, 3)}`,
          );
        }
        setOutcome({ before: result.before, after: result.after, improved });
      })
      .catch((err: Error) => {
        if (err.message !== 'cancelled') setError(err.message);
      })
      .finally(() => {
        jobRef.current = null;
        setJob(null);
        setProgress(null);
      });
  };

  const cancel = (): void => {
    jobRef.current?.cancel();
  };

  return (
    <div className="tool-panel" onPointerDown={(e) => e.stopPropagation()}>
      <div className="tool-head">
        <strong>Optimize over band</strong>
        <button className="btn tiny" onClick={onClose} aria-label="Close optimizer">
          &#215;
        </button>
      </div>
      <div className="row">
        {validBand ? (
          <>
            Band {fmtFrequency(start)} to {fmtFrequency(stop)}, {frequencies.length} points (the
            sweep range in the right panel).
          </>
        ) : (
          'Set a sweep range with start below stop in the right panel first.'
        )}
      </div>
      <div className="row">
        {varied.length === 0
          ? 'Nothing to vary: add elements with a single value (RLC blocks stay fixed).'
          : `Varies ${varied.length} of ${design.elements.length} elements: ${varied
              .map((el) => elementName(el))
              .join(
                ', ',
              )}. Lumped parts stay between Z0 / 25 and 10 Z0 of reactance at band centre, lines and stubs between 10° and 170°.`}
      </div>
      {validBand && (
        <div className="row">
          Worst VSWR now <span className="mono">{fmtNum(current, 3)}</span>
          {floor ? (
            <>
              , Bode-Fano floor <span className="mono">{fmtNum(floor.floor, 3)}</span> for load Q{' '}
              {fmtNum(floor.q, 2)}
            </>
          ) : (
            <span className="muted">
              {' '}
              (no Bode-Fano floor: a fixed R + jX load has no bandwidth of its own)
            </span>
          )}
          .
        </div>
      )}
      {progress && (
        <div className="row">
          Searching: restart {progress.done} of {progress.total}, best so far{' '}
          <span className="mono">{fmtNum(progress.best, 3)}</span>
        </div>
      )}
      {error && <div className="row danger">{error}</div>}
      {outcome && (
        <div className="row result">
          {outcome.improved ? (
            <>
              Worst VSWR <span className="mono">{fmtNum(outcome.before, 3)}</span> &#8594;{' '}
              <span className="mono">{fmtNum(outcome.after, 3)}</span>
              {undone ? ' (undone)' : ', applied to the ladder'}
            </>
          ) : (
            <>
              No better values within the bounds; worst VSWR stays{' '}
              <span className="mono">{fmtNum(outcome.before, 3)}</span>.
            </>
          )}
        </div>
      )}
      <div className="actions">
        {job ? (
          <button className="btn" onClick={cancel}>
            Cancel
          </button>
        ) : (
          <button
            className="btn primary"
            onClick={run}
            disabled={!validBand || varied.length === 0}
          >
            {outcome ? 'Run again' : 'Optimize'}
          </button>
        )}
        {outcome?.improved && !undone && (
          <button
            className="btn"
            onClick={() => {
              useDesignStore.getState().undo();
              setUndone(true);
            }}
          >
            Undo
          </button>
        )}
        {outcome?.improved && undone && canRedo && (
          <button
            className="btn"
            onClick={() => {
              useDesignStore.getState().redo();
              setUndone(false);
            }}
          >
            Reapply
          </button>
        )}
      </div>
    </div>
  );
}
