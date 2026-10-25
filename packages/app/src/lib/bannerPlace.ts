/**
 * Where a mode's banner goes on a tablet or desktop chart (docs/07 section 5):
 * over the chart's margin, never over the disc or its rim labels and never
 * over the chart toolbar. The chart is square in a column that is rarely
 * square, so a band beside or above the disc is usually free; a corner of the
 * square often is too, since the disc is round. When nothing fits (a short
 * window, a zoomed chart) the banner goes to the status bar instead.
 */

/** A rectangle in client pixels. */
export interface Box {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** The chart disc in client pixels. */
export interface Disc {
  readonly cx: number;
  readonly cy: number;
  readonly r: number;
}

export type BannerSpot = 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left';

/** Two boxes overlap (touching edges do not count). */
export function overlaps(a: Box, b: Box): boolean {
  return (
    a.left < b.left + b.width &&
    b.left < a.left + a.width &&
    a.top < b.top + b.height &&
    b.top < a.top + a.height
  );
}

/** A box reaches into the disc: the point of the box nearest the centre lies within the radius. */
export function hitsDisc(b: Box, d: Disc): boolean {
  const x = Math.max(b.left, Math.min(d.cx, b.left + b.width));
  const y = Math.max(b.top, Math.min(d.cy, b.top + b.height));
  return Math.hypot(x - d.cx, y - d.cy) < d.r;
}

/** A box lies within another. */
export function within(inner: Box, outer: Box): boolean {
  return (
    inner.left >= outer.left - 0.5 &&
    inner.top >= outer.top - 0.5 &&
    inner.left + inner.width <= outer.left + outer.width + 0.5 &&
    inner.top + inner.height <= outer.top + outer.height + 0.5
  );
}

/**
 * The places tried for a banner of `size` in `area` (the chart's part of the
 * column, above the schematic strip), in order: the top right corner, under
 * the toolbar at the left, then the two bottom corners.
 */
export function bannerSpots(
  area: Box,
  size: { readonly width: number; readonly height: number },
  toolbar: Box | null,
  gutter = 14,
): { spot: BannerSpot; box: Box }[] {
  const { width, height } = size;
  const right = area.left + area.width - gutter - width;
  const left = area.left + gutter;
  const top = area.top + gutter;
  const bottom = area.top + area.height - gutter - height;
  const underToolbar = toolbar ? toolbar.top + toolbar.height + 6 : top;
  return [
    { spot: 'top-right', box: { left: right, top, width, height } },
    { spot: 'top-left', box: { left, top: underToolbar, width, height } },
    { spot: 'bottom-right', box: { left: right, top: bottom, width, height } },
    { spot: 'bottom-left', box: { left, top: bottom, width, height } },
  ];
}

/**
 * The first spot where the banner stays inside the area, clear of the disc
 * (with `pad` px to spare) and of every obstacle (the rim labels, the
 * toolbar); null when there is none.
 */
export function placeBanner(
  spots: readonly { spot: BannerSpot; box: Box }[],
  area: Box,
  disc: Disc,
  obstacles: readonly Box[],
  pad = 8,
): { spot: BannerSpot; box: Box } | null {
  // A disc that was not measured (NaN) could be anywhere: no spot is known to clear it.
  if (![disc.cx, disc.cy, disc.r].every(Number.isFinite)) return null;
  const ring: Disc = { ...disc, r: disc.r + pad };
  for (const s of spots) {
    if (!within(s.box, area)) continue;
    if (hitsDisc(s.box, ring)) continue;
    if (obstacles.some((o) => overlaps(s.box, o))) continue;
    return s;
  }
  return null;
}
