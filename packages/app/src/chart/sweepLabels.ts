/** A datapoint sweep labels every point up to this many; a longer one is thinned. */
export const MAX_SWEEP_LABELS = 12;

/**
 * Which points of a sweep of `count` points carry an SPn text label. Up to
 * `maxLabels` points all of them do. Beyond that: the first, the last and
 * every k-th point in between, and always the point at `keep` (the design
 * frequency), so that at most `maxLabels` labels show. The markers are not
 * affected; every point keeps its marker.
 */
export function labelledSweepIndices(
  count: number,
  maxLabels: number = MAX_SWEEP_LABELS,
  keep: number | null = null,
): number[] {
  const n = Math.max(0, Math.floor(count));
  // First, last and the design frequency point need three.
  const max = Math.max(3, Math.floor(maxLabels));
  const all = Array.from({ length: n }, (_, i) => i);
  if (n <= max) return all;
  const kept = keep !== null && Number.isInteger(keep) && keep >= 0 && keep < n ? keep : null;
  // One label of the budget is held back for the design frequency point.
  const budget = kept === null ? max : max - 1;
  const step = Math.ceil((n - 1) / (budget - 1));
  const picked = new Set<number>([0, n - 1]);
  for (let i = step; i < n - 1; i += step) picked.add(i);
  if (kept !== null) picked.add(kept);
  return [...picked].sort((a, b) => a - b);
}

/**
 * The index of the sweep point at the design frequency, or null when no point
 * lies there (within a relative 1e-6, which absorbs the rounding of a file).
 */
export function designFrequencyIndex(
  frequencies: readonly number[],
  designFrequency: number,
): number | null {
  if (!(designFrequency > 0)) return null;
  let best: number | null = null;
  let bestErr = 1e-6;
  frequencies.forEach((f, i) => {
    const err = Math.abs(f - designFrequency) / designFrequency;
    if (err <= bestErr) {
      bestErr = err;
      best = i;
    }
  });
  return best;
}
