/**
 * One uPlot panel of the response view: a frequency axis shared with the
 * other panels through a cursor sync group, one or two y scales, marker lines
 * drawn on top, and a click that reports the nearest sample.
 */
import { formatEngineering } from '@smithonline/core';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';

/** Cursor sync group of the response panels. */
const SYNC_KEY = 'smithonline.response';

export interface PlotSeries {
  readonly label: string;
  readonly color: string;
  readonly values: readonly (number | null)[];
  /** 'y' is the left axis, 'd' the right axis. Default 'y'. */
  readonly scale?: 'y' | 'd';
  readonly dash?: readonly number[];
}

export interface PlotAxis {
  /** Formats one tick value. */
  readonly format: (v: number) => string;
  /** Clamps or widens the auto range from the data extremes. */
  readonly range?: (min: number, max: number) => [number, number];
}

export interface PlotProps {
  readonly xs: readonly number[];
  readonly series: readonly PlotSeries[];
  readonly logX: boolean;
  readonly left: PlotAxis;
  /** Present when a series uses the 'd' scale. */
  readonly right?: PlotAxis | undefined;
  /** Vertical marker lines, Hz, labelled M1, M2 ... in order. */
  readonly markers: readonly number[];
  /** Dotted reference line at the design frequency, Hz. */
  readonly designFrequency: number;
  /**
   * VSWR limit line and the frequency band where the curve stays below it,
   * shaded under the curves. The band is null when there is none.
   */
  readonly vswrBand?: VswrBand | undefined;
  /** Changes whenever the theme does, so the colours are read again. */
  readonly themeToken: number;
  readonly onCursor: (idx: number | null) => void;
  readonly onClick: (idx: number) => void;
}

export interface VswrBand {
  /** The VSWR limit, drawn as a dashed horizontal line. */
  readonly limit: number;
  /** Band edges, Hz; null when VSWR at the design frequency is above the limit. */
  readonly band: { readonly low: number; readonly high: number } | null;
}

interface ThemeColors {
  readonly text: string;
  readonly muted: string;
  readonly border: string;
  readonly marker: string;
  readonly band: string;
}

function themeColors(): ThemeColors {
  const style = getComputedStyle(document.documentElement);
  const read = (name: string, fallback: string): string =>
    style.getPropertyValue(name).trim() || fallback;
  return {
    text: read('--text', '#1b1f24'),
    muted: read('--muted', '#5f6b7a'),
    border: read('--border', '#d9dde3'),
    marker: read('--accent', '#0b6bcb'),
    band: read('--vswr', '#2f9e44'),
  };
}

/** Filtered-out splits arrive as null; they get an empty label. */
function label(format: (v: number) => string): (v: number) => string {
  return (v) => (Number.isFinite(v) ? format(v) : '');
}

/** True for 1, 2 and 5 times a power of ten. */
function isRoundMantissa(v: number): boolean {
  if (!(v > 0)) return false;
  const m = v / 10 ** Math.floor(Math.log10(v));
  return [1, 2, 5].some((k) => Math.abs(m - k) < 1e-6 || Math.abs(m - 10 * k) < 1e-6);
}

function fmtAxisFrequency(v: number): string {
  return formatEngineering(v, { unit: 'Hz', digits: 3 });
}

export function Plot({
  xs,
  series,
  logX,
  left,
  right,
  markers,
  designFrequency,
  vswrBand,
  themeToken,
  onCursor,
  onClick,
}: PlotProps) {
  const host = useRef<HTMLDivElement>(null);
  const plot = useRef<uPlot | null>(null);
  // Live values the uPlot hooks read without rebuilding the chart.
  const live = useRef({ markers, designFrequency, vswrBand, onCursor, onClick, series });
  const data = useMemo(() => toAligned(xs, series), [xs, series]);
  const dataRef = useRef(data);
  useLayoutEffect(() => {
    live.current = { markers, designFrequency, vswrBand, onCursor, onClick, series };
    dataRef.current = data;
  });

  // The chart is built once per axis mode, theme and series shape; data flows through setData.
  const shape = series.map((s) => `${s.label}|${s.color}|${s.scale ?? 'y'}`).join(',');
  useLayoutEffect(() => {
    const el = host.current;
    if (!el) return;
    const colors = themeColors();
    const current = live.current.series;
    const axisBase = {
      stroke: colors.muted,
      font: '11px system-ui, sans-serif',
      grid: { stroke: colors.border, width: 1 },
      ticks: { stroke: colors.border, width: 1 },
    };
    const axes: uPlot.Axis[] = [
      {
        ...axisBase,
        scale: 'x',
        values: (_u, splits) => splits.map(label(fmtAxisFrequency)),
        // A log axis offers a split per integer mantissa; label 1, 2 and 5 only.
        ...(logX
          ? { filter: (_u, splits) => splits.map((v) => (isRoundMantissa(v) ? v : null)) }
          : {}),
        space: 70,
      },
      {
        ...axisBase,
        scale: 'y',
        values: (_u, splits) => splits.map(label(left.format)),
        size: 64,
      },
    ];
    if (right) {
      axes.push({
        ...axisBase,
        scale: 'd',
        side: 1,
        values: (_u, splits) => splits.map(label(right.format)),
        grid: { show: false },
        size: 64,
      });
    }
    const rangeOf =
      (axis: PlotAxis | undefined): uPlot.Scale.Range =>
      (_u, min, max) =>
        axis?.range ? axis.range(min, max) : [min, max];
    const opts: uPlot.Options = {
      width: el.clientWidth || 300,
      height: el.clientHeight || 160,
      legend: { show: false },
      padding: [8, right ? 0 : 12, 0, 0],
      scales: {
        x: { time: false, distr: logX ? 3 : 1, log: 10 },
        y: { range: rangeOf(left) },
        ...(right ? { d: { range: rangeOf(right) } } : {}),
      },
      axes,
      series: [
        {},
        ...current.map((s): uPlot.Series => ({
          label: s.label,
          stroke: s.color,
          width: 1.5,
          scale: s.scale ?? 'y',
          ...(s.dash ? { dash: [...s.dash] } : {}),
          spanGaps: false,
          points: { show: false },
        })),
      ],
      cursor: {
        sync: { key: SYNC_KEY, setSeries: false, scales: ['x', null] },
        drag: { x: false, y: false },
        points: { size: 6 },
        y: false,
      },
      hooks: {
        setCursor: [
          (u) => {
            const idx = u.cursor.idx;
            live.current.onCursor(typeof idx === 'number' ? idx : null);
          },
        ],
        drawAxes: [
          (u) => {
            drawVswrBand(u, live.current.vswrBand, colors);
          },
        ],
        draw: [
          (u) => {
            drawMarkers(u, live.current.markers, live.current.designFrequency, colors);
          },
        ],
      },
    };
    const u = new uPlot(opts, dataRef.current, el);
    plot.current = u;

    // A click (not a drag) in the plotting area reports the sample under the cursor.
    let down: { x: number; y: number } | null = null;
    const onDown = (e: PointerEvent): void => {
      down = { x: e.clientX, y: e.clientY };
    };
    const onUp = (e: PointerEvent): void => {
      if (!down) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      down = null;
      if (moved >= 4) return;
      // From the pointer position, not cursor.idx: uPlot updates that on a debounced move.
      const left = e.clientX - u.over.getBoundingClientRect().left;
      const idx = u.posToIdx(left);
      if (Number.isInteger(idx) && idx >= 0) live.current.onClick(idx);
    };
    u.over.addEventListener('pointerdown', onDown);
    u.over.addEventListener('pointerup', onUp);

    const ro = new ResizeObserver(() => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w > 0 && h > 0) u.setSize({ width: w, height: h });
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      u.over.removeEventListener('pointerdown', onDown);
      u.over.removeEventListener('pointerup', onUp);
      u.destroy();
      plot.current = null;
    };
    // The formats and ranges are stable per panel; the chart rebuilds on the listed keys only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logX, themeToken, shape, Boolean(right)]);

  useEffect(() => {
    plot.current?.setData(data);
  }, [data]);

  useEffect(() => {
    plot.current?.redraw(false, false);
  }, [markers, designFrequency, vswrBand]);

  return <div className="plot-host" ref={host} />;
}

/** uPlot wants one x column and one y column per series, gaps as null. */
function toAligned(xs: readonly number[], series: readonly PlotSeries[]): uPlot.AlignedData {
  return [
    [...xs],
    ...series.map((s) => s.values.map((v) => (v === null || Number.isFinite(v) ? v : null))),
  ];
}

/** The usable band as a shaded column and the limit as a dashed line, under the curves. */
function drawVswrBand(u: uPlot, vswrBand: VswrBand | undefined, colors: ThemeColors): void {
  if (!vswrBand) return;
  const { ctx, bbox } = u;
  const xs = u.scales.x;
  if (!xs || xs.min === undefined || xs.max === undefined) return;
  const pr = uPlot.pxRatio;
  ctx.save();
  ctx.beginPath();
  ctx.rect(bbox.left, bbox.top, bbox.width, bbox.height);
  ctx.clip();
  const { band, limit } = vswrBand;
  if (band) {
    const lo = Math.max(band.low, xs.min);
    const hi = Math.min(band.high, xs.max);
    if (hi > lo) {
      const x0 = u.valToPos(lo, 'x', true);
      const x1 = u.valToPos(hi, 'x', true);
      ctx.globalAlpha = 0.16;
      ctx.fillStyle = colors.band;
      ctx.fillRect(x0, bbox.top, x1 - x0, bbox.height);
      ctx.globalAlpha = 1;
    }
  }
  const ys = u.scales.y;
  if (ys && ys.min !== undefined && ys.max !== undefined && limit >= ys.min && limit <= ys.max) {
    const y = u.valToPos(limit, 'y', true);
    ctx.strokeStyle = colors.band;
    ctx.lineWidth = pr;
    ctx.setLineDash([4 * pr, 3 * pr]);
    ctx.beginPath();
    ctx.moveTo(bbox.left, y);
    ctx.lineTo(bbox.left + bbox.width, y);
    ctx.stroke();
  }
  ctx.restore();
}

function drawMarkers(
  u: uPlot,
  markers: readonly number[],
  designFrequency: number,
  colors: ThemeColors,
): void {
  const { ctx, bbox } = u;
  const scale = u.scales.x;
  if (!scale || scale.min === undefined || scale.max === undefined) return;
  const inRange = (f: number): boolean => f >= (scale.min as number) && f <= (scale.max as number);
  const pr = uPlot.pxRatio;
  ctx.save();
  ctx.beginPath();
  ctx.rect(bbox.left, bbox.top, bbox.width, bbox.height);
  ctx.clip();
  ctx.lineWidth = pr;
  if (designFrequency > 0 && inRange(designFrequency)) {
    const x = u.valToPos(designFrequency, 'x', true);
    ctx.strokeStyle = colors.muted;
    ctx.setLineDash([2 * pr, 3 * pr]);
    ctx.beginPath();
    ctx.moveTo(x, bbox.top);
    ctx.lineTo(x, bbox.top + bbox.height);
    ctx.stroke();
  }
  ctx.setLineDash([5 * pr, 3 * pr]);
  ctx.strokeStyle = colors.marker;
  ctx.fillStyle = colors.marker;
  ctx.font = `${11 * pr}px system-ui, sans-serif`;
  ctx.textBaseline = 'top';
  markers.forEach((f, i) => {
    if (!inRange(f)) return;
    const x = u.valToPos(f, 'x', true);
    ctx.beginPath();
    ctx.moveTo(x, bbox.top);
    ctx.lineTo(x, bbox.top + bbox.height);
    ctx.stroke();
    ctx.textAlign = x > bbox.left + bbox.width - 24 * pr ? 'right' : 'left';
    ctx.fillText(`M${i + 1}`, x + (ctx.textAlign === 'left' ? 3 * pr : -3 * pr), bbox.top + 2 * pr);
  });
  ctx.restore();
}
