/**
 * Redesign phase 5: the gesture arithmetic of the chart (chart/gestures.ts,
 * docs/07 section 6) in node: the pinch about the midpoint, the zoom limits,
 * the long press, the nearest-centre pick with its halo and tie rule, and the
 * marker size on a touch screen.
 */
import { describe, expect, it } from 'vitest';
import {
  chartToScreen,
  crowdedWith,
  frameOf,
  HALF_MAX,
  HALF_MIN,
  hitRadius,
  HOME,
  isDoubleTapOnMarker,
  LONG_PRESS_MS,
  longPressCancel,
  longPressMove,
  longPressStart,
  longPressTick,
  markerScale,
  nearestMarker,
  panView,
  pinchView,
  screenToChart,
  wheelZoom,
  zoomAbout,
  type Frame,
  type Marker,
  type View,
} from '../src/chart/gestures';

const frame: Frame = { left: 0, top: 100, size: 400 };

describe('screen and chart points', () => {
  it('round-trips a point at any view', () => {
    const view: View = { cx: 0.3, cy: -0.2, half: 0.4 };
    const p = { x: 123, y: 321 };
    const back = chartToScreen(view, frame, screenToChart(view, frame, p));
    expect(back.x).toBeCloseTo(p.x, 9);
    expect(back.y).toBeCloseTo(p.y, 9);
  });

  it('frames a non-square box as a centred square (preserveAspectRatio meet)', () => {
    expect(frameOf(10, 20, 600, 400)).toEqual({ left: 110, top: 20, size: 400 });
  });

  it('a one-finger pan moves the chart with the finger', () => {
    const v = panView(HOME, frame, 40, -20);
    const u = (2 * HOME.half) / frame.size;
    expect(v.cx).toBeCloseTo(-40 * u, 12);
    expect(v.cy).toBeCloseTo(20 * u, 12);
    expect(v.half).toBe(HOME.half);
  });
});

describe('pinch', () => {
  it('keeps the chart point under the midpoint fixed while the fingers spread', () => {
    const start = { view: HOME, a: { x: 150, y: 250 }, b: { x: 250, y: 350 } };
    const mid = { x: 200, y: 300 };
    const under = screenToChart(HOME, frame, mid);
    // Twice the spread about the same midpoint: zoom in by two.
    const v = pinchView(start, { x: 100, y: 200 }, { x: 300, y: 400 }, frame);
    expect(v.half).toBeCloseTo(HOME.half / 2, 12);
    const now = screenToChart(v, frame, mid);
    expect(now.x).toBeCloseTo(under.x, 12);
    expect(now.y).toBeCloseTo(under.y, 12);
  });

  it('keeps an off-centre midpoint fixed too', () => {
    const view: View = { cx: 0.2, cy: 0.1, half: 0.6 };
    const start = { view, a: { x: 20, y: 120 }, b: { x: 60, y: 160 } };
    const mid = { x: 40, y: 140 };
    const under = screenToChart(view, frame, mid);
    const v = pinchView(start, { x: 10, y: 110 }, { x: 70, y: 170 }, frame);
    const now = screenToChart(v, frame, mid);
    expect(now.x).toBeCloseTo(under.x, 12);
    expect(now.y).toBeCloseTo(under.y, 12);
  });

  it('two fingers moved together pan without zooming', () => {
    const start = { view: HOME, a: { x: 150, y: 250 }, b: { x: 250, y: 350 } };
    const v = pinchView(start, { x: 180, y: 250 }, { x: 280, y: 350 }, frame);
    expect(v.half).toBeCloseTo(HOME.half, 12);
    const u = (2 * HOME.half) / frame.size;
    expect(v.cx).toBeCloseTo(-30 * u, 12);
    expect(v.cy).toBeCloseTo(0, 12);
  });

  it('holds the zoom limits 0.05 and 4', () => {
    const start = { view: HOME, a: { x: 199, y: 300 }, b: { x: 201, y: 300 } };
    expect(pinchView(start, { x: 0, y: 300 }, { x: 400, y: 300 }, frame).half).toBe(HALF_MIN);
    const wide = { view: HOME, a: { x: 0, y: 300 }, b: { x: 400, y: 300 } };
    expect(pinchView(wide, { x: 199, y: 300 }, { x: 201, y: 300 }, frame).half).toBe(HALF_MAX);
    expect(HALF_MIN).toBe(0.05);
    expect(HALF_MAX).toBe(4);
  });

  it('a pinch that starts with the fingers on one spot counts them 8 px apart', () => {
    // Phase 5 QA: the start spread has a floor of PINCH_MIN_PX, so spreading to 60 px still
    // zooms (60 / 8 = 7.5 times in) instead of freezing the zoom for the whole pinch.
    const start = { view: HOME, a: { x: 200, y: 300 }, b: { x: 200, y: 300 } };
    expect(pinchView(start, { x: 200, y: 300 }, { x: 260, y: 300 }, frame).half).toBeCloseTo(
      HOME.half / 7.5,
      12,
    );
  });

  it('the wheel zooms about the cursor within the same limits', () => {
    const at = { x: 0.5, y: -0.25 };
    const v = zoomAbout(HOME, at, 0.5);
    expect(v.half).toBeCloseTo(0.59, 12);
    // The cursor point stays where it was relative to the view.
    expect((at.x - v.cx) / v.half).toBeCloseTo((at.x - HOME.cx) / HOME.half, 12);
    expect(wheelZoom(HOME, at, -1e6).half).toBe(HALF_MIN);
    expect(wheelZoom(HOME, at, 1e6).half).toBe(HALF_MAX);
  });
});

describe('long press', () => {
  it('fires at 400 ms and not before', () => {
    const lp = longPressStart(100, 100, 1000);
    expect(longPressTick(lp, 1000 + LONG_PRESS_MS - 1).state).toBe('pending');
    expect(longPressTick(lp, 1000 + LONG_PRESS_MS).state).toBe('fired');
    expect(LONG_PRESS_MS).toBe(400);
  });

  it('stays pending within 10 px and cancels beyond', () => {
    const lp = longPressStart(100, 100, 0);
    expect(longPressMove(lp, 106, 108).state).toBe('pending'); // exactly 10 px
    const moved = longPressMove(lp, 108, 108); // 11.3 px
    expect(moved.state).toBe('cancelled');
    expect(longPressTick(moved, 500).state).toBe('cancelled');
  });

  it('a second pointer cancels it', () => {
    const lp = longPressCancel(longPressStart(0, 0, 0));
    expect(lp.state).toBe('cancelled');
    expect(longPressTick(lp, 1000).state).toBe('cancelled');
  });

  it('a press that fired does not cancel on later movement', () => {
    const fired = longPressTick(longPressStart(0, 0, 0), 400);
    expect(longPressMove(fired, 50, 50).state).toBe('fired');
    expect(longPressCancel(fired).state).toBe('fired');
  });
});

describe('nearest-centre pick', () => {
  // DP1 and TP2 10 px apart on a 400 px chart at the home view.
  const u = (2 * HOME.half) / frame.size;
  const markers: Marker[] = [
    { index: 0, x: 0, y: 0 },
    { index: 1, x: 10 * u, y: 0 },
  ];
  const radius = hitRadius(HOME, frame);

  it('picks DP1 or TP2 by the nearer centre when they are 10 px apart', () => {
    expect(nearestMarker(markers, { x: 3 * u, y: 4 * u }, radius, null)?.index).toBe(0);
    expect(nearestMarker(markers, { x: 7 * u, y: -4 * u }, radius, null)?.index).toBe(1);
    // Within the halo but outside both markers' drawn size.
    expect(nearestMarker(markers, { x: 25 * u, y: 0 }, radius, null)?.index).toBe(1);
  });

  it('picks nothing outside the 22 px halo', () => {
    expect(nearestMarker(markers, { x: -23 * u, y: 0 }, radius, null)).toBeNull();
    expect(nearestMarker(markers, { x: -21.9 * u, y: 0 }, radius, null)?.index).toBe(0);
  });

  it('the selected point wins a tie', () => {
    const mid = { x: 5 * u, y: 0 };
    expect(nearestMarker(markers, mid, radius, 1)?.index).toBe(1);
    expect(nearestMarker(markers, mid, radius, 0)?.index).toBe(0);
    // Coinciding markers go to the selected one, whatever the order.
    const same: Marker[] = [
      { index: 2, x: 0.1, y: 0.1 },
      { index: 3, x: 0.1, y: 0.1 },
    ];
    expect(nearestMarker(same, { x: 0.1, y: 0.1 }, radius, 2)?.index).toBe(2);
    expect(nearestMarker(same, { x: 0.1, y: 0.1 }, radius, 3)?.index).toBe(3);
    // Clearly nearer beats selected.
    expect(nearestMarker(markers, { x: 1 * u, y: 0 }, radius, 1)?.index).toBe(0);
  });

  it('converts the 22 px halo to chart units at three zoom levels', () => {
    for (const half of [HOME.half, 0.3, 3]) {
      const view: View = { cx: 0, cy: 0, half };
      expect(hitRadius(view, frame)).toBeCloseTo((22 * 2 * half) / 400, 12);
    }
    // Zoomed in 4x, a marker 10 chart-px away at home is 40 px away: outside the halo.
    const zoomed: View = { cx: 0, cy: 0, half: HOME.half / 4 };
    expect(
      nearestMarker([markers[1] as Marker], { x: 0, y: 0 }, hitRadius(zoomed, frame), null),
    ).toBeNull();
  });

  it('names the markers within 12 px of the picked one', () => {
    const crowd: Marker[] = [
      { index: 0, x: 0, y: 0 },
      { index: 1, x: 11 * u, y: 0 },
      { index: 2, x: 5 * u, y: 0 },
      { index: 3, x: 40 * u, y: 0 },
    ];
    expect(crowdedWith(crowd, 0, 12 * u).map((m) => m.index)).toEqual([2, 1]);
    expect(crowdedWith(crowd, 3, 12 * u)).toEqual([]);
  });
});

describe('marker scale on a touch screen', () => {
  it('draws the datapoint markers 12 px wide and the labels 1.15x', () => {
    for (const size of [340, 390, 700]) {
      const s = markerScale(true, size);
      // The dot radius 0.026 k over a viewBox side of 2 half: 0.026 * size / 1.18 px across.
      expect(s.marker * ((0.026 * 2 * size) / (2 * 1.18))).toBeCloseTo(12, 9);
      expect(s.label).toBe(1.15);
    }
  });

  it('leaves a mouse at 1', () => {
    expect(markerScale(false, 390)).toEqual({ marker: 1, label: 1 });
    expect(markerScale(true, 0)).toEqual({ marker: 1, label: 1 });
  });
});

describe('double tap', () => {
  it('is two quick taps on the same marker', () => {
    const first = { x: 10, y: 10, t: 0, point: 2 };
    expect(isDoubleTapOnMarker(first, { x: 14, y: 12, t: 250, point: 2 })).toBe(true);
    expect(isDoubleTapOnMarker(first, { x: 14, y: 12, t: 350, point: 2 })).toBe(false);
    expect(isDoubleTapOnMarker(first, { x: 14, y: 12, t: 250, point: 3 })).toBe(false);
    // Empty chart: never.
    const empty = { x: 10, y: 10, t: 0, point: null };
    expect(isDoubleTapOnMarker(empty, { x: 10, y: 10, t: 100, point: null })).toBe(false);
    expect(isDoubleTapOnMarker(null, { x: 10, y: 10, t: 100, point: 1 })).toBe(false);
  });
});
