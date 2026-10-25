/**
 * Adversarial, phase 5 pure parts: gestures, banner placement, fmtYield and
 * the Markdown pipe table. Each test asserts the correct behaviour; a failure
 * is a defect.
 */
import { describe, expect, it } from 'vitest';
import {
  HALF_MAX,
  HALF_MIN,
  HOME,
  clampHalf,
  frameOf,
  isDoubleTapOnMarker,
  longPressMove,
  longPressStart,
  longPressTick,
  nearestMarker,
  crowdedWith,
  pinchView,
  wheelZoom,
  zoomAbout,
  screenToChart,
  type Frame,
  type Marker,
} from '../src/chart/gestures';
import { bannerSpots, placeBanner, type Box, type Disc } from '../src/lib/bannerPlace';
import { fmtYield } from '../src/lib/format';
import { cardShift, dropIndex } from '../src/lib/ladderDrag';
import { parseMarkdown } from '../src/lib/markdown';

const frame: Frame = frameOf(0, 0, 400, 400);
const finite = (v: { cx: number; cy: number; half: number }): boolean =>
  Number.isFinite(v.cx) && Number.isFinite(v.cy) && Number.isFinite(v.half);

describe('gestures: hostile numbers', () => {
  it('pinch with an Infinity coordinate keeps a finite view', () => {
    const v = pinchView(
      { view: HOME, a: { x: 100, y: 100 }, b: { x: 200, y: 100 } },
      { x: 100, y: 100 },
      { x: Infinity, y: 100 },
      frame,
    );
    expect(finite(v)).toBe(true);
  });
  it('pinch with a NaN coordinate keeps a finite view', () => {
    const v = pinchView(
      { view: HOME, a: { x: 100, y: 100 }, b: { x: 200, y: 100 } },
      { x: NaN, y: 100 },
      { x: 200, y: 100 },
      frame,
    );
    expect(finite(v)).toBe(true);
  });
  it('a pinch that starts at zero distance still zooms once the fingers spread', () => {
    const start = { view: HOME, a: { x: 200, y: 200 }, b: { x: 200, y: 200 } };
    const v = pinchView(start, { x: 150, y: 200 }, { x: 250, y: 200 }, frame);
    expect(v.half).not.toBe(HOME.half);
  });
  it('fingers that cross give the same zoom as fingers that did not', () => {
    const start = { view: HOME, a: { x: 150, y: 200 }, b: { x: 250, y: 200 } };
    const crossed = pinchView(start, { x: 260, y: 200 }, { x: 140, y: 200 }, frame);
    const straight = pinchView(start, { x: 140, y: 200 }, { x: 260, y: 200 }, frame);
    expect(crossed.half).toBeCloseTo(straight.half, 12);
    expect(crossed.cx).toBeCloseTo(straight.cx, 12);
  });
  it('pinch collapsing to zero distance stays within limits', () => {
    const start = { view: HOME, a: { x: 150, y: 200 }, b: { x: 250, y: 200 } };
    const v = pinchView(start, { x: 200, y: 200 }, { x: 200, y: 200 }, frame);
    expect(v.half).toBeGreaterThanOrEqual(HALF_MIN);
    expect(v.half).toBeLessThanOrEqual(HALF_MAX);
  });
  it('pinch at 1e6 px spread clamps to HALF_MIN with a finite centre', () => {
    const start = { view: HOME, a: { x: 199, y: 200 }, b: { x: 201, y: 200 } };
    const v = pinchView(start, { x: -1e6, y: 200 }, { x: 1e6, y: 200 }, frame);
    expect(v.half).toBe(HALF_MIN);
    expect(finite(v)).toBe(true);
  });
  it('wheel with NaN or Infinity delta keeps a finite view', () => {
    expect(finite(wheelZoom(HOME, { x: 0, y: 0 }, NaN))).toBe(true);
    expect(finite(wheelZoom(HOME, { x: 0, y: 0 }, Infinity))).toBe(true);
    expect(finite(wheelZoom(HOME, { x: 0, y: 0 }, -Infinity))).toBe(true);
  });
  it('zoomAbout a NaN point keeps a finite view', () => {
    expect(finite(zoomAbout(HOME, { x: NaN, y: 0 }, 0.5))).toBe(true);
  });
  it('clampHalf(Infinity) and (-Infinity)', () => {
    expect(clampHalf(Infinity)).toBe(HALF_MAX);
    expect(clampHalf(-Infinity)).toBe(HALF_MIN);
  });
  it('screenToChart on a zero frame does not give NaN', () => {
    const p = screenToChart(HOME, frameOf(0, 0, 0, 0), { x: 10, y: 10 });
    expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
  });
});

describe('long press', () => {
  it('sub-pixel jitter does not cancel; fires at 400 ms exactly', () => {
    let lp = longPressStart(100, 100, 1000);
    for (let i = 0; i < 200; i++) {
      lp = longPressMove(lp, 100 + Math.sin(i) * 0.4, 100 + Math.cos(i) * 0.4);
    }
    expect(lp.state).toBe('pending');
    expect(longPressTick(lp, 1399.999).state).toBe('pending');
    expect(longPressTick(lp, 1400).state).toBe('fired');
  });
  it('jitter that drifts past 10 px cancels', () => {
    let lp = longPressStart(100, 100, 0);
    for (let i = 1; i <= 120; i++) lp = longPressMove(lp, 100 + i * 0.1, 100);
    expect(lp.state).toBe('cancelled');
  });
  it('a NaN move cancels rather than letting the press fire', () => {
    const lp = longPressMove(longPressStart(100, 100, 0), NaN, NaN);
    expect(lp.state).toBe('cancelled');
  });
});

describe('double tap', () => {
  const t = (x: number, t0: number, point: number | null) => ({ x, y: 0, t: t0, point });
  it('1 ms apart on one marker is a double tap', () => {
    expect(isDoubleTapOnMarker(t(0, 0, 2), t(0, 1, 2))).toBe(true);
  });
  it('499 ms apart is not', () => {
    expect(isDoubleTapOnMarker(t(0, 0, 2), t(0, 499, 2))).toBe(false);
  });
  it('across two markers is not', () => {
    expect(isDoubleTapOnMarker(t(0, 0, 1), t(0, 10, 2))).toBe(false);
  });
  it('a second tap stamped earlier than the first is not a double tap', () => {
    expect(isDoubleTapOnMarker(t(0, 1000, 2), t(0, 0, 2))).toBe(false);
  });
});

describe('nearest pick', () => {
  it('all markers stacked on one point at HALF_MIN: the selected wins', () => {
    const view = { cx: 0.3, cy: 0, half: HALF_MIN };
    const ms: Marker[] = [0, 1, 2, 3].map((index) => ({ index, x: 0.3, y: 0 }));
    const r = 22 * ((2 * view.half) / frame.size);
    expect(nearestMarker(ms, { x: 0.3, y: 0 }, r, 2)?.index).toBe(2);
    expect(nearestMarker(ms, { x: 0.3, y: 0 }, r, null)?.index).toBe(0);
  });
  it('three equidistant markers: the selected one wins in any order', () => {
    const ms: Marker[] = [
      { index: 0, x: 1, y: 0 },
      { index: 1, x: -0.5, y: Math.sqrt(3) / 2 },
      { index: 2, x: -0.5, y: -Math.sqrt(3) / 2 },
    ];
    for (const sel of [0, 1, 2]) {
      expect(nearestMarker(ms, { x: 0, y: 0 }, 2, sel)?.index).toBe(sel);
      expect(nearestMarker([...ms].reverse(), { x: 0, y: 0 }, 2, sel)?.index).toBe(sel);
    }
  });
  it('the pick does not depend on the order of the markers', () => {
    // radius 44, tie 1: A at 5.0, B at 4.2, selected S at 5.9. B beats S by 1.7 > tie.
    const A = { index: 0, x: 5.0, y: 0 };
    const B = { index: 1, x: 4.2, y: 0 };
    const S = { index: 2, x: 5.9, y: 0 };
    const at = { x: 0, y: 0 };
    expect(nearestMarker([B, A, S], at, 44, 2)?.index).toBe(1);
    expect(nearestMarker([A, B, S], at, 44, 2)?.index).toBe(1);
  });
  it('without a selection the nearer of two near-ties wins whatever the order', () => {
    const A = { index: 0, x: 5.0, y: 0 };
    const B = { index: 1, x: 4.2, y: 0 };
    expect(nearestMarker([A, B], { x: 0, y: 0 }, 44, null)?.index).toBe(1);
  });
  it('crowdedWith ignores markers at NaN', () => {
    const ms: Marker[] = [
      { index: 0, x: 0, y: 0 },
      { index: 1, x: NaN, y: 0 },
      { index: 2, x: 0.001, y: 0 },
    ];
    expect(crowdedWith(ms, 0, 0.01).map((m) => m.index)).toEqual([2]);
  });
});

describe('banner placement', () => {
  const disc: Disc = { cx: 500, cy: 400, r: 300 };
  it('a disc larger than the area gives no spot', () => {
    const area: Box = { left: 300, top: 200, width: 400, height: 400 };
    const spots = bannerSpots(area, { width: 160, height: 40 }, null);
    expect(placeBanner(spots, area, { cx: 500, cy: 400, r: 1000 }, [])).toBeNull();
  });
  it('a zero-size banner (not measured) is not placed on top of a rim label', () => {
    const area: Box = { left: 0, top: 0, width: 1000, height: 800 };
    const label: Box = { left: 900, top: 0, width: 100, height: 60 };
    const spots = bannerSpots(area, { width: 0, height: 0 }, null);
    const found = placeBanner(spots, area, disc, [label]);
    const inside =
      found !== null &&
      found.box.left > label.left &&
      found.box.left < label.left + label.width &&
      found.box.top > label.top &&
      found.box.top < label.top + label.height;
    expect(inside).toBe(false);
  });
  it('a zero-size area gives no spot', () => {
    const area: Box = { left: 0, top: 0, width: 0, height: 0 };
    const spots = bannerSpots(area, { width: 160, height: 40 }, null);
    expect(placeBanner(spots, area, disc, [])).toBeNull();
  });
  it('labels everywhere: no spot', () => {
    const area: Box = { left: 0, top: 0, width: 1400, height: 800 };
    const obstacles: Box[] = [];
    for (let x = 0; x < 1400; x += 50) {
      for (let y = 0; y < 800; y += 20) obstacles.push({ left: x, top: y, width: 40, height: 12 });
    }
    const spots = bannerSpots(area, { width: 160, height: 40 }, null);
    expect(placeBanner(spots, area, { cx: 700, cy: 400, r: 100 }, obstacles)).toBeNull();
  });
  it('a NaN disc does not let the banner land on the chart', () => {
    const area: Box = { left: 0, top: 0, width: 500, height: 500 };
    const spots = bannerSpots(area, { width: 160, height: 40 }, null);
    expect(placeBanner(spots, area, { cx: NaN, cy: 250, r: 250 }, [])).toBeNull();
  });
});

describe('fmtYield', () => {
  it('edges', () => {
    expect(fmtYield(0, 0)).toBe('no runs');
    expect(fmtYield(0, 1)).toBe('0.0 %');
    expect(fmtYield(1, 1)).toBe('100.0 %');
    expect(fmtYield(1999, 2000)).toBe('99.9 %');
    expect(fmtYield(99999, 100000)).toBe('99.9 %');
    expect(fmtYield(1, 100000)).toBe('0.1 %');
    expect(fmtYield(1, 2)).toBe('50.0 %');
    expect(fmtYield(0, 100000)).toBe('0.0 %');
  });
  it('passed above runs or negative is not shown as a yield', () => {
    expect(fmtYield(11, 10)).not.toBe('100.0 %');
    expect(fmtYield(-1, 10)).not.toMatch(/^-/);
  });
});

describe('ladder drag arithmetic', () => {
  it('one card: drop index 0 anywhere, no shift', () => {
    const cards = [{ top: 0, height: 100 }];
    expect(dropIndex(cards, 0, -1e9)).toBe(0);
    expect(dropIndex(cards, 0, 1e9)).toBe(0);
    expect(cardShift(0, 0, 0, 110)).toBe(0);
  });
  it('dropping onto itself keeps the index', () => {
    const cards = [0, 1, 2].map((i) => ({ top: i * 110, height: 100 }));
    expect(dropIndex(cards, 1, 160)).toBe(1);
  });
  it('NaN y gives a valid index', () => {
    const cards = [0, 1, 2].map((i) => ({ top: i * 110, height: 100 }));
    const to = dropIndex(cards, 1, NaN);
    expect(to >= 0 && to <= 2).toBe(true);
  });
});

describe('markdown pipe tables', () => {
  type T = Extract<ReturnType<typeof parseMarkdown>[number], { kind: 'table' }>;
  const table = (src: string): T | undefined =>
    parseMarkdown(src).find((b): b is T => b.kind === 'table');
  const text = (cell: readonly unknown[]): string => JSON.stringify(cell);

  it('a pipe inside a code span stays in its cell', () => {
    const t = table('| Column | Meaning |\n|---|---|\n| `|Γ|` | magnitude |');
    expect(t?.rows[0]?.length).toBe(2);
    expect(text(t?.rows[0]?.[0] ?? [])).toContain('|Γ|');
    expect(text(t?.rows[0]?.[1] ?? [])).toContain('magnitude');
  });
  it('an escaped pipe stays in its cell', () => {
    const t = table('| a | b |\n|---|---|\n| x \\| y | z |');
    expect(text(t?.rows[0]?.[0] ?? [])).toContain('x | y');
    expect(text(t?.rows[0]?.[1] ?? [])).toContain('z');
  });
  it('ragged rows: a row with more cells than the header does not lose text silently', () => {
    const t = table('| a | b |\n|---|---|\n| 1 | 2 | 3 |');
    expect(JSON.stringify(t)).toContain('3');
  });
  it('a header and rule of different widths is not a table (GFM)', () => {
    expect(table('| a | b | c |\n|---|---|\n| 1 | 2 | 3 |')).toBeUndefined();
  });
  it('a table without a separator is a paragraph', () => {
    const blocks = parseMarkdown('| a | b |\n| 1 | 2 |');
    expect(blocks.map((b) => b.kind)).toEqual(['paragraph']);
  });
  it('a wrapped paragraph line that starts and ends with a pipe stays in its paragraph', () => {
    const blocks = parseMarkdown('The magnitude\n|Γ| is shown beside |S11|\nin the table.');
    expect(blocks.map((b) => b.kind)).toEqual(['paragraph']);
  });
  it('a table right under a paragraph line without a blank line', () => {
    const blocks = parseMarkdown('Gestures:\n| a | b |\n|---|---|\n| 1 | 2 |');
    expect(blocks.map((b) => b.kind)).toEqual(['paragraph', 'table']);
  });
  it('10000 rows parse in under a second', () => {
    const rows = Array.from({ length: 10000 }, (_, i) => `| ${i} | **b${i}** | \`c\` |`).join('\n');
    const t0 = performance.now();
    const t = table(`| a | b | c |\n|---|:-:|--:|\n${rows}`);
    const ms = performance.now() - t0;
    expect(t?.rows.length).toBe(10000);
    expect(ms).toBeLessThan(1000);
  });
  it('a hostile rule line does not hang', () => {
    const t0 = performance.now();
    parseMarkdown(`| a |\n|${' -'.repeat(50000)} x |`);
    parseMarkdown(`| a |\n|${' '.repeat(50000)}-${' '.repeat(50000)}x|`);
    expect(performance.now() - t0).toBeLessThan(1000);
  });
  it('CRLF table lines', () => {
    const t = table('| a | b |\r\n|---|---|\r\n| 1 | 2 |\r\n');
    expect(t?.rows.length).toBe(1);
  });
});
