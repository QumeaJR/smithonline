/**
 * Phase 3 of the interaction redesign: where overlays go (positionOverlay),
 * how far a dialog may be dragged (clampOffset) and what a released sheet
 * drag does (settleSheet). Pure functions, tested in node.
 */
import { describe, expect, it } from 'vitest';
import {
  clampOffset,
  OVERLAY_GUTTER,
  positionOverlay,
  settleSheet,
  type Rect,
} from '../src/lib/overlay';

const phone = { width: 375, height: 667 };
const desktop = { width: 1440, height: 900 };

/** The overlay stays inside the window less the gutter, using any max size it was given. */
function inside(
  pos: ReturnType<typeof positionOverlay>,
  size: { width: number; height: number },
  vp: { width: number; height: number },
): void {
  const w = Math.min(size.width, pos.maxWidth ?? Infinity);
  const h = Math.min(size.height, pos.maxHeight ?? Infinity);
  expect(pos.left).toBeGreaterThanOrEqual(OVERLAY_GUTTER);
  expect(pos.top).toBeGreaterThanOrEqual(OVERLAY_GUTTER);
  expect(pos.left + w).toBeLessThanOrEqual(vp.width - OVERLAY_GUTTER);
  expect(pos.top + h).toBeLessThanOrEqual(vp.height - OVERLAY_GUTTER);
}

describe('positionOverlay', () => {
  it('the File menu at x 0 on a 375 px phone is clamped inside the window', () => {
    const button: Rect = { left: 0, top: 50, width: 60, height: 28 };
    const size = { width: 360, height: 500 };
    const pos = positionOverlay(button, size, phone);
    expect(pos.side).toBe('bottom');
    expect(pos.left).toBe(OVERLAY_GUTTER);
    // Wider than the phone allows: limited to the window less both gutters.
    expect(pos.maxWidth).toBe(375 - 2 * OVERLAY_GUTTER);
    inside(pos, size, phone);
  });

  it('Examples at 1440 px opens inside the right edge (end-aligned with its button)', () => {
    const button: Rect = { left: 1180, top: 10, width: 96, height: 28 };
    const size = { width: 360, height: 600 };
    const pos = positionOverlay(button, size, desktop);
    expect(pos.align).toBe('end');
    expect(pos.left).toBe(1180 + 96 - 360);
    inside(pos, size, desktop);
  });

  it('a menu that fits keeps the anchor alignment: left edge on the button, just below it', () => {
    const button: Rect = { left: 400, top: 10, width: 60, height: 28 };
    const pos = positionOverlay(button, { width: 200, height: 300 }, desktop);
    expect(pos).toMatchObject({ left: 400, top: 42, side: 'bottom', align: 'start' });
  });

  it('a context menu near the right rim flips to the left of the point', () => {
    const point: Rect = { left: 1400, top: 300, width: 0, height: 0 };
    const size = { width: 220, height: 260 };
    const pos = positionOverlay(point, size, desktop, { gap: 2 });
    expect(pos.align).toBe('end');
    expect(pos.left).toBe(1400 - 220);
    inside(pos, size, desktop);
  });

  it('a menu near the bottom flips up above its anchor', () => {
    const point: Rect = { left: 600, top: 850, width: 0, height: 0 };
    const size = { width: 220, height: 300 };
    const pos = positionOverlay(point, size, desktop, { gap: 2 });
    expect(pos.side).toBe('top');
    expect(pos.top).toBe(850 - 2 - 300);
    inside(pos, size, desktop);
  });

  it('a menu that fits on neither side goes where there is more room and is clamped', () => {
    const point: Rect = { left: 100, top: 200, width: 0, height: 0 };
    const size = { width: 200, height: 600 };
    const vp = { width: 800, height: 700 };
    const pos = positionOverlay(point, size, vp);
    expect(pos.side).toBe('bottom');
    inside(pos, size, vp);
  });

  it('a menu taller than the room below is limited to that room and scrolls, below its button', () => {
    const button: Rect = { left: 10, top: 10, width: 60, height: 28 };
    const pos = positionOverlay(button, { width: 200, height: 2000 }, phone);
    // Below = 38 + 4 = 42; the room runs to 667 - 12.
    expect(pos.maxHeight).toBe(667 - OVERLAY_GUTTER - 42);
    expect(pos.top).toBe(42);
  });

  it('tall menus never cover their button (QA phase 3: Examples and File at three window sizes)', () => {
    const cases = [
      { button: { left: 1180, top: 10, width: 96, height: 28 }, vp: desktop, h: 1100 },
      {
        button: { left: 700, top: 10, width: 96, height: 28 },
        vp: { width: 1024, height: 768 },
        h: 1100,
      },
      {
        button: { left: 60, top: 10, width: 60, height: 28 },
        vp: { width: 1024, height: 768 },
        h: 900,
      },
      {
        button: { left: 500, top: 10, width: 96, height: 28 },
        vp: { width: 768, height: 1024 },
        h: 1100,
      },
    ];
    for (const { button, vp, h } of cases) {
      const pos = positionOverlay(button, { width: 360, height: h }, vp);
      const shown = Math.min(h, pos.maxHeight ?? Infinity);
      expect(pos.side).toBe('bottom');
      expect(pos.top).toBeGreaterThanOrEqual(button.top + button.height);
      expect(pos.top + shown).toBeLessThanOrEqual(vp.height - OVERLAY_GUTTER);
    }
  });

  it('flipped above its anchor, a tall menu is limited to the room above', () => {
    const button: Rect = { left: 100, top: 600, width: 60, height: 28 };
    const pos = positionOverlay(button, { width: 200, height: 1000 }, { width: 800, height: 700 });
    // Room above 600 - 4 - 12 = 584, below 700 - 12 - 632 = 56: above.
    expect(pos).toMatchObject({ side: 'top', top: 12, maxHeight: 584 });
    expect(pos.top + 584).toBeLessThanOrEqual(button.top);
  });

  it('prefer top and end are honoured when they fit', () => {
    const button: Rect = { left: 600, top: 500, width: 80, height: 28 };
    const pos = positionOverlay(button, { width: 200, height: 200 }, desktop, {
      side: 'top',
      align: 'end',
    });
    expect(pos).toMatchObject({ side: 'top', align: 'end', left: 480, top: 296 });
  });
});

describe('clampOffset: a dragged dialog stays in the window', () => {
  const rect: Rect = { left: 500, top: 96, width: 400, height: 300 };
  it('an offset inside passes unchanged', () => {
    expect(clampOffset({ x: 100, y: 50 }, rect, desktop)).toEqual({ x: 100, y: 50 });
  });
  it('past the right and bottom edges it stops 8 px inside', () => {
    expect(clampOffset({ x: 5000, y: 5000 }, rect, desktop)).toEqual({
      x: 1440 - 8 - 900,
      y: 900 - 8 - 396,
    });
  });
  it('past the left and top edges it stops 8 px inside', () => {
    expect(clampOffset({ x: -5000, y: -5000 }, rect, desktop)).toEqual({ x: 8 - 500, y: 8 - 96 });
  });
  it('a dialog larger than the window keeps its title bar corner inside', () => {
    const big: Rect = { left: 0, top: 0, width: 2000, height: 1200 };
    expect(clampOffset({ x: 300, y: 300 }, big, desktop)).toEqual({ x: 8, y: 8 });
  });
});

describe('settleSheet', () => {
  it('a fast flick down closes whatever the distance', () => {
    expect(settleSheet('half', 30, 20)).toBe('close');
  });
  it('a slow drag down past the threshold closes a half sheet and drops a full one to half', () => {
    expect(settleSheet('half', 120, 1000)).toBe('close');
    expect(settleSheet('full', 120, 1000)).toBe('half');
    expect(settleSheet('full', 400, 1000)).toBe('close');
  });
  it('a drag up opens the full detent; a small move keeps the detent', () => {
    expect(settleSheet('half', -60, 500)).toBe('full');
    expect(settleSheet('half', 20, 500)).toBe('half');
  });
});
