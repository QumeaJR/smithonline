/**
 * Tolerance analysis over the chart: every part is drawn from its tolerance
 * band N times in a Web Worker, the cloud of input impedances at the design
 * frequency is drawn on the chart, and the panel shows the VSWR histogram and
 * the yield against a VSWR limit.
 */
import type { VswrHistogram } from '@smithonline/core';
import { useEffect, useMemo, useRef, useState } from 'react';
import { elementName } from '../lib/elements';
import { fmtNum } from '../lib/format';
import { startMonteCarlo, type MonteCarloJob } from '../lib/montecarlo';
import {
  bandFrequencies,
  cloudPath,
  defaultToleranceLabel,
  monteCarloOptions,
  toleranceSettings,
} from '../lib/tolerance';
import { realizeDesign, effectiveElements } from '../lib/realize';
import { exportLadderOf } from '../lib/simexport';
import { Progress } from './ui/Progress';
import { useDesignStore } from '../store/useDesignStore';
import { useMonteCarlo } from '../store/useMonteCarlo';
import { ValueInput } from './ValueInput';
import { Badge } from './ui/Badge';
import { Button, IconButton } from './ui/Button';
import { Field } from './ui/Field';
import { IconClose } from './ui/icons';
import { Switch } from './ui/Switch';

interface MonteCarloPanelProps {
  readonly onClose: () => void;
}

export function MonteCarloPanel({ onClose }: MonteCarloPanelProps) {
  const design = useDesignStore((s) => s.design);
  const setTolerance = useDesignStore((s) => s.setTolerance);
  const result = useMonteCarlo((s) => s.result);
  const stale = useMonteCarlo((s) => s.stale);
  const t = toleranceSettings(design);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [perPart, setPerPart] = useState(false);
  const job = useRef<MonteCarloJob | null>(null);
  const ranFor = useRef<unknown>(null);

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
  const defaultLabel = defaultToleranceLabel(design);

  const run = (): void => {
    setError(null);
    setProgress({ done: 0, total: t.runs });
    const realization = realizeDesign(design, effectiveElements(design));
    const ladder = exportLadderOf(design, realization);
    const started = startMonteCarlo({ ladder, options: monteCarloOptions(design) }, (done, total) =>
      setProgress({ done, total }),
    );
    job.current = started;
    ranFor.current = design;
    started.result
      .then((r) => {
        useMonteCarlo.getState().set(r, cloudPath(r.re, r.im, design.z0));
        if (useDesignStore.getState().design !== design) useMonteCarlo.getState().markStale(true);
        useDesignStore
          .getState()
          .setMessage(
            `Tolerance analysis: ${r.runs} runs, yield ${(r.yield * 100).toFixed(1)} % within VSWR ${fmtNum(r.vswrLimit, 2)}`,
          );
      })
      .catch((err: Error) => {
        if (err.message !== 'cancelled') setError(err.message);
      })
      .finally(() => {
        job.current = null;
        setProgress(null);
      });
  };

  const running = progress !== null;
  const setOverride = (id: string, pct: number | null): void => {
    const next = { ...t.overrides };
    if (pct === null) delete next[id];
    else next[id] = pct;
    setTolerance({ overrides: next });
  };

  return (
    <div className="tool-panel mc-panel" onPointerDown={(e) => e.stopPropagation()}>
      <div className="tool-head">
        <strong>Tolerance analysis</strong>
        <span className="muted">Monte Carlo</span>
        <IconButton
          size="sm"
          icon={<IconClose size={13} />}
          label="Close tolerance analysis"
          onClick={onClose}
        />
      </div>
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
          title="Every lumped part gets this unless set per part below; empty takes the tolerance of the active E series"
          value={t.percent ?? 0}
          plain
          min={0}
          suffix="%"
          width="calc(6ch + 8px)"
          onCommit={(v) => setTolerance({ percent: v > 0 ? v : null })}
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
      <div className="row">
        Default tolerance: {defaultLabel}. Locked parts stay exact; lines and transformers vary only
        when given a tolerance below. The network analysed is the one shown (realized values and
        losses included).
      </div>
      <div className="row">
        <Switch
          checked={t.overBand}
          disabled={band.length === 0}
          onChange={(overBand) => setTolerance({ overBand })}
        >
          Judge each run by its worst VSWR over the sweep range
        </Switch>
        {band.length === 0 && <span className="small"> (set a sweep range first)</span>}
      </div>
      <div className="row">
        <Button size="sm" onClick={() => setPerPart(!perPart)} aria-expanded={perPart}>
          {perPart ? 'Hide tolerance per part' : 'Tolerance per part'}
        </Button>
      </div>
      {perPart && (
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
                    plain
                    min={0}
                    width="4em"
                    onCommit={(v) => setOverride(el.id, v)}
                    ariaLabel={`Tolerance of part ${i + 1} in percent`}
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
      {result && !running && (
        <div className="mc-result">
          <div className="row result">
            Yield <strong className="mono">{(result.yield * 100).toFixed(1)} %</strong> (
            {result.passed} of {result.runs} runs within VSWR {fmtNum(result.vswrLimit, 2)}
            {t.overBand && result.worst.length > 0
              ? ' over the sweep range'
              : ' at the design frequency'}
            ){stale ? ' - the design has changed since, run again' : ''}.
          </div>
          <div className="row">
            VSWR at the design frequency: nominal{' '}
            <span className="mono">{fmtNum(result.nominal.vswr, 3)}</span>, median{' '}
            <span className="mono">{fmtNum(result.stats.median, 3)}</span>, 95 % below{' '}
            <span className="mono">{fmtNum(result.stats.p95, 3)}</span>, worst{' '}
            <span className="mono">
              {Number.isFinite(result.stats.max) ? fmtNum(result.stats.max, 3) : 'total reflection'}
            </span>
            .
          </div>
          <Histogram h={result.histogram} limit={result.vswrLimit} />
        </div>
      )}
      <div className="actions">
        {running ? (
          <Button onClick={() => job.current?.cancel()}>Cancel</Button>
        ) : (
          <Button variant="primary" onClick={run} disabled={design.elements.length === 0}>
            {result ? 'Run again' : 'Run'}
          </Button>
        )}
        {result && !running && (
          <Button onClick={() => useMonteCarlo.getState().clear()}>Clear cloud</Button>
        )}
      </div>
    </div>
  );
}

/** Bars of the VSWR distribution with the limit as a dashed line. */
function Histogram({ h, limit }: { readonly h: VswrHistogram; readonly limit: number }) {
  const W = 330;
  const H = 110;
  const left = 4;
  const bottom = 22;
  const top = 6;
  const max = Math.max(1, ...h.counts);
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
