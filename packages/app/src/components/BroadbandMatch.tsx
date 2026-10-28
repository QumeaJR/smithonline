import { track } from '../lib/analytics/track';
import {
  applyElement,
  broadbandSteps,
  measuredLoadInfo,
  losslessLadder,
  shownBandLimit,
  enumerateTopologies,
  sweepPoints,
  type BroadbandProgress,
  type BroadbandResult,
  type Complex,
  type Element,
  type MatchSolution,
  type RftLimit,
} from '@smithonline/core';
import { useEffect, useMemo, useRef, useState } from 'react';
import { withIdentity, type DesignElement } from '../lib/design';
import {
  bandLoad,
  bandPointCount,
  broadbandProgressBar,
  broadbandProgressText,
  bodeFanoTip,
  floorMethodText,
  loadModelOf,
  noFloorReason,
  snapCandidate,
  startBroadband,
  type BroadbandJob,
} from '../lib/broadband';
import { solutionDoesNothing } from '../lib/match';
import {
  beyondDataText,
  designBand,
  hasMeasuredLoad,
  measuredLoadLine,
  pointsLoadModel,
  useFitVersion,
} from '../lib/measuredLoad';
import { fmtFrequency, fmtNum } from '../lib/format';
import { useDesignStore } from '../store/useDesignStore';
import { useBandLimit } from '../store/useBandLimit';
import { emitTourEvent } from '../lib/tourEvents';
import { noteBroadbandApplied, noteBroadbandResult } from '../lib/nextSteps';
import { SolutionList } from './SolutionList';
import { Progress } from './ui/Progress';
import { useCoarsePointer } from '../lib/pointer';
import { Button } from './ui/Button';
import { Field } from './ui/Field';
import { useJobs, useReportJob } from '../store/useJobs';
import { ownerOf, useBroadbandMemory, type MemoryPatch } from '../store/useBroadbandMemory';
import { StaleNote } from './ui/StaleNote';
import { RealFrequency, type RftJobState } from './RealFrequency';

interface BroadbandMatchProps {
  /** The elements as evaluated (with the loss model when it is on): the prefix when they are kept. */
  readonly elements: readonly DesignElement[];
  readonly target: Complex;
  readonly onPreview: (solution: MatchSolution | null) => void;
  readonly onClose: () => void;
}

/** What a result was computed for; any change to it makes the list stale. */
export interface SearchRan {
  readonly result: BroadbandResult;
  readonly elements: readonly DesignElement[];
  readonly load: Complex;
  readonly loads: unknown;
  readonly z0: number;
  readonly target: Complex;
  readonly keep: boolean;
  readonly useDatapoints: boolean;
  readonly start: number;
  readonly stop: number;
}

const MAX_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8];

/**
 * The search's Bode-Fano limit as the panel and the Response view show it, by the one rule of
 * the real frequency table (shownBandLimit): none through kept parts with loss, none that a
 * ladder found (`also`: the real frequency ladder on the same band) or the load alone beats.
 */
function searchLimit(
  result: BroadbandResult,
  kept: readonly Element[],
  also: readonly number[] = [],
): RftLimit {
  return shownBandLimit(
    result.floor,
    [result.baseline, ...result.candidates.map((c) => c.worstVswr), ...also],
    kept.length > 0 && !losslessLadder(kept, result.scoringFrequencies),
  );
}

/**
 * Broadband matching: the best network over a band, searched over ladder
 * topologies of up to a chosen number of parts. Runs in a Web Worker; the
 * results are listed best first with the worst VSWR over the band, hovering
 * previews the network on the chart and clicking replaces the design's parts
 * (or appends to them) in one undo step.
 */
export function BroadbandMatch({ elements, target, onPreview, onClose }: BroadbandMatchProps) {
  const design = useDesignStore((s) => s.design);
  const coarse = useCoarsePointer();
  // The sweep range, unless the design frequency lies outside it: then an octave around f0.
  // Over a measured load (a datapoint sweep of imported points), the measured band.
  const defaultBand = (): { start: number; stop: number } => {
    const { start: lo, stop: hi } = designBand(design);
    const inRange = design.frequency >= lo && design.frequency <= hi;
    return inRange
      ? { start: lo, stop: hi }
      : { start: design.frequency / 2, stop: design.frequency * 2 };
  };
  // What the tool had when it last closed on this design (useBroadbandMemory): the typed band,
  // the choices and the results. On another design it starts afresh.
  const [memory] = useState(() => useBroadbandMemory.getState().recall(ownerOf(elements, design)));
  const owner = ownerOf(elements, design);
  const remember = (patch: MemoryPatch): void =>
    useBroadbandMemory.getState().remember(owner, patch);
  const typed = memory.band;
  const [start, setStart] = useState(() => typed?.start ?? defaultBand().start);
  const [stop, setStop] = useState(() => typed?.stop ?? defaultBand().stop);
  /** True once the user typed a band: a new import then leaves it alone. */
  const [edited, setEdited] = useState(typed !== null);
  // A new import (or a switch between the sweeps) brings its own band while the panel is open,
  // unless the user has set one since the last default.
  // (State adjusted while rendering, React's pattern for state that follows a prop.)
  const [bandSource, setBandSource] = useState({
    loads: design.sweep.loads,
    mode: design.sweep.mode,
  });
  if (bandSource.loads !== design.sweep.loads || bandSource.mode !== design.sweep.mode) {
    setBandSource({ loads: design.sweep.loads, mode: design.sweep.mode });
    if (!edited) {
      const next = defaultBand();
      setStart(next.start);
      setStop(next.stop);
    }
  }
  /** A band typed upside down is swapped, as the sweep is (one rule everywhere). */
  const setBand = (from: number, to: number): void => {
    const lo = Math.min(from, to);
    const hi = Math.max(from, to);
    setEdited(true);
    setStart(lo);
    setStop(hi);
    remember({ band: { start: lo, stop: hi } });
    if (from > to) {
      useDesignStore
        .getState()
        .setMessage(`Swapped the band to ${fmtFrequency(lo)} to ${fmtFrequency(hi)}`);
    }
  };
  // The choices, as they were when the tool last closed.
  const [maxElements, setMaxElementsState] = useState(() => memory.maxElements);
  const [keep, setKeepState] = useState(() => memory.keep ?? elements.length > 0);
  const [allowLine, setAllowLineState] = useState(() => memory.allowLine);
  const setMaxElements = (n: number): void => {
    setMaxElementsState(n);
    remember({ maxElements: n });
  };
  const setKeep = (on: boolean): void => {
    setKeepState(on);
    remember({ keep: on });
  };
  const setAllowLine = (on: boolean): void => {
    setAllowLineState(on);
    remember({ allowLine: on });
  };
  const datapointLoads = design.sweep.loads && design.sweep.loads.length >= 2;
  const [job, setJob] = useState<BroadbandJob | null>(null);
  const [progress, setProgress] = useState<BroadbandProgress | null>(null);
  const [ran, setRan] = useState<SearchRan | null>(() => memory.search);
  /** Results finished in this panel: each is announced to the tours after it is on show. */
  const [resultCount, setResultCount] = useState(0);
  useEffect(() => {
    if (resultCount > 0) emitTourEvent('broadband-result');
  }, [resultCount]);
  /** The search result, kept also in useBroadbandMemory so it outlives the closed tool. */
  const keepRan = (r: SearchRan | null): void => {
    setRan(r);
    remember({ search: r });
  };
  const [error, setError] = useState<string | null>(null);
  const jobRef = useRef<BroadbandJob | null>(null);
  /** The ladders the running search goes through: the note's count, and the bar's first pass. */
  const [runCount, setRunCount] = useState(0);
  /** The real frequency run below, while it lasts: the job row shows it when no search runs. */
  const [rftJob, setRftJob] = useState<RftJobState | null>(null);

  const validBand = start > 0 && stop > start;
  /** The load every band tool uses: the measured load of a datapoint sweep, else the fixed load. */
  const usesDatapoints = hasMeasuredLoad(design);
  const fits = useFitVersion();
  /** The measured load's model (fitted from six points), for its quality line and the band flag. */
  const measured = useMemo(
    () =>
      design.sweep.loads && design.sweep.loads.length >= 2
        ? measuredLoadInfo(pointsLoadModel(design.sweep.loads, design.z0))
        : null,
    // fits: the model arrives from the fitting worker.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [design.sweep.loads, design.z0, fits],
  );
  /** A band wholly outside the data: the load there is a held constant, nothing to match. */
  const outsideData =
    usesDatapoints &&
    measured !== null &&
    validBand &&
    (stop < measured.band[0] || start > measured.band[1]);
  const beyond =
    usesDatapoints && measured && validBand && !outsideData
      ? beyondDataText(measured, start, stop)
      : null;
  const prefix: readonly Element[] = keep ? elements : [];
  const searched = useMemo(
    () => enumerateTopologies(maxElements, { allowLine }).length,
    [maxElements, allowLine],
  );

  // Stop a running search when the panel goes away.
  useEffect(() => () => jobRef.current?.cancel(), []);
  const progressText = progress ? broadbandProgressText(progress, runCount) : '';
  // The bar counts what its words count: ladders, then refinements.
  const bar = progress ? broadbandProgressBar(progress, runCount) : null;
  /** Stop the running search: the status line says so. */
  const stopSearch = (): void => {
    if (!job) return;
    job.cancel();
    useDesignStore.getState().setMessage('Stopped the broadband search');
  };

  // The job row shows the progress, with Stop, and the header button a dot while the tool is
  // closed (docs/10 section 5.1).
  useReportJob(
    'match',
    progress && bar
      ? {
          done: bar.done,
          total: bar.total,
          label: broadbandProgressText(progress, runCount, progress.best),
        }
      : rftJob
        ? {
            done: rftJob.progress.done,
            total: rftJob.progress.total,
            label: `Real frequency run, ${Math.min(rftJob.progress.done + 1, rftJob.progress.total)} of ${rftJob.progress.total}`,
          }
        : null,
    () => (job ? stopSearch() : rftJob?.stop()),
  );

  const run = (): void => {
    if (!validBand || outsideData) return;
    onPreview(null);
    setError(null);
    keepRan(null);
    const load = bandLoad(design, usesDatapoints);
    const frequencies = sweepPoints(start, stop, bandPointCount(design.sweep.points, maxElements));
    // The whole count from the start, the refinement pass included, so the bar never steps back.
    setRunCount(searched);
    setProgress({ done: 0, total: broadbandSteps(searched), best: NaN, label: '' });
    const started = startBroadband(
      { frequencies, load, z0: design.z0, target, prefix, maxElements, allowLine },
      setProgress,
    );
    jobRef.current = started;
    setJob(started);
    started.result
      .then((result) => {
        track('job', 'broadband', 'done');
        // The result, also for a user on another segment: the status line and a check dot.
        const best = result.candidates.reduce((m, c) => Math.min(m, c.worstVswr), Infinity);
        const said = Number.isFinite(best)
          ? `Broadband search done: best worst-case VSWR ${fmtNum(best, 3)}`
          : 'Broadband search done: no network does better than the parts there are';
        useDesignStore.getState().setMessage(said);
        useJobs.getState().finish('match', said);
        keepRan({
          result,
          elements,
          load: design.load,
          loads: design.sweep.loads,
          z0: design.z0,
          target,
          keep,
          useDatapoints: usesDatapoints,
          start,
          stop,
        });
        // The limit goes to the Response view's VSWR plot while these rows are the load, by the
        // panel's rule: none that a ladder found beats, and an estimate labelled as one.
        const shown = searchLimit(result, prefix).floor;
        useBandLimit.getState().setLimit(
          shown && usesDatapoints && design.sweep.loads
            ? {
                floor: shown.floor,
                estimate: shown.method !== 'exact',
                start,
                stop,
                loads: design.sweep.loads,
              }
            : null,
        );
        // The best of every size searched, also the sizes the listed rows leave out.
        useBandLimit
          .getState()
          .setBests(
            result.bestBySize
              .filter((c) => Number.isFinite(c.worstVswr))
              .map((c) => ({ count: c.count, vswr: c.worstVswr })),
          );
        // Said once the result is on show (an effect after the commit): a workflow step that reads
        // the panel then reads the new rows.
        setResultCount((c) => c + 1);
        noteBroadbandResult(best, shown?.floor ?? null, shown?.fromFit === true);
      })
      .catch((err: Error) => {
        track('job', 'broadband', err.message === 'cancelled' ? 'stopped' : 'error');
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
    ran.useDatapoints === usesDatapoints
      ? ran
      : null;

  /** The results with Realize applied: snapped values, worst VSWR after snapping, ranked by it. */
  const { rows: listed, unbuilt } = useMemo(() => {
    if (!fresh) return { rows: [], unbuilt: 0 };
    const { result } = fresh;
    const load = loadModelOf(bandLoad(design, fresh.useDatapoints), design.z0);
    const centre = (fresh.start + fresh.stop) / 2;
    const from = fresh.keep ? undefined : typeof load === 'function' ? load(centre) : load;
    // A candidate with a part that changes nothing (Zin already on the target) is not offered.
    const loadAtCentre = typeof load === 'function' ? load(centre) : load;
    const startAtCentre = fresh.keep
      ? fresh.elements.reduce((z, el) => applyElement(el, z, centre), loadAtCentre)
      : loadAtCentre;
    const rows = result.candidates
      .filter((c) => !solutionDoesNothing(c.elements, startAtCentre, design.z0, centre))
      .map((candidate) => {
        const snapped = snapCandidate(
          design,
          fresh.keep ? fresh.elements : [],
          candidate,
          load,
          result.scoringFrequencies,
          target,
        );
        const parts = snapped ? snapped.elements : candidate.elements;
        const solution: MatchSolution = {
          elements: parts,
          q: 0,
          result: target,
          description: candidate.topology.label,
          ...(from ? { from } : {}),
        };
        return {
          candidate,
          snapped,
          unbuildable: snapped?.unbuildable === true,
          solution,
          label: snapped
            ? `${candidate.count} ${candidate.count === 1 ? 'part' : 'parts'}, VSWR ${fmtNum(snapped.worstVswr, 3)} (ideal ${fmtNum(candidate.worstVswr, 3)})`
            : `${candidate.count} ${candidate.count === 1 ? 'part' : 'parts'}, VSWR ${fmtNum(candidate.worstVswr, 3)}`,
        };
      });
    // A snapped network below the exact floor of a single-reactance load is a peak the dense
    // grid missed, not a network that exists (the search drops such candidates the same way).
    const buildable = rows.filter((r) => !r.unbuildable);
    const exact = result.exactFloor;
    // An exact floor read from a fitted model is known to the fit's 1e-3, as in the search.
    const slack = result.floor?.fromFit ? 1e-3 : 1e-9;
    const possible =
      exact === null
        ? buildable
        : buildable.filter(
            (r) => (r.snapped?.worstVswr ?? r.candidate.worstVswr) >= exact * (1 - slack),
          );
    if (possible.some((r) => r.snapped)) {
      possible.sort(
        (a, b) =>
          Math.round((a.snapped?.worstVswr ?? 0) * 1000) -
            Math.round((b.snapped?.worstVswr ?? 0) * 1000) || a.candidate.count - b.candidate.count,
      );
    }
    return { rows: possible, unbuilt: rows.length - buildable.length };
    // fits: the model arrives from the fitting worker.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fresh, design, target, fits]);

  const apply = (sol: MatchSolution): void => {
    const row = listed.find((r) => r.solution === sol);
    if (!row || !fresh) return;
    const achieved = row.snapped ? row.snapped.worstVswr : row.candidate.worstVswr;
    // One step named by its message; a replaced network offers the inline Undo.
    useDesignStore.getState().step(
      `${fresh.keep ? 'Added' : 'Replaced the network with'} ${row.candidate.topology.label}${row.snapped ? ` with ${row.snapped.sourceLabel} values` : ''}: worst VSWR ${fmtNum(achieved, 3)} over ${fmtFrequency(fresh.start)} to ${fmtFrequency(fresh.stop)} (was ${fmtNum(fresh.result.baseline, 3)})`,
      (d) => {
        let list: readonly DesignElement[] = fresh.keep ? d.elements : [];
        for (const el of sol.elements) list = [...list, withIdentity(el, list)];
        return {
          ...d,
          elements: list,
          sweep: { ...d.sweep, enabled: true, start: fresh.start, stop: fresh.stop },
        };
      },
      fresh.keep ? undefined : { undo: true },
    );
    onClose();
    noteBroadbandApplied();
  };

  const startPoint = fresh?.keep ? 'with the existing parts' : 'with the load alone';
  // The real frequency ladder on the same design and band: a limit it beats is no limit either
  // (one rule with its table, shownBandLimit).
  const rftRan = useBroadbandMemory((s) => s.rft);
  const rftBest =
    fresh &&
    rftRan &&
    rftRan.elements === fresh.elements &&
    rftRan.load === fresh.load &&
    rftRan.loads === fresh.loads &&
    rftRan.z0 === fresh.z0 &&
    rftRan.target.re === fresh.target.re &&
    rftRan.target.im === fresh.target.im &&
    rftRan.keep === fresh.keep &&
    rftRan.start === fresh.start &&
    rftRan.stop === fresh.stop
      ? rftRan.answer.result.best?.worstVswr
      : undefined;
  const limit = useMemo(
    () =>
      fresh
        ? searchLimit(fresh.result, fresh.keep ? fresh.elements : [], rftBest ? [rftBest] : [])
        : null,
    [fresh, rftBest],
  );
  const floor = limit?.floor ?? null;
  // The Response view's dashed line follows the same rule (a real frequency run can drop it).
  useEffect(() => {
    if (!fresh || !fresh.useDatapoints || !fresh.loads) return;
    const shown = useBandLimit.getState().limit;
    if (shown && shown.loads === fresh.loads && !floor) useBandLimit.getState().setLimit(null);
  }, [fresh, floor]);
  const best = listed[0];
  const bestValue = best ? (best.snapped?.worstVswr ?? best.candidate.worstVswr) : null;

  return (
    <>
      <div className="dropdown-note">
        Searches ladders of series and shunt inductors and capacitors, from one part up to the
        maximum, for the lowest worst VSWR anywhere in the band. More parts follow the load better
        but cost more to build. To optimize the gain of every ladder of a given size at once, try
        the{' '}
        <a
          href="#rft-section"
          onClick={(e) => {
            e.preventDefault();
            document.getElementById('rft-section')?.scrollIntoView({ block: 'start' });
          }}
        >
          real frequency technique
        </a>{' '}
        below.
      </div>
      <div className="fields">
        <Field
          label="From"
          value={start}
          unit="Hz"
          digits={5}
          min={1}
          onCommit={(v) => setBand(v, stop)}
          ariaLabel="Band start"
        />
        <Field
          label="To"
          value={stop}
          unit="Hz"
          digits={5}
          min={1}
          onCommit={(v) => setBand(start, v)}
          ariaLabel="Band stop"
        />
        <label data-tour="match.broadband.maxParts">
          Max parts
          <select
            className="btn"
            value={maxElements}
            onChange={(e) => setMaxElements(Number(e.target.value))}
            aria-label="Maximum number of parts"
          >
            {MAX_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="free-parts">
        <label className="check">
          <input
            type="checkbox"
            checked={keep}
            onChange={(e) => setKeep(e.target.checked)}
            disabled={elements.length === 0}
          />
          Keep the {elements.length} existing part{elements.length === 1 ? '' : 's'} as a prefix
          (new parts go after them)
        </label>
        <label className="check" data-tour="match.broadband.line">
          <input
            type="checkbox"
            checked={allowLine}
            onChange={(e) => setAllowLine(e.target.checked)}
          />
          Allow one series line in place of a series part
        </label>
        {usesDatapoints && measured && (
          <div className="dropdown-note measured-load-note">
            {measuredLoadLine(measured, design.sweep.loadsName)}
            {beyond && <span className="warn-text"> {beyond}</span>}
            {outsideData && (
              <span className="warn-text">
                {' '}
                The band lies wholly outside the measured {fmtFrequency(measured.band[0])} to{' '}
                {fmtFrequency(measured.band[1])}: the load there is only the value at the end of the
                data held constant, so there is nothing to match against. Set a band inside the
                data.
              </span>
            )}
          </div>
        )}
        {datapointLoads && !usesDatapoints && (
          <div className="dropdown-note">
            The {design.sweep.loads?.length} imported rows are kept, but with the frequency sweep
            every band tool, this one included, uses the fixed load; Sweep over them instead (the
            sweep section) makes them the load.
          </div>
        )}
      </div>
      <div className="dropdown-note">
        {validBand
          ? `Band ${fmtFrequency(start)} to ${fmtFrequency(stop)}, ${searched} ladders; lumped parts stay between Z0 / 25 and 10 Z0 of reactance at band centre.${maxElements >= 7 ? ' This many parts can take half a minute.' : ''}`
          : 'Set a band of two different positive frequencies.'}
        {design.realize.enabled &&
          ' Realize is on: results are snapped to your values and ranked by the VSWR they then give.'}
      </div>
      <div className="actions">
        {job ? (
          <Button onClick={stopSearch}>Stop</Button>
        ) : ran && !fresh ? null : (
          // A stale result has its own Run again in the note below: one button, not two.
          <Button
            variant="primary"
            onClick={run}
            disabled={!validBand || outsideData}
            data-tour="match.broadband.run"
          >
            {ran ? 'Run again' : 'Run'}
          </Button>
        )}
      </div>
      {progress && bar && (
        <Progress
          className="row"
          ariaLabel="Broadband search"
          done={bar.done}
          total={bar.total}
          label={
            <>
              {progressText}
              {progress.label ? ` (${progress.label})` : ''}
              {Number.isFinite(progress.best) && (
                <>
                  , best worst-case VSWR <span className="mono">{fmtNum(progress.best, 3)}</span>
                </>
              )}
            </>
          }
        />
      )}
      {error && <div className="row danger">{error}</div>}
      {ran && !fresh && !job && (
        <StaleNote onRun={run}>The design has changed since this run.</StaleNote>
      )}
      {fresh && (
        <>
          <div className="row result">
            {listed.length === 0 && unbuilt > 0
              ? `Your values cannot build any of the ${unbuilt} ladders found: snapped to them, each reflects all the power somewhere in the band. Add values, or turn Realize off.`
              : listed.length === 0
                ? `No network of up to ${fresh.result.maxElements} parts does better than the ${fmtNum(fresh.result.baseline, 3)} worst VSWR ${startPoint}.`
                : `Worst VSWR over the band (${fresh.result.scoringFrequencies.length} points) ${fmtNum(fresh.result.baseline, 3)} ${startPoint}; best found ${fmtNum(bestValue ?? NaN, 3)} with ${best?.candidate.count} parts. ${fresh.result.evaluations.toLocaleString()} evaluations.`}
          </div>
          <div className="row" data-tour="match.broadband.limit">
            {floor ? (
              <>
                <span title={bodeFanoTip(floor.method !== 'exact')}>Bode-Fano limit</span>{' '}
                <span className="mono">{fmtNum(floor.floor, 3)}</span> over{' '}
                {fmtNum(floor.fractionalBandwidth * 100, 1)} %,{' '}
                {floorMethodText(floor, (v) => fmtNum(v, 2))}
                {floor.method === 'exact'
                  ? ': no lossless network of any size does better.'
                  : '. An estimate for any number of parts, not a hard limit.'}
              </>
            ) : (
              <span className="muted">
                {limit?.note
                  ? `No Bode-Fano limit shown: ${limit.note}.`
                  : noFloorReason(
                      fresh.useDatapoints,
                      fresh.result.frequencies.length,
                      fresh.useDatapoints && measured?.mode === 'fitted',
                    )}
              </span>
            )}
          </div>
          {listed.length > 0 && (
            <>
              <div className="dropdown-note">
                {coarse
                  ? `Tap a row to preview it on the chart, tap it again or press ${fresh.keep ? 'Add' : 'Use'} to `
                  : 'Hover to preview on the chart, click to '}
                {fresh.keep ? 'add the parts' : 'replace the network'}. One Undo takes it back.
              </div>
              {/* The workflow points at the top rows to click, not the whole list. */}
              <SolutionList
                solutions={listed.map((r) => r.solution)}
                labels={listed.map((r) => r.label)}
                empty=""
                onPreview={onPreview}
                onApply={apply}
                tourRows={{ id: 'match.broadband.results', count: 3 }}
                applyLabel={fresh.keep ? 'Add' : 'Use'}
              />
            </>
          )}
        </>
      )}
      {validBand && !outsideData && (
        <RealFrequency
          elements={elements}
          keep={keep}
          start={start}
          stop={stop}
          target={target}
          maxElements={maxElements}
          beyond={beyond}
          search={fresh && fresh.start === start && fresh.stop === stop ? fresh.result : null}
          onPreview={onPreview}
          onClose={onClose}
          onJob={setRftJob}
        />
      )}
    </>
  );
}
