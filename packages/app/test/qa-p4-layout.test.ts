/**
 * QA, redesign phase 4: lib/layout.ts (breakpoints, sheet detents in pixels,
 * how a drag settles, the pane a column shows) against docs/07 sections 4
 * and 5, and the CSS and Shell wiring that use them.
 *
 * Sheet heights: the hero bottom is the top bar plus the square chart of
 * index.css, `min(100vw, 100dvh - 44 - safeTop - 64 - safeBottom - 96)`, so
 * every expected value below is worked by hand from the viewport size.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  DESKTOP_MIN,
  effectivePane,
  isThreeColumn,
  layoutForWidth,
  settlePanel,
  sheetHeights,
  TABLET_MIN,
  WIDE_MIN,
} from '../src/lib/layout';

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

describe('breakpoints at every boundary (phone < 700 <= tablet < 1100 <= desktop < 1440 <= wide)', () => {
  it('the constants are the documented ones', () => {
    expect([TABLET_MIN, DESKTOP_MIN, WIDE_MIN]).toEqual([700, 1100, 1440]);
  });

  it('both sides of each boundary, including fractional CSS pixels', () => {
    expect(layoutForWidth(0)).toBe('phone');
    expect(layoutForWidth(-1)).toBe('phone');
    expect(layoutForWidth(699)).toBe('phone');
    expect(layoutForWidth(699.99)).toBe('phone');
    expect(layoutForWidth(700)).toBe('tablet');
    expect(layoutForWidth(1099)).toBe('tablet');
    expect(layoutForWidth(1099.5)).toBe('tablet');
    expect(layoutForWidth(1100)).toBe('desktop');
    expect(layoutForWidth(1439.99)).toBe('desktop');
    expect(layoutForWidth(1440)).toBe('wide');
    expect(layoutForWidth(10_000)).toBe('wide');
    expect(layoutForWidth(Number.POSITIVE_INFINITY)).toBe('wide');
  });

  it('three columns for desktop and wide only', () => {
    expect(isThreeColumn('phone')).toBe(false);
    expect(isThreeColumn('tablet')).toBe(false);
    expect(isThreeColumn('desktop')).toBe(true);
    expect(isThreeColumn('wide')).toBe(true);
  });
});

describe('sheet detents for real phones', () => {
  it('375 x 667 (iPhone SE): hero 375, bottom 419; half 667 - 419 = 248, full 667 - 44 = 623', () => {
    expect(sheetHeights(667, 44 + 375, 44)).toEqual({ peek: 64, half: 248, full: 623 });
  });

  it('390 x 844: hero 390, bottom 434; half 410, full 800', () => {
    expect(sheetHeights(844, 44 + 390, 44)).toEqual({ peek: 64, half: 410, full: 800 });
  });

  it('430 x 932: hero 430, bottom 474; half 458, full 888', () => {
    expect(sheetHeights(932, 44 + 430, 44)).toEqual({ peek: 64, half: 458, full: 888 });
  });

  it('390 x 844 with insets 47 top and 34 bottom: bar 91, hero 390, bottom 481', () => {
    // peek 64 + 34 = 98; full 844 - 91 = 753; half 844 - 481 = 363 (above 98 + 120 = 218).
    expect(sheetHeights(844, 91 + 390, 91, 34)).toEqual({ peek: 98, half: 363, full: 753 });
  });

  it('430 x 932 with insets 59 top and 34 bottom: bar 103, hero 430, bottom 533', () => {
    expect(sheetHeights(932, 103 + 430, 103, 34)).toEqual({ peek: 98, half: 399, full: 829 });
  });

  it('a phone in landscape, 667 x 375: hero min(667, 375 - 204) = 171; half floors at peek + 120', () => {
    // below = 375 - 215 = 160 < 184, so half = 184; full = 331.
    expect(sheetHeights(375, 44 + 171, 44)).toEqual({ peek: 64, half: 184, full: 331 });
  });

  it('limits: a negative inset counts as 0, a bar below the viewport collapses half and full to peek', () => {
    expect(sheetHeights(844, 434, 44, -20).peek).toBe(64);
    expect(sheetHeights(300, 400, 400)).toEqual({ peek: 64, half: 64, full: 64 });
    // Fractional layout values round to whole pixels.
    expect(sheetHeights(844.4, 434.2, 44.1)).toEqual({ peek: 64, half: 410, full: 800 });
  });
});

describe('settlePanel edges', () => {
  const H = { peek: 64, half: 410, full: 800 };

  it('ms 0 is no flick: the nearest detent wins (half - 200 = 210 is nearest peek)', () => {
    expect(settlePanel(H, 'half', 200, 0)).toBe('peek');
    expect(settlePanel(H, 'half', 20, 0)).toBe('half');
  });

  it('a flick needs at least 16 px and more than 0.6 px/ms', () => {
    // 16 px in 20 ms = 0.8 px/ms: a flick down.
    expect(settlePanel(H, 'half', 16, 20)).toBe('peek');
    // 15 px at 1.5 px/ms: too short, height 395 is nearest half.
    expect(settlePanel(H, 'half', 15, 10)).toBe('half');
    // Exactly 0.6 px/ms is not faster than 0.6: height 380 is nearest half.
    expect(settlePanel(H, 'half', 30, 50)).toBe('half');
  });

  it('a flick past the ends stays at the end', () => {
    expect(settlePanel(H, 'full', -100, 50)).toBe('full');
    expect(settlePanel(H, 'peek', 100, 50)).toBe('peek');
    expect(settlePanel(H, 'peek', -100, 50)).toBe('half');
  });

  it('a tie between two detents keeps the current one', () => {
    // From half, a drag of 173 px lands at 237, 173 px from both peek and half.
    expect(settlePanel(H, 'half', 173, 5000)).toBe('half');
  });
});

describe('effectivePane, every layout, pane and tool state', () => {
  it('phone shows what is stored; Tools lists the tools when none is open', () => {
    expect(effectivePane('phone', 'network', false)).toBe('network');
    expect(effectivePane('phone', 'numbers', true)).toBe('numbers');
    expect(effectivePane('phone', 'tool', false)).toBe('tool');
    expect(effectivePane('phone', 'tool', true)).toBe('tool');
  });

  it('tablet falls back to Network without a tool', () => {
    expect(effectivePane('tablet', 'network', true)).toBe('network');
    expect(effectivePane('tablet', 'numbers', false)).toBe('numbers');
    expect(effectivePane('tablet', 'tool', false)).toBe('network');
    expect(effectivePane('tablet', 'tool', true)).toBe('tool');
  });

  it('desktop and wide have no Network pane on the right', () => {
    for (const layout of ['desktop', 'wide'] as const) {
      expect(effectivePane(layout, 'network', false)).toBe('numbers');
      expect(effectivePane(layout, 'network', true)).toBe('numbers');
      expect(effectivePane(layout, 'numbers', true)).toBe('numbers');
      expect(effectivePane(layout, 'tool', false)).toBe('numbers');
      expect(effectivePane(layout, 'tool', true)).toBe('tool');
    }
  });
});

describe('CSS and wiring against the spec', () => {
  const css = read('../src/index.css');

  it('the tablet grid fits the narrowest tablet (700 px) without a horizontal page scroll', () => {
    // docs/07 section 8 item 1: no horizontal page scroll at any width.
    const block = /\.app\.layout-tablet\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    const cols = /grid-template-columns:\s*([^;]+);/.exec(block)?.[1] ?? '';
    const mins = [...cols.matchAll(/minmax\((\d+)px/g)].map((m) => Number(m[1]));
    expect(mins.length).toBeGreaterThan(0);
    const sum = mins.reduce((a, b) => a + b, 0);
    expect(sum).toBeLessThanOrEqual(TABLET_MIN);
  });

  it('the horizontal schematic can grow past its strip, so the strip scrolls (section 5: "scrollable")', () => {
    const capped = /(^|\n)\.schematic\s*\{[^}]*max-width:\s*100%/.test(css);
    const released =
      /\.(phone-strip|schematic-strip)[^{]*\.schematic(?![-.\w])[^{]*\{[^}]*max-width:\s*none/.test(
        css,
      );
    expect(!capped || released).toBe(true);
  });

  it('the shell passes the bottom safe area to the detents (section 4: peek is 64 px plus the safe area)', () => {
    const shell = read('../src/layout/Shell.tsx');
    const fn = /function measureHeights[\s\S]*?\n\}/.exec(shell)?.[0] ?? '';
    const call = /sheetHeights\(([^)]*)\)/.exec(fn)?.[1] ?? '';
    expect(call.split(',').filter((a) => a.trim() !== '').length).toBe(4);
  });
});
