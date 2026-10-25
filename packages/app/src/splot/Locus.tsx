/**
 * The two small charts of the S-Plot view: s11 and s22 as loci on a Smith
 * chart, s12 and s21 on a polar plot. Both mark the selected gain table row
 * and the graph cursor.
 */
import { cabs, type Complex } from '@smithonline/core';
import { gridCircles } from '../chart/grid';
import { nearestIndex, niceLimit, type SPlotAnalysis } from '../lib/splot';
import type { SPlotEntry, TraceKey } from '../store/useSPlotStore';
import { curveStyle } from './style';

export interface LocusFile {
  readonly entry: SPlotEntry;
  readonly analysis: SPlotAnalysis;
}

interface LocusProps {
  readonly files: readonly LocusFile[];
  readonly traces: Readonly<Record<TraceKey, boolean>>;
  /** Frequency of the selected gain table row, Hz. */
  readonly selected: number | null;
  /** Frequency under the graph cursor, Hz. */
  readonly cursor: number | null;
}

interface Trace {
  readonly key: TraceKey;
  readonly file: LocusFile;
  readonly values: readonly Complex[];
}

const finite = (c: Complex): boolean => Number.isFinite(c.re) && Number.isFinite(c.im);

function tracesOf(
  files: readonly LocusFile[],
  keys: readonly TraceKey[],
  on: LocusProps['traces'],
): Trace[] {
  const out: Trace[] = [];
  for (const file of files) {
    for (const key of keys) {
      const values = file.analysis[key];
      // A VNA table without this parameter holds NaN for it: no curve.
      if (on[key] && values && values.some(finite)) out.push({ key, file, values });
    }
  }
  return out;
}

/** Index of the sample at `f` in a trace, only when the file covers f. */
function sampleAt(trace: Trace, f: number | null): number | null {
  if (f === null) return null;
  const freqs = trace.file.analysis.frequency;
  const lo = freqs[0];
  const hi = freqs[freqs.length - 1];
  if (lo === undefined || hi === undefined || f < lo || f > hi) return null;
  return nearestIndex(freqs, f);
}

/** The polyline through the points; a non-finite point breaks it. */
function pathOf(points: readonly Complex[], scale: number): string {
  let move = true;
  let d = '';
  for (const p of points) {
    if (!finite(p)) {
      move = true;
      continue;
    }
    d += `${move ? 'M' : 'L'}${(p.re * scale).toFixed(4)} ${(-p.im * scale).toFixed(4)}`;
    move = false;
  }
  return d;
}

function Curves({
  traces,
  multi,
  scale,
  selected,
  cursor,
}: {
  readonly traces: readonly Trace[];
  readonly multi: boolean;
  readonly scale: number;
  readonly selected: number | null;
  readonly cursor: number | null;
}) {
  return (
    <>
      {traces.map((t) => {
        const style = curveStyle(t.key, t.file.entry, multi);
        const start = t.values.find(finite);
        return (
          <g key={`${t.file.entry.id}-${t.key}`}>
            <path
              d={pathOf(t.values, scale)}
              fill="none"
              stroke={style.color}
              strokeWidth={1.6}
              vectorEffect="non-scaling-stroke"
              {...(style.dash ? { strokeDasharray: style.dash.join(' ') } : {})}
            />
            {start && (
              <circle cx={start.re * scale} cy={-start.im * scale} r={0.02} fill={style.color} />
            )}
          </g>
        );
      })}
      {traces.map((t) => {
        const style = curveStyle(t.key, t.file.entry, multi);
        const dots: { readonly i: number; readonly ring: boolean }[] = [];
        const c = sampleAt(t, cursor);
        const s = sampleAt(t, selected);
        if (c !== null) dots.push({ i: c, ring: false });
        if (s !== null) dots.push({ i: s, ring: true });
        return dots.map((d) => {
          const p = t.values[d.i] as Complex;
          if (!finite(p)) return null;
          return (
            <circle
              key={`${t.file.entry.id}-${t.key}-${d.ring ? 's' : 'c'}`}
              cx={p.re * scale}
              cy={-p.im * scale}
              r={d.ring ? 0.045 : 0.03}
              fill={d.ring ? 'none' : style.color}
              stroke={d.ring ? 'var(--text-primary)' : 'var(--surface)'}
              strokeWidth={d.ring ? 2 : 1}
              vectorEffect="non-scaling-stroke"
            />
          );
        });
      })}
    </>
  );
}

/** s11 and s22 loci on a Smith chart. */
export function SmithLocus({ files, traces, selected, cursor }: LocusProps) {
  const shown = tracesOf(files, ['s11', 's22'], traces);
  const multi = files.length > 1;
  const grid = gridCircles('coarse', 1);
  return (
    <svg
      className="locus"
      viewBox="-1.15 -1.15 2.3 2.3"
      role="img"
      aria-label="s11 and s22 on the Smith chart"
    >
      <defs>
        <clipPath id="splot-smith-clip">
          <circle r={1} />
        </clipPath>
      </defs>
      <g clipPath="url(#splot-smith-clip)" fill="none" stroke="var(--grid-z)" strokeWidth={0.6}>
        {grid.map((c, i) => (
          <circle
            key={i}
            cx={c.cx}
            cy={-c.cy}
            r={c.r}
            vectorEffect="non-scaling-stroke"
            opacity={c.major ? 0.9 : 0.5}
          />
        ))}
        <line x1={-1} x2={1} y1={0} y2={0} vectorEffect="non-scaling-stroke" />
      </g>
      <circle
        r={1}
        fill="none"
        stroke="var(--grid-z)"
        strokeWidth={1.2}
        vectorEffect="non-scaling-stroke"
      />
      <Curves traces={shown} multi={multi} scale={1} selected={selected} cursor={cursor} />
    </svg>
  );
}

/** s21 and s12 on a polar plot scaled to the largest visible magnitude. */
export function PolarLocus({ files, traces, selected, cursor }: LocusProps) {
  const shown = tracesOf(files, ['s21', 's12'], traces);
  const multi = files.length > 1;
  // A loop, not Math.max(...values): a file of 100k points would overflow the call stack.
  let peak = 0;
  for (const t of shown) for (const v of t.values) if (finite(v)) peak = Math.max(peak, cabs(v));
  const limit = niceLimit(peak);
  const scale = 1 / limit;
  const spokes = [0, 30, 60, 90, 120, 150];
  return (
    <svg
      className="locus"
      viewBox="-1.15 -1.15 2.3 2.3"
      role="img"
      aria-label="s21 and s12 on a polar plot"
    >
      <g fill="none" stroke="var(--grid-z)" strokeWidth={0.6}>
        {[0.25, 0.5, 0.75, 1].map((r) => (
          <circle key={r} r={r} vectorEffect="non-scaling-stroke" opacity={r === 1 ? 1 : 0.55} />
        ))}
        {spokes.map((a) => {
          const rad = (a * Math.PI) / 180;
          return (
            <line
              key={a}
              x1={-Math.cos(rad)}
              y1={Math.sin(rad)}
              x2={Math.cos(rad)}
              y2={-Math.sin(rad)}
              vectorEffect="non-scaling-stroke"
              opacity={0.5}
            />
          );
        })}
      </g>
      <g fill="var(--text-secondary)" fontSize={0.07} textAnchor="middle">
        {[0.5, 1].map((r) => (
          <text key={r} x={r} y={0.09}>
            {r * limit}
          </text>
        ))}
        <text x={1.1} y={0.025}>
          0°
        </text>
        <text x={0} y={-1.06}>
          90°
        </text>
        <text x={-1.1} y={0.025}>
          180°
        </text>
        <text x={0} y={1.12}>
          -90°
        </text>
      </g>
      <Curves traces={shown} multi={multi} scale={scale} selected={selected} cursor={cursor} />
    </svg>
  );
}
