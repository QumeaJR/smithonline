import {
  applyElement,
  broadbandSteps,
  enumerateTopologies,
  sweepPoints,
  type BroadbandProgress,
  type BroadbandResult,
  type Complex,
  type Element,
  type MatchSolution,
} from '@smithonline/core';
import { useEffect, useMemo, useRef, useState } from 'react';
import { withIdentity, type DesignElement } from '../lib/design';
import {
  bandLoad,
  broadbandProgressText,
  loadModelOf,
  snapCandidate,
  startBroadband,
  type BroadbandJob,
} from '../lib/broadband';
import { solutionDoesNothing } from '../lib/match';
import { fmtFrequency, fmtNum } from '../lib/format';
import { useDesignStore } from '../store/useDesignStore';
import { SolutionList } from './SolutionList';
import { Progress } from './ui/Progress';
import { useCoarsePointer } from '../lib/pointer';
import { Button } from './ui/Button';
import { Field } from './ui/Field';
import { useReportJob } from '../store/useJobs';

interface BroadbandMatchProps {
  /** The elements as evaluated (with the loss model when it is on): the prefix when they are kept. */
  readonly elements: readonly DesignElement[];
  readonly target: Complex;
  readonly onPreview: (solution: MatchSolution | null) => void;
  readonly onClose: () => void;
}

/** What a result was computed for; any change to it makes the list stale. */
interface Ran {
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

/** Points the band is judged at: the sweep's own count, within what a search can afford. */
function bandPointCount(points: number): number {
  return Math.max(5, Math.min(101, Math.floor(points)));
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
  const inRange =
    design.frequency >= Math.min(design.sweep.start, design.sweep.stop) &&
    design.frequency <= Math.max(design.sweep.start, design.sweep.stop);
  const [start, setStart] = useState(inRange ? design.sweep.start : design.frequency / 2);
  const [stop, setStop] = useState(inRange ? design.sweep.stop : design.frequency * 2);
  const [maxElements, setMaxElements] = useState(4);
  const [keep, setKeep] = useState(elements.length > 0);
  const [allowLine, setAllowLine] = useState(false);
  const datapointLoads = design.sweep.loads && design.sweep.loads.length >= 2;
  const [useDatapoints, setUseDatapoints] = useState(true);
  const [job, setJob] = useState<BroadbandJob | null>(null);
  const [progress, setProgress] = useState<BroadbandProgress | null>(null);
  const [ran, setRan] = useState<Ran | null>(null);
  const [error, setError] = useState<string | null>(null);
  const jobRef = useRef<BroadbandJob | null>(null);
  /** The ladders the running search goes through: the note's count, and the bar's first pass. */
  const [runCount, setRunCount] = useState(0);

  const validBand = start > 0 && stop > start;
  const usesDatapoints = Boolean(datapointLoads) && useDatapoints;
  const prefix: readonly Element[] = keep ? elements : [];
  const searched = useMemo(
    () => enumerateTopologies(maxElements, { allowLine }).length,
    [maxElements, allowLine],
  );

  // Stop a running search when the panel goes away.
  useEffect(() => () => jobRef.current?.cancel(), []);
  const progressText = progress ? broadbandProgressText(progress, runCount) : '';
  // The tool strip shows the progress and the header button a dot while another segment shows.
  useReportJob(
    'match',
    progress ? { done: progress.done, total: progress.total, label: progressText } : null,
  );

  const run = (): void => {
    if (!validBand) return;
    onPreview(null);
    setError(null);
    setRan(null);
    const load = bandLoad(design, usesDatapoints);
    const frequencies = sweepPoints(start, stop, bandPointCount(design.sweep.points));
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
      .then((result) =>
        setRan({
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
        }),
      )
      .catch((err: Error) => {
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
    ran.keep === keep
      ? ran
      : null;

  /** The results with Realize applied: snapped values, worst VSWR after snapping, ranked by it. */
  const listed = useMemo(() => {
    if (!fresh) return [];
    const { result } = fresh;
    const load = loadModelOf(bandLoad(design, fresh.useDatapoints));
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
          result.frequencies,
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
          solution,
          label: snapped
            ? `${candidate.count} ${candidate.count === 1 ? 'part' : 'parts'}, VSWR ${fmtNum(snapped.worstVswr, 3)} (ideal ${fmtNum(candidate.worstVswr, 3)})`
            : `${candidate.count} ${candidate.count === 1 ? 'part' : 'parts'}, VSWR ${fmtNum(candidate.worstVswr, 3)}`,
        };
      });
    if (rows.some((r) => r.snapped)) {
      rows.sort(
        (a, b) =>
          Math.round((a.snapped?.worstVswr ?? 0) * 1000) -
            Math.round((b.snapped?.worstVswr ?? 0) * 1000) || a.candidate.count - b.candidate.count,
      );
    }
    return rows;
  }, [fresh, design, target]);

  const apply = (sol: MatchSolution): void => {
    const row = listed.find((r) => r.solution === sol);
    if (!row || !fresh) return;
    const store = useDesignStore.getState();
    store.update((d) => {
      let list: readonly DesignElement[] = fresh.keep ? d.elements : [];
      for (const el of sol.elements) list = [...list, withIdentity(el, list)];
      return {
        ...d,
        elements: list,
        sweep: { ...d.sweep, enabled: true, start: fresh.start, stop: fresh.stop },
      };
    });
    const achieved = row.snapped ? row.snapped.worstVswr : row.candidate.worstVswr;
    store.setMessage(
      `${fresh.keep ? 'Added' : 'Replaced the network with'} ${row.candidate.topology.label}${row.snapped ? ` with ${row.snapped.sourceLabel} values` : ''}: worst VSWR ${fmtNum(achieved, 3)} over ${fmtFrequency(fresh.start)} to ${fmtFrequency(fresh.stop)} (was ${fmtNum(fresh.result.baseline, 3)})`,
    );
    onClose();
  };

  const startPoint = fresh?.keep ? 'with the existing parts' : 'with the load alone';
  const floor = fresh?.result.floor ?? null;
  const best = listed[0];
  const bestValue = best ? (best.snapped?.worstVswr ?? best.candidate.worstVswr) : null;

  return (
    <>
      <div className="dropdown-note">
        Searches ladders of alternating series and shunt inductors and capacitors, from one part up
        to the maximum, for the lowest worst VSWR anywhere in the band. More parts follow the load
        better but cost more to build.
      </div>
      <div className="fields">
        <Field
          label="From"
          value={start}
          unit="Hz"
          digits={5}
          min={1}
          onCommit={setStart}
          ariaLabel="Band start"
        />
        <Field
          label="To"
          value={stop}
          unit="Hz"
          digits={5}
          min={1}
          onCommit={setStop}
          ariaLabel="Band stop"
        />
        <label>
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
        <label className="check">
          <input
            type="checkbox"
            checked={allowLine}
            onChange={(e) => setAllowLine(e.target.checked)}
          />
          Allow one series line in place of a series part
        </label>
        {datapointLoads && (
          <label className="check">
            <input
              type="checkbox"
              checked={useDatapoints}
              onChange={(e) => setUseDatapoints(e.target.checked)}
            />
            Use the {design.sweep.loads?.length} datapoint loads as the load across the band
          </label>
        )}
      </div>
      <div className="dropdown-note">
        {validBand
          ? `Band ${fmtFrequency(start)} to ${fmtFrequency(stop)}, ${searched} ladders; lumped parts stay between Z0 / 25 and 10 Z0 of reactance at band centre.${maxElements >= 7 ? ' This many parts can take half a minute.' : ''}`
          : 'Set the band with start below stop.'}
        {design.realize.enabled &&
          ' Realize is on: results are snapped to your values and ranked by the VSWR they then give.'}
      </div>
      <div className="actions">
        {job ? (
          <Button onClick={() => job.cancel()}>Cancel</Button>
        ) : (
          <Button variant="primary" onClick={run} disabled={!validBand}>
            {ran ? 'Run again' : 'Run'}
          </Button>
        )}
      </div>
      {progress && (
        <Progress
          className="row"
          ariaLabel="Broadband search"
          done={progress.done}
          total={progress.total}
          label={
            <>
              {progressText}
              {progress.label ? ` (${progress.label})` : ''}
              {Number.isFinite(progress.best) && (
                <>
                  , best so far <span className="mono">{fmtNum(progress.best, 3)}</span>
                </>
              )}
            </>
          }
        />
      )}
      {error && <div className="row danger">{error}</div>}
      {ran && !fresh && <div className="row">The design changed since this run; run it again.</div>}
      {fresh && (
        <>
          <div className="row result">
            {listed.length === 0
              ? `No network of up to ${fresh.result.maxElements} parts does better than the ${fmtNum(fresh.result.baseline, 3)} worst VSWR ${startPoint}.`
              : `Worst VSWR over the band ${fmtNum(fresh.result.baseline, 3)} ${startPoint}; best found ${fmtNum(bestValue ?? NaN, 3)} with ${best?.candidate.count} parts. ${fresh.result.evaluations.toLocaleString()} evaluations.`}
          </div>
          <div className="row">
            {floor ? (
              <>
                Bode-Fano floor <span className="mono">{fmtNum(floor.floor, 3)}</span> for load Q{' '}
                {fmtNum(floor.q, 2)} over {fmtNum(floor.fractionalBandwidth * 100, 1)} %: no
                lossless network of any size does better.
              </>
            ) : (
              <span className="muted">
                No Bode-Fano floor: a fixed impedance has no bandwidth of its own, so only the
                number of parts limits it. Import datapoints to give the load a frequency behaviour.
              </span>
            )}
          </div>
          {listed.length > 0 && (
            <>
              <div className="dropdown-note">
                {coarse
                  ? 'Tap a row to preview it on the chart, tap it again or press Add to '
                  : 'Hover to preview on the chart, click to '}
                {fresh.keep ? 'add the parts' : 'replace the network'}. One Undo takes it back.
              </div>
              <SolutionList
                solutions={listed.map((r) => r.solution)}
                labels={listed.map((r) => r.label)}
                empty=""
                onPreview={onPreview}
                onApply={apply}
              />
            </>
          )}
        </>
      )}
    </>
  );
}
