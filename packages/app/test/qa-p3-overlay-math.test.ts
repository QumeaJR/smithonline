/**
 * QA round on redesign phase 3: the pure overlay maths of lib/overlay.ts
 * (positionOverlay, clampOffset, settleSheet) on the branches the phase 3
 * tests do not reach. Every expected value is worked out by hand from the
 * documented rule: gap 4 px, gutter 12 px, prefer below and start-aligned,
 * flip when only the other side fits, clamp into the window less the gutter;
 * a sheet closes on a flick faster than 0.6 px/ms or a drag of more than
 * 80 px, a full sheet drops to half below 200 px. it.fails marks a finding.
 */
import { describe, expect, it } from 'vitest';
import { clampOffset, positionOverlay, settleSheet } from '../src/lib/overlay';

const phone = { width: 375, height: 667 };
const desktop = { width: 1440, height: 900 };
const menu = { width: 200, height: 100 };

describe('positionOverlay: an anchor partly off screen', () => {
  it('off the left edge: start alignment kept, left clamped to the gutter', () => {
    // start = -40 fits (-40 + 200 <= 363); clamp(-40, 12, 163) = 12; below = 120 + 4 = 124.
    const p = positionOverlay({ left: -40, top: 100, width: 80, height: 20 }, menu, phone);
    expect(p).toEqual({ left: 12, top: 124, side: 'bottom', align: 'start' });
  });

  it('off the right edge: flips to end alignment, then clamped to the right gutter', () => {
    // start 340 does not fit (540 > 363); end = 420 - 200 = 220 fits; clamp(220, 12, 163) = 163.
    const p = positionOverlay({ left: 340, top: 100, width: 80, height: 20 }, menu, phone);
    expect(p).toEqual({ left: 163, top: 124, side: 'bottom', align: 'end' });
    expect(p.left + menu.width).toBe(phone.width - 12);
  });

  it('off the bottom edge: flips above the anchor', () => {
    // below 694 + 100 > 655; above = 650 - 4 - 100 = 546 >= 12.
    const p = positionOverlay({ left: 50, top: 650, width: 80, height: 40 }, menu, phone);
    expect(p).toEqual({ left: 50, top: 546, side: 'top', align: 'start' });
  });

  it('above the top edge: stays below, clamped down to the gutter', () => {
    // bottom = -30, below = -26 fits; clamp(-26, 12, 555) = 12.
    const p = positionOverlay({ left: 50, top: -50, width: 80, height: 20 }, menu, phone);
    expect(p).toEqual({ left: 50, top: 12, side: 'bottom', align: 'start' });
  });

  it('a right-click on the bottom-right rim of a 1440 x 900 window', () => {
    // A point at (1430, 890): above = 890 - 4 - 300 = 586; end = 1430 - 200 = 1230,
    // clamp(1230, 12, 1440 - 12 - 200 = 1228) = 1228.
    const p = positionOverlay(
      { left: 1430, top: 890, width: 0, height: 0 },
      { width: 200, height: 300 },
      desktop,
    );
    expect(p).toEqual({ left: 1228, top: 586, side: 'top', align: 'end' });
  });
});

describe('positionOverlay: a viewport smaller than the overlay', () => {
  it('is limited to the room below the anchor and the window width less two gutters', () => {
    // width room = 300 - 24 = 276; below = 14, room below 188 - 14 = 174, room above 0,
    // room above (-2) is not larger than below (178): bottom at 14, limited to 174 (corrected
    // in the phase 3 QA fixes: the height is capped at the room on its side, not the window).
    const p = positionOverlay(
      { left: 10, top: 10, width: 0, height: 0 },
      { width: 400, height: 300 },
      { width: 300, height: 200 },
    );
    expect(p).toEqual({
      left: 12,
      top: 14,
      side: 'bottom',
      align: 'start',
      maxHeight: 174,
      maxWidth: 276,
    });
  });

  it('only one axis too large: only that limit is set', () => {
    // width 500 <= 1416: no maxWidth; below = 34, room below 888 - 34 = 854: maxHeight 854 at 34.
    const p = positionOverlay(
      { left: 100, top: 10, width: 50, height: 20 },
      { width: 500, height: 1000 },
      desktop,
    );
    expect(p.maxHeight).toBe(854);
    expect(p.maxWidth).toBeUndefined();
    expect(p.top).toBe(34);
    expect(p.left).toBe(100);
  });

  it('a window narrower than two gutters gives a zero budget, never a negative size', () => {
    const p = positionOverlay(
      { left: 5, top: 5, width: 0, height: 0 },
      { width: 100, height: 100 },
      { width: 20, height: 20 },
    );
    expect(p.maxWidth).toBe(0);
    expect(p.maxHeight).toBe(0);
    expect(p.left).toBe(12);
    expect(p.top).toBe(12);
  });
});

describe('positionOverlay: left and right preference (no RTL)', () => {
  const anchor = { left: 500, top: 100, width: 100, height: 30 };
  it('start puts the left edges together, end the right edges, when both fit', () => {
    expect(positionOverlay(anchor, menu, desktop, { align: 'start' }).left).toBe(500);
    // end = 600 - 200 = 400.
    expect(positionOverlay(anchor, menu, desktop, { align: 'end' })).toMatchObject({
      left: 400,
      align: 'end',
    });
  });

  it('end that would leave the left edge falls back to start', () => {
    // end = 80 - 200 = -120 < 12; start 20 fits.
    const p = positionOverlay({ left: 20, top: 100, width: 60, height: 30 }, menu, desktop, {
      align: 'end',
    });
    expect(p).toMatchObject({ left: 20, align: 'start' });
  });

  it('neither side fits: the preferred alignment is kept and the overlay is clamped', () => {
    const a = { left: 150, top: 100, width: 50, height: 20 };
    const wide = { width: 300, height: 100 };
    // start 150 + 300 > 363, end = 200 - 300 = -100 < 12: start kept, clamp(150, 12, 63) = 63.
    expect(positionOverlay(a, wide, phone)).toMatchObject({ left: 63, align: 'start' });
    // end kept, clamp(-100, 12, 63) = 12.
    expect(positionOverlay(a, wide, phone, { align: 'end' })).toMatchObject({
      left: 12,
      align: 'end',
    });
  });

  it('prefer top that does not fit above flips below when below fits', () => {
    // above = 30 - 4 - 100 = -74; below = 54 fits.
    const p = positionOverlay({ left: 50, top: 30, width: 80, height: 20 }, menu, phone, {
      side: 'top',
    });
    expect(p).toMatchObject({ top: 54, side: 'bottom' });
  });

  it('a custom gap and gutter are honoured', () => {
    // below = 130 + 10 = 140; start 0 with gutter 0 stays 0.
    const p = positionOverlay({ left: 0, top: 100, width: 80, height: 30 }, menu, phone, {
      gap: 10,
      gutter: 0,
    });
    expect(p).toEqual({ left: 0, top: 140, side: 'bottom', align: 'start' });
  });
});

describe('clampOffset: margins', () => {
  it('a margin of 0 lets the dialog reach the window edge', () => {
    // rect 100..500 x 50..350 in 1000 x 800: maxX = 1000 - 500 = 500, maxY = 800 - 350 = 450.
    expect(
      clampOffset(
        { x: 900, y: 900 },
        { left: 100, top: 50, width: 400, height: 300 },
        { width: 1000, height: 800 },
        0,
      ),
    ).toEqual({ x: 500, y: 450 });
  });
});

describe('settleSheet: the thresholds', () => {
  it('exactly 0.6 px/ms is not a flick; just above is', () => {
    expect(settleSheet('half', 60, 100)).toBe('half');
    expect(settleSheet('full', 61, 100)).toBe('close');
  });

  it('exactly 80 px down keeps the detent; 81 px closes half and drops full to half', () => {
    expect(settleSheet('half', 80, 1000)).toBe('half');
    expect(settleSheet('half', 81, 1000)).toBe('close');
    expect(settleSheet('full', 81, 1000)).toBe('half');
  });

  it('a full sheet drops to half below 200 px and closes from 200 px', () => {
    expect(settleSheet('full', 199, 1000)).toBe('half');
    expect(settleSheet('full', 200, 1000)).toBe('close');
  });

  it('exactly 40 px up keeps the detent; 41 px up opens full, whatever the speed up', () => {
    expect(settleSheet('half', -40, 1000)).toBe('half');
    expect(settleSheet('half', -41, 1000)).toBe('full');
    expect(settleSheet('half', -300, 50)).toBe('full');
    expect(settleSheet('full', -41, 1000)).toBe('full');
  });

  it('no time or time running backwards is not a flick', () => {
    expect(settleSheet('half', 50, 0)).toBe('half');
    expect(settleSheet('half', 50, -10)).toBe('half');
    expect(settleSheet('half', 100, 0)).toBe('close');
  });

  it('NaN distance or time keeps the detent', () => {
    expect(settleSheet('half', Number.NaN, 100)).toBe('half');
    expect(settleSheet('full', 30, Number.NaN)).toBe('full');
  });

  // A finding of this round, fixed: at least 16 px of travel before the speed rule applies.
  it('a few pixels of slip in a quick tap on the grabber is not a flick', () => {
    // 6 px in 8 ms is 0.75 px/ms, above the flick speed, but it is a tap that slipped.
    expect(settleSheet('full', 6, 8)).toBe('full');
    expect(settleSheet('half', 3, 2)).toBe('half');
  });
});
