import { zToGamma, type Complex, type LadderResult, type SweepPoint } from '@smithonline/core';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type { ChartCircle } from '../lib/circles';
import { datapointLabel, fmtFrequency, fmtNum } from '../lib/format';
import { capturePointer, useCoarsePointer } from '../lib/pointer';
import type { ChartOptions } from '../store/useDesignStore';
import { useMonteCarlo } from '../store/useMonteCarlo';
import { useSettings } from '../store/useSettings';
import {
  CROWD_PX,
  crowdedWith,
  frameOf,
  HIT_RADIUS_PX,
  hitRadius,
  HOME,
  isDoubleTapOnMarker,
  LONG_PRESS_MS,
  LONG_PRESS_SLOP,
  longPressCancel,
  longPressMove,
  longPressStart,
  longPressTick,
  markerScale,
  MOUSE_HIT_RADIUS_PX,
  nearestMarker,
  panView,
  pinchView,
  screenToChart,
  wheelZoom,
  type Frame,
  type LongPress,
  type Marker,
  type PinchStart,
  type Point,
  type Tap,
  type View,
} from './gestures';
import { gridCircles, gridLabels } from './grid';
import { declutterLabels, labelledSweepIndices, MAX_SWEEP_LABELS } from './sweepLabels';

/** A user datapoint other than the chain start, drawn as a hollow marker. */
export interface UserPoint {
  readonly z: Complex;
  /** Position in the DP numbering, 0-based. */
  readonly index: number;
}

export interface ChartProps {
  readonly result: LadderResult;
  readonly z0: number;
  readonly options: ChartOptions;
  readonly selected: number | null;
  readonly sweep: readonly SweepPoint[] | null;
  /** A frequency sweep is drawn as a locus, a datapoint sweep as SP markers. */
  readonly sweepKind: 'frequency' | 'datapoints';
  /** The realized network, drawn dashed beside the ideal one. */
  readonly realized: LadderResult | null;
  readonly realizedSweep: readonly SweepPoint[] | null;
  /** The network as built with its component packages, drawn dotted. */
  readonly packaged?: LadderResult | null;
  readonly packagedSweep?: readonly SweepPoint[] | null;
  /** Where the network should land, drawn as a hollow square. */
  readonly target: Complex;
  readonly vswrCircles: readonly number[];
  readonly qContours: readonly number[];
  /** Stability, gain and noise circles of the two-port device. */
  readonly deviceCircles: readonly ChartCircle[];
  /** Colour of each element locus, in ladder order. */
  readonly arcColors: readonly string[];
  readonly onSelect: (index: number | null) => void;
  readonly onHover: (gamma: Complex | null) => void;
  /** A datapoint is being dragged to this reflection coefficient. */
  readonly onDragDatapoint: (index: number, gamma: Complex) => void;
  /** A marker press or drag ended (or its point went away under it). */
  readonly onDragEnd: () => void;
  /**
   * The identity of each chain datapoint (the load, then the part behind each node): a drag
   * follows its point by it when the design changes under the drag, and ends without a change
   * when the point is gone. Without it the index is the identity.
   */
  readonly pointIds?: readonly string[];
  /** A marker was pressed: a drag may follow (the phone's sheet drops to peek). */
  readonly onDragStart?: (index: number) => void;
  /** Preview of an element being placed or a suggested match. */
  readonly ghost: Ghost | null;
  /** A plain click or tap on the chart while an element is armed (or a press released): place it here. */
  readonly onPlace: ((gamma: Complex) => void) | null;
  /** Double click, or a double tap on a marker: ask for match suggestions towards this point. */
  readonly onSuggest: (gamma: Complex, clientX: number, clientY: number, tap?: boolean) => void;
  /** Bump to reset zoom and pan. */
  readonly fitKey: number;
  /**
   * Right click or a long press at this reflection coefficient and screen
   * position, on datapoint `point` if any; `crowd` names the other markers
   * within 12 px of it, for the chooser row of the context sheet.
   */
  readonly onContextMenu: (
    gamma: Complex,
    clientX: number,
    clientY: number,
    point: number | null,
    crowd: readonly number[],
  ) => void;
  /**
   * A finger is down on the chart (on marker `point`, or on empty chart with
   * null, or aiming an armed part or a datapoint to add), or it lifted (null):
   * the phone shows the readout in the chart's top band for the duration.
   */
  readonly onFinger?: (finger: Finger | null) => void;
  /** The datapoint whose context menu is open: its marker pulses. */
  readonly pulsePoint?: number | null;
  readonly svgRef: RefObject<SVGSVGElement | null>;
  /** The user datapoints the chain does not start from (DPn, hollow). */
  readonly userPoints?: readonly UserPoint[];
  /** A hollow datapoint was clicked: start the network there. */
  readonly onStartDatapoint?: (index: number) => void;
  /** Number of user datapoints and the start's place among them, for the labels. */
  readonly dpCount?: number;
  readonly startSlot?: number;
  /** The sweep point the design sits on, so a thinned datapoint sweep always labels it. */
  readonly anchor?: number | null;
}

/** A finger on the chart: on a marker, on empty chart, or aiming a placement. */
export interface Finger {
  readonly point: number | null;
  /** Aiming an armed part or a datapoint to add: the release places it. */
  readonly aiming?: boolean;
}

export interface Ghost {
  /** Where the armed element can reach from the current input point, as impedances. */
  readonly reach: readonly Complex[];
  /** Loci of the previewed elements, as impedances. */
  readonly arcs: readonly (readonly Complex[])[];
  /** Where the preview lands. */
  readonly marker: Complex | null;
  readonly label: string;
  readonly color: string;
  /** The armed part cannot move the point to where it is aimed: a dashed red marker there. */
  readonly unreachable?: boolean;
}

/** Keep dragged points inside the chart so the impedance stays finite. */
function clampGamma(g: Complex, max = 0.995): Complex {
  const m = Math.hypot(g.re, g.im);
  return m > max ? { re: (g.re * max) / m, im: (g.im * max) / m } : g;
}

/**
 * What the pointers on the chart are doing (docs/07 section 6): nothing; one
 * pointer pressed (on a marker, on empty chart, or aiming an armed part); two
 * fingers pinching; or finished, waiting for the last finger to lift.
 */
type Gesture =
  | { readonly kind: 'idle' }
  | { readonly kind: 'done' }
  | {
      readonly kind: 'pinch';
      readonly ids: readonly [number, number];
      readonly start: PinchStart;
      readonly frame: Frame;
    }
  | {
      readonly kind: 'press';
      readonly id: number;
      /** Where it went down, client px. */
      readonly x: number;
      readonly y: number;
      /** The view and the chart's frame when it went down: a pan is measured from them. */
      readonly view: View;
      readonly frame: Frame;
      /** The picked marker, or null on empty chart. */
      readonly point: number | null;
      /** The identity of the picked marker's point: a drag follows it, not the index. */
      readonly pointId: string | null;
      /** A hollow user datapoint picked within its halo: a tap starts the network there. */
      readonly user: number | null;
      /** The marker's centre less the finger, chart units: the finger keeps its offset. */
      readonly offset: Point;
      /** Moved further than the slop: a drag or a pan, not a tap. */
      readonly moved: boolean;
      /** Aiming an armed part or a datapoint to add: the release places it. */
      readonly place: boolean;
      /** A finger or a pen, not a mouse. */
      readonly touch: boolean;
      readonly lp: LongPress | null;
    };

function pathOf(points: readonly Complex[], z0: number): string {
  let d = '';
  for (const z of points) {
    const g = zToGamma(z, z0);
    if (!Number.isFinite(g.re) || !Number.isFinite(g.im)) continue;
    // Clamp far-away points so a near-open does not blow up the path extents.
    const m = Math.hypot(g.re, g.im);
    const k = m > 3 ? 3 / m : 1;
    d += `${d ? 'L' : 'M'}${(g.re * k).toFixed(5)} ${(-g.im * k).toFixed(5)}`;
  }
  return d;
}

export function SmithChart({
  result,
  z0,
  options,
  selected,
  sweep,
  sweepKind,
  realized,
  realizedSweep,
  packaged = null,
  packagedSweep = null,
  target,
  vswrCircles,
  qContours,
  deviceCircles,
  arcColors,
  onSelect,
  onHover,
  onDragDatapoint,
  onDragEnd,
  onDragStart,
  onContextMenu,
  ghost,
  onPlace,
  onSuggest,
  fitKey,
  svgRef,
  userPoints = [],
  onStartDatapoint,
  dpCount = 1,
  startSlot = 0,
  anchor = null,
  onFinger,
  pulsePoint = null,
  pointIds,
}: ChartProps) {
  const cloud = useMonteCarlo((s) => s.cloud);
  const cloudStale = useMonteCarlo((s) => s.stale);
  const coarse = useCoarsePointer();
  const [view, setViewState] = useState<View>(HOME);
  /** The view as the handlers see it between renders: set together with the state. */
  const viewRef = useRef<View>(HOME);
  const setView = useCallback((next: View | ((v: View) => View)): void => {
    const v = typeof next === 'function' ? next(viewRef.current) : next;
    viewRef.current = v;
    setViewState(v);
  }, []);
  const [dragging, setDragging] = useState(false);
  /** The side of the drawn chart square in px, for the marker size on a touch screen. */
  const [framePx, setFramePx] = useState(0);
  /** The pointers on the chart, by id, at their last position (client px). */
  const pointers = useRef(new Map<number, Point>());
  const gesture = useRef<Gesture>({ kind: 'idle' });
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** The last tap that ended on the chart, for a double tap on a marker. */
  const lastTap = useRef<Tap | null>(null);
  /** The kind of the last pointer pressed: a touch's long press is its context menu. */
  const lastPointer = useRef<string>('mouse');
  const k = view.half / HOME.half; // scales text and markers so they stay the same size on screen
  const gammas = result.datapoints.map((z) => zToGamma(z, z0));

  /** Where the chart square lies on the screen now. */
  const frameNow = useCallback((): Frame => {
    const svg = svgRef.current;
    if (!svg) return { left: 0, top: 0, size: 0 };
    const r = svg.getBoundingClientRect();
    return frameOf(r.left, r.top, r.width, r.height);
  }, [svgRef]);

  const toChart = useCallback(
    (clientX: number, clientY: number): Complex | null => {
      const frame = frameNow();
      if (!(frame.size > 0)) return null;
      const p = screenToChart(viewRef.current, frame, { x: clientX, y: clientY });
      return { re: p.x, im: -p.y };
    },
    [frameNow],
  );

  // The drawn size decides how large the markers draw on a touch screen.
  useLayoutEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const measure = (): void => setFramePx(frameNow().size);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(svg);
    return () => observer.disconnect();
  }, [svgRef, frameNow]);

  // Wheel zoom needs a non-passive listener to stop the page from scrolling; the pinch needs
  // non-passive listeners too, so Safari's own gesture events never zoom the page.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      const at = toChart(e.clientX, e.clientY);
      if (!at) return;
      setView((v) => wheelZoom(v, { x: at.re, y: -at.im }, e.deltaY));
    };
    const stop = (e: Event): void => e.preventDefault();
    const onTouchMove = (e: TouchEvent): void => {
      if (e.touches.length > 1 && e.cancelable) e.preventDefault();
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    svg.addEventListener('gesturestart', stop, { passive: false });
    svg.addEventListener('gesturechange', stop, { passive: false });
    svg.addEventListener('touchmove', onTouchMove, { passive: false });
    return () => {
      svg.removeEventListener('wheel', onWheel);
      svg.removeEventListener('gesturestart', stop);
      svg.removeEventListener('gesturechange', stop);
      svg.removeEventListener('touchmove', onTouchMove);
    };
  }, [svgRef, toChart, setView]);

  const clearTimer = (): void => {
    if (pressTimer.current !== null) clearTimeout(pressTimer.current);
    pressTimer.current = null;
  };
  useEffect(() => clearTimer, []);

  /** The chain's markers in chart units, for the nearest-centre pick. */
  const markers = (): Marker[] => gammas.map((g, index) => ({ index, x: g.re, y: -g.im }));
  const inside = (g: Complex | null): g is Complex => g !== null && Math.hypot(g.re, g.im) <= 1;

  /**
   * The marker a press at this screen point picks: the nearest centre within
   * the halo (22 px on a touch screen, 10 px with a mouse), the selected
   * marker winning a tie.
   */
  const pickAt = (clientX: number, clientY: number, pointerType: string): Marker | null => {
    const frame = frameNow();
    if (!(frame.size > 0)) return null;
    const at = screenToChart(viewRef.current, frame, { x: clientX, y: clientY });
    const px = pointerType === 'mouse' ? MOUSE_HIT_RADIUS_PX : HIT_RADIUS_PX;
    return nearestMarker(markers(), at, hitRadius(viewRef.current, frame, px), selected);
  };

  /** The hollow user datapoint a press here picks: the nearest within the same halo. */
  const pickUser = (clientX: number, clientY: number, pointerType: string): number | null => {
    if (userPoints.length === 0) return null;
    const frame = frameNow();
    if (!(frame.size > 0)) return null;
    const at = screenToChart(viewRef.current, frame, { x: clientX, y: clientY });
    const px = pointerType === 'mouse' ? MOUSE_HIT_RADIUS_PX : HIT_RADIUS_PX;
    const list = userPoints.map((p) => {
      const g = zToGamma(p.z, z0);
      return { index: p.index, x: g.re, y: -g.im };
    });
    return nearestMarker(list, at, hitRadius(viewRef.current, frame, px), null)?.index ?? null;
  };

  /** The identity of chain point `index`, and the index of a point by its identity (-1: gone). */
  const idOf = (index: number): string => pointIds?.[index] ?? String(index);
  const indexOfId = (id: string): number =>
    pointIds ? pointIds.indexOf(id) : Number(id) < gammas.length ? Number(id) : -1;

  /** The markers within 12 px of `point`, for the chooser row of the context sheet. */
  const crowdOf = (point: number): number[] => {
    const frame = frameNow();
    if (!(frame.size > 0)) return [];
    return crowdedWith(markers(), point, hitRadius(viewRef.current, frame, CROWD_PX)).map(
      (m) => m.index,
    );
  };

  /** End a marker drag or press: the drag commits its one step, a press without movement none. */
  const endPress = (g: Gesture): void => {
    if (g.kind === 'press' && g.point !== null) {
      setDragging(false);
      onDragEnd();
    } else if (g.kind === 'press' && g.moved) {
      setDragging(false);
    }
  };

  const startPinch = (): void => {
    const g = gesture.current;
    clearTimer();
    endPress(g);
    const [a, b] = [...pointers.current.entries()];
    if (!a || !b) return;
    gesture.current = {
      kind: 'pinch',
      ids: [a[0], b[0]],
      start: { view: viewRef.current, a: a[1], b: b[1] },
      frame: frameNow(),
    };
    setDragging(true);
    onFinger?.(null);
    onHover(null);
  };

  /**
   * The point under a drag went away (a Delete or an Undo while the pointer
   * holds it): the drag ends here without changing anything, and the pointer
   * does nothing more until it lifts.
   */
  const losePoint = (g: Extract<Gesture, { kind: 'press' }>): void => {
    clearTimer();
    gesture.current = { kind: 'done' };
    setDragging(false);
    onDragEnd();
    if (g.touch) onFinger?.(null);
    onHover(null);
  };

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>): void => {
    lastPointer.current = e.pointerType || 'mouse';
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const at = { x: e.clientX, y: e.clientY };
    pointers.current.set(e.pointerId, at);
    capturePointer(e.currentTarget, e.pointerId);
    if (pointers.current.size === 2) {
      startPinch();
      return;
    }
    if (pointers.current.size > 2) return;
    const touch = e.pointerType !== 'mouse';
    const g = toChart(e.clientX, e.clientY);
    // An armed part or datapoint input: press to aim (the ghost follows), release to place.
    if (onPlace) {
      gesture.current = {
        kind: 'press',
        id: e.pointerId,
        x: e.clientX,
        y: e.clientY,
        view: viewRef.current,
        frame: frameNow(),
        point: null,
        pointId: null,
        user: null,
        offset: { x: 0, y: 0 },
        moved: false,
        place: true,
        touch,
        lp: null,
      };
      if (g) onHover(inside(g) ? g : null);
      // The phone's band shows the aimed point and the part's value while the finger aims.
      if (touch) onFinger?.({ point: null, aiming: true });
      return;
    }
    const picked = pickAt(e.clientX, e.clientY, e.pointerType);
    // A hollow user datapoint within its halo, when no chain marker is nearer.
    const user = picked ? null : pickUser(e.clientX, e.clientY, e.pointerType);
    const fingerAt = g ? { x: g.re, y: -g.im } : { x: 0, y: 0 };
    gesture.current = {
      kind: 'press',
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      view: viewRef.current,
      frame: frameNow(),
      point: picked?.index ?? null,
      pointId: picked ? idOf(picked.index) : null,
      user,
      // The finger keeps its offset from the marker's centre while it drags it.
      offset: picked ? { x: picked.x - fingerAt.x, y: picked.y - fingerAt.y } : { x: 0, y: 0 },
      moved: false,
      place: false,
      touch,
      lp: touch ? longPressStart(e.clientX, e.clientY, e.timeStamp) : null,
    };
    if (picked) {
      onSelect(picked.index);
      onDragStart?.(picked.index);
      // The readout names the picked point the instant the finger lands.
      const mg = gammas[picked.index];
      if (mg) onHover(mg);
    } else if (touch && inside(g)) {
      onHover(g);
    }
    if (touch) onFinger?.({ point: picked?.index ?? null });
    if (touch) {
      clearTimer();
      const id = e.pointerId;
      const clientX = e.clientX;
      const clientY = e.clientY;
      pressTimer.current = setTimeout(() => {
        pressTimer.current = null;
        const now = gesture.current;
        if (now.kind !== 'press' || now.id !== id || !now.lp) return;
        // A long press is the touch screen's right-click: on a marker or on empty chart inside
        // the disc. In the margin outside it the press does nothing and the finger may pan.
        const point = now.pointId !== null ? indexOfId(now.pointId) : null;
        const mg = point !== null ? (gammas[point] ?? null) : toChart(clientX, clientY);
        if (point !== null ? mg === null : !inside(mg)) {
          gesture.current = { ...now, lp: longPressCancel(now.lp) };
          return;
        }
        const lp = longPressTick(now.lp, now.lp.t + LONG_PRESS_MS);
        if (lp.state !== 'fired') return;
        gesture.current = { ...now, lp };
        if (mg) onContextMenu(mg, clientX, clientY, point, point !== null ? crowdOf(point) : []);
      }, LONG_PRESS_MS);
    }
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>): void => {
    const tracked = pointers.current.has(e.pointerId);
    if (tracked) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    if (g.kind === 'pinch') {
      const a = pointers.current.get(g.ids[0]);
      const b = pointers.current.get(g.ids[1]);
      if (a && b) setView(pinchView(g.start, a, b, g.frame));
      return;
    }
    const at = toChart(e.clientX, e.clientY);
    if (g.kind !== 'press' || g.id !== e.pointerId) {
      // A mouse moving over the chart: the readout follows it (and an armed part's ghost).
      if (!tracked && g.kind === 'idle') onHover(inside(at) ? at : null);
      return;
    }
    const dx = e.clientX - g.x;
    const dy = e.clientY - g.y;
    let next = g;
    if (g.lp) {
      const lp = longPressMove(g.lp, e.clientX, e.clientY);
      if (lp !== g.lp) {
        next = { ...next, lp };
        if (lp.state === 'cancelled') clearTimer();
      }
    }
    // A long press that opened the context menu holds the chart still until the finger lifts.
    if (next.lp?.state === 'fired') {
      gesture.current = next;
      return;
    }
    if (g.place) {
      if (at) onHover(inside(at) ? at : null);
      gesture.current = next;
      return;
    }
    const slop = g.touch ? LONG_PRESS_SLOP : 3;
    if (!next.moved && Math.hypot(dx, dy) > slop) {
      next = { ...next, moved: true, lp: next.lp ? longPressCancel(next.lp) : null };
      clearTimer();
      setDragging(true);
    }
    gesture.current = next;
    if (!next.moved) return;
    if (next.pointId !== null) {
      // The point is followed by its identity: a Delete or an Undo under the drag moves it
      // to another index, or takes it away (the drag then ends without a change).
      const index = indexOfId(next.pointId);
      if (index < 0) {
        losePoint(next);
        return;
      }
      if (index !== next.point) gesture.current = { ...next, point: index };
      const c = screenToChart(viewRef.current, next.frame, { x: e.clientX, y: e.clientY });
      const target = clampGamma({ re: c.x + next.offset.x, im: -(c.y + next.offset.y) });
      // The readout shows the point where it lands on its locus (App), not the finger.
      onDragDatapoint(index, target);
      return;
    }
    // One finger (or the mouse) on empty chart pans; the chart point under it stays put.
    setView(panView(next.view, next.frame, dx, dy));
    if (g.touch && inside(at)) onHover(at);
  };

  const finish = (e: React.PointerEvent<SVGSVGElement>, cancelled: boolean): void => {
    pointers.current.delete(e.pointerId);
    const g = gesture.current;
    if (g.kind === 'pinch') {
      // Only the pinch's own fingers end it: a third finger (or a palm) that lifts does not.
      if (!g.ids.includes(e.pointerId)) return;
      // The finger left on the chart after a pinch does nothing until it lifts too.
      gesture.current = pointers.current.size === 0 ? { kind: 'idle' } : { kind: 'done' };
      if (pointers.current.size === 0) {
        setDragging(false);
        onHover(null);
      }
      return;
    }
    if (g.kind === 'done') {
      if (pointers.current.size === 0) {
        // The last finger of a pinch (or of a lost drag) lifted: the chart is at rest again.
        gesture.current = { kind: 'idle' };
        setDragging(false);
        onHover(null);
      }
      return;
    }
    if (g.kind !== 'press' || g.id !== e.pointerId) return;
    clearTimer();
    gesture.current = pointers.current.size === 0 ? { kind: 'idle' } : { kind: 'done' };
    if (g.touch) onFinger?.(null);
    release(g, e, cancelled);
    // A finger that lifted leaves no hover behind: its readout stays in the chip (App).
    if (g.touch) onHover(null);
  };
  /** What a press does when it ends: a drag commits, a tap places, selects or asks. */
  const release = (
    g: Extract<Gesture, { kind: 'press' }>,
    e: React.PointerEvent<SVGSVGElement>,
    cancelled: boolean,
  ): void => {
    const fired = g.lp?.state === 'fired';
    endPress(g);
    if (cancelled || fired) return;
    const at = toChart(e.clientX, e.clientY);
    if (g.place) {
      // A plain tap places at once; a press that aimed places where it was let go.
      if (onPlace && inside(at)) onPlace(clampGamma(at));
      return;
    }
    if (g.moved) return;
    // A tap on a hollow user datapoint (within its halo) starts the network there.
    if (g.user !== null && g.point === null) {
      lastTap.current = null;
      onStartDatapoint?.(g.user);
      return;
    }
    const tap: Tap = { x: e.clientX, y: e.clientY, t: e.timeStamp, point: g.point };
    if (g.touch && isDoubleTapOnMarker(lastTap.current, tap) && g.point !== null) {
      // A double tap on a marker asks for suggestions towards it; on empty chart it does nothing.
      lastTap.current = null;
      const mg = gammas[g.point];
      if (mg) onSuggest(clampGamma(mg), e.clientX, e.clientY, true);
      return;
    }
    lastTap.current = tap;
    if (g.point === null) onSelect(null);
  };
  const onPointerUp = (e: React.PointerEvent<SVGSVGElement>): void => finish(e, false);
  /**
   * The browser took the pointer (or the window lost it): end a point drag as
   * a release would, without placing, selecting or opening anything.
   */
  const onPointerCancel = (e: React.PointerEvent<SVGSVGElement>): void => finish(e, true);

  // The Fit button resets zoom and pan.
  const [lastFit, setLastFit] = useState(fitKey);
  if (fitKey !== lastFit) {
    setLastFit(fitKey);
    setViewState(HOME);
  }
  // The handlers read the view from the ref: it follows the state (the Fit above sets only that).
  useLayoutEffect(() => {
    viewRef.current = view;
  }, [view]);

  const labelDensity = useSettings((s) => s.settings.labelDensity);
  /** Element loci scale with the locus width of the settings (2 px is the standard). */
  const locus = useSettings((s) => s.settings.locusWidth) / 2;
  const zCircles = options.zGrid ? gridCircles(options.density, 1) : [];
  const yCircles = options.yGrid ? gridCircles(options.density, -1) : [];
  const labels = options.labels
    ? [
        ...(options.zGrid ? gridLabels(options.density, 1, labelDensity) : []),
        ...(options.yGrid && !options.zGrid ? gridLabels(options.density, -1, labelDensity) : []),
      ]
    : [];
  const fontSize = 0.045 * k;
  /** Datapoint markers 12 px wide and their labels 1.15x on a touch screen. */
  const scale = markerScale(coarse, framePx);
  const mk = k * scale.marker;
  const dpFont = fontSize * scale.label;

  return (
    <svg
      ref={svgRef}
      className="smith-chart"
      viewBox={`${view.cx - view.half} ${view.cy - view.half} ${2 * view.half} ${2 * view.half}`}
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="Smith chart"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onPointerLeave={() => {
        if (gesture.current.kind === 'idle') onHover(null);
      }}
      onDoubleClick={(e) => {
        // A touch screen's double tap is handled with the taps (on a marker only).
        if (lastPointer.current !== 'mouse') return;
        const g = toChart(e.clientX, e.clientY);
        if (inside(g)) onSuggest(clampGamma(g), e.clientX, e.clientY);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        // A touch screen opens the menu with its own long press (and only that).
        if (lastPointer.current !== 'mouse') return;
        const picked = pickAt(e.clientX, e.clientY, 'mouse');
        if (picked) {
          const mg = gammas[picked.index];
          if (mg) onContextMenu(mg, e.clientX, e.clientY, picked.index, crowdOf(picked.index));
          return;
        }
        const g = toChart(e.clientX, e.clientY);
        if (inside(g)) onContextMenu(g, e.clientX, e.clientY, null, []);
      }}
      // touch-action: none, -webkit-touch-callout: none and user-select: none are in index.css.
      style={{ cursor: dragging ? 'grabbing' : 'crosshair' }}
    >
      <defs>
        <clipPath id="unit-disk">
          <circle cx={0} cy={0} r={1} />
        </clipPath>
      </defs>
      <circle cx={0} cy={0} r={1} className="chart-disk" />
      <g
        clipPath="url(#unit-disk)"
        className="grid-y"
        fill="none"
        vectorEffect="non-scaling-stroke"
      >
        {yCircles.map((c, i) => (
          <circle
            key={i}
            cx={c.cx}
            cy={c.cy}
            r={c.r}
            className={c.major ? 'major' : 'minor'}
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </g>
      <g clipPath="url(#unit-disk)" className="grid-z" fill="none">
        {zCircles.map((c, i) => (
          <circle
            key={i}
            cx={c.cx}
            cy={c.cy}
            r={c.r}
            className={c.major ? 'major' : 'minor'}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        <line x1={-1} y1={0} x2={1} y2={0} className="major" vectorEffect="non-scaling-stroke" />
      </g>
      <circle
        cx={0}
        cy={0}
        r={1}
        className="chart-rim"
        fill="none"
        vectorEffect="non-scaling-stroke"
      />
      <g className="grid-labels" fontSize={fontSize}>
        {labels.map((l, i) => (
          <text
            key={i}
            x={l.x}
            y={l.y === 0 ? -0.012 * k : l.y + fontSize * 0.35}
            textAnchor={l.anchor}
          >
            {l.text}
          </text>
        ))}
      </g>

      <g className="circles" fill="none" clipPath="url(#unit-disk)">
        {vswrCircles.map((v) => (
          <circle
            key={`v${v}`}
            cx={0}
            cy={0}
            r={(v - 1) / (v + 1)}
            className="vswr"
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {qContours.flatMap((q) =>
          [1, -1].map((s) => (
            <circle
              key={`q${q}${s}`}
              cx={0}
              cy={s / q}
              r={Math.sqrt(1 + 1 / (q * q))}
              className="q"
              vectorEffect="non-scaling-stroke"
            />
          )),
        )}
      </g>

      <g className="device-circles" fill="none">
        {(() => {
          /** Labels already placed, so a second one at the same spot moves down a line. */
          const placed: { x: number; y: number }[] = [];
          const apart = (x: number, y: number): [number, number] => {
            let yy = y;
            for (const p of placed) {
              if (Math.abs(p.x - x) < 0.3 * k && Math.abs(p.y - yy) < fontSize * 1.2) {
                yy = p.y + fontSize * 1.2;
              }
            }
            placed.push({ x, y: yy });
            return [x, yy];
          };
          return deviceCircles.map((c, i) => {
            const { center, radius } = c.circle;
            if (!(radius < 50)) return null;
            // Label at the top of the circle; a stability circle that dwarfs the
            // chart is described in the device panel instead.
            if (radius >= 1.5 && c.kind === 'stability') {
              // Label where the circle comes closest to the chart centre, which is
              // the part of it that lies on or near the chart.
              const d = Math.hypot(center.re, center.im) || 1;
              // Distance of that point from the centre, clamped to the chart edge so the
              // label stays in view when the circle lies entirely outside the chart.
              const reach = Math.max(-1.02, Math.min(1.02, d - radius));
              const px = (center.re / d) * reach;
              const py = (center.im / d) * reach;
              const [lx, ly] = apart(px, -py - 0.02 * k);
              return (
                <g key={i} className={c.kind}>
                  <circle
                    cx={center.re}
                    cy={-center.im}
                    r={radius}
                    vectorEffect="non-scaling-stroke"
                  />
                  <text
                    x={lx}
                    y={ly}
                    textAnchor="middle"
                    fontSize={fontSize * 0.85}
                    strokeWidth={0.01 * k}
                  >
                    {c.label}
                  </text>
                </g>
              );
            }
            const ly = -center.im - radius - 0.02 * k;
            return (
              <g key={i} className={c.kind}>
                <circle
                  cx={center.re}
                  cy={-center.im}
                  r={radius}
                  vectorEffect="non-scaling-stroke"
                  clipPath={c.kind === 'stability' ? undefined : 'url(#unit-disk)'}
                />
                <text
                  x={center.re}
                  y={ly}
                  textAnchor="middle"
                  fontSize={fontSize * 0.85}
                  strokeWidth={0.01 * k}
                >
                  {c.label}
                </text>
              </g>
            );
          });
        })()}
      </g>

      {cloud && (
        <path
          className={`mc-cloud ${cloudStale ? 'stale' : ''}`}
          d={cloud}
          fill="none"
          vectorEffect="non-scaling-stroke"
        />
      )}

      {sweep && sweepKind === 'datapoints' && (
        <g className="sweep points" fill="none">
          {(() => {
            // Every point keeps its marker; a long sweep labels only some of them.
            // Points off the chart have no marker and take no label.
            const drawn: number[] = [];
            sweep.forEach((p, i) => {
              const g = zToGamma(p.zin, z0);
              if (Number.isFinite(g.re) && Number.isFinite(g.im)) drawn.push(i);
            });
            const anchorAt = anchor === null ? -1 : drawn.indexOf(anchor);
            const picked = labelledSweepIndices(
              drawn.length,
              MAX_SWEEP_LABELS,
              anchorAt >= 0 ? anchorAt : null,
            ).map((j) => drawn[j] as number);
            // The design point wins a collision, then the first and last; the rest give way.
            const first = picked[0];
            const last = picked[picked.length - 1];
            const must = [anchor, first, last].filter(
              (i, at, all): i is number => i !== null && i !== undefined && all.indexOf(i) === at,
            );
            const order = [
              ...must.filter((i) => picked.includes(i)),
              ...picked.filter((i) => !must.includes(i)),
            ];
            const at = (i: number): { x: number; y: number } => {
              const g = zToGamma((sweep[i] as SweepPoint).zin, z0);
              return { x: g.re, y: -g.im };
            };
            // "SP" plus the digits of the highest number, in the 0.85 font, after the offset.
            const width = fontSize * (1.6 + 0.6 * String(sweep.length).length);
            const labelled = new Set(declutterLabels(order, at, width, fontSize * 0.95));
            return sweep.map((p, i) => {
              const g = zToGamma(p.zin, z0);
              if (!Number.isFinite(g.re) || !Number.isFinite(g.im)) return null;
              return (
                <g key={i}>
                  <circle cx={g.re} cy={-g.im} r={0.018 * k} className="sweep-end">
                    <title>{`SP${i + 1}: ${fmtFrequency(p.frequency)}, VSWR ${fmtNum(p.info.vswr, 2)}`}</title>
                  </circle>
                  {labelled.has(i) && (
                    <text
                      x={g.re + 0.028 * k}
                      y={-g.im + fontSize * 0.35}
                      fontSize={fontSize * 0.85}
                    >
                      SP{i + 1}
                    </text>
                  )}
                </g>
              );
            });
          })()}
        </g>
      )}

      {sweep && sweepKind === 'frequency' && sweep.length > 1 && (
        <g className="sweep" fill="none">
          <path
            d={pathOf(
              sweep.map((p) => p.zin),
              z0,
            )}
            vectorEffect="non-scaling-stroke"
          />
          {[sweep[0], sweep[sweep.length - 1]].map((p, i) => {
            if (!p) return null;
            const g = zToGamma(p.zin, z0);
            return (
              <g key={i}>
                <circle cx={g.re} cy={-g.im} r={0.014 * k} className="sweep-end" />
                <text x={g.re + 0.025 * k} y={-g.im + fontSize * 0.35} fontSize={fontSize * 0.85}>
                  {fmtFrequency(p.frequency)}
                </text>
              </g>
            );
          })}
        </g>
      )}

      <g className="arcs" fill="none">
        {result.arcs.map((arc, i) => (
          <path
            key={i}
            d={pathOf(arc, z0)}
            stroke={arcColors[i] ?? 'currentColor'}
            strokeWidth={0.012 * k * locus}
            strokeLinecap="round"
            opacity={selected === null || selected === i + 1 || selected === i ? 1 : 0.45}
          />
        ))}
      </g>

      {realized && (
        <g className="realized" fill="none" pointerEvents="none">
          {realizedSweep && realizedSweep.length > 1 && (
            <path
              className="realized-sweep"
              d={pathOf(
                realizedSweep.map((p) => p.zin),
                z0,
              )}
              vectorEffect="non-scaling-stroke"
            />
          )}
          {realized.arcs.map((arc, i) => (
            <path
              key={i}
              d={pathOf(arc, z0)}
              stroke={arcColors[i] ?? 'currentColor'}
              strokeWidth={0.009 * k * locus}
              strokeDasharray={`${0.035 * k} ${0.022 * k}`}
              strokeLinecap="butt"
              opacity={selected === null || selected === i + 1 || selected === i ? 0.9 : 0.4}
            />
          ))}
          {realized.datapoints.map((z, i) => {
            if (i === 0) return null;
            const g = zToGamma(z, z0);
            return (
              <circle
                key={i}
                cx={g.re}
                cy={-g.im}
                r={(i === realized.datapoints.length - 1 ? 0.022 : 0.014) * k}
                className="realized-dp"
                strokeWidth={0.006 * k}
              />
            );
          })}
        </g>
      )}

      {packaged && (
        <g className="packaged" fill="none" pointerEvents="none">
          {packagedSweep && packagedSweep.length > 1 && (
            <path
              className="packaged-sweep"
              d={pathOf(
                packagedSweep.map((p) => p.zin),
                z0,
              )}
              vectorEffect="non-scaling-stroke"
            />
          )}
          {packaged.arcs.map((arc, i) => (
            <path
              key={i}
              d={pathOf(arc, z0)}
              stroke={arcColors[i] ?? 'currentColor'}
              strokeWidth={0.011 * k * locus}
              strokeDasharray={`${0.004 * k} ${0.018 * k}`}
              strokeLinecap="round"
              opacity={selected === null || selected === i + 1 || selected === i ? 0.95 : 0.4}
            />
          ))}
          {packaged.datapoints.map((z, i) => {
            if (i === 0) return null;
            const g = zToGamma(z, z0);
            const r = (i === packaged.datapoints.length - 1 ? 0.02 : 0.013) * k;
            return (
              <rect
                key={i}
                x={g.re - r}
                y={-g.im - r}
                width={2 * r}
                height={2 * r}
                transform={`rotate(45 ${g.re} ${-g.im})`}
                className="packaged-dp"
                strokeWidth={0.006 * k}
              />
            );
          })}
        </g>
      )}

      {ghost && (
        <g className="ghost" fill="none" pointerEvents="none">
          {ghost.reach.length > 1 && (
            <path d={pathOf(ghost.reach, z0)} className="reach" vectorEffect="non-scaling-stroke" />
          )}
          {ghost.arcs.map((arc, i) => (
            <path
              key={i}
              d={pathOf(arc, z0)}
              className="arc"
              stroke={ghost.color}
              strokeWidth={0.014 * k}
            />
          ))}
          {ghost.marker &&
            (() => {
              const g = zToGamma(ghost.marker, z0);
              // On a touch screen the label stands above the point, clear of the finger.
              const lift = coarse && framePx > 0 ? (48 * 2 * view.half) / framePx : 0;
              return (
                <>
                  <circle
                    cx={g.re}
                    cy={-g.im}
                    r={0.03 * k}
                    className={ghost.unreachable ? 'marker unreachable' : 'marker'}
                    strokeWidth={0.008 * k}
                    {...(ghost.unreachable ? { strokeDasharray: `${0.014 * k} ${0.01 * k}` } : {})}
                  />
                  <text
                    className={ghost.unreachable ? 'unreachable' : undefined}
                    x={coarse ? g.re : g.re + 0.045 * k}
                    y={coarse ? -g.im - lift : -g.im + 0.015 * k}
                    textAnchor={coarse ? 'middle' : undefined}
                    fontSize={fontSize * 0.9}
                    strokeWidth={0.012 * k}
                  >
                    {ghost.label}
                  </text>
                </>
              );
            })()}
        </g>
      )}

      {(() => {
        const gt = zToGamma(target, z0);
        if (!Number.isFinite(gt.re) || !Number.isFinite(gt.im)) return null;
        return (
          <g className="target" aria-label="Target impedance">
            <rect
              x={gt.re - 0.04 * k}
              y={-gt.im - 0.04 * k}
              width={0.08 * k}
              height={0.08 * k}
              strokeWidth={0.006 * k}
              transform={`rotate(45 ${gt.re} ${-gt.im})`}
            />
            <text
              x={gt.re + 0.05 * k}
              y={-gt.im + 0.05 * k}
              fontSize={fontSize}
              fontWeight={600}
              strokeWidth={0.012 * k}
            >
              Target
            </text>
          </g>
        );
      })()}

      {userPoints.length > 0 && (
        <g className="user-datapoints">
          {userPoints.map((p) => {
            const g = zToGamma(p.z, z0);
            if (!Number.isFinite(g.re) || !Number.isFinite(g.im)) return null;
            const label = `DP${p.index + 1}`;
            return (
              // The chart picks it within the halo on press (a tap starts the network here);
              // with a part armed or datapoint input on, the press places instead.
              <g
                key={p.index}
                className="udp"
                role="img"
                aria-label={`${label}, ${coarse ? 'tap' : 'click'} to start the network here`}
              >
                <title>{`${label}: ${coarse ? 'tap' : 'click'} to start the network here`}</title>
                <circle cx={g.re} cy={-g.im} r={0.026 * mk} strokeWidth={0.008 * k} />
                <text
                  x={g.re + 0.04 * mk}
                  y={-g.im - 0.03 * mk}
                  fontSize={dpFont}
                  fontWeight={700}
                  strokeWidth={0.012 * k}
                >
                  {label}
                </text>
              </g>
            );
          })}
        </g>
      )}

      <g className="datapoints">
        {gammas.map((g, i) => (
          <g
            key={i}
            className={`dp${i === selected ? ' selected' : ''}${i === pulsePoint ? ' pulse' : ''}`}
            role="button"
            aria-label={`${datapointLabel(i, dpCount, startSlot)}, drag to tune`}
          >
            {/* Stroke widths in chart units: a CSS px width would be taken as chart units here.
                The two ends of the chain, load and source, are squares; the nodes between are dots.
                The chart picks a marker by its nearest centre (the halo), not by this shape. */}
            {i === 0 || i === gammas.length - 1 ? (
              <rect
                x={g.re - (i === selected ? 0.032 : 0.025) * mk}
                y={-g.im - (i === selected ? 0.032 : 0.025) * mk}
                width={(i === selected ? 0.064 : 0.05) * mk}
                height={(i === selected ? 0.064 : 0.05) * mk}
                strokeWidth={0.006 * k}
              />
            ) : (
              <circle
                cx={g.re}
                cy={-g.im}
                r={(i === selected ? 0.034 : 0.026) * mk}
                strokeWidth={0.006 * k}
              />
            )}
            <text
              x={g.re + 0.04 * mk}
              y={-g.im - 0.03 * mk}
              fontSize={dpFont}
              fontWeight={700}
              strokeWidth={0.012 * k}
            >
              {datapointLabel(i, dpCount, startSlot)}
            </text>
          </g>
        ))}
      </g>
    </svg>
  );
}
