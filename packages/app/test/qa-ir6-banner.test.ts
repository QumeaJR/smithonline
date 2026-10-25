/**
 * QA, redesign phase 5: the desktop mode banner's placement fallbacks in
 * their documented order (top right, top left under the toolbar, bottom
 * right, bottom left, then null for the status bar) and the boundaries of
 * the disc ring and of the box tests (lib/bannerPlace.ts, docs/07 section 5).
 */
import { describe, expect, it } from 'vitest';
import {
  bannerSpots,
  hitsDisc,
  overlaps,
  placeBanner,
  within,
  type Box,
  type Disc,
} from '../src/lib/bannerPlace';

// A 1000 x 600 column, a 250 px disc in the middle, a toolbar at the top left.
const area: Box = { left: 0, top: 0, width: 1000, height: 600 };
const disc: Disc = { cx: 500, cy: 300, r: 250 };
const toolbar: Box = { left: 14, top: 14, width: 300, height: 30 };
const size = { width: 200, height: 60 };

describe('banner spots', () => {
  it('lie 14 px in from the corners; the top left one 6 px under the toolbar', () => {
    // right = 1000 - 14 - 200 = 786, bottom = 600 - 14 - 60 = 526, under the toolbar 14 + 30 + 6 = 50
    expect(bannerSpots(area, size, toolbar)).toEqual([
      { spot: 'top-right', box: { left: 786, top: 14, width: 200, height: 60 } },
      { spot: 'top-left', box: { left: 14, top: 50, width: 200, height: 60 } },
      { spot: 'bottom-right', box: { left: 786, top: 526, width: 200, height: 60 } },
      { spot: 'bottom-left', box: { left: 14, top: 526, width: 200, height: 60 } },
    ]);
  });

  it('without a toolbar the top left spot sits at the gutter', () => {
    expect(bannerSpots(area, size, null)[1]?.box.top).toBe(14);
  });
});

describe('banner fallbacks in order', () => {
  const spots = bannerSpots(area, size, toolbar);
  const label1: Box = { left: 900, top: 30, width: 40, height: 20 }; // in the top right spot
  const label2: Box = { left: 100, top: 80, width: 20, height: 10 }; // in the top left spot
  const label3: Box = { left: 800, top: 550, width: 10, height: 10 }; // in the bottom right spot
  const label4: Box = { left: 50, top: 560, width: 10, height: 10 }; // in the bottom left spot

  it('1. top right when it is free', () => {
    expect(placeBanner(spots, area, disc, [toolbar])?.spot).toBe('top-right');
  });
  it('2. top left under the toolbar when the top right is taken', () => {
    expect(placeBanner(spots, area, disc, [toolbar, label1])?.spot).toBe('top-left');
  });
  it('3. bottom right when both top corners are taken', () => {
    expect(placeBanner(spots, area, disc, [toolbar, label1, label2])?.spot).toBe('bottom-right');
  });
  it('4. bottom left when only it is free', () => {
    expect(placeBanner(spots, area, disc, [toolbar, label1, label2, label3])?.spot).toBe(
      'bottom-left',
    );
  });
  it('5. null (the status bar) when every corner is taken', () => {
    expect(placeBanner(spots, area, disc, [toolbar, label1, label2, label3, label4])).toBeNull();
  });
  it('a spot outside the area is skipped even when nothing covers it', () => {
    // 1000 px wide banner: right = 1000 - 14 - 1000 = -14, outside the area by 14 px.
    const wide = bannerSpots(area, { width: 1000, height: 60 }, toolbar);
    expect(placeBanner(wide, area, { cx: 500, cy: 300, r: 10 }, [])).toBeNull();
  });
  it('a disc that fills the area pushes every spot out', () => {
    expect(placeBanner(spots, area, { cx: 500, cy: 300, r: 700 }, [])).toBeNull();
  });
});

describe('box tests at their boundaries', () => {
  it('a box whose nearest point lies exactly on the ring is clear; a hair inside hits', () => {
    const b: Box = { left: 100, top: 0, width: 10, height: 10 };
    // nearest point (100, 5), distance 100 from (0, 5)
    expect(hitsDisc(b, { cx: 0, cy: 5, r: 100 })).toBe(false);
    expect(hitsDisc(b, { cx: 0, cy: 5, r: 100.001 })).toBe(true);
  });

  it('placeBanner adds 8 px to the disc: r 92 clears a spot 100 px off, r 92.01 does not', () => {
    const one = [{ spot: 'top-right' as const, box: { left: 100, top: 0, width: 10, height: 10 } }];
    const big: Box = { left: -200, top: -200, width: 400, height: 400 };
    expect(placeBanner(one, big, { cx: 0, cy: 5, r: 92 }, [])?.spot).toBe('top-right');
    expect(placeBanner(one, big, { cx: 0, cy: 5, r: 92.01 }, [])).toBeNull();
  });

  it('touching edges do not overlap; one pixel in does', () => {
    const a: Box = { left: 0, top: 0, width: 10, height: 10 };
    expect(overlaps(a, { left: 10, top: 0, width: 5, height: 5 })).toBe(false);
    expect(overlaps(a, { left: 0, top: 10, width: 5, height: 5 })).toBe(false);
    expect(overlaps(a, { left: 9, top: 9, width: 5, height: 5 })).toBe(true);
  });

  it('within allows half a pixel of rounding and no more', () => {
    const outer: Box = { left: 0, top: 0, width: 100, height: 100 };
    expect(within({ left: -0.5, top: 0, width: 100.5, height: 100 }, outer)).toBe(true);
    expect(within({ left: -0.51, top: 0, width: 10, height: 10 }, outer)).toBe(false);
    expect(within({ left: 0, top: 0, width: 100.51, height: 10 }, outer)).toBe(false);
  });
});
