import { track } from '../lib/analytics/track';
import {
  applyElement,
  gainOfVswr,
  RFT_MAX_PARTS,
  sweepPoints,
  worstVswr,
  type BroadbandCandidate,
  type BroadbandResult,
  type Complex,
  type Element,
  type MatchSolution,
  type RftProgress,
  type RftSolution,
} from '@smithonline/core';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { withIdentity, type DesignElement } from '../lib/design';
import {
  bandLoad,
  bandPointCount,
  BODE_FANO_TIP,
  loadModelOf,
  snapCandidate,
  type SnappedCandidate,
} from '../lib/broadband';
import {
  comparisonText,
  figureOf,
  gainDb,
  ladderGains,
  prototypeText,
  rftLabel,
  startRft,
  type Figure,
  type RftJob,
} from '../lib/rft';
import type { RftAnswer } from '../workers/rft.worker';
import { hasMeasuredLoad, useFitVersion } from '../lib/measuredLoad';
import { fmtFrequency, fmtNum } from '../lib/format';
import { useDesignStore } from '../store/useDesignStore';
import { emitTourEvent } from '../lib/tourEvents';
import { noteBroadbandApplied, noteRftRan } from '../lib/nextSteps';
import { SolutionList } from './SolutionList';
import { Progress } from './ui/Progress';
import { Button } from './ui/Button';
import { StaleNote } from './ui/StaleNote';
import { solutionDoesNothing } from '../lib/match';
import { useCoarsePointer } from '../lib/pointer';

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
  /** The warning the panel shows when the band reaches past the measured data, or null. */
  readonly beyond?: string | null;
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
  /** Part counts of the search's ladders the run started from (none when the search had not run). */
  readonly seeded: readonly number[];
}

/** What a fresh run shows. */
interface View {
  readonly result: RftAnswer['result'];
  readonly floor: RftAnswer['floor'];
  readonly limitNote: string | null;
  readonly best: RftSolution;
  readonly sameSize: BroadbandCandidate | null;
  /** The search's best of this size on this run's grid (snapped when Realize is on). */
  readonly searchFigure: Figure | null;
  readonly searchGain: readonly number[] | null;
  /** The ladder Apply inserts (snapped when Realize is on and the values can build it). */
  readonly ladderFigure: Figure;
  readonly ladderGain: readonly number[];
  readonly snapped: SnappedCandidate | null;
  readonly solution: MatchSolution;
  readonly useless: boolean;
  readonly grid: readonly number[];
}

const PARTS = Array.from({ length: RFT_MAX_PARTS }, (_, i) => i + 1);

const partsText = (n: number): string => `${n} ${n === 1 ? 'part' : 'parts'}`;

/** Only lumped L and C: what the technique can start from. */
const lumpedOnly = (els: readonly Element[]): boolean =>
  els.every((e) => e.kind === 'L' || e.kind === 'C');

/**
 * The real frequency technique beside the topology search: the gain shape it
 * finds for a ladder of the chosen size over the band, the Bode-Fano limit,
 * the search's best of the same size and the ladder built from the shape
 * (polished inside the search's part window), which one click puts in the
 * design (one Undo step).
 */
export function RealFrequency(props: RealFrequencyProps) {
  const {
    elements,
    keep,
    start,
    stop,
    target,
    maxElements,
    search,
    beyond,
    onPreview,
    onClose,
    onJob,
  } = props;
  const design = useDesignStore((s) => s.design);
  const fits = useFitVersion();
  const coarse = useCoarsePointer();
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
  // The panel's Stop and the job row's stop say the same.
  const stopRun = useCallback((): void => {
    const running = jobRef.current;
    if (!running) return;
    running.cancel();
    useDesignStore.getState().setMessage('Stopped the real frequency run');
  }, []);
  // The panel's job row shows this run while it lasts.
  const onJobRef = useRef(onJob);
  useEffect(() => {
    onJobRef.current = onJob;
  });
  useEffect(() => {
    onJobRef.current(progress && job ? { progress, stop: stopRun } : null);
  }, [progress, job, stopRun]);

  const run = (): void => {
    if (!validBand || !resistive) return;
    onPreview(null);
    setError(null);
    setRan(null);
    noteRftRan();
    const load = bandLoad(design, usesDatapoints);
    // The same band points for every part count: a run of n parts then contains the run of
    // n - 1 exactly, and is never worse than it.
    const frequencies = sweepPoints(
      start,
      stop,
      bandPointCount(design.sweep.points, RFT_MAX_PARTS),
    );
    // The search's best ladder of each size up to this one: exact starts and candidates.
    const seededFrom = (search?.bestBySize ?? []).filter(
      (c) => c.count <= parts && lumpedOnly(c.elements),
    );
    setProgress({ done: 0, total: 1 });
    const started = startRft(
      {
        frequencies,
        load,
        z0: design.z0,
        r0: target.re,
        prefix,
        parts,
        ladders: seededFrom.map((c) => c.elements),
      },
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
              ? `Real frequency technique: ${partsText(best.elements.length)} reach worst VSWR ${fmtNum(best.worstVswr, 3)}`
              : `Real frequency technique: no ladder of ${partsText(parts)} came out`,
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
          seeded: seededFrom.map((c) => c.count),
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

  const sameDesign =
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
    ran.stop === stop;
  const fresh = sameDesign && ran.parts === parts ? ran : null;

  const view = useMemo((): View | null => {
    const best = fresh?.answer.result.best;
    if (!fresh || !best) return null;
    const { result, floor } = fresh.answer;
    const load = loadModelOf(bandLoad(design, fresh.useDatapoints), design.z0);
    const grid = result.scoringFrequencies;
    const r0 = target.re;
    // The search's best ladder of the same size, measured on this run's grid (like for like).
    const sameSize = search?.bestBySize.find((c) => c.count === fresh.parts) ?? null;
    const asCandidate = (els: readonly Element[], vswr: number): BroadbandCandidate => ({
      topology: { slots: [], label: rftLabel(els) },
      elements: els,
      worstVswr: vswr,
      count: els.length,
      seeded: false,
      evaluations: 0,
    });
    const searchSnapped = sameSize
      ? snapCandidate(design, prefix, sameSize, load, grid, target)
      : null;
    const searchElements =
      sameSize && searchSnapped && !searchSnapped.unbuildable
        ? searchSnapped.elements
        : (sameSize?.elements ?? null);
    const searchFigure = searchElements
      ? figureOf(worstVswr([...prefix, ...searchElements], load, r0, grid, target))
      : null;
    const searchGain = searchElements
      ? ladderGains([...prefix, ...searchElements], load, r0, grid)
      : null;
    const snapped = snapCandidate(
      design,
      prefix,
      asCandidate(best.elements, best.worstVswr),
      load,
      grid,
      target,
    );
    const applied = snapped && !snapped.unbuildable ? snapped.elements : best.elements;
    const ladderGain = ladderGains([...prefix, ...applied], load, r0, grid);
    const centre = (fresh.start + fresh.stop) / 2;
    const zc = typeof load === 'function' ? load(centre) : load;
    const startAtCentre = fresh.keep
      ? fresh.elements.reduce((z, el) => applyElement(el, z, centre), zc)
      : zc;
    const solution: MatchSolution = {
      elements: applied,
      q: 0,
      result: target,
      description: `Real frequency ladder: ${rftLabel(best.elements)}`,
      ...(fresh.keep ? {} : { from: zc }),
    };
    // A ladder that changes nothing at the centre, or does not beat the kept parts (or the bare
    // load) over the band, is not offered.
    const useless =
      solutionDoesNothing(best.elements, startAtCentre, design.z0, centre) ||
      !(best.worstVswr < result.baseline * (1 - 1e-6));
    return {
      result,
      floor,
      limitNote: fresh.answer.limitNote ?? null,
      best,
      sameSize,
      searchFigure,
      searchGain,
      ladderFigure: figureOf(snapped && !snapped.unbuildable ? snapped.worstVswr : best.worstVswr),
      ladderGain,
      snapped,
      solution,
      useless,
      grid,
    };
    // fits: the model arrives from the fitting worker.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fresh, design, search, target, fits]);

  const unbuildable = view?.snapped?.unbuildable === true;

  const apply = (): void => {
    if (!view || !fresh || unbuildable) return;
    const achieved = view.ladderFigure.vswr;
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

  const stale = ran && !fresh && !job;
  return (
    <div className="rft" id="rft-section" data-tour="match.rft">
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
        ) : stale ? null : (
          // A stale result has its own Run again in the note below: one button, not two.
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
      {parts >= 5 && !job && (
        <div className="dropdown-note">
          {parts} parts take some 10 to 60 seconds, and the polynomials behind them lose digits: the
          panel says how far the built ladder strays from its gain shape.
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
      {stale && (
        <StaleNote onRun={run}>
          {sameDesign
            ? 'Parts changed since this run.'
            : 'The design or the band has changed since this run.'}
        </StaleNote>
      )}
      {fresh && !view && (
        <div className="row muted">
          No ladder of {partsText(fresh.parts)} came out of this band.
        </div>
      )}
      {view && fresh && beyond && <div className="dropdown-note warn-text">{beyond}</div>}
      {view && fresh && <RftComparison view={view} ran={fresh} searched={search !== null} />}
      {view && view.useless && (
        <div className="row muted">
          {fresh?.keep && fresh.elements.length > 0
            ? `Adds nothing over the kept parts (worst VSWR ${fmtNum(view.result.baseline, 3)}).`
            : `Adds nothing over the load alone (worst VSWR ${fmtNum(view.result.baseline, 3)}).`}
        </div>
      )}
      {view && !view.useless && unbuildable && (
        <div className="row muted">
          Your values cannot build this ladder: snapped to them, it reflects all the power somewhere
          in the band. Add values, or turn Realize off.
        </div>
      )}
      {view && !view.useless && !unbuildable && (
        <>
          <div className="dropdown-note">
            {coarse
              ? `Tap the row to preview the real frequency ladder, then ${fresh?.keep ? 'Add' : 'Use'} to `
              : 'Hover to preview the real frequency ladder, click it to '}
            {fresh?.keep ? 'add it after the kept parts' : 'replace the network'}. One Undo takes it
            back; Realize then snaps it like any network.
          </div>
          <SolutionList
            solutions={[view.solution]}
            labels={[
              view.snapped
                ? `${partsText(view.best.elements.length)}, VSWR ${fmtNum(view.snapped.worstVswr, 3)} (ideal ${fmtNum(view.best.worstVswr, 3)})`
                : `${partsText(view.best.elements.length)}, VSWR ${fmtNum(view.best.worstVswr, 3)}`,
            ]}
            empty=""
            onPreview={onPreview}
            onApply={apply}
            tourRows={{ id: 'match.rft.ladder', count: 1 }}
            applyLabel={fresh?.keep ? 'Add' : 'Use'}
          />
        </>
      )}
    </div>
  );
}

/** The tooltip of the limit: what it is, and for an estimate how far to trust it. */
const limitTip = (method: 'exact' | 'estimate'): string =>
  method === 'exact'
    ? BODE_FANO_TIP
    : `${BODE_FANO_TIP}. Here an estimate from the load Q at the band centre: it may be off either way, most for a load of low Q or with several resonances in the band.`;

/** The four rows side by side, and the gain plot. */
function RftComparison({
  view,
  ran,
  searched,
}: {
  readonly view: View;
  readonly ran: Ran;
  readonly searched: boolean;
}) {
  const { best, floor, sameSize, searchFigure, ladderFigure, snapped } = view;
  const parts = ran.parts;
  const keptCount = ran.keep ? ran.elements.length : 0;
  const kept =
    keptCount > 0 ? ` after the ${keptCount === 1 ? 'kept part' : `${keptCount} kept parts`}` : '';
  const built = best.elements.length;
  const shapeNote =
    best.source === 'lower'
      ? `; no ladder of ${partsText(parts)} beat the one of ${partsText(built)} below, which is the result`
      : best.source === 'ladder'
        ? "; the search's own ladder, below, did better than the ladder built from any shape found"
        : best.shapeGap < 1e-6
          ? '; the ladder below has this gain'
          : '; the ladder below is built from it, then polished within the part window';
  const limitText = floor
    ? floor.method === 'exact'
      ? `any number of parts, exact; worst mismatch loss ${fmtNum(figureOf(floor.floor).lossDb, 2)} dB`
      : 'any number of parts; estimate from load Q, may be off either way'
    : (view.limitNote ?? 'this load has no bandwidth limit of its own');
  const searchNote = searchFigure
    ? `${sameSize?.topology.label ?? ''}${snapped ? ', snapped' : ''}; worst mismatch loss ${fmtNum(searchFigure.lossDb, 2)} dB`
    : searched
      ? `the search has no ladder of ${partsText(parts)} (Max parts, or none beat the load)`
      : `run the search above with Max parts ${parts} or more; the technique then also starts from its ladders`;
  const ladderNotes = [
    `${rftLabel(best.elements)}${snapped && !snapped.unbuildable ? `, snapped to ${snapped.sourceLabel} values` : ''}`,
    `worst mismatch loss ${fmtNum(ladderFigure.lossDb, 2)} dB`,
    ...(searchFigure ? [comparisonText(ladderFigure, searchFigure)] : []),
    ...(ran.seeded.includes(parts) ? ["started also from the search's ladder of this size"] : []),
    ...(best.synthesisError > 1e-3
      ? [
          `the ladder as synthesized strays ${fmtNum(best.synthesisError, 4)} in gain from its shape`,
        ]
      : []),
    ...(best.outsideWindow > 0
      ? [`${best.outsideWindow} of its parts lie outside the search's part window`]
      : []),
  ];
  return (
    <>
      <table className="rft-table" data-tour="match.rft.compare">
        <tbody>
          <tr>
            <th scope="row">
              Gain shape found, {partsText(parts)}
              {kept}
            </th>
            <td>
              <span className="mono rft-value">VSWR {fmtNum(best.shapeVswr, 3)}</span>
              <span className="muted rft-note">
                worst mismatch loss {fmtNum(-gainDb(best.minGain), 2)} dB, {prototypeText(best)}
                {shapeNote}
              </span>
            </td>
          </tr>
          <tr>
            <th scope="row">
              <span title={floor ? limitTip(floor.method) : BODE_FANO_TIP}>Bode-Fano limit</span>
            </th>
            <td>
              <span className="mono rft-value">
                {floor ? `VSWR ${fmtNum(floor.floor, 3)}` : 'none'}
              </span>
              <span className="muted rft-note">{limitText}</span>
            </td>
          </tr>
          <tr>
            <th scope="row">
              Topology search, {partsText(parts)}
              {kept}
            </th>
            <td>
              <span className="mono rft-value">
                {searchFigure
                  ? `VSWR ${fmtNum(searchFigure.vswr, 3)}`
                  : searched
                    ? 'none'
                    : 'not run'}
              </span>
              <span className="muted rft-note">{searchNote}</span>
            </td>
          </tr>
          <tr>
            <th scope="row">
              Real frequency ladder{built !== parts ? `, ${partsText(built)}` : ''}
            </th>
            <td>
              <span className="mono rft-value">VSWR {fmtNum(ladderFigure.vswr, 3)}</span>
              <span className="muted rft-note">{ladderNotes.join('; ')}</span>
            </td>
          </tr>
        </tbody>
      </table>
      <GainPlot view={view} />
    </>
  );
}

/** A tick step of 0.5, 1, 2, 5 or 10 dB that gives at most six ticks down to `lowest`. */
function tickStep(lowest: number): number {
  for (const s of [0.5, 1, 2, 5, 10, 20]) if (-lowest / s <= 5) return s;
  return 50;
}

/**
 * Gain in dB over the band: the ladder Apply inserts, the gain shape it was
 * built from (thinner), the search's best of the same size and the limit.
 */
function GainPlot({ view }: { readonly view: View }) {
  const { grid, best, searchGain, ladderGain, floor } = view;
  const W = 320;
  const H = 132;
  const pad = { l: 30, r: 8, t: 14, b: 18 };
  const ladder = ladderGain.map(gainDb);
  const shape = best.gain.map(gainDb);
  const searchDb = searchGain ? searchGain.map(gainDb) : null;
  const limitDb = floor ? gainDb(gainOfVswr(floor.floor)) : null;
  const lowest = Math.min(...ladder, ...shape, ...(searchDb ?? []), limitDb ?? 0, -0.5);
  const step = tickStep(lowest);
  const yMin = Math.floor(lowest / step) * step;
  const ticks = Array.from({ length: Math.round(-yMin / step) + 1 }, (_, i) => -i * step);
  const f0 = grid[0] ?? 0;
  const f1 = grid[grid.length - 1] ?? 1;
  const x = (f: number) => pad.l + ((f - f0) / (f1 - f0 || 1)) * (W - pad.l - pad.r);
  const y = (db: number) => pad.t + (Math.max(yMin, Math.min(0, db)) / yMin) * (H - pad.t - pad.b);
  const path = (vals: readonly number[]) =>
    vals
      .map((v, i) => `${i ? 'L' : 'M'}${x(grid[i] as number).toFixed(1)},${y(v).toFixed(1)}`)
      .join('');
  const deviation = ladder.reduce((m, v, i) => Math.max(m, Math.abs(v - (shape[i] as number))), 0);
  return (
    <figure className="rft-plot" data-tour="match.rft.plot">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Transducer gain over the band, dB">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} className="rft-grid" />
            <text x={pad.l - 4} y={y(t) + 3} textAnchor="end" className="rft-tick">
              {fmtNum(t, step < 1 ? 1 : 0)}
            </text>
          </g>
        ))}
        <text x={pad.l - 4} y={pad.t - 5} textAnchor="end" className="rft-tick">
          dB
        </text>
        <line x1={pad.l} x2={pad.l} y1={pad.t} y2={H - pad.b} className="rft-axis" />
        <line x1={pad.l} x2={W - pad.r} y1={y(yMin)} y2={y(yMin)} className="rft-axis" />
        <text x={pad.l} y={H - 4} className="rft-tick">
          {fmtFrequency(f0)}
        </text>
        <text x={(pad.l + W - pad.r) / 2} y={H - 4} textAnchor="middle" className="rft-tick">
          {fmtFrequency((f0 + f1) / 2)}
        </text>
        <text x={W - pad.r} y={H - 4} textAnchor="end" className="rft-tick">
          {fmtFrequency(f1)}
        </text>
        {limitDb !== null && (
          <>
            <line x1={pad.l} x2={W - pad.r} y1={y(limitDb)} y2={y(limitDb)} className="rft-limit" />
            <text x={W - pad.r} y={y(limitDb) - 3} textAnchor="end" className="rft-tick">
              limit {fmtNum(limitDb, 2)} dB
            </text>
          </>
        )}
        {searchDb && <path d={path(searchDb)} className="rft-search" />}
        <path d={path(shape)} className="rft-shape" />
        <path d={path(ladder)} className="rft-ladder" />
      </svg>
      <figcaption className="rft-legend">
        <span className="rft-key rft-key-ladder">ladder applied</span>
        <span className="rft-key rft-key-shape">gain shape found</span>
        {searchDb && <span className="rft-key rft-key-search">search, same parts</span>}
        {limitDb !== null && <span className="rft-key rft-key-limit">Bode-Fano limit</span>}
        <span className="rft-deviation">
          {deviation < 0.01
            ? 'The applied ladder has the gain shape to within 0.01 dB.'
            : `The applied ladder differs from the gain shape by up to ${fmtNum(deviation, 2)} dB.`}
        </span>
      </figcaption>
    </figure>
  );
}
