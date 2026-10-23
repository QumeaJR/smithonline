/**
 * The S-Plot view (Smith V4.1 "S-Plot mode"): file list, graphs with a shared
 * cursor and markers, readout table, s11 and s22 on a Smith chart, s12 and
 * s21 on a polar plot, and the gain table.
 */
import { useMemo } from 'react';
import { fmtDeg, fmtFrequency, fmtNum } from '../lib/format';
import { alignToGrid, analysisOf, nearestIndex, unionGrid, type SPlotAnalysis } from '../lib/splot';
import { MAX_MARKERS, useDesignStore } from '../store/useDesignStore';
import { activeEntry, useSPlotStore, type TraceKey } from '../store/useSPlotStore';
import { Plot, type PlotAxis, type PlotSeries } from '../response/Plot';
import { useThemeToken } from '../response/useThemeToken';
import { FilePanel } from './FilePanel';
import { GainTable } from './GainTable';
import { PolarLocus, SmithLocus, type LocusFile } from './Locus';
import { curveStyle, QUANTITY_COLORS, QUANTITY_LABELS, type Quantity } from './style';

const TRACE_KEYS: readonly TraceKey[] = ['s11', 's21', 's12', 's22'];

const DB_AXIS: PlotAxis = {
  format: (v) => `${v}`,
  range: (min, max) => [Math.max(min, -100), Math.min(Math.max(max, 0.5), 100)],
};
const PHASE_AXIS: PlotAxis = { format: (v) => `${v}°`, range: () => [-180, 180] };
const RL_AXIS: PlotAxis = {
  format: (v) => `${v}`,
  range: (min, max) => [Math.max(Math.min(min, 0), -20), Math.min(Math.max(max, 1), 80)],
};
const K_AXIS: PlotAxis = {
  format: (v) => `${v}`,
  range: (min, max) => [Math.min(Math.max(min, -5), 0), Math.min(Math.max(max, 2), 10)],
};

interface Panel {
  readonly key: string;
  readonly title: string;
  readonly left: PlotAxis;
  readonly series: readonly PlotSeries[];
}

type Shown = LocusFile;

interface LegendItem {
  readonly label: string;
  readonly color: string;
  readonly dash?: readonly number[] | undefined;
}

/**
 * One file on screen: a swatch per curve. Several files: a swatch per file and
 * one dash sample per quantity, instead of a long label for every curve.
 */
function legendOf(series: readonly PlotSeries[], shown: readonly Shown[]): LegendItem[] {
  if (shown.length < 2) return series.map((s) => ({ label: s.label, color: s.color }));
  const items: LegendItem[] = [];
  const seen = new Set<string>();
  const owner = (s: PlotSeries): Shown | undefined =>
    shown.find((f) => s.label.endsWith(` ${f.entry.id}`));
  for (const f of shown) {
    if (series.some((s) => owner(s) === f)) {
      items.push({ label: f.entry.fileName, color: f.entry.color });
    }
  }
  for (const s of series) {
    const f = owner(s);
    const q = f ? s.label.slice(0, -(f.entry.id.length + 1)) : s.label;
    if (seen.has(q)) continue;
    seen.add(q);
    items.push({ label: q, color: 'var(--muted)', dash: s.dash });
  }
  return items;
}

/** MSG is drawn where K < 1 and one point into the stable region, so the two gain curves meet. */
function msgWhereUnstable(a: SPlotAnalysis): (number | null)[] | null {
  if (!a.msgDb || !a.k) return null;
  const k = a.k;
  return a.msgDb.map((v, i) =>
    (k[i] as number) < 1 || (k[i - 1] ?? 2) < 1 || (k[i + 1] ?? 2) < 1 ? v : null,
  );
}

function buildPanels(
  shown: readonly Shown[],
  grid: readonly number[],
  traces: Readonly<Record<TraceKey, boolean>>,
): Panel[] {
  const multi = shown.length > 1;
  const series = (
    file: Shown,
    q: Quantity,
    label: string,
    values: readonly (number | null)[] | null,
  ): PlotSeries[] => {
    if (!values) return [];
    const style = curveStyle(q, file.entry, multi);
    return [
      {
        label: multi ? `${label} ${file.entry.id}` : label,
        color: style.color,
        values: alignToGrid(
          grid,
          file.analysis.frequency,
          values.map((v) => v ?? NaN),
        ),
        ...(style.dash ? { dash: style.dash } : {}),
      },
    ];
  };
  const perTrace = (
    pick: (a: SPlotAnalysis, k: TraceKey) => readonly number[] | null,
    label: (k: TraceKey) => string,
  ): PlotSeries[] =>
    shown.flatMap((f) =>
      TRACE_KEYS.filter((k) => traces[k]).flatMap((k) =>
        series(f, k, label(k), pick(f.analysis, k)),
      ),
    );
  const perFile = (fn: (f: Shown) => PlotSeries[]): PlotSeries[] => shown.flatMap((f) => fn(f));

  const panels: Panel[] = [
    {
      key: 'mag',
      title: 'Magnitude, dB',
      left: DB_AXIS,
      series: perTrace(
        (a, k) => a.db[k],
        (k) => `|${QUANTITY_LABELS[k]}|`,
      ),
    },
    {
      key: 'phase',
      title: 'Phase, degrees',
      left: PHASE_AXIS,
      series: perTrace(
        (a, k) => a.phase[k],
        (k) => `∠${QUANTITY_LABELS[k]}`,
      ),
    },
    {
      key: 'rl',
      title: 'Return loss, dB',
      left: RL_AXIS,
      series: perFile((f) => [
        ...(traces.s11 ? series(f, 's11', 'RL s11', f.analysis.returnLoss1) : []),
        ...(traces.s22 ? series(f, 's22', 'RL s22', f.analysis.returnLoss2) : []),
      ]),
    },
    {
      key: 'gain',
      title: 'Gain, dB: MAG where K > 1, MSG where K < 1',
      left: DB_AXIS,
      series: perFile((f) => [
        ...series(f, 'mag', 'MAG', f.analysis.magDb),
        ...series(f, 'msg', 'MSG', msgWhereUnstable(f.analysis)),
      ]),
    },
    {
      key: 'k',
      title: 'Stability, K and μ',
      left: K_AXIS,
      series: perFile((f) => [
        ...series(f, 'k', 'K', f.analysis.k),
        ...series(f, 'mu', 'μ', f.analysis.mu),
      ]),
    },
  ];
  return panels.filter((p) => p.series.length > 0);
}

interface ReadoutRow {
  readonly label: string;
  readonly color: string;
  readonly value: (a: SPlotAnalysis, i: number) => string | null;
}

const dbText = (v: number | undefined | null): string | null =>
  v === undefined || v === null || Number.isNaN(v) ? null : `${fmtNum(v, 2)} dB`;
const numText = (v: number | undefined | null): string | null =>
  v === undefined || v === null || Number.isNaN(v) ? null : Number.isFinite(v) ? fmtNum(v, 3) : '∞';

function readoutRows(): ReadoutRow[] {
  const rows: ReadoutRow[] = [];
  for (const k of TRACE_KEYS) {
    const name = QUANTITY_LABELS[k];
    rows.push({
      label: `|${name}|`,
      color: QUANTITY_COLORS[k],
      value: (a, i) => dbText(a.db[k]?.[i]),
    });
    rows.push({
      label: `∠${name}`,
      color: QUANTITY_COLORS[k],
      value: (a, i) => {
        const v = a.phase[k]?.[i];
        return v === undefined ? null : fmtDeg(v, 1);
      },
    });
  }
  rows.push(
    { label: 'RL s11', color: QUANTITY_COLORS.s11, value: (a, i) => dbText(a.returnLoss1[i]) },
    { label: 'RL s22', color: QUANTITY_COLORS.s22, value: (a, i) => dbText(a.returnLoss2?.[i]) },
    { label: 'K', color: QUANTITY_COLORS.k, value: (a, i) => numText(a.k?.[i]) },
    { label: 'μ', color: QUANTITY_COLORS.mu, value: (a, i) => numText(a.mu?.[i]) },
    { label: 'MAG', color: QUANTITY_COLORS.mag, value: (a, i) => dbText(a.magDb?.[i]) },
    { label: 'MSG', color: QUANTITY_COLORS.msg, value: (a, i) => dbText(a.msgDb?.[i]) },
  );
  return rows;
}
const READOUT_ROWS = readoutRows();

export function SPlotView() {
  const files = useSPlotStore((s) => s.files);
  const activeId = useSPlotStore((s) => s.activeId);
  const traces = useSPlotStore((s) => s.traces);
  const logX = useSPlotStore((s) => s.logX);
  const selected = useSPlotStore((s) => s.selected);
  const cursor = useSPlotStore((s) => s.cursor);
  const markers = useDesignStore((s) => s.response.markers);
  const designFrequency = useDesignStore((s) => s.design.frequency);
  const { setCursor, select } = useSPlotStore.getState();
  const { addMarker, removeMarker, setResponse } = useDesignStore.getState();
  const themeToken = useThemeToken();

  const entry = activeEntry({ files, activeId });
  const shown = useMemo<Shown[]>(
    () => files.filter((f) => f.visible).map((f) => ({ entry: f, analysis: analysisOf(f.data) })),
    [files],
  );
  const grid = useMemo(() => unionGrid(shown.map((f) => f.analysis.frequency)), [shown]);
  const panels = useMemo(() => buildPanels(shown, grid, traces), [shown, grid, traces]);

  const activeFrequencies = entry?.data.points.map((p) => p.frequency) ?? [];
  const selectedFrequency =
    entry && selected !== null ? (entry.data.points[selected]?.frequency ?? null) : null;
  const analysis = entry ? analysisOf(entry.data) : null;

  const columns: { readonly label: string; readonly f: number | null; readonly marker?: number }[] =
    [
      { label: 'Cursor', f: cursor },
      ...markers.map((f, i) => ({ label: `M${i + 1}`, f, marker: i })),
    ];
  if (selectedFrequency !== null) columns.splice(1, 0, { label: 'Row', f: selectedFrequency });

  const rowsToShow = analysis
    ? READOUT_ROWS.filter((r) => r.value(analysis, 0) !== null || analysis.ports >= 2)
    : [];

  return (
    <div className="response splot">
      <div className="response-toolbar">
        <span className="muted small">
          Hover the graphs for a readout, click to set a marker ({markers.length} of {MAX_MARKERS})
          and select the nearest table row. The dotted line is the design frequency.
        </span>
        <span className="spacer" />
        {markers.length > 0 && (
          <button className="btn tiny" onClick={() => setResponse({ markers: [] })}>
            Clear markers
          </button>
        )}
        {selected !== null && (
          <button className="btn tiny" onClick={() => select(null)}>
            Clear row
          </button>
        )}
      </div>
      <div className="splot-body">
        <aside className="splot-files">
          <FilePanel />
        </aside>
        <div className="splot-center">
          {panels.length === 0 ? (
            <p className="hint">
              {files.length === 0
                ? 'Add an S-parameter file in the list on the left to plot it.'
                : 'Nothing to plot: show a file with its checkbox and switch on at least one trace.'}
            </p>
          ) : (
            <div className="plots">
              {panels.map((p) => (
                <section className="panel" key={p.key}>
                  <h3>
                    {p.title}
                    {legendOf(p.series, shown).map((item) => (
                      <span className="legend" key={item.label}>
                        <span
                          className="sw"
                          style={
                            item.dash
                              ? {
                                  background: 'none',
                                  borderTop: `2px dashed ${item.color}`,
                                  height: 0,
                                }
                              : { background: item.color }
                          }
                        />
                        {item.label}
                      </span>
                    ))}
                  </h3>
                  <Plot
                    xs={grid}
                    series={p.series}
                    logX={logX}
                    left={p.left}
                    markers={markers}
                    designFrequency={designFrequency}
                    highlight={selectedFrequency}
                    spanGaps
                    themeToken={themeToken}
                    onCursor={(idx) => {
                      const f = idx === null ? undefined : grid[idx];
                      if (f !== undefined) setCursor(f);
                    }}
                    onClick={(idx) => {
                      const f = grid[idx];
                      if (f === undefined) return;
                      addMarker(f);
                      const near = nearestIndex(activeFrequencies, f);
                      if (near !== null) select(near);
                    }}
                  />
                </section>
              ))}
            </div>
          )}
          {analysis && entry && (
            <table className="readout-table">
              <caption className="muted small">Readout of {entry.fileName}</caption>
              <thead>
                <tr>
                  <th />
                  {columns.map((c) => (
                    <th key={c.label}>
                      {c.label}
                      {c.marker !== undefined && (
                        <button
                          className="btn tiny"
                          onClick={() => removeMarker(c.marker as number)}
                          aria-label={`Remove ${c.label}`}
                          title={`Remove ${c.label}`}
                        >
                          &#215;
                        </button>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>f</td>
                  {columns.map((c) => {
                    const i = c.f === null ? null : nearestIndex(analysis.frequency, c.f);
                    return (
                      <td key={c.label}>
                        {i === null ? '–' : fmtFrequency(analysis.frequency[i] as number)}
                      </td>
                    );
                  })}
                </tr>
                {rowsToShow.map((r) => (
                  <tr key={r.label}>
                    <td>
                      <span className="sw" style={{ background: r.color }} />
                      {r.label}
                    </td>
                    {columns.map((c) => {
                      const i = c.f === null ? null : nearestIndex(analysis.frequency, c.f);
                      const text = i === null ? null : r.value(analysis, i);
                      return <td key={c.label}>{text ?? '–'}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <aside className="splot-right">
          <section className="panel">
            <h3>Smith chart: s11 and s22</h3>
            <SmithLocus
              files={shown}
              traces={traces}
              selected={selectedFrequency}
              cursor={cursor}
            />
          </section>
          <section className="panel">
            <h3>Polar: s21 and s12</h3>
            <PolarLocus
              files={shown}
              traces={traces}
              selected={selectedFrequency}
              cursor={cursor}
            />
          </section>
          <section className="panel gain">
            <h3>Gain table{entry ? `: ${entry.fileName}` : ''}</h3>
            <GainTable entry={entry} />
          </section>
        </aside>
      </div>
    </div>
  );
}
