import type { Complex } from '@smithonline/core';
import { startIndex } from '../lib/datapoints';
import type { Design } from '../lib/design';

/** A datapoint sweep labels every point up to this many; a longer one is thinned. */
export const MAX_SWEEP_LABELS = 12;

/**
 * Which points of a sweep of `count` points carry an SPn text label. Up to
 * `maxLabels` points all of them do. Beyond that: the first, the last and
 * points spread evenly in between, and always the point at `keep` (the design
 * point), so that at most `maxLabels` labels show. The markers are not
 * affected; every point keeps its marker.
 */
export function labelledSweepIndices(
  count: number,
  maxLabels: number = MAX_SWEEP_LABELS,
  keep: number | null = null,
): number[] {
  const n = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  const max = Number.isNaN(maxLabels) ? MAX_SWEEP_LABELS : Math.floor(maxLabels);
  if (n <= max) return Array.from({ length: n }, (_, i) => i);
  if (max <= 0) return [];
  if (max === 1) return [0];
  if (max === 2) return [0, n - 1];
  const kept = keep !== null && Number.isInteger(keep) && keep >= 0 && keep < n ? keep : null;
  // One label of the budget is held back for the design point.
  const budget = kept === null ? max : max - 1;
  const gap = (n - 1) / (budget - 1);
  const picked = new Set<number>();
  for (let j = 0; j < budget; j++) picked.add(Math.round(j * gap));
  if (kept !== null) {
    // A spread label right beside the design point would only crowd it.
    for (const i of [...picked])
      if (i !== 0 && i !== n - 1 && Math.abs(i - kept) < gap / 2) picked.delete(i);
    picked.add(kept);
  }
  return [...picked].sort((a, b) => a - b);
}

/**
 * The index of the sweep point at the design frequency (the first, when
 * several share it), or null when no point lies there (within a relative
 * 1e-6, which absorbs the rounding of a file).
 */
export function designFrequencyIndex(
  frequencies: readonly number[],
  designFrequency: number,
): number | null {
  if (!(designFrequency > 0) || !Number.isFinite(designFrequency)) return null;
  let best: number | null = null;
  let bestErr = 1e-6;
  frequencies.forEach((f, i) => {
    const err = Math.abs(f - designFrequency) / designFrequency;
    if (err < bestErr || (best === null && err <= bestErr)) {
      bestErr = err;
      best = i;
    }
  });
  return best;
}

/**
 * The sweep point the design itself sits on: among the points at the design
 * frequency, the one whose load is nearest the design load (the first of
 * equals), so that a dragged start stays on its own row.
 */
export function designPointIndex(
  points: readonly { readonly frequency: number; readonly z: Complex }[],
  frequency: number,
  z: Complex,
): number | null {
  let best: number | null = null;
  let bestDistance = Infinity;
  points.forEach((p, i) => {
    if (designFrequencyIndex([p.frequency], frequency) !== 0) return;
    const d = Math.hypot(p.z.re - z.re, p.z.im - z.im);
    if (best === null || d < bestDistance) {
      best = i;
      bestDistance = Number.isNaN(d) ? Infinity : d;
    }
  });
  return best;
}

/**
 * Drop the labels that would sit on top of one already kept. `order` lists the
 * candidate indices, most important first; two labels collide when their
 * anchors are closer than `width` horizontally and `height` vertically.
 */
export function declutterLabels(
  order: readonly number[],
  position: (index: number) => { readonly x: number; readonly y: number } | null,
  width: number,
  height: number,
): number[] {
  const kept: { x: number; y: number; index: number }[] = [];
  for (const index of order) {
    const p = position(index);
    if (!p) continue;
    if (kept.some((q) => Math.abs(q.x - p.x) < width && Math.abs(q.y - p.y) < height)) continue;
    kept.push({ x: p.x, y: p.y, index });
  }
  return kept.map((q) => q.index).sort((a, b) => a - b);
}

/**
 * The sweep point the chain starts from, which a thinned sweep always labels:
 * the start datapoint's slot for a sweep over user datapoints, the point with
 * the design frequency and load for an imported one.
 */
export function sweepAnchorIndex(design: Design): number | null {
  const loads = design.sweep.loads;
  return loads?.length
    ? designPointIndex(loads, design.frequency, design.load)
    : startIndex(design);
}
