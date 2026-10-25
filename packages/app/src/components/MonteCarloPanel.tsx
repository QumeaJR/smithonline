/**
 * Tolerance analysis over the chart: every part is drawn from its tolerance
 * band N times in a Web Worker, the cloud of input impedances at the design
 * frequency is drawn on the chart, and the panel shows the VSWR histogram and
 * the yield against a VSWR limit with its Wilson interval. D3 adds the
 * correlation of parts from one reel, the ranking of the parts by their share
 * of the spread (live, from the analytic sensitivities), the worst-case corner
 * of each run and design centring.
 */
import type { VswrHistogram } from '@smithonline/core';
import { useEffect, useMemo, useRef, useState } from 'react';
import { elementName } from '../lib/elements';
import { fmtInterval, fmtNum, fmtSig, fmtYield } from '../lib/format';
import { MONTE_CARLO_FAILED, startMonteCarlo, type MonteCarloJob } from '../lib/montecarlo';
import {
  bandFrequencies,
  cloudAnchor,
  cloudPath,
  defaultToleranceLabel,
  defaultTolerancePlaceholder,
  judgedRangeText,
  monteCarloOptions,
  toleranceSettings,
} from '../lib/tolerance';
import { realizeDesign, effectiveElements } from '../lib/realize';
import {
  designLoadInfo,
  hasMeasuredLoad,
  useFitVersion,
  measuredLoadLine,
  measuredPoints,
} from '../lib/measuredLoad';
import { exportLadderOf } from '../lib/simexport';
import { Progress } from './ui/Progress';
import { useDesignStore } from '../store/useDesignStore';
import { useMonteCarlo } from '../store/useMonteCarlo';
import { ValueInput } from './ValueInput';
import { Badge } from './ui/Badge';
import { useJobs, useReportJob } from '../store/useJobs';
import { Button } from './ui/Button';
import { Field } from './ui/Field';
import { Switch } from './ui/Switch';
import { EmptyState } from './ui/EmptyState';
import { StaleNote } from './ui/StaleNote';
import { designSpread, hasCorrelation } from '../lib/sensitivity';
import { CentreSection, CornerLine, SpreadRanking } from './ToleranceDepth';

/** Tolerance analysis; the tool strip (or the phone's sheet) carries its name and close button. */
export function MonteCarloPanel() {
  const design = useDesignStore((s) => s.design);
  const setTolerance = useDesignStore((s) => s.setTolerance);
  const result = useMonteCarlo((s) => s.result);
  const corner = useMonteCarlo((s) => s.corner);
  /** The spread of the worst VSWR over the band, when the runs were judged over one. */
  const bandStats = useMemo(() => (result ? bandSpread(result.worst) : null), [result]);
  const stale = useMonteCarlo((s) => s.stale);
  const t = toleranceSettings(design);
  const [progress, setProgress] = useState<{
    done: number;
    total: number;
    passed: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [perPart, setPerPart] = useState(false);
  const job = useRef<MonteCarloJob | null>(null);
  /** Where the last run was judged (" over the sweep range, ..."), kept with it. */
  const [resultWhere, setResultWhere] = useState('');
  const ranFor = useRef<unknown>(null);
  /**
   * The result of a run started here (the yield line down to the histogram) comes into view
   * in the sheet when it arrives: whole when it fits, else from the yield line down.
   */
  const resultBox = useRef<HTMLDivElement>(null);
  const showResult = useRef(false);

  // A running search stops with the panel, and the cloud goes with it.
  useEffect(
    () => () => {
      job.current?.cancel();
      useMonteCarlo.getState().clear();
    },
    [],
  );
  // The cloud belongs to the design it was drawn for.
  useEffect(() => {
    if (ranFor.current !== null && ranFor.current !== design)
      useMonteCarlo.getState().markStale(true);
  }, [design]);

  const band = useMemo(() => bandFrequencies(design), [design]);
  const fits = useFitVersion();
  // fits: the model arrives from the fitting worker.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const measuredInfo = useMemo(() => designLoadInfo(design), [design, fits]);
  const defaultLabel = defaultToleranceLabel(design);
  // Who causes the spread, live: the analytic sensitivities of the network as analysed.
  // fits: the measured load model arrives from the fitting worker.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const spread = useMemo(() => designSpread(design), [design, fits]);
  const correlation = t.correlation ?? {};
  /** The field refuses values outside 0 to 1 (with a message naming it); 0 is independent. */
  const setCorrelation = (kind: 'L' | 'C' | 'R', r: number): void => {
    const next = { ...correlation, [kind]: r };
    if (!(r > 0)) delete next[kind];
    setTolerance({ correlation: next });
  };
  const where = judgedRangeText(design);

  const run = (): void => {
    setError(null);
    setProgress({ done: 0, total: t.runs, passed: 0 });
    let started: MonteCarloJob;
    try {
      const realization = realizeDesign(design, effectiveElements(design));
      const ladder = exportLadderOf(design, realization);
      // Over the band, a datapoint sweep's measured load is the load (the fixed one at f0).
      const loads = t.overBand && hasMeasuredLoad(design) ? measuredPoints(design) : null;
      started = startMonteCarlo(
        { ladder, options: monteCarloOptions(design), ...(loads ? { loads } : {}) },
        (done, total, passed) => setProgress({ done, total, passed }),
      );
    } catch {
      setProgress(null);
      setError(MONTE_CARLO_FAILED);
      return;
    }
    job.current = started;
    ranFor.current = design;
    setResultWhere(where);
    started.result
      .then(({ result: r, corner: c }) => {
        showResult.current = true;
        useMonteCarlo
          .getState()
          .set(r, cloudPath(r.re, r.im, design.z0), cloudAnchor(r.re, r.im, design.z0), c);
        if (useDesignStore.getState().design !== design) useMonteCarlo.getState().markStale(true);
        const said = `Tolerance analysis: ${r.runs} runs, yield ${fmtYield(r.passed, r.runs)} within VSWR ${fmtSig(r.vswrLimit)}`;
        useDesignStore.getState().setMessage(said);
        // Also for a user on another segment: the Tools entry carries a check dot.
        useJobs.getState().finish('montecarlo', said);
      })
      .catch((err: unknown) => {
        // A short message of the panel's own: a raw exception text means nothing to the user.
        if (!(err instanceof Error && err.message === 'cancelled')) setError(MONTE_CARLO_FAILED);
      })
      .finally(() => {
        job.current = null;
        setProgress(null);
      });
  };

  const running = progress !== null;
  // The result renders once the run has ended (progress cleared), after the result arrives.
  useEffect(() => {
    if (!result || running || !showResult.current) return;
    const box = resultBox.current;
    if (!box) return;
    showResult.current = false;
    if (!box.scrollIntoView) return;
    let scroller: HTMLElement | null = box.parentElement;
    while (scroller && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)) {
      scroller = scroller.parentElement;
    }
    const room = scroller?.clientHeight ?? window.innerHeight;
    box.scrollIntoView({ block: box.offsetHeight <= room ? 'nearest' : 'start' });
  }, [result, running]);
  /** Stop the running analysis: the status line says so. */
  const stop = (): void => {
    if (!job.current) return;
    job.current.cancel();
    useDesignStore.getState().setMessage('Stopped the tolerance analysis');
  };
  useReportJob(
    'montecarlo',
    progress
      ? {
          done: progress.done,
          total: progress.total,
          label:
            progress.done > 0
              ? `Run ${progress.done} of ${progress.total}, yield ${fmtYield(progress.passed, progress.done)}`
              : `Run ${progress.done} of ${progress.total}`,
        }
      : null,
  );
  const setOverride = (id: string, pct: number | null): void => {
    const next = { ...t.overrides };
    if (pct === null) delete next[id];
    else next[id] = pct;
    setTolerance({ overrides: next });
  };

  const head = (
    <div className="tool-head">
      <strong>Tolerance analysis</strong>
      <span className="muted">Monte Carlo</span>
    </div>
  );
  // Without parts the settings stay: Auto match judges its yield by this limit and tolerance.
  const empty = design.elements.length === 0 && !running;
  const realizeOff = !design.realize.enabled && t.percent === null;

  return (
    <div className="tool-panel mc-panel" onPointerDown={(e) => e.stopPropagation()}>
      {head}
      {empty && (
        <EmptyState
          className="mc-empty"
          title="Add parts to analyse"
          line="Each run draws every part from its tolerance band; with no parts in the network there is nothing to vary. The limit and tolerance below also set how Auto match judges the yield of the networks it lists."
          steps={[
            'Add parts from the palette, or with Auto match.',
            'Set a tolerance per part or one for all.',
            'Run: the cloud shows on the chart, the histogram here.',
          ]}
        />
      )}
      <div className="fields">
        <Field
          label="Runs"
          title="Number of random networks"
          value={t.runs}
          plain
          digits={6}
          min={1}
          width="calc(7ch + 8px)"
          onCommit={(v) => setTolerance({ runs: Math.min(100000, Math.max(1, Math.round(v))) })}
          ariaLabel="Number of runs"
        />
        <Field
          label="Seed"
          title="The same seed gives the same cloud"
          value={t.seed}
          plain
          digits={9}
          width="calc(10ch + 8px)"
          onCommit={(v) => setTolerance({ seed: Math.round(v) })}
          ariaLabel="Random seed"
        />
        <label>
          Distribution
          <select
            value={t.distribution}
            aria-label="Distribution"
            onChange={(e) => setTolerance({ distribution: e.target.value as 'uniform' | 'normal' })}
            title="Uniform inside the band, or normal with the band as three standard deviations"
          >
            <option value="uniform">Uniform</option>
            <option value="normal">Normal (band = 3 sigma)</option>
          </select>
        </label>
        <Field
          label="Tolerance"
          title="Every lumped part gets this unless set per part below. Empty takes the tolerance of the series chosen in Realize; 0 keeps every part exact."
          value={t.percent ?? 0}
          empty={t.percent === null}
          placeholder={defaultTolerancePlaceholder(design)}
          onClear={() => setTolerance({ percent: null })}
          plain
          min={0}
          max={100}
          suffix="%"
          width="calc(9ch + 8px)"
          onCommit={(v) => setTolerance({ percent: v })}
          ariaLabel="Default tolerance in percent"
        />
        <Field
          label="VSWR limit"
          value={t.vswrLimit}
          plain
          min={1}
          width="calc(6ch + 8px)"
          onCommit={(v) => setTolerance({ vswrLimit: v })}
          ariaLabel="VSWR limit"
        />
      </div>
      <div className="fields mc-correlation">
        <span className="muted" title="Parts from one reel drift together">
          Reel correlation
        </span>
        <span className="mc-correlation-fields">
          {(['L', 'C', 'R'] as const).map((kind) => (
            <Field
              key={kind}
              label={kind}
              title={`Correlation coefficient between any two ${kind} parts, 0 (independent) to 1 (all drift as one)`}
              value={correlation[kind] ?? 0}
              plain
              digits={3}
              min={0}
              max={1}
              name={`Reel correlation ${kind}`}
              width="calc(5ch + 8px)"
              onCommit={(v) => setCorrelation(kind, v)}
              ariaLabel={`Correlation of the ${kind} parts`}
            />
          ))}
        </span>
      </div>
      <div className="row">
        Default tolerance: {defaultLabel}
        {realizeOff
          ? ' (the series chosen in Realize, which is off; type a tolerance to set your own)'
          : ''}
        . Locked parts stay exact; lines and transformers vary only when given a tolerance below.
        The network analysed is the one shown (realized values and losses included)
        {design.target ? ', judged towards the target' : ''}.
      </div>
      <div className="row">
        <Switch
          checked={t.overBand}
          disabled={band.length === 0}
          onChange={(overBand) => setTolerance({ overBand })}
        >
          {measuredInfo
            ? 'Judge each run by its worst VSWR over the measured band, with the measured load'
            : 'Judge each run by its worst VSWR over the sweep range'}
        </Switch>
        {band.length === 0 && <span className="small"> (set a sweep range first)</span>}
      </div>
      {measuredInfo && t.overBand && (
        <div className="row small muted measured-load-note">
          {measuredLoadLine(measuredInfo, design.sweep.loadsName)}
        </div>
      )}
      {!empty && (
        <div className="row">
          <Button size="sm" onClick={() => setPerPart(!perPart)} aria-expanded={perPart}>
            {perPart ? 'Hide tolerance per part' : 'Tolerance per part'}
          </Button>
        </div>
      )}
      {perPart && !empty && (
        <table className="fit-table mc-parts">
          <tbody>
            {design.elements.map((el, i) => (
              <tr key={el.id}>
                <td>
                  <Badge className="idx" color={el.color}>
                    {i + 1}
                  </Badge>
                </td>
                <td>{elementName(el)}</td>
                <td>
                  <ValueInput
                    value={t.overrides[el.id] ?? 0}
                    empty={t.overrides[el.id] === undefined}
                    placeholder={el.locked ? 'exact' : defaultPlaceholder(el.kind, defaultLabel)}
                    onClear={() => setOverride(el.id, null)}
                    plain
                    min={0}
                    max={100}
                    width="5em"
                    onCommit={(v) => setOverride(el.id, v)}
                    ariaLabel={`Tolerance of part ${i + 1} in percent`}
                    title="Empty takes the default; 0 keeps the part exact"
                  />{' '}
                  %
                </td>
                <td>
                  {t.overrides[el.id] !== undefined ? (
                    <Button size="sm" onClick={() => setOverride(el.id, null)}>
                      Default
                    </Button>
                  ) : (
                    <span className="muted small">{el.locked ? 'locked, exact' : 'default'}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {spread && <SpreadRanking spread={spread} correlated={hasCorrelation(t)} />}
      {progress && (
        <Progress
          className="row"
          ariaLabel="Monte Carlo"
          done={progress.done}
          total={progress.total}
          label={`Running: ${progress.done} of ${progress.total}`}
        />
      )}
      {error && <div className="row danger">{error}</div>}
      {result && !running && stale && (
        // Above the old result, which is dimmed: the stale lines do not read as current.
        <StaleNote onRun={run}>The design has changed since this run.</StaleNote>
      )}
      {result && !running && (
        <div className={`mc-result${stale ? ' stale' : ''}`} ref={resultBox}>
          <div className="row result">
            Yield <strong className="mono">{fmtYield(result.passed, result.runs)}</strong> (
            {result.passed} of {result.runs} runs within VSWR {fmtSig(result.vswrLimit)}
            {resultWhere}; 95 % interval{' '}
            <span className="mono">{fmtInterval(result.interval)}</span>).
          </div>
          {/* Under the yield line, so both fit in the phone's half-height sheet. */}
          <Histogram h={result.histogram} limit={result.vswrLimit} />
          {bandStats ? (
            <>
              <div className="row">
                Worst VSWR over the band: nominal{' '}
                <span className="mono">{fmtStat(result.nominal.worst ?? NaN)}</span>, median{' '}
                <span className="mono">{fmtStat(bandStats.median)}</span>, 95 % below{' '}
                <span className="mono">{fmtStat(bandStats.p95)}</span>, worst{' '}
                <span className="mono">{fmtStat(bandStats.max)}</span>.
              </div>
              <div className="row small muted">
                At the design frequency (the cloud and the histogram): median{' '}
                <span className="mono">{fmtStat(result.stats.median)}</span>, worst{' '}
                <span className="mono">{fmtStat(result.stats.max)}</span>.
              </div>
            </>
          ) : (
            <div className="row">
              VSWR at the design frequency: nominal{' '}
              <span className="mono">{fmtNum(result.nominal.vswr, 3)}</span>, median{' '}
              <span className="mono">{fmtNum(result.stats.median, 3)}</span>, 95 % below{' '}
              <span className="mono">{fmtNum(result.stats.p95, 3)}</span>, worst{' '}
              <span className="mono">{fmtStat(result.stats.max)}</span>.
            </div>
          )}
          {corner && <CornerLine corner={corner} limit={result.vswrLimit} />}
        </div>
      )}
      {!empty && (
        <div className="actions">
          {running ? (
            <Button onClick={stop}>Stop</Button>
          ) : result && stale ? null : (
            // A stale result has its own Run again in the note above: one button, not two.
            <Button variant="primary" onClick={run} disabled={design.elements.length === 0}>
              {result ? 'Run again' : 'Run'}
            </Button>
          )}
          {result && !running && (
            <Button onClick={() => useMonteCarlo.getState().clear()}>Clear cloud</Button>
          )}
        </div>
      )}
      {!empty && <CentreSection design={design} />}
    </div>
  );
}

/** The placeholder of a part's tolerance field: the default it takes ("5 %"), "none" for a line. */
function defaultPlaceholder(kind: string, defaultLabel: string): string {
  if (kind === 'line' || kind === 'openStub' || kind === 'shortStub' || kind === 'transformer')
    return 'none';
  return /^[\d.]+ %/.exec(defaultLabel)?.[0] ?? 'default';
}

/** A VSWR statistic: three digits, "total reflection" when infinite. */
function fmtStat(v: number): string {
  return Number.isFinite(v) ? fmtNum(v, 3) : v === Infinity ? 'total reflection' : '-';
}

/** Median, 95th percentile and largest of the per-run worst VSWR over the band; null without a band. */
function bandSpread(worst: Float64Array): { median: number; p95: number; max: number } | null {
  if (worst.length === 0) return null;
  const sorted = Array.from(worst).sort((a, b) => a - b);
  const at = (q: number): number =>
    sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))] as number;
  return { median: at(0.5), p95: at(0.95), max: sorted[sorted.length - 1] as number };
}

/** Bars of the VSWR distribution with the limit as a dashed line. */
function Histogram({ h, limit }: { readonly h: VswrHistogram; readonly limit: number }) {
  const W = 330;
  const H = 110;
  const left = 4;
  const bottom = 22;
  const top = 6;
  let max = 1;
  for (const c of h.counts) if (c > max) max = c;
  const lo = h.edges[0] as number;
  const hi = h.edges[h.edges.length - 1] as number;
  const x = (v: number): number => left + ((v - lo) / (hi - lo)) * (W - left - 4);
  const barW = (W - left - 4) / h.counts.length;
  const ticks = [lo, (lo + hi) / 2, hi];
  return (
    <svg
      className="mc-histogram"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label="Histogram of the VSWR at the design frequency"
    >
      {h.counts.map((c, i) => {
        const bh = (c / max) * (H - bottom - top);
        const over = (h.edges[i] as number) >= limit;
        return (
          <rect
            key={i}
            x={left + i * barW + 0.5}
            y={H - bottom - bh}
            width={Math.max(1, barW - 1)}
            height={bh}
            className={over ? 'bar over' : 'bar'}
          >
            <title>
              {`VSWR ${fmtNum(h.edges[i] as number, 3)} to ${fmtNum(h.edges[i + 1] as number, 3)}: ${c} runs`}
            </title>
          </rect>
        );
      })}
      {limit >= lo && limit <= hi && (
        <line x1={x(limit)} x2={x(limit)} y1={top} y2={H - bottom} className="limit" />
      )}
      <line x1={left} x2={W - 4} y1={H - bottom} y2={H - bottom} className="axis" />
      {ticks.map((v, i) => (
        <text
          key={i}
          x={x(v)}
          y={H - 8}
          textAnchor={i === 0 ? 'start' : i === 2 ? 'end' : 'middle'}
          className="tick"
        >
          {fmtNum(v, 2)}
          {i === 2 && h.overflow > 0 ? '+' : ''}
        </text>
      ))}
    </svg>
  );
}
