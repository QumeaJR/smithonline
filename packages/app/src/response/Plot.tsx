/**
 * One uPlot panel of the response view: a frequency axis shared with the
 * other panels through a cursor sync group, one or two y scales, marker lines
 * drawn on top, and a click that reports the nearest sample.
 */
import { formatEngineering } from '@smithonline/core';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { DOUBLE_TAP_MS, DOUBLE_TAP_PX } from '../chart/gestures';
import { useCoarsePointer } from '../lib/pointer';
import { cursorAt, scrubIntent } from '../lib/plotTouch';
import {
  boxRange,
  panBy,
  pinchRange,
  rangeText,
  validRange,
  zoomAbout,
  type Range,
} from '../lib/plotZoom';

/** Cursor sync group of the response panels. */
const SYNC_KEY = 'smithonline.response';

export interface PlotSeries {
  readonly label: string;
  readonly color: string;
  readonly values: readonly (number | null)[];
  /** 'y' is the left axis, 'd' the right axis. Default 'y'. */
  readonly scale?: 'y' | 'd';
  readonly dash?: readonly number[];
  /** Line width, px; default 1.5. */
  readonly width?: number;
  /** Formats a value for the touch readout row; default the axis format at 4 digits. */
  readonly format?: (v: number) => string;
  /** Draw the samples as dots without a line (measured points among a dense curve). */
  readonly points?: boolean;
}

export interface PlotAxis {
  /** Formats one tick value. */
  readonly format: (v: number) => string;
  /**
   * The unit the readout row writes after a value formatted by the axis ("|S11| -10.07 dB");
   * the ticks leave it to the panel title.
   */
  readonly unit?: string;
  /** The unit in a CSV column header ("|S21| dB", "R ohm"); default `unit`. */
  readonly exportUnit?: string;
  /** Clamps or widens the auto range from the data extremes. */
  readonly range?: (min: number, max: number) => [number, number];
}

/** A limit area drawn as a shaded region: the part of the plot a curve must stay out of. */
export interface PlotLimit {
  readonly f1: number;
  readonly f2: number;
  readonly kind: 'min' | 'max';
  readonly value: number;
  /** Which y scale the value is on. */
  readonly scale: 'y' | 'd';
  /** Drawn in the warning colour when the curve breaks it. */
  readonly violated: boolean;
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
  /** Limit areas on this plot, drawn behind the markers. */
  readonly limits?: readonly PlotLimit[];
  /** Dotted reference line at the design frequency, Hz. */
  readonly designFrequency: number;
  /**
   * VSWR limit line and the frequency band where the curve stays below it,
   * shaded under the curves. The band is null when there is none.
   */
  readonly vswrBand?: VswrBand | undefined;
  /** A selected sample, Hz: a solid line with a dot on every curve (S-Plot gain table row). */
  readonly highlight?: number | null;
  /** Join the points of a curve across gaps; for curves sampled at different frequencies. */
  readonly spanGaps?: boolean;
  /** Changes whenever the theme does, so the colours are read again. */
  readonly themeToken: number;
  readonly onCursor: (idx: number | null) => void;
  /**
   * A click or Enter on a sample. It may return how to take it back: the first click of a
   * double click is taken back, since the double click resets the zoom.
   */
  readonly onClick: (idx: number) => void | (() => void);
  /** The plot's name for a screen reader ("VSWR"); with it the plot takes the focus and keys. */
  readonly title?: string | undefined;
  /** The frequency range on show (the zoom), or null for the whole data. */
  readonly xRange?: Range | null | undefined;
  /** The plot asks for another frequency range (null: the whole data); without it, no zoom. */
  readonly onXRange?: ((range: Range | null) => void) | undefined;
  /** E on the focused plot enlarges it. */
  readonly onEnlarge?: (() => void) | undefined;
  /** Two fingers pinch and pan the frequency, a double tap resets (the enlarged plot on a phone). */
  readonly gestures?: boolean | undefined;
  /** Filled with a handle the export reads the ranges and ticks on show from. */
  readonly handleRef?: { current: PlotHandle | null } | undefined;
}

/** What a plot shows right now, for the export (docs/10 section 4.4). */
export interface PlotView {
  readonly xRange: Range;
  readonly yRange: Range;
  readonly dRange?: Range;
  readonly xTicks: number[] | undefined;
  readonly yTicks: number[] | undefined;
  readonly dTicks: number[] | undefined;
}

export interface PlotHandle {
  readonly view: () => PlotView | null;
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
  readonly danger: string;
  readonly band: string;
}

function themeColors(): ThemeColors {
  const style = getComputedStyle(document.documentElement);
  const read = (name: string, fallback: string): string =>
    style.getPropertyValue(name).trim() || fallback;
  return {
    text: read('--text-primary', '#1b1f24'),
    muted: read('--text-secondary', '#5a6472'),
    border: read('--border-strong', '#cfd5dc'),
    marker: read('--accent', '#0b6bcb'),
    danger: read('--danger', '#d6336c'),
    band: read('--vswr', '#2f9e44'),
  };
}

const NO_LIMITS: readonly PlotLimit[] = [];

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
  limits = NO_LIMITS,
  designFrequency,
  vswrBand,
  highlight = null,
  spanGaps = false,
  themeToken,
  onCursor,
  onClick,
  title,
  xRange = null,
  onXRange,
  onEnlarge,
  gestures = false,
  handleRef,
}: PlotProps) {
  const host = useRef<HTMLDivElement>(null);
  const plot = useRef<uPlot | null>(null);
  const coarse = useCoarsePointer();
  /** The sample a finger put the cursor on: the readout row under the plot shows it. */
  const [pinned, setPinned] = useState<number | null>(null);
  /** The y ranges a box zoom fixed on this plot, until a reset. */
  const yFixed = useRef<{ y?: Range; d?: Range } | null>(null);
  // Live values the uPlot hooks read without rebuilding the chart.
  const live = useRef({
    markers,
    limits,
    designFrequency,
    vswrBand,
    highlight,
    onCursor,
    onClick,
    series,
    xRange,
    onXRange,
    onEnlarge,
    gestures,
  });
  const data = useMemo(() => toAligned(xs, series), [xs, series]);
  const dataRef = useRef(data);
  useLayoutEffect(() => {
    live.current = {
      markers,
      limits,
      designFrequency,
      vswrBand,
      highlight,
      onCursor,
      onClick,
      series,
      xRange,
      onXRange,
      onEnlarge,
      gestures,
    };
    dataRef.current = data;
  });

  // The chart is built once per axis mode, theme and series shape; data flows through setData.
  const shape = series
    .map((s) => `${s.label}|${s.color}|${s.scale ?? 'y'}|${s.points ? 'p' : 'l'}`)
    .join(',');
  useLayoutEffect(() => {
    const el = host.current;
    if (!el) return;
    const colors = themeColors();
    const current = live.current.series;
    /** The data's frequency range: the end of every zoom. */
    const full = (): Range => {
      const x = dataRef.current[0] as ArrayLike<number>;
      return [x[0] ?? 0, x[x.length - 1] ?? 1];
    };
    const zoomTo = (r: Range | null): void => {
      live.current.onXRange?.(r);
    };
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
      (axis: PlotAxis | undefined, key: 'y' | 'd'): uPlot.Scale.Range =>
      (_u, min, max) => {
        const fixed = yFixed.current?.[key];
        if (fixed) return [fixed[0], fixed[1]];
        return axis?.range ? axis.range(min, max) : [min, max];
      };
    const opts: uPlot.Options = {
      width: el.clientWidth || 300,
      height: el.clientHeight || 160,
      legend: { show: false },
      // Room on the right for half of the last x label ("1.1 GHz" is centred on its tick).
      padding: [8, right ? 0 : 30, 0, 0],
      scales: {
        // A log axis rounds its range out to whole decades unless told otherwise: the data's own
        // range, as the linear axis shows it, or the zoom.
        x: {
          time: false,
          distr: logX ? 3 : 1,
          log: 10,
          range: (_u: uPlot, min: number, max: number): uPlot.Range.MinMax => {
            const z = live.current.xRange;
            return validRange(z, logX) ? [z[0], z[1]] : [min, max];
          },
        },
        y: { range: rangeOf(left, 'y') },
        ...(right ? { d: { range: rangeOf(right, 'd') } } : {}),
      },
      axes,
      series: [
        {},
        ...current.map((s): uPlot.Series => ({
          label: s.label,
          stroke: s.color,
          width: s.width ?? 1.5,
          scale: s.scale ?? 'y',
          ...(s.dash ? { dash: [...s.dash] } : {}),
          spanGaps,
          ...(s.points
            ? {
                // Dots only: no path between them.
                paths: () => null,
                points: { show: true, size: 6, width: 1, stroke: s.color, fill: s.color },
              }
            : { points: { show: false } }),
        })),
      ],
      cursor: {
        sync: { key: SYNC_KEY, setSeries: false, scales: ['x', null] },
        // A drag draws a box (docs/10 section 4.2): a mostly sideways one zooms frequency only.
        drag: { x: true, y: true, uni: 12, setScale: false },
        points: { size: 6 },
        y: false,
        // The double click is the plot's own reset (below), not uPlot's.
        bind: { dblclick: () => () => null },
      },
      hooks: {
        setCursor: [
          (u) => {
            const idx = u.cursor.idx;
            live.current.onCursor(typeof idx === 'number' ? idx : null);
          },
        ],
        setSelect: [
          (u) => {
            const s = u.select;
            if (!(s.width > 0 && s.height > 0)) return;
            u.setSelect({ left: 0, top: 0, width: 0, height: 0 }, false);
            if (s.width < 4 && s.height < 4) return;
            const fullHeight = s.height >= u.over.clientHeight - 1;
            if (!fullHeight) {
              const y: Range = [u.posToVal(s.top + s.height, 'y'), u.posToVal(s.top, 'y')];
              const d: Range | undefined = u.scales.d
                ? [u.posToVal(s.top + s.height, 'd'), u.posToVal(s.top, 'd')]
                : undefined;
              yFixed.current = { y, ...(d ? { d } : {}) };
              u.setScale('y', { min: y[0], max: y[1] });
              if (d) u.setScale('d', { min: d[0], max: d[1] });
            }
            if (s.width >= u.over.clientWidth - 1) return;
            const r = boxRange(
              u.posToVal(s.left, 'x'),
              u.posToVal(s.left + s.width, 'x'),
              full(),
              logX,
            );
            if (r) zoomTo(r);
          },
        ],
        drawAxes: [
          (u) => {
            drawVswrBand(u, live.current.vswrBand, colors);
          },
        ],
        draw: [
          (u) => {
            drawLimits(u, live.current.limits, colors);
            drawMarkers(u, live.current.markers, live.current.designFrequency, colors);
            drawHighlight(u, live.current.highlight, live.current.series, colors);
          },
        ],
      },
    };
    const u = new uPlot(opts, dataRef.current, el);
    plot.current = u;

    /** The x range on show and the y ranges, with the ticks drawn, for the export. */
    if (handleRef) {
      handleRef.current = {
        view: () => {
          const sx = u.scales.x;
          const sy = u.scales.y;
          if (sx?.min === undefined || sx.max === undefined) return null;
          if (sy?.min === undefined || sy.max === undefined) return null;
          const sd = u.scales.d;
          const splits = (i: number): number[] | undefined => {
            const raw = (u.axes[i] as { _splits?: (number | null)[] } | undefined)?._splits;
            return raw?.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
          };
          return {
            xRange: [sx.min, sx.max],
            yRange: [sy.min, sy.max],
            ...(sd?.min !== undefined && sd.max !== undefined
              ? { dRange: [sd.min, sd.max] as Range }
              : {}),
            xTicks: splits(0),
            yTicks: splits(1),
            dTicks: right ? splits(2) : undefined,
          };
        },
      };
    }

    /** Reset: the whole frequency range and this plot's own y (double click, double tap, 0). */
    const reset = (): void => {
      yFixed.current = null;
      if (live.current.xRange) zoomTo(null);
      else {
        const f = full();
        u.setScale('x', { min: f[0], max: f[1] });
      }
    };
    /** The value under a pointer, or the centre of the range on show. */
    const valueAt = (clientX?: number): number => {
      const rect = u.over.getBoundingClientRect();
      const px = clientX === undefined ? rect.width / 2 : clientX - rect.left;
      return u.posToVal(px, 'x');
    };

    // A click (not a drag) in the plotting area reports the sample under the cursor. The
    // first click of a double click is taken back: the double click only resets.
    let down: { x: number; y: number } | null = null;
    let lastClick: { t: number; undo: (() => void) | null } | null = null;
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
      if (Number.isInteger(idx) && idx >= 0) {
        const undo = live.current.onClick(idx);
        lastClick = { t: e.timeStamp, undo: typeof undo === 'function' ? undo : null };
      }
    };
    const onDouble = (e: MouseEvent): void => {
      if (lastClick && e.timeStamp - lastClick.t < 600) lastClick.undo?.();
      lastClick = null;
      reset();
    };
    u.over.addEventListener('pointerdown', onDown);
    u.over.addEventListener('pointerup', onUp);
    u.over.addEventListener('dblclick', onDouble);

    // Ctrl or Cmd with the wheel zooms frequency about the pointer; a plain wheel scrolls the page.
    const onWheel = (e: WheelEvent): void => {
      if (!(e.ctrlKey || e.metaKey) || !live.current.onXRange) return;
      e.preventDefault();
      const factor = Math.min(2, Math.max(0.5, Math.exp(e.deltaY * 0.0015)));
      zoomTo(zoomAbout(live.current.xRange, full(), valueAt(e.clientX), factor, logX));
    };
    u.over.addEventListener('wheel', onWheel, { passive: false });

    // Shift and a drag pans the zoomed frequency range; uPlot's box does not start.
    let pan: { x: number; start: Range } | null = null;
    const onPanDown = (e: MouseEvent): void => {
      if (!e.shiftKey || e.button !== 0 || !u.over.contains(e.target as Node)) return;
      e.stopPropagation();
      const z = live.current.xRange;
      pan = validRange(z, logX) ? { x: e.clientX, start: z } : null;
    };
    const onPanMove = (e: MouseEvent): void => {
      if (!pan) return;
      const width = u.over.clientWidth || 1;
      zoomTo(panBy(pan.start, full(), -(e.clientX - pan.x) / width, logX));
    };
    const onPanUp = (): void => {
      pan = null;
    };
    el.addEventListener('mousedown', onPanDown, true);
    window.addEventListener('mousemove', onPanMove);
    window.addEventListener('mouseup', onPanUp);

    // A finger: uPlot listens to the mouse only, so the finger drives its cursor. Sideways
    // it scrubs (the readout row under the plot follows), up or down the page scrolls
    // (touch-action: pan-y on the plotting area leaves that to the browser), a tap sets a
    // marker (onUp above) with the cursor on it. In the enlarged plot on a phone two fingers
    // pinch and pan the frequency and a double tap resets (docs/10 section 4.5).
    let finger: {
      id: number;
      x: number;
      y: number;
      mode: 'pending' | 'scrub' | 'scroll';
    } | null = null;
    const touches = new Map<number, { x: number; y: number }>();
    let pinch: { d0: number; mid0: number; at: number; start: Range } | null = null;
    let lastTap: { t: number; x: number; y: number } | null = null;
    const scrubTo = (e: PointerEvent): void => {
      u.setCursor(cursorAt(u.over.getBoundingClientRect(), e.clientX, e.clientY));
      const idx = u.posToIdx(u.cursor.left ?? 0);
      if (Number.isInteger(idx) && idx >= 0) setPinned(idx);
    };
    const twoFingers = (): { d: number; mid: number } | null => {
      const [a, b] = [...touches.values()];
      if (!a || !b) return null;
      return { d: Math.hypot(a.x - b.x, a.y - b.y), mid: (a.x + b.x) / 2 };
    };
    const onFingerDown = (e: PointerEvent): void => {
      if (e.pointerType === 'mouse') return;
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (live.current.gestures && touches.size === 2) {
        const g = twoFingers();
        finger = null;
        if (g && g.d >= 8) {
          pinch = {
            d0: g.d,
            mid0: g.mid,
            at: valueAt(g.mid),
            start: live.current.xRange ?? full(),
          };
        }
        return;
      }
      if (touches.size > 1) return;
      finger = { id: e.pointerId, x: e.clientX, y: e.clientY, mode: 'pending' };
    };
    const onFingerMove = (e: PointerEvent): void => {
      if (touches.has(e.pointerId)) touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch) {
        const g = twoFingers();
        if (!g) return;
        if (e.cancelable) e.preventDefault();
        const zoomed = pinchRange(pinch.start, full(), pinch.at, pinch.d0, g.d, logX);
        const width = u.over.clientWidth || 1;
        zoomTo(panBy(zoomed, full(), -(g.mid - pinch.mid0) / width, logX));
        return;
      }
      if (!finger || finger.id !== e.pointerId) return;
      if (finger.mode === 'pending') {
        const intent = scrubIntent(e.clientX - finger.x, e.clientY - finger.y);
        if (intent === null) return;
        finger.mode = live.current.gestures ? 'scrub' : intent;
        if (finger.mode === 'scrub') {
          try {
            u.over.setPointerCapture(e.pointerId);
          } catch {
            // the pointer is gone already
          }
        }
      }
      if (finger.mode !== 'scrub') return;
      if (e.cancelable) e.preventDefault();
      scrubTo(e);
    };
    const onFingerUp = (e: PointerEvent): void => {
      touches.delete(e.pointerId);
      if (pinch) {
        if (touches.size < 2) pinch = null;
        return;
      }
      if (!finger || finger.id !== e.pointerId) return;
      // A tap leaves the cursor and the readout row on the sample it set a marker on.
      if (finger.mode === 'pending' && e.type === 'pointerup') {
        scrubTo(e);
        const tap = { t: e.timeStamp, x: e.clientX, y: e.clientY };
        if (
          live.current.gestures &&
          lastTap &&
          tap.t - lastTap.t < DOUBLE_TAP_MS &&
          Math.hypot(tap.x - lastTap.x, tap.y - lastTap.y) < DOUBLE_TAP_PX
        ) {
          if (lastClick) lastClick.undo?.();
          lastClick = null;
          lastTap = null;
          reset();
        } else lastTap = tap;
      }
      finger = null;
    };
    u.over.addEventListener('pointerdown', onFingerDown);
    u.over.addEventListener('pointermove', onFingerMove);
    u.over.addEventListener('pointerup', onFingerUp);
    u.over.addEventListener('pointercancel', onFingerUp);

    // The keys of a focused plot (docs/10 section 4.2).
    const onKey = (e: KeyboardEvent): void => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const x = dataRef.current[0] as ArrayLike<number>;
      const cursorIdx = (): number | null => {
        const idx = u.cursor.idx;
        return typeof idx === 'number' && idx >= 0 ? idx : null;
      };
      const at = (): number => {
        const idx = cursorIdx();
        return idx !== null && x[idx] !== undefined ? (x[idx] as number) : valueAt();
      };
      const moveCursor = (step: number): void => {
        const idx = Math.min(
          x.length - 1,
          Math.max(0, (cursorIdx() ?? Math.floor(x.length / 2)) + step),
        );
        const f = x[idx];
        if (f === undefined) return;
        u.setCursor({ left: u.valToPos(f, 'x'), top: (u.over.clientHeight || 2) / 2 });
      };
      let handled = true;
      if (e.key === '+' || e.key === '=')
        zoomTo(zoomAbout(live.current.xRange, full(), at(), 0.8, logX));
      else if (e.key === '-' || e.key === '_')
        zoomTo(zoomAbout(live.current.xRange, full(), at(), 1.25, logX));
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        const dir = e.key === 'ArrowLeft' ? -1 : 1;
        if (e.shiftKey) zoomTo(panBy(live.current.xRange, full(), dir * 0.1, logX));
        else moveCursor(dir);
      } else if (e.key === 'Enter') {
        const idx = cursorIdx();
        if (idx !== null) live.current.onClick(idx);
      } else if (e.key === '0') reset();
      else if ((e.key === 'e' || e.key === 'E') && live.current.onEnlarge) live.current.onEnlarge();
      else handled = false;
      if (handled) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    el.addEventListener('keydown', onKey);

    const ro = new ResizeObserver(() => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w > 0 && h > 0) u.setSize({ width: w, height: h });
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      if (handleRef) handleRef.current = null;
      el.removeEventListener('keydown', onKey);
      el.removeEventListener('mousedown', onPanDown, true);
      window.removeEventListener('mousemove', onPanMove);
      window.removeEventListener('mouseup', onPanUp);
      u.over.removeEventListener('wheel', onWheel);
      u.over.removeEventListener('pointerdown', onDown);
      u.over.removeEventListener('pointerup', onUp);
      u.over.removeEventListener('dblclick', onDouble);
      u.over.removeEventListener('pointerdown', onFingerDown);
      u.over.removeEventListener('pointermove', onFingerMove);
      u.over.removeEventListener('pointerup', onFingerUp);
      u.over.removeEventListener('pointercancel', onFingerUp);
      u.destroy();
      plot.current = null;
    };
    // The formats and ranges are stable per panel; the chart rebuilds on the listed keys only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logX, themeToken, shape, Boolean(right), spanGaps]);

  useEffect(() => {
    plot.current?.setData(data);
  }, [data]);

  // The zoom: a new x range re-ranges y over what shows (a fixed y stays); none clears it.
  const zoomKey = xRange ? `${xRange[0]}:${xRange[1]}` : '';
  useEffect(() => {
    const u = plot.current;
    if (!xRange) yFixed.current = null;
    // A stand-in for uPlot (the tests) may have no scales.
    if (!u || typeof u.setScale !== 'function') return;
    const x = dataRef.current[0] as ArrayLike<number>;
    if (x.length < 2) return;
    const r = validRange(xRange, logX) ? xRange : ([x[0], x[x.length - 1]] as Range);
    u.setScale('x', { min: r[0], max: r[1] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoomKey, logX]);

  useEffect(() => {
    plot.current?.redraw(false, false);
  }, [markers, limits, designFrequency, vswrBand, highlight]);

  // Another frequency grid (a new sweep, another file) leaves no stale readout behind.
  const [pinnedFor, setPinnedFor] = useState(xs);
  if (pinnedFor !== xs) {
    setPinnedFor(xs);
    setPinned(null);
  }

  const shown = validRange(xRange, logX)
    ? xRange
    : xs.length > 1
      ? ([xs[0], xs[xs.length - 1]] as Range)
      : null;
  const ariaLabel = title
    ? `${title} plot${shown ? `, ${rangeText(shown, fmtAxisFrequency)}` : ''}`
    : undefined;
  return (
    <>
      <div
        className="plot-host"
        ref={host}
        {...(title ? { tabIndex: 0, role: 'img', 'aria-label': ariaLabel } : {})}
      />
      {coarse && (
        <div className="plot-readout mono small" role="status" aria-live="off">
          {pinned !== null && pinned < xs.length
            ? readoutText(xs, series, pinned, left, right)
            : 'Drag sideways on the plot for a readout'}
        </div>
      )}
    </>
  );
}

/** The readout row of a sample: its frequency and the value of every curve there. */
function readoutText(
  xs: readonly number[],
  series: readonly PlotSeries[],
  idx: number,
  left: PlotAxis,
  right: PlotAxis | undefined,
): string {
  const f = formatEngineering(xs[idx] as number, { unit: 'Hz', digits: 5 });
  const values = series.flatMap((s) => {
    const v = s.values[idx];
    if (v === null || v === undefined || !Number.isFinite(v)) return [];
    const axis = s.scale === 'd' && right ? right : left;
    const text = s.format
      ? s.format(v)
      : `${axis.format(Number(v.toPrecision(4)))}${axis.unit ? ` ${axis.unit}` : ''}`;
    return [`${s.label} ${text}`];
  });
  return [`f ${f}`, ...values].join('   ');
}

/** uPlot wants one x column and one y column per series, gaps as null. */
function toAligned(xs: readonly number[], series: readonly PlotSeries[]): uPlot.AlignedData {
  return [
    [...xs],
    ...series.map((s) => s.values.map((v) => (v === null || Number.isFinite(v) ? v : null))),
  ];
}

/** Shade the forbidden side of each limit between its frequencies, with a solid edge at the limit value. */
function drawLimits(u: uPlot, limits: readonly PlotLimit[], colors: ThemeColors): void {
  if (limits.length === 0) return;
  const { ctx, bbox } = u;
  const pr = uPlot.pxRatio;
  ctx.save();
  ctx.beginPath();
  ctx.rect(bbox.left, bbox.top, bbox.width, bbox.height);
  ctx.clip();
  for (const l of limits) {
    if (!u.scales[l.scale]) continue;
    const x1 = u.valToPos(Math.min(l.f1, l.f2), 'x', true);
    const x2 = u.valToPos(Math.max(l.f1, l.f2), 'x', true);
    const y = u.valToPos(l.value, l.scale, true);
    if (!Number.isFinite(x1) || !Number.isFinite(x2) || !Number.isFinite(y)) continue;
    const top = l.kind === 'max' ? bbox.top : y;
    const bottom = l.kind === 'max' ? y : bbox.top + bbox.height;
    ctx.fillStyle = colors.danger;
    ctx.globalAlpha = l.violated ? 0.28 : 0.13;
    ctx.fillRect(x1, top, x2 - x1, bottom - top);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = colors.danger;
    ctx.lineWidth = 1.5 * pr;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(x1, y);
    ctx.lineTo(x2, y);
    ctx.stroke();
  }
  ctx.restore();
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

/** The selected sample: a solid vertical line and a dot where each curve has a value. */
function drawHighlight(
  u: uPlot,
  highlight: number | null,
  series: readonly PlotSeries[],
  colors: ThemeColors,
): void {
  if (highlight === null || !Number.isFinite(highlight)) return;
  const scale = u.scales.x;
  if (!scale || scale.min === undefined || scale.max === undefined) return;
  if (highlight < scale.min || highlight > scale.max) return;
  const { ctx, bbox } = u;
  const pr = uPlot.pxRatio;
  const x = u.valToPos(highlight, 'x', true);
  ctx.save();
  ctx.beginPath();
  ctx.rect(bbox.left, bbox.top, bbox.width, bbox.height);
  ctx.clip();
  ctx.lineWidth = 1.5 * pr;
  ctx.strokeStyle = colors.text;
  ctx.globalAlpha = 0.6;
  ctx.beginPath();
  ctx.moveTo(x, bbox.top);
  ctx.lineTo(x, bbox.top + bbox.height);
  ctx.stroke();
  ctx.globalAlpha = 1;
  const xs = u.data[0] as ArrayLike<number>;
  const idx = Array.prototype.indexOf.call(xs, highlight);
  if (idx >= 0) {
    series.forEach((s, i) => {
      const v = (u.data[i + 1] as ArrayLike<number | null> | undefined)?.[idx];
      if (v === null || v === undefined || !Number.isFinite(v)) return;
      ctx.fillStyle = s.color;
      ctx.strokeStyle = colors.text;
      ctx.lineWidth = pr;
      ctx.beginPath();
      ctx.arc(x, u.valToPos(v, s.scale ?? 'y', true), 4 * pr, 0, 2 * Math.PI);
      ctx.fill();
      ctx.stroke();
    });
  }
  ctx.restore();
}
