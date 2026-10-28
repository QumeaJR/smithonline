import { track } from '../lib/analytics/track';
import {
  applyElement,
  gainOfVswr,
  RFT_MAX_PARTS,
  sweepPoints,
  type BroadbandCandidate,
  type BroadbandResult,
  type Complex,
  type Element,
  type MatchSolution,
  type RftProgress,
  type RftSolution,
} from '@smithonline/core';
import { useEffect, useMemo, useRef, useState } from 'react';
import { withIdentity, type DesignElement } from '../lib/design';
import {
  bandLoad,
  bandPointCount,
  BODE_FANO_TIP,
  loadModelOf,
  snapCandidate,
  type SnappedCandidate,
} from '../lib/broadband';
import { gainDb, ladderGains, prototypeText, rftLabel, startRft, type RftJob } from '../lib/rft';
import type { RftAnswer } from '../workers/rft.worker';
import { hasMeasuredLoad, useFitVersion } from '../lib/measuredLoad';
import { fmtFrequency, fmtNum } from '../lib/format';
import { useDesignStore } from '../store/useDesignStore';
import { emitTourEvent } from '../lib/tourEvents';
import { noteBroadbandApplied } from '../lib/nextSteps';
import { SolutionList } from './SolutionList';
import { Progress } from './ui/Progress';
import { Button } from './ui/Button';
import { StaleNote } from './ui/StaleNote';
import { solutionDoesNothing } from '../lib/match';

/** The run in progress, for the panel's job row: done of total, and how to stop it. */
export interface RftJobState {
  readonly progress: RftProgress;
  readonly stop: () => void;
}

interface RealFrequencyProps {
  readonly elements: readonly DesignElement[];
  readonly keep: boolean;
  readonly start: number;
  readonly stop: number;
  readonly target: Complex;
  /** The panel's Max parts: the default part count. */
  readonly maxElements: number;
  /** The topology search's result while it is fresh: the comparison at the same part count. */
  readonly search: BroadbandResult | null;
  readonly onPreview: (solution: MatchSolution | null) => void;
  readonly onClose: () => void;
  readonly onJob: (job: RftJobState | null) => void;
}

interface Ran {
  readonly answer: RftAnswer;
  readonly elements: readonly DesignElement[];
  readonly load: Complex;
  readonly loads: unknown;
  readonly z0: number;
  readonly target: Complex;
  readonly keep: boolean;
  readonly useDatapoints: boolean;
  readonly start: number;
  readonly stop: number;
  readonly parts: number;
}

/** What a fresh run shows. */
interface View {
  readonly result: RftAnswer['result'];
  readonly floor: RftAnswer['floor'];
  readonly best: RftSolution;
  readonly sameSize: BroadbandCandidate | null;
  readonly searchGain: readonly number[] | null;
  readonly rftGain: readonly number[];
  readonly snapped: SnappedCandidate | null;
  readonly solution: MatchSolution;
  readonly useless: boolean;
  readonly grid: readonly number[];
}

const PARTS = Array.from({ length: RFT_MAX_PARTS }, (_, i) => i + 1);

/**
 * The real frequency technique beside the topology search (docs/08, D7): the
 * best gain shape a ladder of the chosen size can have over the band, the
 * Bode-Fano limit, the search's best of the same size and the ladder built
 * from the gain shape, which one click puts in the design (one Undo step).
 */
export function RealFrequency(props: RealFrequencyProps) {
  const { elements, keep, start, stop, target, maxElements, search, onPreview, onClose, onJob } =
    props;
  const design = useDesignStore((s) => s.design);
  const fits = useFitVersion();
  const [parts, setParts] = useState(() => Math.min(maxElements, RFT_MAX_PARTS));
  const [job, setJob] = useState<RftJob | null>(null);
  const [progress, setProgress] = useState<RftProgress | null>(null);
  const [ran, setRan] = useState<Ran | null>(null);
  const [error, setError] = useState<string | null>(null);
  const jobRef = useRef<RftJob | null>(null);
  const usesDatapoints = hasMeasuredLoad(design);
  const resistive = target.im === 0 && target.re > 0;
  const validBand = start > 0 && stop > start;
  const prefix: readonly Element[] = keep ? elements : [];

  useEffect(() => () => jobRef.current?.cancel(), []);
  const stopRun = (): void => {
    if (!job) return;
    job.cancel();
    useDesignStore.getState().setMessage('Stopped the real frequency run');
  };
  // The panel's job row shows this run while it lasts.
  const onJobRef = useRef(onJob);
  useEffect(() => {
    onJobRef.current = onJob;
  });
  useEffect(() => {
    onJobRef.current(progress && job ? { progress, stop: () => job.cancel() } : null);
  }, [progress, job]);

  const run = (): void => {
    if (!validBand || !resistive) return;
    onPreview(null);
    setError(null);
    setRan(null);
    const load = bandLoad(design, usesDatapoints);
    const frequencies = sweepPoints(start, stop, bandPointCount(design.sweep.points, parts));
    setProgress({ done: 0, total: 1 });
    const started = startRft(
      { frequencies, load, z0: design.z0, r0: target.re, prefix, parts },
      setProgress,
    );
    jobRef.current = started;
    setJob(started);
    started.result
      .then((answer) => {
        track('job', 'rft', 'done');
        const best = answer.result.best;
        if (best) track('rft', 'run', best.prototype);
        useDesignStore
          .getState()
          .setMessage(
            best
              ? `Real frequency technique: ${parts} parts reach worst VSWR ${fmtNum(best.worstVswr, 3)}`
              : 'Real frequency technique: no ladder of this size came out',
          );
        setRan({
          answer,
          elements,
          load: design.load,
          loads: design.sweep.loads,
          z0: design.z0,
          target,
          keep,
          useDatapoints: usesDatapoints,
          start,
          stop,
          parts,
        });
        if (best) emitTourEvent('rft-result');
      })
      .catch((err: Error) => {
        track('job', 'rft', err.message === 'cancelled' ? 'stopped' : 'error');
        if (err.message !== 'cancelled') setError(err.message);
      })
      .finally(() => {
        jobRef.current = null;
        setJob(null);
        setProgress(null);
      });
  };

  const fresh =
    ran &&
    ran.elements === elements &&
    ran.load === design.load &&
    ran.loads === design.sweep.loads &&
    ran.z0 === design.z0 &&
    ran.target.re === target.re &&
    ran.target.im === target.im &&
    ran.keep === keep &&
    ran.useDatapoints === usesDatapoints &&
    ran.start === start &&
    ran.stop === stop &&
    ran.parts === parts
      ? ran
      : null;

  const view = useMemo((): View | null => {
    const best = fresh?.answer.result.best;
    if (!fresh || !best) return null;
    const { result, floor } = fresh.answer;
    const load = loadModelOf(bandLoad(design, fresh.useDatapoints), design.z0);
    const grid = result.scoringFrequencies;
    // The search's best ladder of the same size, when the search ran on this design.
    const sameSize = search
      ? search.candidates
          .filter((c) => c.count === fresh.parts)
          .reduce<BroadbandCandidate | null>(
            (m, c) => (m === null || c.worstVswr < m.worstVswr ? c : m),
            null,
          )
      : null;
    const searchGain = sameSize
      ? ladderGains([...prefix, ...sameSize.elements], load, target.re, grid)
      : null;
    const rftGain = ladderGains([...prefix, ...best.elements], load, target.re, grid);
    const candidate: BroadbandCandidate = {
      topology: { slots: [], label: rftLabel(best.elements) },
      elements: best.elements,
      worstVswr: best.worstVswr,
      count: best.elements.length,
      seeded: false,
      evaluations: 0,
    };
    const snapped = snapCandidate(design, prefix, candidate, load, grid, target);
    const centre = (fresh.start + fresh.stop) / 2;
    const zc = typeof load === 'function' ? load(centre) : load;
    const startAtCentre = fresh.keep
      ? fresh.elements.reduce((z, el) => applyElement(el, z, centre), zc)
      : zc;
    const solution: MatchSolution = {
      elements: snapped ? snapped.elements : best.elements,
      q: 0,
      result: target,
      description: `Real frequency ladder: ${candidate.topology.label}`,
      ...(fresh.keep ? {} : { from: zc }),
    };
    const useless = solutionDoesNothing(best.elements, startAtCentre, design.z0, centre);
    return { result, floor, best, sameSize, searchGain, rftGain, snapped, solution, useless, grid };
    // fits: the model arrives from the fitting worker.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fresh, design, search, target, fits]);

  const apply = (): void => {
    if (!view || !fresh) return;
    const achieved = view.snapped ? view.snapped.worstVswr : view.best.worstVswr;
    useDesignStore.getState().step(
      `${fresh.keep ? 'Added' : 'Replaced the network with'} the real frequency ladder ${rftLabel(view.best.elements)}${view.snapped ? ` with ${view.snapped.sourceLabel} values` : ''}: worst VSWR ${fmtNum(achieved, 3)} over ${fmtFrequency(fresh.start)} to ${fmtFrequency(fresh.stop)} (was ${fmtNum(view.result.baseline, 3)})`,
      (d) => {
        let list: readonly DesignElement[] = fresh.keep ? d.elements : [];
        for (const el of view.solution.elements) list = [...list, withIdentity(el, list)];
        return {
          ...d,
          elements: list,
          sweep: { ...d.sweep, enabled: true, start: fresh.start, stop: fresh.stop },
        };
      },
      fresh.keep ? undefined : { undo: true },
    );
    track('rft', 'apply', view.best.prototype);
    emitTourEvent('rft-applied');
    onClose();
    noteBroadbandApplied();
  };

  return (
    <div className="rft" data-tour="match.rft">
      <div className="dropdown-note">
        <strong>Real frequency technique.</strong> Optimizes the gain of every lossless ladder of
        the chosen size over the band at once, then builds the ladder that has it. Lumped parts,
        towards a resistive source.
      </div>
      <div className="fields">
        <label data-tour="match.rft.parts">
          Parts
          <select
            className="btn"
            value={parts}
            onChange={(e) => setParts(Number(e.target.value))}
            aria-label="Parts of the real frequency ladder"
          >
            {PARTS.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        {job ? (
          <Button onClick={stopRun}>Stop</Button>
        ) : (
          <Button
            onClick={run}
            disabled={!validBand || !resistive}
            data-tour="match.rft.run"
            title="Run the real frequency technique for this many parts"
          >
            {fresh ? 'Run again' : 'Run real frequency'}
          </Button>
        )}
      </div>
      {!resistive && (
        <div className="dropdown-note">
          The real frequency technique matches to a resistance: set a target without reactance, or
          none (Z0).
        </div>
      )}
      {parts >= 6 && !job && (
        <div className="dropdown-note">
          {parts} parts can take a minute, and the polynomials behind them lose digits: the panel
          says how far the built ladder strays from its gain shape.
        </div>
      )}
      {progress && (
        <Progress
          className="row"
          ariaLabel="Real frequency run"
          done={progress.done}
          total={progress.total}
          label={`Optimizing gain shapes, ${Math.min(progress.done + 1, progress.total)} of ${progress.total}`}
        />
      )}
      {error && <div className="row danger">{error}</div>}
      {ran && !fresh && !job && (
        <StaleNote onRun={run}>The design or the band has changed since this run.</StaleNote>
      )}
      {fresh && !view && (
        <div className="row muted">No ladder of {fresh.parts} parts came out of this band.</div>
      )}
      {view && <RftComparison view={view} parts={fresh?.parts ?? parts} />}
      {view && !view.useless && (
        <>
          <div className="dropdown-note">
            Hover to preview the real frequency ladder, click to{' '}
            {fresh?.keep ? 'add it' : 'replace the network'}. One Undo takes it back; Realize then
            snaps it like any network.
          </div>
          <SolutionList
            solutions={[view.solution]}
            labels={[
              view.snapped
                ? `${view.best.elements.length} parts, VSWR ${fmtNum(view.snapped.worstVswr, 3)} (ideal ${fmtNum(view.best.worstVswr, 3)})`
                : `${view.best.elements.length} parts, VSWR ${fmtNum(view.best.worstVswr, 3)}`,
            ]}
            empty=""
            onPreview={onPreview}
            onApply={apply}
            tourRows={{ id: 'match.rft.ladder', count: 1 }}
          />
        </>
      )}
    </div>
  );
}

/** The four numbers side by side, and the gain plot. */
function RftComparison({ view, parts }: { readonly view: View; readonly parts: number }) {
  const { best, floor, sameSize } = view;
  const beats =
    sameSize !== null
      ? best.worstVswr < sameSize.worstVswr - 5e-4
        ? 'better than'
        : best.worstVswr <= sameSize.worstVswr + 5e-4
          ? 'equal to'
          : 'worse than'
      : null;
  return (
    <>
      <table className="rft-table" data-tour="match.rft.compare">
        <tbody>
          <tr>
            <th scope="row">Best gain shape, {parts} parts</th>
            <td>
              <span className="mono rft-value">VSWR {fmtNum(best.shapeVswr, 3)}</span>
              <span className="muted rft-note">
                lowest gain {fmtNum(gainDb(best.minGain), 2)} dB, {prototypeText(best)}
              </span>
            </td>
          </tr>
          <tr>
            <th scope="row">
              <span title={BODE_FANO_TIP}>Bode-Fano limit</span>
            </th>
            <td>
              <span className="mono rft-value">
                {floor ? `VSWR ${fmtNum(floor.floor, 3)}` : 'none'}
              </span>
              <span className="muted rft-note">
                {floor
                  ? `any number of parts, ${floor.method === 'exact' ? 'exact' : 'estimate'}`
                  : 'this load has no bandwidth limit of its own'}
              </span>
            </td>
          </tr>
          <tr>
            <th scope="row">Topology search, {parts} parts</th>
            <td>
              <span className="mono rft-value">
                {sameSize ? `VSWR ${fmtNum(sameSize.worstVswr, 3)}` : 'not run'}
              </span>
              <span className="muted rft-note">
                {sameSize ? sameSize.topology.label : 'Run the search above with this many parts'}
              </span>
            </td>
          </tr>
          <tr>
            <th scope="row">Real frequency ladder</th>
            <td>
              <span className="mono rft-value">VSWR {fmtNum(best.worstVswr, 3)}</span>
              <span className="muted rft-note">
                {rftLabel(best.elements)}
                {beats ? `; ${beats} the search` : ''}
                {best.synthesisError > 1e-3
                  ? `; built ladder strays ${fmtNum(best.synthesisError, 4)} in gain from its shape`
                  : ''}
              </span>
            </td>
          </tr>
        </tbody>
      </table>
      <GainPlot view={view} />
    </>
  );
}

/** Gain in dB over the band: the shape, the search's best of the same size, the limit. */
function GainPlot({ view }: { readonly view: View }) {
  const { grid, best, searchGain, floor } = view;
  const W = 320;
  const H = 120;
  const pad = { l: 34, r: 8, t: 8, b: 20 };
  const shape = best.gain.map(gainDb);
  const searchDb = searchGain ? searchGain.map(gainDb) : null;
  const limitDb = floor ? gainDb(gainOfVswr(floor.floor)) : null;
  const lowest = Math.min(...shape, ...(searchDb ?? []), limitDb ?? 0);
  const yMin = Math.min(-0.5, Math.floor(lowest * 2) / 2);
  const f0 = grid[0] ?? 0;
  const f1 = grid[grid.length - 1] ?? 1;
  const x = (f: number) => pad.l + ((f - f0) / (f1 - f0 || 1)) * (W - pad.l - pad.r);
  const y = (db: number) => pad.t + (Math.max(yMin, Math.min(0, db)) / yMin) * (H - pad.t - pad.b);
  const path = (vals: readonly number[]) =>
    vals
      .map((v, i) => `${i ? 'L' : 'M'}${x(grid[i] as number).toFixed(1)},${y(v).toFixed(1)}`)
      .join('');
  return (
    <figure className="rft-plot">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Transducer gain over the band">
        <line x1={pad.l} x2={W - pad.r} y1={y(0)} y2={y(0)} className="rft-axis" />
        <line x1={pad.l} x2={W - pad.r} y1={y(yMin)} y2={y(yMin)} className="rft-axis" />
        <text x={pad.l - 4} y={y(0) + 4} textAnchor="end" className="rft-tick">
          0
        </text>
        <text x={pad.l - 4} y={y(yMin) + 4} textAnchor="end" className="rft-tick">
          {fmtNum(yMin, 1)}
        </text>
        <text x={pad.l} y={H - 4} className="rft-tick">
          {fmtFrequency(f0)}
        </text>
        <text x={W - pad.r} y={H - 4} textAnchor="end" className="rft-tick">
          {fmtFrequency(f1)} (gain, dB)
        </text>
        {limitDb !== null && (
          <line x1={pad.l} x2={W - pad.r} y1={y(limitDb)} y2={y(limitDb)} className="rft-limit" />
        )}
        {searchDb && <path d={path(searchDb)} className="rft-search" />}
        <path d={path(shape)} className="rft-shape" />
      </svg>
      <figcaption className="rft-legend">
        <span className="rft-key rft-key-shape">gain shape</span>
        {searchDb && <span className="rft-key rft-key-search">search, same parts</span>}
        {limitDb !== null && <span className="rft-key rft-key-limit">Bode-Fano limit</span>}
      </figcaption>
    </figure>
  );
}
