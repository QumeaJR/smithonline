/**
 * Usable bandwidth: the span around the working frequency over which VSWR
 * stays inside a limit, which for a matching network is the question right
 * after "does it match".
 *
 * Portions derived from QuickSmith-Web, copyright 2017 Nathan Iyer, MIT license
 * (engine.js bandwidth and edge, commit ca1b69e612f3e7c753591e2a09c38e19110136ef):
 * walk outwards from the centre in coarse steps until the limit is crossed,
 * then bisect each edge. The search function is passed in, so the same code
 * serves any network; the app builds it from the ladder.
 *
 * Differences from the original: frequencies are in hertz, the result says
 * whether an edge ran into the end of the search range (the true edge lies
 * beyond it), and a non-finite VSWR counts as outside the limit.
 */

export interface UsableBandwidth {
  /** Lower band edge, Hz. */
  readonly low: number;
  /** Upper band edge, Hz. */
  readonly high: number;
  /** high - low, Hz. */
  readonly span: number;
  /** True when VSWR is still inside the limit at the lowest frequency searched. */
  readonly lowOpen: boolean;
  /** True when VSWR is still inside the limit at the highest frequency searched. */
  readonly highOpen: boolean;
}

export interface BandwidthOptions {
  /** Lowest frequency searched, Hz. Default centre / 8. */
  readonly min?: number;
  /** Highest frequency searched, Hz. Default centre * 8. */
  readonly max?: number;
  /** Coarse steps from the centre to each end of the range. Default 40. */
  readonly steps?: number;
  /** Bisection steps per edge. Default 30. */
  readonly bisections?: number;
}

interface Edge {
  readonly f: number;
  readonly open: boolean;
}

/** Walk from `from` towards `towards` until the limit breaks, then bisect. */
function edge(
  vswrAt: (f: number) => number,
  from: number,
  towards: number,
  limit: number,
  steps: number,
  bisections: number,
): Edge {
  let inside = from;
  let outside = NaN;
  for (let i = 1; i <= steps; i++) {
    const f = from + (towards - from) * (i / steps);
    if (!(vswrAt(f) <= limit)) {
      outside = f;
      break;
    }
    inside = f;
  }
  // Still inside at the end of the range.
  if (Number.isNaN(outside)) return { f: towards, open: true };
  for (let j = 0; j < bisections; j++) {
    const mid = (inside + outside) / 2;
    if (vswrAt(mid) <= limit) inside = mid;
    else outside = mid;
  }
  return { f: inside, open: false };
}

/**
 * The band around `centre` where `vswrAt(f) <= limit`. Null when the centre
 * frequency itself is outside the limit (or the limit is not above 1, or the
 * centre is not a positive frequency).
 */
export function usableBandwidth(
  vswrAt: (f: number) => number,
  centre: number,
  limit: number,
  options: BandwidthOptions = {},
): UsableBandwidth | null {
  if (!(centre > 0) || !Number.isFinite(centre) || !(limit > 1)) return null;
  let lowest = options.min ?? 0;
  let highest = options.max ?? 0;
  if (!(lowest > 0) || lowest >= centre) lowest = centre / 8;
  if (!(highest > 0) || !Number.isFinite(highest) || highest <= centre) highest = centre * 8;
  const steps = Math.max(1, Math.floor(options.steps ?? 40));
  const bisections = Math.max(1, Math.floor(options.bisections ?? 30));
  if (!(vswrAt(centre) <= limit)) return null;
  const low = edge(vswrAt, centre, lowest, limit, steps, bisections);
  const high = edge(vswrAt, centre, highest, limit, steps, bisections);
  return {
    low: low.f,
    high: high.f,
    span: high.f - low.f,
    lowOpen: low.open,
    highOpen: high.open,
  };
}
