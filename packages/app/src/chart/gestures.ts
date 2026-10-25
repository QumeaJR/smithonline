/**
 * The gesture arithmetic of the Smith chart (docs/07-interaction-redesign.md
 * section 6), pure and tested in node: the view and its zoom limits, the
 * wheel zoom about the cursor, the pinch about the midpoint with its
 * two-finger pan, the long press, the nearest-centre pick of a marker within
 * a halo of 22 screen pixels, and the marker size on a touch screen.
 *
 * Chart units are those of the SVG: x is Re(Gamma), y is -Im(Gamma). Screen
 * points are client pixels.
 */

/** The visible square of the chart: its centre and half its side, in chart units. */
export interface View {
  readonly cx: number;
  readonly cy: number;
  readonly half: number;
}

/** The view after Fit: the unit disc with room for the rim labels. */
export const HOME: View = { cx: 0, cy: 0, half: 1.18 };

/**
 * The zoom limits as half the visible side, chart units (disc radii): deep zoom 0.05, far
 * out 4. At Fit the half side is 1.18, so the zoom reaches about 24 times in and 3.4 out.
 */
export const HALF_MIN = 0.05;
export const HALF_MAX = 4;

export function clampHalf(half: number): number {
  if (Number.isNaN(half)) return HOME.half;
  return Math.min(HALF_MAX, Math.max(HALF_MIN, half));
}

/** A point on the screen or in the chart. */
export interface Point {
  readonly x: number;
  readonly y: number;
}

/**
 * Where the square viewBox lies on the screen: the SVG draws it centred in
 * its box at the largest size that fits (preserveAspectRatio meet).
 */
export interface Frame {
  readonly left: number;
  readonly top: number;
  /** The side of the drawn square, px. */
  readonly size: number;
}

/** The frame of an SVG box of this position and size. */
export function frameOf(left: number, top: number, width: number, height: number): Frame {
  const size = Math.max(0, Math.min(width, height));
  return { left: left + (width - size) / 2, top: top + (height - size) / 2, size };
}

/** Chart units per screen pixel at this view; 0 for a frame without size. */
export function unitsPerPx(view: View, frame: Frame): number {
  return frame.size > 0 ? (2 * view.half) / frame.size : 0;
}

/** The chart point under a screen point. */
export function screenToChart(view: View, frame: Frame, p: Point): Point {
  const u = unitsPerPx(view, frame);
  return {
    x: view.cx - view.half + (p.x - frame.left) * u,
    y: view.cy - view.half + (p.y - frame.top) * u,
  };
}

/** The screen point of a chart point. */
export function chartToScreen(view: View, frame: Frame, c: Point): Point {
  const u = unitsPerPx(view, frame);
  if (u === 0) return { x: frame.left, y: frame.top };
  return {
    x: frame.left + (c.x - view.cx + view.half) / u,
    y: frame.top + (c.y - view.cy + view.half) / u,
  };
}

const finitePoint = (p: Point): boolean => Number.isFinite(p.x) && Number.isFinite(p.y);

/**
 * Zoom by `factor` (above 1 zooms out) about the chart point `at`, within the limits. A
 * point that is not finite zooms about the centre; a factor that is not a number keeps the zoom.
 */
export function zoomAbout(view: View, at: Point, factor: number): View {
  const half = clampHalf(view.half * (Number.isNaN(factor) ? 1 : factor));
  const s = half / view.half;
  const c = finitePoint(at) ? at : { x: view.cx, y: view.cy };
  return { half, cx: c.x + (view.cx - c.x) * s, cy: c.y + (view.cy - c.y) * s };
}

/** The wheel zoom of a mouse: about the cursor, a notch of 100 is about 16 percent. */
export function wheelZoom(view: View, at: Point, deltaY: number): View {
  return zoomAbout(view, at, Math.exp(deltaY * 0.0015));
}

/** A pan by a screen movement of the pointer (dx, dy in px) from the view at its start. */
export function panView(start: View, frame: Frame, dx: number, dy: number): View {
  const u = unitsPerPx(start, frame);
  return { ...start, cx: start.cx - dx * u, cy: start.cy - dy * u };
}

/** Two fingers on the chart: where they were when the pinch began, and the view then. */
export interface PinchStart {
  readonly view: View;
  readonly a: Point;
  readonly b: Point;
}

/**
 * Two fingers that start closer than this count as this far apart, px, so a
 * pinch that starts with both on one spot still zooms once they spread.
 */
export const PINCH_MIN_PX = 8;

/**
 * The view of a pinch: the spread of the fingers scales the zoom (apart
 * zooms in), within the limits, and the chart point that was under their
 * midpoint at the start stays under their midpoint now, so moving both
 * fingers together pans. A finger at a point that is not finite keeps the
 * view of the start.
 */
export function pinchView(start: PinchStart, a: Point, b: Point, frame: Frame): View {
  if (![start.a, start.b, a, b].every(finitePoint)) return start.view;
  const d0 = Math.max(PINCH_MIN_PX, Math.hypot(start.b.x - start.a.x, start.b.y - start.a.y));
  const d1 = Math.hypot(b.x - a.x, b.y - a.y);
  const half = d1 > 0 ? clampHalf((start.view.half * d0) / d1) : start.view.half;
  const m0 = { x: (start.a.x + start.b.x) / 2, y: (start.a.y + start.b.y) / 2 };
  const m1 = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const fixed = screenToChart(start.view, frame, m0);
  const u = frame.size > 0 ? (2 * half) / frame.size : 0;
  return {
    half,
    cx: fixed.x + half - (m1.x - frame.left) * u,
    cy: fixed.y + half - (m1.y - frame.top) * u,
  };
}

/* ------------------------------------------------------------------------------------------ */
/* Long press                                                                                 */
/* ------------------------------------------------------------------------------------------ */

/** A press held this long opens the context menu, ms. */
export const LONG_PRESS_MS = 400;
/** Moving further than this from the press point cancels a long press, px. */
export const LONG_PRESS_SLOP = 10;

export interface LongPress {
  readonly x: number;
  readonly y: number;
  /** When the press began, ms. */
  readonly t: number;
  readonly state: 'pending' | 'fired' | 'cancelled';
}

export function longPressStart(x: number, y: number, t: number): LongPress {
  return { x, y, t, state: 'pending' };
}

/**
 * The finger moved: further than the slop, or to a point that is not finite, cancels a
 * press that has not fired.
 */
export function longPressMove(lp: LongPress, x: number, y: number): LongPress {
  if (lp.state !== 'pending') return lp;
  return Math.hypot(x - lp.x, y - lp.y) <= LONG_PRESS_SLOP ? lp : { ...lp, state: 'cancelled' };
}

/** A second finger came down (a pinch) or the press ended: a pending press is cancelled. */
export function longPressCancel(lp: LongPress): LongPress {
  return lp.state === 'pending' ? { ...lp, state: 'cancelled' } : lp;
}

/** The clock reached `t`: a press still pending fires at LONG_PRESS_MS. */
export function longPressTick(lp: LongPress, t: number): LongPress {
  return lp.state === 'pending' && t - lp.t >= LONG_PRESS_MS ? { ...lp, state: 'fired' } : lp;
}

/* ------------------------------------------------------------------------------------------ */
/* Picking a marker                                                                           */
/* ------------------------------------------------------------------------------------------ */

/** The halo of a marker on a touch screen: a 44 px target, 22 px radius from its centre. */
export const HIT_RADIUS_PX = 22;
/** The halo with a mouse, which points precisely, px. */
export const MOUSE_HIT_RADIUS_PX = 10;
/** Markers closer than this on the screen get a chooser row in the context sheet, px. */
export const CROWD_PX = 12;

/** A screen radius in chart units at the current zoom. */
export function hitRadius(view: View, frame: Frame, px = HIT_RADIUS_PX): number {
  return px * unitsPerPx(view, frame);
}

/** A marker that can be picked, at its place in chart units. */
export interface Marker {
  readonly index: number;
  readonly x: number;
  readonly y: number;
}

/**
 * The marker whose centre is nearest `at`, within `radius` (chart units),
 * or null, whatever the order of the markers (of two at exactly the same
 * distance the first wins). The selected marker wins a tie: when it lies no
 * more than `tie` further away than the nearest one (default a 44th of the
 * radius, half a pixel of the 22 px touch halo), it is picked. Without a
 * selection the nearest marker wins, however close the others are.
 */
export function nearestMarker(
  markers: readonly Marker[],
  at: Point,
  radius: number,
  selected: number | null,
  tie = radius / 44,
): Marker | null {
  let best: Marker | null = null;
  let bestD = Infinity;
  let mine: Marker | null = null;
  let mineD = Infinity;
  for (const m of markers) {
    if (!Number.isFinite(m.x) || !Number.isFinite(m.y)) continue;
    const d = Math.hypot(m.x - at.x, m.y - at.y);
    if (!(d <= radius)) continue;
    if (d < bestD) {
      best = m;
      bestD = d;
    }
    if (selected !== null && m.index === selected && d < mineD) {
      mine = m;
      mineD = d;
    }
  }
  return mine !== null && mineD - bestD <= tie ? mine : best;
}

/** The other markers within `radius` of marker `index` (chart units), nearest first. */
export function crowdedWith(markers: readonly Marker[], index: number, radius: number): Marker[] {
  const me = markers.find((m) => m.index === index);
  if (!me) return [];
  return markers
    .filter((m) => m.index !== index && Math.hypot(m.x - me.x, m.y - me.y) <= radius)
    .sort((p, q) => Math.hypot(p.x - me.x, p.y - me.y) - Math.hypot(q.x - me.x, q.y - me.y));
}

/* ------------------------------------------------------------------------------------------ */
/* Marker size on a touch screen                                                              */
/* ------------------------------------------------------------------------------------------ */

/** The radius of a datapoint dot as the chart draws it with a mouse, in units of the view. */
export const DOT_RADIUS = 0.026;
/** A datapoint marker on a touch screen is this wide on the screen, px. */
export const COARSE_MARKER_PX = 12;
/** Datapoint labels on a touch screen are this much larger (not 1.4x, which worsens overlaps). */
export const COARSE_LABEL_SCALE = 1.15;

export interface MarkerScale {
  /** Multiplies the size of every datapoint marker. */
  readonly marker: number;
  /** Multiplies the font size of the datapoint labels. */
  readonly label: number;
}

/**
 * How much larger the datapoint markers and their labels draw on a touch
 * screen: markers COARSE_MARKER_PX wide whatever the size of the chart
 * (they stay the same size on the screen at every zoom, as with a mouse),
 * labels COARSE_LABEL_SCALE larger. With a mouse both stay at 1.
 */
export function markerScale(coarse: boolean, framePx: number): MarkerScale {
  if (!coarse || !(framePx > 0)) return { marker: 1, label: 1 };
  // A dot of radius DOT_RADIUS * k (k = half / HOME.half) is DOT_RADIUS * size / HOME.half px
  // across at every zoom, so the factor depends on the size of the chart only.
  const px = (2 * DOT_RADIUS * framePx) / (2 * HOME.half);
  return { marker: COARSE_MARKER_PX / px, label: COARSE_LABEL_SCALE };
}

/* ------------------------------------------------------------------------------------------ */
/* Double tap                                                                                 */
/* ------------------------------------------------------------------------------------------ */

/** Two taps within this time make a double tap, ms. */
export const DOUBLE_TAP_MS = 300;
/** ... and within this distance of each other, px. */
export const DOUBLE_TAP_PX = 24;

export interface Tap {
  readonly x: number;
  readonly y: number;
  readonly t: number;
  /** The marker the tap picked, or null on empty chart. */
  readonly point: number | null;
}

/** Whether `tap` follows `last` as the second tap of a double tap on the same marker. */
export function isDoubleTapOnMarker(last: Tap | null, tap: Tap): boolean {
  return (
    last !== null &&
    tap.point !== null &&
    last.point === tap.point &&
    tap.t >= last.t &&
    tap.t - last.t <= DOUBLE_TAP_MS &&
    Math.hypot(tap.x - last.x, tap.y - last.y) <= DOUBLE_TAP_PX
  );
}
