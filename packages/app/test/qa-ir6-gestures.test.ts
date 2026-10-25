/**
 * QA, redesign phase 5: the unreached branches of chart/gestures.ts. Every
 * transition of the long-press machine with its 400 ms and 10 px boundaries,
 * the hit radius at the zoom limits 0.05 and 4, the double-tap window at
 * 300 ms and 24 px, and the nearest-centre pick without a selection
 * (docs/07 section 6). Expected values are hand calculations.
 */
import { describe, expect, it } from 'vitest';
import {
  clampHalf,
  crowdedWith,
  HALF_MAX,
  HALF_MIN,
  hitRadius,
  HOME,
  isDoubleTapOnMarker,
  longPressCancel,
  longPressMove,
  longPressStart,
  longPressTick,
  markerScale,
  nearestMarker,
  pinchView,
  unitsPerPx,
  wheelZoom,
  zoomAbout,
  type Frame,
  type Tap,
} from '../src/chart/gestures';

const frame: Frame = { left: 0, top: 0, size: 400 };

describe('long press: every state transition', () => {
  const start = longPressStart(100, 100, 1000);

  it('starts pending at the press point and time', () => {
    expect(start).toEqual({ x: 100, y: 100, t: 1000, state: 'pending' });
  });

  it('pending -> pending: a move of exactly 10 px (straight and diagonal 6-8-10)', () => {
    expect(longPressMove(start, 110, 100).state).toBe('pending');
    expect(longPressMove(start, 106, 108).state).toBe('pending');
    // Unchanged state hands back the same object (SmithChart compares by identity).
    expect(longPressMove(start, 106, 108)).toBe(start);
  });

  it('pending -> cancelled: just beyond 10 px', () => {
    expect(longPressMove(start, 110.01, 100).state).toBe('cancelled');
    expect(longPressMove(start, 106, 108.01).state).toBe('cancelled');
  });

  it('pending -> pending at 399.9 ms, pending -> fired at exactly 400 ms', () => {
    expect(longPressTick(start, 1399.9)).toBe(start);
    expect(longPressTick(start, 1400).state).toBe('fired');
    expect(longPressTick(start, 5000).state).toBe('fired');
  });

  it('pending -> cancelled by a second finger or the release', () => {
    expect(longPressCancel(start).state).toBe('cancelled');
  });

  it('fired is final: movement, a cancel and later ticks leave it fired', () => {
    const fired = longPressTick(start, 1400);
    expect(longPressMove(fired, 500, 500)).toBe(fired);
    expect(longPressCancel(fired)).toBe(fired);
    expect(longPressTick(fired, 9999)).toBe(fired);
  });

  it('cancelled is final: it never fires and never comes back to pending', () => {
    const cancelled = longPressCancel(start);
    expect(longPressTick(cancelled, 1400)).toBe(cancelled);
    expect(longPressMove(cancelled, 100, 100)).toBe(cancelled);
    expect(longPressCancel(cancelled)).toBe(cancelled);
  });
});

describe('hit radius at the zoom limits', () => {
  it('22 px is 0.0055 chart units at the deep limit and 0.44 at the far limit (400 px chart)', () => {
    // 22 px * (2 * half / 400 px)
    expect(hitRadius({ cx: 0, cy: 0, half: HALF_MIN }, frame)).toBeCloseTo(0.0055, 12);
    expect(hitRadius({ cx: 0, cy: 0, half: HALF_MAX }, frame)).toBeCloseTo(0.44, 12);
  });

  it('the mouse halo of 10 px is 0.0025 and 0.2 chart units there', () => {
    expect(hitRadius({ cx: 0, cy: 0, half: HALF_MIN }, frame, 10)).toBeCloseTo(0.0025, 12);
    expect(hitRadius({ cx: 0, cy: 0, half: HALF_MAX }, frame, 10)).toBeCloseTo(0.2, 12);
  });

  it('a chart without size has no halo', () => {
    expect(hitRadius(HOME, { left: 0, top: 0, size: 0 })).toBe(0);
    expect(unitsPerPx(HOME, { left: 0, top: 0, size: -5 })).toBe(0);
  });

  it('the wheel stops at the limits however hard it turns', () => {
    expect(wheelZoom(HOME, { x: 0, y: 0 }, -1e6).half).toBe(HALF_MIN);
    expect(wheelZoom(HOME, { x: 0, y: 0 }, 1e6).half).toBe(HALF_MAX);
  });

  it('at the deep limit a marker 21.9 px off is picked and one 22.1 px off is not', () => {
    const view = { cx: 0, cy: 0, half: HALF_MIN };
    const r = hitRadius(view, frame);
    const u = unitsPerPx(view, frame); // 0.00025 per px
    const marker = [{ index: 4, x: 0.01, y: 0.01 }];
    expect(nearestMarker(marker, { x: 0.01 + 21.9 * u, y: 0.01 }, r, null)?.index).toBe(4);
    expect(nearestMarker(marker, { x: 0.01 + 22.1 * u, y: 0.01 }, r, null)).toBeNull();
  });

  it('clampHalf holds NaN, infinities, zero and negatives inside the limits', () => {
    expect(clampHalf(Number.NaN)).toBe(HOME.half);
    expect(clampHalf(Infinity)).toBe(HALF_MAX);
    expect(clampHalf(-Infinity)).toBe(HALF_MIN);
    expect(clampHalf(0)).toBe(HALF_MIN);
    expect(clampHalf(-1)).toBe(HALF_MIN);
  });

  it('a zoom at a limit keeps the point under the cursor fixed', () => {
    // From half 0.05 a further zoom in is clamped: factor 1, the centre does not move.
    const deep = { cx: 0.3, cy: -0.2, half: HALF_MIN };
    expect(zoomAbout(deep, { x: 0.31, y: -0.19 }, 0.5)).toEqual(deep);
  });

  it('a pinch whose fingers end on one spot keeps the zoom', () => {
    const start = { view: HOME, a: { x: 100, y: 100 }, b: { x: 300, y: 100 } };
    expect(pinchView(start, { x: 200, y: 100 }, { x: 200, y: 100 }, frame).half).toBe(HOME.half);
  });
});

describe('double tap window', () => {
  const first: Tap = { x: 100, y: 100, t: 1000, point: 2 };

  it('300 ms apart is a double tap, 300.1 ms is not', () => {
    expect(isDoubleTapOnMarker(first, { x: 100, y: 100, t: 1300, point: 2 })).toBe(true);
    expect(isDoubleTapOnMarker(first, { x: 100, y: 100, t: 1300.1, point: 2 })).toBe(false);
  });

  it('24 px apart is a double tap, 24.01 px is not (straight and diagonal)', () => {
    expect(isDoubleTapOnMarker(first, { x: 124, y: 100, t: 1100, point: 2 })).toBe(true);
    expect(isDoubleTapOnMarker(first, { x: 124.01, y: 100, t: 1100, point: 2 })).toBe(false);
    // hypot(14.4, 19.19) = 23.99, just inside (an exact 24 on a diagonal is not representable)
    expect(isDoubleTapOnMarker(first, { x: 114.4, y: 119.19, t: 1100, point: 2 })).toBe(true);
  });

  it('no first tap, another marker, or empty chart is no double tap', () => {
    expect(isDoubleTapOnMarker(null, { x: 100, y: 100, t: 1100, point: 2 })).toBe(false);
    expect(isDoubleTapOnMarker(first, { x: 100, y: 100, t: 1100, point: 3 })).toBe(false);
    expect(isDoubleTapOnMarker(first, { x: 100, y: 100, t: 1100, point: null })).toBe(false);
    expect(
      isDoubleTapOnMarker({ ...first, point: null }, { x: 100, y: 100, t: 1100, point: null }),
    ).toBe(false);
  });
});

describe('nearest-centre pick without a selection', () => {
  it('two markers within the tie band: the nearer one wins whatever their order', () => {
    // Radius 22 (px-like units), tie = 22 / 44 = 0.5. A is 5.4 away, B 5.0: B is nearer.
    const a = { index: 0, x: 5.4, y: 0 };
    const b = { index: 1, x: -5.0, y: 0 };
    expect(nearestMarker([b, a], { x: 0, y: 0 }, 22, null)?.index).toBe(1);
    expect(nearestMarker([a, b], { x: 0, y: 0 }, 22, null)?.index).toBe(1);
  });

  it('a marker exactly on the halo edge is picked; non-finite markers are skipped', () => {
    const m = [
      { index: 0, x: Number.NaN, y: 0 },
      { index: 1, x: 22, y: 0 },
    ];
    expect(nearestMarker(m, { x: 0, y: 0 }, 22, null)?.index).toBe(1);
    expect(nearestMarker([], { x: 0, y: 0 }, 22, null)).toBeNull();
  });

  it('crowdedWith: an unknown marker has no crowd; one exactly 12 apart is in it', () => {
    const m = [
      { index: 0, x: 0, y: 0 },
      { index: 1, x: 12, y: 0 },
      { index: 2, x: 0, y: 12.01 },
    ];
    expect(crowdedWith(m, 7, 12)).toEqual([]);
    expect(crowdedWith(m, 0, 12).map((c) => c.index)).toEqual([1]);
  });
});

describe('marker scale edge cases', () => {
  it('no frame, a negative frame or NaN keeps the mouse scale on a touch screen', () => {
    for (const px of [0, -10, Number.NaN])
      expect(markerScale(true, px)).toEqual({ marker: 1, label: 1 });
  });

  it('a 400 px chart: the dot is 2 * 0.026 * 400 / 2.36 = 8.814 px, so 12 px is 1.3615x', () => {
    expect(markerScale(true, 400).marker).toBeCloseTo(12 / ((2 * 0.026 * 400) / 2.36), 10);
    expect(markerScale(true, 400).marker).toBeCloseTo(1.3615, 4);
  });
});
