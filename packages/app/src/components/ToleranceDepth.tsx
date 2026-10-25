/**
 * The D3 sections of the Tolerance panel: which part dominates the spread
 * (live, from the analytic sensitivities), the worst-case corner of the last
 * run, and design centring in a worker with its before and after yields.
 */
import {
  formatEngineering,
  primaryValueOf,
  type CentreProgress,
  type CentreResult,
  type CornerResult,
  type Element,
} from '@smithonline/core';
import { useEffect, useRef, useState } from 'react';
import { CENTRE_FAILED, centreRequest, startCentring, type CentreJob } from '../lib/centre';
import type { Design } from '../lib/design';
import { primaryValue, withPrimaryValue } from '../lib/elements';
import { fmtFrequency, fmtNum, fmtSig, fmtYield, fmtYieldInterval } from '../lib/format';
import { fmtShare, partLabel, spreadSentence, type DesignSpread } from '../lib/sensitivity';
import { useDesignStore } from '../store/useDesignStore';
import { Button } from './ui/Button';
import { Progress } from './ui/Progress';

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
  const where =
    spread.over === 'band'
      ? `over the band, weighted to where the VSWR is worst; slopes at ${fmtFrequency(spread.at)}, the worst frequency`
      : 'at the design frequency';
  return (
    <div className="mc-spread">
      <div className="row">
        <strong>Spread by part</strong>{' '}
        <span className="muted small">(linearized from the analytic sensitivities, {where})</span>
      </div>
      <div className="row spread-sentence">{spreadSentence(spread)}.</div>
      <table className="fit-table mc-ranking">
        <thead>
          <tr>
            <th scope="col">Part</th>
            <th scope="col">Tol.</th>
            <th scope="col" title="Change of the VSWR per percent of the part">
              VSWR per %
            </th>
            <th scope="col" title="Share of the spread of Γ the part causes under its tolerance">
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
                title={`|Γ| changes by ${fmtSig(p.gammaPerPercent, 2)} per percent`}
              >
                {fmtSlope(p.vswrPerPercent)}
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
        Share: how much of the variance of Γ under the tolerances the part causes (its sensitivity
        times its tolerance)
        {correlated
          ? ', with the correlation of parts from one reel; a negative share offsets the others'
          : ''}
        .
        {spread.matched
          ? ' The match is perfect here, so the VSWR has no slope (0); the shares use the change of Γ, which has one.'
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

/** The worst-case corner of the last run, in one sentence. */
export function CornerLine({
  corner,
  elements,
  limit,
}: {
  readonly corner: CornerResult;
  readonly elements: readonly Element[];
  readonly limit: number;
}) {
  const parts = corner.slots.map((s, i) => {
    const el = elements[s.ref.index];
    const name = el ? partLabel(el, s.ref.index, s.ref) : `part ${s.ref.index + 1}`;
    const sign = (corner.worst.signs[i] ?? 1) > 0 ? '+' : '-';
    return `${name} ${sign}${fmtSig(s.tolerance * 100, 3)} %`;
  });
  const v = corner.worst.vswr;
  const shown = Number.isFinite(v) ? fmtNum(v, 3) : 'total reflection';
  const found =
    corner.fromSensitivity.vswr >= corner.worst.vswr
      ? 'the sensitivities point to it'
      : `the sensitivities found ${fmtNum(corner.fromSensitivity.vswr, 3)}`;
  return (
    <div className="row mc-corner">
      Worst-case corner: VSWR{' '}
      <span className={`mono ${v > limit ? 'warn-text' : ''}`}>{shown}</span> with{' '}
      {parts.join(', ')}{' '}
      <span className="muted small">
        (every part at a tolerance limit;{' '}
        {corner.exhaustive
          ? `all ${corner.evaluated} corners evaluated, ${found}`
          : `${corner.evaluated} corners from the sensitivities evaluated`}
        )
      </span>
      .
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

/**
 * Design centring: moves the nominal values to the centre of what passes,
 * for the best yield within the tolerances, in a Web Worker. Apply sets the
 * values in one undo step named after the gain.
 */
export function CentreSection({ design }: { readonly design: Design }) {
  const [job, setJob] = useState<CentreJob | null>(null);
  const [progress, setProgress] = useState<CentreProgress | null>(null);
  const [outcome, setOutcome] = useState<{
    result: CentreResult;
    for: Design;
    /** The network the search started from: the realized values when Realize is on. */
    from: readonly Element[];
  } | null>(null);
  const [applied, setApplied] = useState<Design | null>(null);
  const [error, setError] = useState<string | null>(null);
  const jobRef = useRef<CentreJob | null>(null);
  useEffect(() => () => jobRef.current?.cancel(), []);
  const limit = design.tolerance?.vswrLimit ?? 2;
  const movable = design.elements.some((el) => !el.locked && primaryValueOf(el) !== null);

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
    started.result
      .then((result) => setOutcome({ result, for: ranFor, from }))
      .catch((err: unknown) => {
        if (!(err instanceof Error && err.message === 'cancelled')) setError(CENTRE_FAILED);
      })
      .finally(() => {
        jobRef.current = null;
        setJob(null);
        setProgress(null);
      });
  };
  const stop = (): void => {
    if (!jobRef.current) return;
    jobRef.current.cancel();
    useDesignStore.getState().setMessage('Stopped design centring');
  };

  const result = outcome?.result ?? null;
  const current = outcome !== null && outcome.for === design;
  const wasApplied = applied !== null && applied === design;
  const changes = result
    ? result.indices
        .filter(
          (i) =>
            primaryValueOf(result.elements[i] as Element) !==
            primaryValueOf(outcome?.from[i] as Element),
        )
        .map((i) => ({
          i,
          from: outcome?.from[i] as Element,
          to: result.elements[i] as Element,
        }))
    : [];
  const apply = (): void => {
    if (!result || !outcome) return;
    const label = `Centred the design: yield ${fmtYield(result.before.passed, result.before.runs)} to ${fmtYield(result.after.passed, result.after.runs)} within VSWR ${fmtSig(limit)}`;
    useDesignStore.getState().step(
      label,
      (d) => ({
        ...d,
        elements: d.elements.map((el, i) =>
          result.indices.includes(i)
            ? withPrimaryValue(el, primaryValueOf(result.elements[i] as Element) as number)
            : el,
        ),
      }),
      { undo: true },
    );
    setApplied(useDesignStore.getState().design);
  };

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
          label={`Centring (${progress.stage}): best yield ${fmtNum(progress.best * 100, 1)} % on the search draws`}
        />
      )}
      {error && <div className="row danger">{error}</div>}
      {result && !job && (
        <div className="row result centre-result">
          {result.improved ? (
            <>
              Yield <span className="mono">{fmtYieldInterval(result.before)}</span> &#8594;{' '}
              <span className="mono">{fmtYieldInterval(result.after)}</span>{' '}
              <span className="muted small">
                on {result.after.runs} fresh runs within VSWR {fmtSig(limit)}
              </span>
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
              {wasApplied ? (
                <div className="small">Applied; Undo brings the previous values back.</div>
              ) : !current ? (
                <div className="small muted">The design has changed since this search.</div>
              ) : null}
            </>
          ) : (
            <>
              No better centre found: the yield stays{' '}
              <span className="mono">{fmtYieldInterval(result.before)}</span>
              {result.continuous
                ? ` (centred before snapping: ${fmtYieldInterval(result.continuous.yield)})`
                : ''}
              .
            </>
          )}
        </div>
      )}
      <div className="actions">
        {job ? (
          <Button onClick={stop}>Stop</Button>
        ) : (
          <Button onClick={run} disabled={!movable}>
            {result ? 'Centre again' : 'Centre the design'}
          </Button>
        )}
        {result?.improved && current && !wasApplied && !job && (
          <Button variant="primary" onClick={apply}>
            Apply
          </Button>
        )}
      </div>
    </div>
  );
}
