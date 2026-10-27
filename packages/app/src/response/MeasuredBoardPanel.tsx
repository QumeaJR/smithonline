import { cabs, type Complex } from '@smithonline/core';
import { useMemo, useState } from 'react';
import { currentFit, expectedText, useBoardFit } from '../lib/boardFit';
import { fmtFrequency, fmtNum, fmtSig, NO_VALUE } from '../lib/format';
import {
  boardBand,
  boardComparison,
  boardKey,
  coverageNote,
  expectedAfter,
  fittedGammas,
  fitVerdict,
  measuredWorstText,
} from '../lib/measuredBoard';
import { designVswrLimit } from '../lib/tolerance';
import { useDesignStore } from '../store/useDesignStore';
import { Plot, type PlotAxis, type PlotSeries } from './Plot';
import { useThemeToken } from './useThemeToken';

/** The measured board's palette, from the tokens the chart uses (index.css, --board-*). */
function boardColors(): Record<'measured' | 'designed' | 'fitted' | 'after' | 'delta', string> {
  const style = typeof document !== 'undefined' ? getComputedStyle(document.documentElement) : null;
  const read = (name: string, fallback: string): string =>
    style?.getPropertyValue(name).trim() || fallback;
  return {
    measured: read('--board-measured', '#1b1f24'),
    designed: read('--board-designed', '#5c6670'),
    fitted: read('--board-fitted', '#0b7285'),
    after: read('--board-after', '#8a6d00'),
    delta: read('--board-delta', '#d9480f'),
  };
}

const db = (g: Complex): number => 20 * Math.log10(Math.max(cabs(g), 1e-6));
const dbText = (v: number | undefined): string =>
  v === undefined || !Number.isFinite(v) ? NO_VALUE : `${fmtNum(v, 2)} dB`;

const DB_AXIS: PlotAxis = {
  format: (v) => `${v}`,
  unit: 'dB',
  range: (min, max) => [Math.max(min, -60), Math.max(max, 0.5)],
};
const DELTA_AXIS: PlotAxis = {
  format: (v) => `${v}`,
  range: (_min, max) => [0, Math.max(0.05, max)],
};

/**
 * The measured board in the Response view (phase D6): |S11| as measured and as designed (the
 * network as built), with the fitted model and the result expected after a retune when there
 * are, and |ΔΓ| between measured and designed on the right axis, at the measured frequencies.
 * The measured curve is drawn last, on top; the cursor reads every curve.
 */
export function MeasuredBoardPanel({ logX }: { readonly logX: boolean }) {
  const design = useDesignStore((s) => s.design);
  const fitState = useBoardFit();
  const themeToken = useThemeToken();
  const [cursor, setCursor] = useState<number | null>(null);
  const cmp = useMemo(() => boardComparison(design), [design]);
  const key = useMemo(() => (design.measurement ? boardKey(design) : null), [design]);
  const fit = fitState.key === key ? currentFit(design) : null;
  const drifts = fit?.ok ? fit.fit.drifts : null;
  const retune = fitState.retuneKey === key ? fitState.retune : null;
  // A few hundred points each: computed on render (the React Compiler keeps what it can).
  const changes = retune?.suggestion?.changes ?? [];
  const fitted = cmp && drifts ? fittedGammas(design, drifts) : null;
  const after = cmp && changes.length > 0 ? expectedAfter(design, drifts ?? {}, changes) : null;
  // Read on every render: the theme token re-renders the panel when the theme changes.
  const colors = boardColors();
  if (!design.measurement || !cmp) return null;
  const xs = cmp.points.map((p) => p.frequency);
  const measured = cmp.points.map((p) => db(p.measured));
  const designed = cmp.points.map((p) => db(p.designed));
  const fittedDb = fitted ? fitted.map(db) : null;
  const afterDb = after ? after.map(db) : null;
  const fmt = (v: number): string => `${fmtNum(v, 2)} dB`;
  const series: PlotSeries[] = [
    {
      label: '|S11| designed',
      color: colors.designed,
      values: designed,
      dash: [8, 4],
      format: fmt,
    },
    ...(afterDb
      ? [
          {
            label: '|S11| after retune',
            color: colors.after,
            values: afterDb,
            dash: [6, 2, 1, 2],
            width: 1.8,
            format: fmt,
          },
        ]
      : []),
    ...(fittedDb
      ? [{ label: '|S11| fitted', color: colors.fitted, values: fittedDb, width: 1, format: fmt }]
      : []),
    { label: '|S11| measured', color: colors.measured, values: measured, width: 2, format: fmt },
    {
      label: '|ΔΓ|',
      color: colors.delta,
      values: cmp.points.map((p) => p.delta),
      scale: 'd',
      width: 1,
      format: (v) => fmtNum(v, 4),
    },
  ];
  const legend: { label: string; color: string; style: string }[] = [
    { label: 'measured', color: colors.measured, style: 'solid thick' },
    { label: 'designed', color: colors.designed, style: 'dashed' },
    ...(fittedDb ? [{ label: 'fitted', color: colors.fitted, style: 'solid thin' }] : []),
    ...(afterDb ? [{ label: 'after retune', color: colors.after, style: 'dashed' }] : []),
    { label: '|ΔΓ|', color: colors.delta, style: 'solid thin' },
  ];
  const band = boardBand(design);
  const limit = designVswrLimit(design);
  const i = cursor;
  const at = i !== null ? cmp.points[i] : undefined;
  const verdict = fit?.ok ? fitVerdict(design, fit.fit) : null;
  const coverage = coverageNote(design, cmp);
  return (
    <section className="panel measured-board-panel" data-tour="response.measured">
      <h3>
        Measured board: |S11|, dB, and |ΔΓ|
        {legend.map((s) => (
          <span className="legend" key={s.label}>
            <span className={`sw board-sw ${s.style}`} style={{ borderColor: s.color }} />
            {s.label}
          </span>
        ))}
      </h3>
      <p className="muted small">
        {design.measurement.name}: |ΔΓ| worst {fmtNum(cmp.worstDelta, 4)} at{' '}
        {Number.isFinite(cmp.worstDeltaAt) ? fmtFrequency(cmp.worstDeltaAt) : NO_VALUE}, RMS{' '}
        {fmtNum(cmp.rmsDelta, 4)}.{' '}
        {cmp.designedWorst
          ? `Worst VSWR from ${fmtFrequency(Math.min(...band))} to ${fmtFrequency(Math.max(...band))}: measured ${measuredWorstText(cmp)}, designed ${fmtNum(cmp.designedWorst.vswr, 3)}, target ${fmtSig(limit)}.`
          : ''}
        {retune?.suggestion && retune.suggestion.changes.length > 0
          ? ` After the suggested retune: ${fmtNum(retune.suggestion.worst.vswr, 3)} expected.`
          : ''}
      </p>
      {fitState.applied?.design === design && (
        <p className="small measured-applied" role="note">
          {fitState.applied.label}: the measurement is of the board before it, and designed is now
          the retuned design with no drift. Rework the board, measure it and compare again:{' '}
          {expectedText(fitState.applied.expected, design)}.
        </p>
      )}
      {(coverage || (verdict && verdict.level !== 'ok')) && (
        <p className="small warn-text" role="note">
          {[coverage, verdict && verdict.level !== 'ok' ? verdict.text : null]
            .filter(Boolean)
            .join(' ')}
        </p>
      )}
      <p className="muted small measured-cursor" aria-live="polite">
        {at && i !== null
          ? `${fmtFrequency(at.frequency)}: measured ${dbText(measured[i])}, designed ${dbText(designed[i])}${fittedDb ? `, fitted ${dbText(fittedDb[i])}` : ''}${afterDb ? `, after retune ${dbText(afterDb[i])}` : ''}, |ΔΓ| ${fmtNum(at.delta, 4)}`
          : 'Move over the plot to read every curve at one frequency.'}
      </p>
      <Plot
        xs={xs}
        series={series}
        logX={logX}
        left={DB_AXIS}
        right={DELTA_AXIS}
        markers={[]}
        designFrequency={design.frequency}
        themeToken={themeToken}
        onCursor={setCursor}
        onClick={() => undefined}
      />
    </section>
  );
}
