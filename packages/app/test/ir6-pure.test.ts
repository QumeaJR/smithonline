/**
 * Redesign phase 5, the pure parts besides the chart gestures: where the
 * desktop mode banner goes (lib/bannerPlace.ts), the ladder drag arithmetic
 * (lib/ladderDrag.ts), the wording per pointer (lib/tips.ts), the yield that
 * never reads 100.0 % with a failed run, the half detent that meets a
 * height-limited hero, and the phase 4 wording leftovers.
 */
import { describe, expect, it } from 'vitest';
import {
  bannerSpots,
  hitsDisc,
  overlaps,
  placeBanner,
  type Box,
  type Disc,
} from '../src/lib/bannerPlace';
import { broadbandProgressText } from '../src/lib/broadband';
import { fmtYield } from '../src/lib/format';
import { cardShift, dropIndex, outsideList } from '../src/lib/ladderDrag';
import { HALF_FLOOR, PEEK_H, sheetHeights, TOP_BAR_H } from '../src/lib/layout';
import { pointerHints, TIPS } from '../src/lib/tips';

describe('mode banner placement', () => {
  // A 780 x 760 chart column with a 590 px disc centred under a toolbar at the top left.
  const area: Box = { left: 300, top: 48, width: 780, height: 760 };
  const disc: Disc = { cx: 690, cy: 420, r: 295 };
  const toolbar: Box = { left: 314, top: 62, width: 314, height: 29 };

  it('a box clear of the disc, and one reaching into it', () => {
    expect(hitsDisc({ left: 900, top: 60, width: 160, height: 70 }, disc)).toBe(false);
    expect(hitsDisc({ left: 600, top: 100, width: 160, height: 40 }, disc)).toBe(true);
    expect(overlaps(toolbar, { left: 600, top: 70, width: 50, height: 10 })).toBe(true);
    expect(overlaps(toolbar, { left: 628, top: 62, width: 50, height: 10 })).toBe(false);
  });

  it('goes to the top right corner where it clears the disc and the labels', () => {
    const spots = bannerSpots(area, { width: 160, height: 72 }, toolbar);
    const found = placeBanner(spots, area, disc, [toolbar]);
    expect(found?.spot).toBe('top-right');
    expect(found && hitsDisc(found.box, { ...disc, r: disc.r + 8 })).toBe(false);
  });

  it('skips a corner where a rim label sits', () => {
    const spots = bannerSpots(area, { width: 160, height: 72 }, toolbar);
    const label: Box = { left: 1000, top: 70, width: 30, height: 12 };
    const found = placeBanner(spots, area, disc, [toolbar, label]);
    expect(found?.spot).not.toBe('top-right');
  });

  it('a banner that fits nowhere gives null (the status bar takes it)', () => {
    const square: Box = { left: 300, top: 48, width: 600, height: 600 };
    const big: Disc = { cx: 600, cy: 348, r: 300 };
    const spots = bannerSpots(square, { width: 405, height: 32 }, null);
    expect(placeBanner(spots, square, big, [])).toBeNull();
  });

  it('never leaves the area', () => {
    const spots = bannerSpots(area, { width: 900, height: 32 }, null);
    expect(placeBanner(spots, area, { cx: 0, cy: 0, r: 0 }, [])).toBeNull();
  });
});

describe('ladder drag arithmetic', () => {
  const cards = [
    { top: 0, height: 100 },
    { top: 110, height: 100 },
    { top: 220, height: 100 },
    { top: 330, height: 100 },
  ];

  it('the slot follows the pointer past the middles of the other cards', () => {
    expect(dropIndex(cards, 0, 20)).toBe(0);
    expect(dropIndex(cards, 0, 170)).toBe(1);
    expect(dropIndex(cards, 0, 400)).toBe(3);
    expect(dropIndex(cards, 3, 10)).toBe(0);
    expect(dropIndex(cards, 3, 380)).toBe(3);
  });

  it('the cards between move aside, and out of the list the gap closes', () => {
    expect([0, 1, 2, 3].map((i) => cardShift(i, 0, 2, 110))).toEqual([0, -110, -110, 0]);
    expect([0, 1, 2, 3].map((i) => cardShift(i, 3, 1, 110))).toEqual([0, 110, 110, 0]);
    expect([0, 1, 2, 3].map((i) => cardShift(i, 1, null, 110))).toEqual([0, 0, -110, -110]);
    expect([0, 1, 2, 3].map((i) => cardShift(i, 2, 2, 110))).toEqual([0, 0, 0, 0]);
  });

  it('out of the list is any side of its box', () => {
    const list = { left: 0, top: 50, right: 300, bottom: 600 };
    expect(outsideList(list, 150, 300)).toBe(false);
    expect(outsideList(list, 150, 40)).toBe(true);
    expect(outsideList(list, 301, 300)).toBe(true);
    expect(outsideList(list, 150, 601)).toBe(true);
    expect(outsideList(list, -1, 300)).toBe(true);
  });
});

describe('wording per pointer', () => {
  const words = (h: ReturnType<typeof pointerHints>): string =>
    [
      h.chart,
      h.armed('Series L'),
      h.response,
      h.splot,
      h.preview,
      h.responseMarker,
      h.splotCursor,
      h.datapointSwitch,
      h.datapointInput(3),
      h.emptyLadder,
      h.startMatch,
      h.press,
    ].join(' ');

  it('a touch screen gets no hover, right-click, double-click, wheel or "on the left"', () => {
    const touch = words(pointerHints(true)).toLowerCase();
    for (const banned of [
      'hover',
      'right-click',
      'double-click',
      'wheel',
      'on the left',
      'click',
    ]) {
      expect(touch, banned).not.toContain(banned);
    }
    for (const said of ['tap', 'long press', 'pinch', 'drag']) expect(touch).toContain(said);
  });

  it('the switch reads Tap chart on touch and Click chart with a mouse', () => {
    expect(pointerHints(true).datapointSwitch).toBe('Tap chart');
    expect(pointerHints(false).datapointSwitch).toBe('Click chart');
    expect(pointerHints(true).responseMarker).toMatch(/^Tap a curve/);
    expect(pointerHints(false).responseMarker).toMatch(/^Click a curve/);
    expect(pointerHints(true).splotCursor).not.toMatch(/hover/i);
  });

  it('a mouse keeps its words, and no "left panel" for a layout that has none', () => {
    const mouse = words(pointerHints(false));
    expect(mouse).toContain('right-click');
    expect(mouse).toContain('Wheel zooms');
    expect(mouse).not.toContain('left panel');
  });
});

describe('yield', () => {
  it('never reads 100.0 % unless every run passed', () => {
    expect(fmtYield(9999, 10000)).toBe('99.9 %');
    expect(fmtYield(99999, 100000)).toBe('99.9 %');
    expect(fmtYield(1000, 1000)).toBe('100.0 %');
    expect(fmtYield(973, 1000)).toBe('97.3 %');
    expect(fmtYield(1, 3)).toBe('33.3 %');
  });

  it('never reads 0.0 % when one run passed, and no runs without runs', () => {
    expect(fmtYield(1, 100000)).toBe('0.1 %');
    expect(fmtYield(0, 100)).toBe('0.0 %');
    expect(fmtYield(0, 0)).toBe('no runs');
  });
});

describe('the half detent meets a height-limited hero', () => {
  it('hero bottom equals sheet top at 699 x 900 and on a foldable', () => {
    for (const [vw, vh] of [
      [699, 900],
      [673, 841],
      [600, 960],
    ] as const) {
      const square = Math.min(vw, vh - TOP_BAR_H - PEEK_H - HALF_FLOOR);
      const heroBottom = TOP_BAR_H + square;
      const h = sheetHeights(vh, heroBottom, TOP_BAR_H);
      expect(vh - h.half, `${vw} x ${vh}`).toBeGreaterThanOrEqual(heroBottom);
      if (square < vw) expect(vh - h.half, `${vw} x ${vh}`).toBe(heroBottom);
    }
  });
});

describe('phase 4 wording leftovers', () => {
  it('the Share title names the action', () => {
    expect(TIPS.share).toBe('Share link: puts the whole design in the address and copies the link');
  });

  it('the Broadband progress names the best worst-case VSWR', () => {
    expect(broadbandProgressText({ done: 1, total: 10 }, 10, 1.263)).toMatch(
      /best worst-case VSWR 1\.26$/,
    );
  });
});

describe('the guide shows the gestures table', () => {
  it('a pipe table with a rule line becomes a table block; without the rule a paragraph', async () => {
    const { parseMarkdown } = await import('../src/lib/markdown');
    const blocks = parseMarkdown('| A | B |\n|---|---|\n| one | **two** |\n\n| not | a table |');
    expect(blocks[0]?.kind).toBe('table');
    if (blocks[0]?.kind === 'table') {
      expect(blocks[0].head).toHaveLength(2);
      expect(blocks[0].rows).toHaveLength(1);
      expect(blocks[0].rows[0]?.[1]?.[0]?.kind).toBe('bold');
    }
    expect(blocks[1]?.kind).toBe('paragraph');
  });

  it('the bundled guide has the table with mouse and touch columns', async () => {
    const { GUIDE } = await import('../src/lib/guide');
    const table = GUIDE.find((b) => b.kind === 'table');
    expect(table?.kind).toBe('table');
    if (table?.kind === 'table') {
      const text = (cells: readonly (readonly { kind: string; text?: string }[])[]): string[] =>
        cells.map((c) => c.map((p) => p.text ?? '').join(''));
      expect(text(table.head)).toEqual(['Gesture', 'Mouse', 'Touch']);
      expect(table.rows.map((r) => text(r)[0])).toContain('Context menu');
    }
  });
});
