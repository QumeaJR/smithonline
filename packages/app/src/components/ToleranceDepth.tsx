/**
 * The D3 sections of the Tolerance panel: which part dominates the spread
 * (live, from the analytic sensitivities), the worst case of the last run,
 * and design centring in a worker with its before and after yields.
 */
import {
  formatEngineering,
  primaryValueOf,
  type CentreProgress,
  type CentreResult,
  type Corner,
  type CornerResult,
  type Element,
} from '@smithonline/core';
import { useEffect, useRef, useState } from 'react';
import {
  CENTRE_FAILED,
  centreRequest,
  startCentring,
  useCentreOutcome,
  type CentreJob,
} from '../lib/centre';
import type { Design } from '../lib/design';
import { primaryValue, withPrimaryValue } from '../lib/elements';
import { fmtNum, fmtSig, fmtYield, fmtYieldInterval } from '../lib/format';
import { fmtShare, partLabel, spreadSentence, type DesignSpread } from '../lib/sensitivity';
import { judgedRangeText } from '../lib/tolerance';
import { useDesignStore } from '../store/useDesignStore';
import { emitTourEvent } from '../lib/tourEvents';
import { noteCentred } from '../lib/nextSteps';
import { Button } from './ui/Button';
import { Progress } from './ui/Progress';
import { StaleNote } from './ui/StaleNote';

/** A VSWR slope per percent, with its sign: "+0.012", "-0.004". */
function fmtSlope(v: number): string {
  if (!Number.isFinite(v)) return '-';
  const s = Math.abs(v) < 5e-5 ? '0.000' : fmtSig(Math.abs(v), 2);
  return v > 0 && s !== '0.000' ? `+${s}` : v < 0 && s !== '0.000' ? `-${s}` : s;
}

/** The ranking of the parts by their share of the spread. */
export function SpreadRanking({
  spread,
  correlated,
}: {
  readonly spread: DesignSpread;
  readonly correlated: boolean;
}) {
  const band = spread.over === 'band';
  const where = band
    ? 'over the band: the smooth band VSWR, a power mean of the VSWR across the band weighted to where it is worst'
    : 'at the design frequency';
  const quantity = spread.measure === 'gamma' ? 'Γ' : band ? 'the smooth band VSWR' : 'the VSWR';
  return (
    <div className="mc-spread" data-tour="tolerance.spread">
      <div className="row">
        <strong title="Share of the VSWR spread each part causes under its tolerance">
          Which part matters most
        </strong>{' '}
        <span className="muted small">(linearized from the analytic sensitivities, {where})</span>
      </div>
      <div className="row spread-sentence">{spreadSentence(spread)}.</div>
      <table className="fit-table mc-ranking">
        <thead>
          <tr>
            <th scope="col">Part</th>
            <th scope="col">Tol.</th>
            <th
              scope="col"
              title={
                band
                  ? 'Change of the smooth band VSWR (the power mean over the band) for a 1 % change of this part'
                  : 'Change of the VSWR for a 1 % change of this part'
              }
            >
              VSWR per %
            </th>
            <th
              scope="col"
              title={`Share of the variance of ${quantity} the part causes under its tolerance`}
            >
              Share
            </th>
          </tr>
        </thead>
        <tbody>
          {spread.ranking.map((p) => (
            <tr key={`${p.ref.index}:${p.ref.parameter}`}>
              <td>{p.label}</td>
              <td className="mono">{fmtSig(p.tolerance * 100, 3)} %</td>
              <td
                className="mono"
                title={
                  spread.matched
                    ? `A perfect match: the VSWR has no slope; |Γ| rises by ${fmtSig(p.gammaPerPercent, 2)} per percent either way`
                    : `|Γ| changes by ${fmtSig(p.gammaPerPercent, 2)} per percent`
                }
              >
                {spread.matched ? '0' : fmtSlope(p.vswrPerPercent)}
              </td>
              <td className="share">
                <ShareBar share={p.share} />
                <span className="mono">{fmtShare(p.share)}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="row small muted">
        Share: how much of the variance of {quantity} under the tolerances the part causes (its
        slope times its tolerance)
        {correlated
          ? ', with the correlation of parts from one reel; a negative share offsets the others'
          : ''}
        .
        {spread.measure === 'gamma'
          ? spread.matched
            ? ' The match is perfect here, so the VSWR has no slope (0); the shares use the mean square change of Γ, the second-order term of the mismatch at a match.'
            : ' The match is so close that the VSWR is not linear in the parts, so the shares use the mean square change of Γ instead.'
          : ''}
      </div>
    </div>
  );
}

/** A small horizontal bar for a share of 0 to 100 percent; a negative share draws nothing. */
export function ShareBar({ share }: { readonly share: number }) {
  const pct = Math.max(0, Math.min(1, Number.isFinite(share) ? share : 0)) * 100;
  return (
    <span className="share-bar" aria-hidden="true">
      <span style={{ width: `${pct}%` }} />
    </span>
  );
}

/** "Shunt L 1 -5 %, Series C 2 +3.1 %": where each varied quantity sits, named from the run's network. */
function deviationsText(result: CornerResult, at: Corner): string {
  return result.slots
    .map((s, i) => {
      const el = result.elements[s.ref.index];
      const name = el ? partLabel(el, s.ref.index, s.ref) : `part ${s.ref.index + 1}`;
      const pct = (at.signs[i] ?? 0) * s.tolerance * 100;
      const digits = at.source === 'corner' ? 3 : 2;
      const shown = fmtSig(Math.abs(pct), digits);
      const sign = shown === '0' ? '' : pct > 0 ? '+' : '-';
      return `${name} ${sign}${shown} %`;
    })
    .join(', ');
}

/** A judged VSWR: three decimals, "total reflection" when infinite. */
function vswrText(v: number): string {
  return Number.isFinite(v) ? fmtNum(v, 3) : 'total reflection';
}

/**
 * The worst case of the last run in one sentence: the worst corner, or the nominal network or a
 * run when one of them is worse (a corner is not a bound where the response is not monotonic in
 * the parts). The part names come with the run, so they hold after the design changes.
 */
export function CornerLine({
  corner,
  limit,
}: {
  readonly corner: CornerResult;
  readonly limit: number;
}) {
  const w = corner.worst;
  const value = (
    <span className={`mono ${w.vswr > limit ? 'warn-text' : ''}`}>{vswrText(w.vswr)}</span>
  );
  const found =
    corner.fromSensitivity.vswr >= corner.corner.vswr
      ? 'the sensitivities point to it'
      : `the sensitivities found ${fmtNum(corner.fromSensitivity.vswr, 3)}`;
  const searched = corner.exhaustive
    ? `all ${corner.evaluated} corners evaluated, ${found}`
    : `${corner.evaluated} corners from the sensitivities evaluated`;
  if (w.source === 'corner') {
    return (
      <div className="row mc-corner" data-tour="tolerance.worstCase">
        Worst case: VSWR {value} at a corner, with {deviationsText(corner, w)}{' '}
        <span className="muted small">(every part at a tolerance limit; {searched})</span>.
      </div>
    );
  }
  const beyond = w.signs.some((d) => Math.abs(d) > 1);
  const where =
    w.source === 'nominal'
      ? 'at the nominal values'
      : `in run ${(w.run ?? 0) + 1}, ${beyond ? 'beyond' : 'inside'} the tolerance band (${deviationsText(corner, w)})`;
  return (
    <div className="row mc-corner" data-tour="tolerance.worstCase">
      Worst case: VSWR {value} {where}; the worst corner reaches{' '}
      <span className="mono">{vswrText(corner.corner.vswr)}</span> with{' '}
      {deviationsText(corner, corner.corner)}.{' '}
      <span className="muted small">
        {beyond
          ? 'A normal draw goes past the tolerance limits, so a corner is not a bound.'
          : 'The response is not monotonic in the parts here (a resonance or a peak inside the tolerance band), so a corner is not a bound.'}{' '}
        ({searched})
      </span>
    </div>
  );
}

function valueText(el: Element): string {
  const pv = primaryValue(el);
  if (!pv) return '';
  return pv.unit === 'λ' || pv.unit === ''
    ? `${fmtSig(pv.value, 4)}${pv.unit ? ` ${pv.unit}` : ''}`
    : formatEngineering(pv.value, { unit: pv.unit, digits: 3 });
}

/** What the progress bar says in each stage of the search. */
function stageText(p: CentreProgress, realizeLabel: string | null): string {
  switch (p.stage) {
    case 'centring':
      return `Searching for the centre: best yield ${fmtNum(p.best * 100, 1)} % on the search draws`;
    case 'snapping':
      return `Snapping to ${realizeLabel ?? 'the Realize values'}: best yield ${fmtNum(p.best * 100, 1)} % on the search draws`;
    case 'checking':
      return 'Checking the yield before and after on fresh runs';
  }
}

/** "at the edge of its range (twice its value)". */
function edgeText(factor: number): string {
  if (Math.abs(factor - 2) < 1e-9) return 'twice its value';
  if (Math.abs(factor - 0.5) < 1e-9) return 'half its value';
  return 'the end of its realizable range';
}

/** What a centring result was found for, kept with it. */
interface CentreOutcome {
  readonly result: CentreResult;
  readonly for: Design;
  /** The network the search started from: the realized values when Realize is on. */
  readonly from: readonly Element[];
  readonly limit: number;
  /** " over the measured band, 70 MHz to 130 MHz", as judged then. */
  readonly where: string;
}

/**
 * Design centring: moves the nominal values to the centre of what passes,
 * for the best yield within the tolerances, in a Web Worker. Apply sets the
 * values in one undo step named after the gain.
 */
export function CentreSection({ design }: { readonly design: Design }) {
  const [job, setJob] = useState<CentreJob | null>(null);
  const [progress, setProgress] = useState<CentreProgress | null>(null);
  const [outcome, setOutcome] = useState<CentreOutcome | null>(null);
  const [applied, setApplied] = useState<Design | null>(null);
  const [error, setError] = useState<string | null>(null);
  const jobRef = useRef<CentreJob | null>(null);
  useEffect(() => () => jobRef.current?.cancel(), []);
  const movable = design.elements.some((el) => !el.locked && primaryValueOf(el) !== null);
  const realizeLabel = design.realize.enabled
    ? design.realize.series === 'stock'
      ? 'your stock'
      : design.realize.series === 'library'
        ? 'the part library (centred values stay ideal: library parts are not a scale to snap to)'
        : design.realize.series
    : null;

  const run = (): void => {
    setError(null);
    setOutcome(null);
    setApplied(null);
    setProgress({ stage: 'centring', done: 0, total: 1, best: 0 });
    let started: CentreJob;
    let from: readonly Element[];
    try {
      const request = centreRequest(design);
      from = request.ladder.elements;
      started = startCentring(request, setProgress);
    } catch {
      setProgress(null);
      setError(CENTRE_FAILED);
      return;
    }
    jobRef.current = started;
    setJob(started);
    const ranFor = design;
    const limit = design.tolerance?.vswrLimit ?? 2;
    const where = judgedRangeText(design);
    useCentreOutcome.setState({ running: true, last: null });
    started.result
      .then((result) => {
        setOutcome({ result, for: ranFor, from, limit, where });
        const offered =
          result.significant &&
          result.indices.some((i) => {
            const a = from[i];
            const b = result.elements[i];
            return a !== undefined && b !== undefined && valueText(a) !== valueText(b);
          });
        useCentreOutcome.setState({ last: { result, limit, offered } });
        useDesignStore
          .getState()
          .setMessage(
            offered
              ? `Design centring done: yield ${fmtYieldInterval(result.before)} to ${fmtYieldInterval(result.after)}; Apply sets the values`
              : result.improved
                ? `Design centring done: the best centre gives ${fmtYieldInterval(result.after)}, within the noise of the runs`
                : `Design centring done: no better centre found, the yield stays ${fmtYieldInterval(result.before)}`,
          );
        emitTourEvent('centre-result');
      })
      .catch((err: unknown) => {
        if (!(err instanceof Error && err.message === 'cancelled')) setError(CENTRE_FAILED);
      })
      .finally(() => {
        jobRef.current = null;
        setJob(null);
        setProgress(null);
        useCentreOutcome.setState({ running: false });
      });
  };
  const stop = (): void => {
    if (!jobRef.current) return;
    jobRef.current.cancel();
    useDesignStore.getState().setMessage('Stopped design centring');
  };

  const result = outcome?.result ?? null;
  const wasApplied = applied !== null && applied === design;
  // Any change of the design, its limit or its band makes the result stale, found or not.
  const stale = outcome !== null && outcome.for !== design && !wasApplied;
  const offer = result !== null && result.significant;
  // The parts whose shown value changes; Apply writes these and nothing else.
  const changes =
    result && outcome
      ? result.indices
          .map((i) => ({
            i,
            from: outcome.from[i] as Element,
            to: result.elements[i] as Element,
          }))
          .filter(({ from, to }) => from && to && valueText(from) !== valueText(to))
      : [];
  const apply = (): void => {
    if (!result || !outcome || changes.length === 0) return;
    const label = `Centred the design: yield ${fmtYield(result.before.passed, result.before.runs)} to ${fmtYield(result.after.passed, result.after.runs)} within VSWR ${fmtSig(outcome.limit)}`;
    const values = new Map(changes.map(({ i, to }) => [i, primaryValueOf(to) as number] as const));
    useDesignStore.getState().step(
      label,
      (d) => ({
        ...d,
        elements: d.elements.map((el, i) => {
          const v = values.get(i);
          return v !== undefined ? withPrimaryValue(el, v) : el;
        }),
      }),
      { undo: true },
    );
    setApplied(useDesignStore.getState().design);
    emitTourEvent('centre-applied');
    noteCentred();
  };
  const runs = result
    ? `on ${result.after.runs} fresh runs within VSWR ${fmtSig(outcome?.limit ?? 2)}${outcome?.where ?? ''}`
    : '';
  const edgeParts = result
    ? result.edges.map((e) => {
        const el = outcome?.from[e.index];
        return el
          ? `${partLabel(el, e.index)} sits at the edge of its range (${edgeText(e.factor)})`
          : '';
      })
    : [];

  return (
    <div className="mc-centre">
      <div className="row">
        <strong>Design centring</strong>{' '}
        <span className="muted small">
          moves the nominal values to the centre of what passes, for the best yield within the
          tolerances
          {design.realize.enabled ? ', then snaps them to the Realize values' : ''}
        </span>
      </div>
      {progress && (
        <Progress
          className="row"
          ariaLabel="Design centring"
          done={progress.done}
          total={progress.total}
          label={stageText(progress, realizeLabel)}
        />
      )}
      {error && <div className="row danger">{error}</div>}
      {result && !job && stale && (
        <StaleNote onRun={run} label="Centre again">
          The design has changed since this search.
        </StaleNote>
      )}
      {result && !job && (
        <div className={`row result centre-result${stale ? ' stale' : ''}`}>
          {offer && changes.length > 0 ? (
            <>
              Yield <span className="mono">{fmtYieldInterval(result.before)}</span> &#8594;{' '}
              <span className="mono">{fmtYieldInterval(result.after)}</span>{' '}
              <span className="muted small">{runs}</span>
              <div className="small">
                Nominal worst VSWR <span className="mono">{vswrText(result.nominal.before)}</span>{' '}
                &#8594; <span className="mono">{vswrText(result.nominal.after)}</span>
                {result.nominal.after > result.nominal.before
                  ? ': the centre gives up some of the nominal match for the yield.'
                  : '.'}
              </div>
              {result.continuous && (
                <div className="small muted">
                  Centred before snapping: {fmtYieldInterval(result.continuous.yield)}.
                </div>
              )}
              <ul className="centre-changes">
                {changes.map(({ i, from, to }) => (
                  <li key={i}>
                    {partLabel(from, i)} <span className="mono">{valueText(from)}</span> &#8594;{' '}
                    <span className="mono">{valueText(to)}</span>
                  </li>
                ))}
              </ul>
              {edgeParts.filter(Boolean).map((t) => (
                <div key={t} className="small muted">
                  {t}; the centre may lie further out.
                </div>
              ))}
              {wasApplied && (
                <div className="small">Applied; Undo brings the previous values back.</div>
              )}
            </>
          ) : (
            <>
              No better centre found: the yield stays{' '}
              <span className="mono">{fmtYieldInterval(result.before)}</span>{' '}
              <span className="muted small">{runs}</span>
              {result.improved && changes.length > 0 ? (
                <div className="small muted">
                  The best centre found gives {fmtYieldInterval(result.after)}, within what{' '}
                  {result.after.runs} runs can tell apart.
                </div>
              ) : null}
              {result.continuous && !result.improved ? (
                <div className="small muted">
                  Centred before snapping: {fmtYieldInterval(result.continuous.yield)}.
                </div>
              ) : null}
            </>
          )}
        </div>
      )}
      <div className="actions">
        {job ? (
          <Button onClick={stop}>Stop</Button>
        ) : stale ? null : (
          // A stale result has its own Centre again in the note above.
          <Button
            onClick={run}
            disabled={!movable}
            data-tour="tolerance.centre"
            title="Moves nominal values to where most boards pass"
          >
            {result ? 'Centre again' : 'Centre for yield'}
          </Button>
        )}
        {offer && changes.length > 0 && !stale && !wasApplied && !job && (
          <Button variant="primary" onClick={apply} data-tour="tolerance.apply">
            Apply
          </Button>
        )}
      </div>
    </div>
  );
}
