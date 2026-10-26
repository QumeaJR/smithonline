import { cabs, type Complex } from '@smithonline/core';
import { useMemo, useState } from 'react';
import { currentFit, useBoardFit } from '../lib/boardFit';
import { fmtFrequency, fmtNum, fmtSig, NO_VALUE } from '../lib/format';
import { boardBand, boardComparison, boardKey, expectedAfter } from '../lib/measuredBoard';
import { designVswrLimit } from '../lib/tolerance';
import { useDesignStore } from '../store/useDesignStore';
import { Plot, type PlotAxis, type PlotSeries } from './Plot';
import { useThemeToken } from './useThemeToken';

const COLORS = {
  measured: '#d6336c',
  designed: '#1c7ed6',
  fitted: '#7048e8',
  retuned: '#2f9e44',
  delta: '#f08c00',
};

const db = (g: Complex): number => 20 * Math.log10(Math.max(cabs(g), 1e-6));

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
  const fitted = useMemo(() => {
    if (!cmp || !drifts) return null;
    return expectedAfter(design, drifts, []);
  }, [cmp, design, drifts]);
  const after = useMemo(() => {
    const changes = retune?.suggestion?.changes ?? [];
    if (!cmp || changes.length === 0) return null;
    return expectedAfter(design, drifts ?? {}, changes);
  }, [cmp, design, drifts, retune]);
  if (!design.measurement || !cmp) return null;
  const xs = cmp.points.map((p) => p.frequency);
  const series: PlotSeries[] = [
    {
      label: '|S11| measured',
      color: COLORS.measured,
      values: cmp.points.map((p) => db(p.measured)),
      format: (v) => `${fmtNum(v, 2)} dB`,
    },
    {
      label: '|S11| designed',
      color: COLORS.designed,
      values: cmp.points.map((p) => db(p.designed)),
      dash: [1, 4],
      format: (v) => `${fmtNum(v, 2)} dB`,
    },
    ...(fitted
      ? [
          {
            label: '|S11| fitted',
            color: COLORS.fitted,
            values: fitted.map(db),
            dash: [6, 3],
            format: (v: number) => `${fmtNum(v, 2)} dB`,
          },
        ]
      : []),
    ...(after
      ? [
          {
            label: '|S11| after retune',
            color: COLORS.retuned,
            values: after.map(db),
            dash: [8, 4],
            format: (v: number) => `${fmtNum(v, 2)} dB`,
          },
        ]
      : []),
    {
      label: '|ΔΓ|',
      color: COLORS.delta,
      values: cmp.points.map((p) => p.delta),
      scale: 'd',
      format: (v) => fmtNum(v, 4),
    },
  ];
  const band = boardBand(design);
  const limit = designVswrLimit(design);
  const at = cursor !== null ? cmp.points[cursor] : undefined;
  return (
    <section className="panel measured-board-panel" data-tour="response.measured">
      <h3>
        Measured board: |S11|, dB, and |ΔΓ|
        {series.map((s) => (
          <span className="legend" key={s.label}>
            <span
              className={`sw${s.dash ? (s.dash[0] === 1 ? ' dotted' : ' dashed') : ''}`}
              style={s.dash ? { borderColor: s.color } : { background: s.color }}
            />
            {s.label.replace('|S11| ', '')}
          </span>
        ))}
      </h3>
      <p className="muted small">
        {design.measurement.name}: |ΔΓ| worst {fmtNum(cmp.worstDelta, 4)} at{' '}
        {Number.isFinite(cmp.worstDeltaAt) ? fmtFrequency(cmp.worstDeltaAt) : NO_VALUE}, RMS{' '}
        {fmtNum(cmp.rmsDelta, 4)}.{' '}
        {cmp.measuredWorst && cmp.designedWorst
          ? `Worst VSWR from ${fmtFrequency(Math.min(...band))} to ${fmtFrequency(Math.max(...band))}: measured ${fmtNum(cmp.measuredWorst.vswr, 3)}, designed ${fmtNum(cmp.designedWorst.vswr, 3)}, target ${fmtSig(limit)}.`
          : ''}
        {retune?.suggestion && retune.suggestion.changes.length > 0
          ? ` After the suggested retune: ${fmtNum(retune.suggestion.worst.vswr, 3)} expected.`
          : ''}
        {at ? ` Cursor ${fmtFrequency(at.frequency)}: |ΔΓ| ${fmtNum(at.delta, 4)}.` : ''}
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
