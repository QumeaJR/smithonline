import { driftParameters, type FittedParameter } from '@smithonline/core';
import { useMemo } from 'react';
import {
  applyRetune,
  clearMeasurement,
  expectedText,
  runBoardFit,
  runRetune,
  setFitFree,
  stopBoardFit,
  ticksChanged,
  useBoardFit,
} from '../lib/boardFit';
import { fmtFrequency, fmtNum, fmtSig } from '../lib/format';
import {
  boardBand,
  boardComparison,
  boardKey,
  boardModel,
  coverageNote,
  designMisses,
  driftText,
  fitVerdict,
  measuredWorstText,
  nominalText,
  notFittedText,
  parameterLabel,
  partText,
  retuneCause,
  sigmaText,
  typicalText,
} from '../lib/measuredBoard';
import { elementName } from '../lib/elements';
import { designVswrLimit } from '../lib/tolerance';
import { useReportJob } from '../store/useJobs';
import { useDesignStore } from '../store/useDesignStore';
import { HelpLink } from './HelpLink';
import { Button } from './ui/Button';

/** A fitted drift within two of its uncertainties of none: not told apart from no drift. */
const significant = (p: FittedParameter): boolean =>
  p.sigma === null || Math.abs(p.drift) >= 2 * p.sigma;

/**
 * Build, Measured board (phase D6): the measured S11 of the built board against the network as
 * built, Fit what moved with its drift table and the checks of the fit, Suggest retune and Apply.
 */
export function MeasuredBoardSection() {
  const design = useDesignStore((s) => s.design);
  const fit = useBoardFit();
  const m = design.measurement;
  const key = useMemo(() => (m ? boardKey(design) : null), [design, m]);
  const cmp = useMemo(() => boardComparison(design), [design]);
  const params = useMemo(() => (m ? driftParameters(boardModel(design)) : []), [design, m]);
  const defaults = useMemo(() => params.filter((p) => p.freeByDefault).map((p) => p.id), [params]);
  const free = new Set(fit.free ?? defaults);
  const band = useMemo(() => boardBand(design), [design]);
  const limit = designVswrLimit(design);
  useReportJob(
    'build',
    fit.running
      ? {
          done: fit.progress?.iteration ?? 0,
          total: 0,
          label: fit.progress
            ? `Fitting, pass ${fit.progress.pass}, iteration ${fit.progress.iteration}`
            : 'Fitting',
        }
      : null,
  );

  if (!m) {
    return (
      <section className="build-section" aria-label="Measured board" data-tour="build.measured">
        <h3 className="build-caption" data-build-section="measured">
          Measured board
        </h3>
        <p className="muted small">
          When the board is built: open its measured S11 (File, Open: .s1p, .s2p, CITI or VNA CSV)
          and choose <strong>Compare with the design</strong>. Then fit what moved and retune here.
        </p>
      </section>
    );
  }

  const outcome = fit.outcome && fit.key === key ? fit.outcome : null;
  const appliedHere = fit.applied?.design === design ? fit.applied : null;
  const stale = fit.outcome !== null && fit.key !== key && !appliedHere;
  const ticked = outcome !== null && ticksChanged(defaults);
  const retune = fit.retune && fit.retuneKey === key ? fit.retune : null;
  const labelOf = (id: string): string => {
    const p = params.find((q) => q.id === id);
    return p ? parameterLabel(design, p) : id;
  };
  const shown = outcome?.ok ? outcome.fit.parameters : [];
  const verdict = outcome?.ok ? fitVerdict(design, outcome.fit) : null;
  const suggestion = retune?.suggestion ?? null;
  const firstEl = retune?.first !== null && retune ? design.elements[retune.first] : undefined;
  const lo = Math.min(...band);
  const hi = Math.max(...band);
  const coverage = cmp ? coverageNote(design, cmp) : null;
  // After an Apply the design compensates the board's drift: its value without drift says nothing.
  const misses = !appliedHere && designMisses(design, cmp);
  const cause = retune ? retuneCause(design, retune) : null;

  return (
    <section
      className="build-section measured-board"
      aria-label="Measured board"
      data-tour="build.measured"
    >
      <h3 className="build-caption" data-build-section="measured">
        Measured board
        <HelpLink section="measure-and-retune" topic="measure and retune" />
      </h3>
      <p className="small">
        <strong>{m.name}</strong>: {m.points.length} points
        {m.termination !== undefined
          ? `, two-port: S11 with port 2 on ${fmtNum(m.termination, 1)} Ω`
          : ', S11 with the load connected'}
        .{' '}
        <Button
          size="sm"
          variant="quiet"
          onClick={clearMeasurement}
          title="The measurement leaves the design (one step of Undo)"
        >
          Stop comparing
        </Button>
      </p>
      {appliedHere && (
        <p className="small measured-applied" role="note">
          {appliedHere.label}. The measurement is of the board before it: the curves set it against
          the retuned design. Rework the board, measure it and compare again:{' '}
          {expectedText(appliedHere.expected, design)}.
        </p>
      )}
      {cmp && (
        <div className="small measured-compare" data-tour="build.compare">
          {cmp.points.length === 0 ? (
            <span className="warn-text">
              No measured frequency lies where the design&apos;s load is known.
            </span>
          ) : (
            <>
              |ΔΓ| measured against the network as built: RMS {fmtNum(cmp.rmsDelta, 4)}, worst{' '}
              {fmtNum(cmp.worstDelta, 4)} at {fmtFrequency(cmp.worstDeltaAt)}.
              {cmp.designedWorst && (
                <>
                  {' '}
                  Worst VSWR from {fmtFrequency(lo)} to {fmtFrequency(hi)}: measured{' '}
                  {cmp.measuredWorst ? (
                    <strong className={cmp.measuredWorst.vswr > limit ? 'warn-text' : ''}>
                      {fmtNum(cmp.measuredWorst.vswr, 3)}
                    </strong>
                  ) : (
                    <span className="muted">{measuredWorstText(cmp)}</span>
                  )}
                  , designed{' '}
                  <strong className={misses ? 'warn-text' : ''}>
                    {fmtNum(cmp.designedWorst.vswr, 3)}
                  </strong>{' '}
                  (target {fmtSig(limit)}).
                </>
              )}
              {cmp.leftOut > 0 && ` ${cmp.leftOut} points outside the load's data are left out.`}
              {misses && (
                <span className="warn-text" role="note">
                  {' '}
                  The design as built misses the target before any drift: a retune would correct the
                  design as well as the board.
                </span>
              )}
              {coverage && (
                <span className="warn-text" role="note">
                  {' '}
                  {coverage}
                </span>
              )}
            </>
          )}
        </div>
      )}
      <details className="measured-params">
        <summary className="small">
          Parameters to fit ({free.size} of {params.length})
        </summary>
        <div className="measured-param-list">
          {params.map((p) => {
            const nominal = nominalText(p, design);
            return (
              <label key={p.id} className="small">
                <input
                  type="checkbox"
                  checked={free.has(p.id)}
                  onChange={(e) => setFitFree(p.id, e.target.checked, defaults)}
                  disabled={fit.running}
                />{' '}
                {parameterLabel(design, p)}{' '}
                <span className="muted">
                  ({nominal ? `${nominal}, ` : ''}typical drift {typicalText(p)})
                </span>
              </label>
            );
          })}
        </div>
      </details>
      <div className="actions">
        {fit.running ? (
          <>
            <Button onClick={stopBoardFit}>Stop</Button>
            <span className="muted small" role="status">
              Fitting
              {fit.progress
                ? `: pass ${fit.progress.pass}, iteration ${fit.progress.iteration}, |ΔΓ| RMS ${fmtNum(fit.progress.rms, 4)}`
                : ''}
            </span>
          </>
        ) : (
          <Button
            onClick={runBoardFit}
            disabled={cmp === null || cmp.points.length === 0}
            data-tour="build.fit"
            title="Least squares over the chosen part values and board parameters, weighted by their typical drifts; parameters this data cannot tell apart are fixed and named"
          >
            {outcome ? 'Fit again' : 'Fit what moved'}
          </Button>
        )}
      </div>
      {stale && !fit.running && (
        <p className="muted small">
          The design changed since the last fit: fit again to see what moved.
        </p>
      )}
      {ticked && !fit.running && (
        <p className="muted small">
          The parameters to fit changed since this fit: the table is of the earlier choice. Fit
          again.
        </p>
      )}
      {outcome && !outcome.ok && <p className="small warn-text">Fit refused: {outcome.reason}.</p>}
      {outcome?.ok && (
        <div data-tour="build.drift">
          <table className="fit-table measured-drift">
            <thead>
              <tr>
                <th>What moved</th>
                <th>Nominal</th>
                <th>Drift</th>
                <th title="One standard uncertainty, from the Jacobian and the residual">±</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((p) => {
                const sig = p.status === 'fitted' && significant(p);
                const odd = verdict?.level === 'untrusted' && p.status === 'fitted';
                return (
                  <tr key={p.id} className={sig ? '' : 'muted'}>
                    <td>{parameterLabel(design, p)}</td>
                    <td>{nominalText(p, design) ?? ''}</td>
                    {p.status === 'fitted' ? (
                      <>
                        <td className={odd ? 'warn-text' : ''}>
                          {driftText(p, p.drift, p.sigma)}
                          {!sig && <span className="muted"> (not significant: within 2σ)</span>}
                          {p.partner && (
                            <span
                              className="muted"
                              title={`The two estimates move together: their combined effect is better known than each`}
                            >
                              {' '}
                              (correlation {fmtNum(p.correlation ?? 0, 2)} with {labelOf(p.partner)}
                              )
                            </span>
                          )}
                        </td>
                        <td>{p.sigma !== null ? sigmaText(p, p.sigma) : ''}</td>
                      </>
                    ) : (
                      <td colSpan={2}>{notFittedText(p, labelOf)}</td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="muted small">
            |ΔΓ| RMS {fmtNum(outcome.fit.rmsBefore, 4)} before, {fmtNum(outcome.fit.rmsAfter, 4)}{' '}
            after the fit, over {outcome.fit.used} frequencies
            {Number.isFinite(outcome.fit.check.noiseFloor)
              ? `; noise floor of the measurement ${fmtSig(outcome.fit.check.noiseFloor, 2)}`
              : ''}
            ; condition {fmtNum(outcome.fit.condition, 1)}.
          </p>
          {verdict && (
            <p
              className={`small measured-verdict ${verdict.level === 'ok' ? 'muted' : 'warn-text'}`}
              role={verdict.level === 'ok' ? undefined : 'alert'}
              data-verdict={verdict.level}
            >
              {verdict.text}
            </p>
          )}
        </div>
      )}
      <div className="actions">
        <Button
          onClick={() => runRetune()}
          disabled={fit.running || cmp === null}
          data-tour="build.retune"
          title={`The part values, snapped to ${design.realize.series === 'library' ? 'the part library' : design.realize.series === 'stock' ? 'your stock' : design.realize.series}, that bring the built board as fitted back inside VSWR ${fmtSig(limit)}, judged where the board was measured`}
        >
          Suggest retune
        </Button>
        {suggestion && suggestion.changes.length > 0 && (
          <Button
            variant="primary"
            onClick={applyRetune}
            data-tour="build.apply-fit"
            title="Change the parts as suggested, as one step of Undo"
          >
            Apply retune
          </Button>
        )}
      </div>
      {retune && (
        <div className="small measured-retune" data-tour="build.retune.result">
          {retune.refused ? (
            <span className="warn-text">Retune refused: {retune.refused}.</span>
          ) : suggestion && suggestion.changes.length === 0 && suggestion.inside ? (
            <span>
              The board is inside the target already (worst VSWR {fmtNum(retune.before.vswr, 3)}{' '}
              against {fmtSig(limit)}): no change needed.
            </span>
          ) : !suggestion || suggestion.changes.length === 0 ? (
            <span>
              No change of the parts in reach does better than the board as built (worst VSWR{' '}
              {fmtNum(retune.before.vswr, 3)}).
            </span>
          ) : (
            <>
              <ul>
                {suggestion.changes.map((c) => {
                  const el = design.elements[c.index];
                  return (
                    <li key={c.index}>
                      {el ? `${elementName(el)} ${c.index + 1}` : 'A part'}: {partText(c.from)} to{' '}
                      <strong>{partText(c.to)}</strong>
                    </li>
                  );
                })}
              </ul>
              Expected worst VSWR {fmtNum(suggestion.worst.vswr, 3)} at{' '}
              {fmtFrequency(suggestion.worst.frequency)}, was {fmtNum(retune.before.vswr, 3)}:{' '}
              {suggestion.inside ? 'inside' : 'still outside'} the target of {fmtSig(limit)}
              {outcome?.ok ? '' : ' (no fit yet: the board as designed)'}.
              {firstEl && retune.single?.inside && suggestion.changes.length === 1 ? (
                <>
                  {' '}
                  One change is enough: change {elementName(firstEl)} {(retune.first ?? 0) + 1}.
                </>
              ) : firstEl && suggestion.changes.length > 1 ? (
                <>
                  {' '}
                  Change {elementName(firstEl)} {(retune.first ?? 0) + 1} first: it helps most
                  alone.
                </>
              ) : null}
            </>
          )}
          {!retune.refused && retune.bandOutside > 0 && retune.judged.length > 0 && (
            <span className="warn-text">
              {' '}
              Judged from {fmtFrequency(Math.min(...retune.judged))} to{' '}
              {fmtFrequency(Math.max(...retune.judged))} only, where the board was measured.
            </span>
          )}
          {!retune.refused && cause && (
            <span className={retune.designMisses ? 'warn-text' : 'muted'}> {cause}</span>
          )}
          {!retune.refused && verdict?.level === 'caution' && (
            <span className="warn-text">
              {' '}
              The fit leaves more than noise: check the result on the bench before trusting it.
            </span>
          )}
        </div>
      )}
    </section>
  );
}
