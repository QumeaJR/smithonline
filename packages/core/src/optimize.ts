/**
 * Matching a band rather than a point.
 *
 * Portions derived from QuickSmith-Web, copyright 2017 Nathan Iyer, MIT license
 * (match.js, commit ca1b69e612f3e7c753591e2a09c38e19110136ef): the worst-case
 * VSWR cost, the Nelder-Mead search with seeded restarts, the reactance-based
 * bounds for lumped parts, the Yaghjian-Best load Q and the Bode-Fano floor.
 *
 * The synthesis in match.ts is exact at one frequency. There is no closed
 * form for the best match across a band, so this searches for one: it
 * proposes values for the parts already in the ladder, asks the same ladder
 * evaluation the chart uses what the worst VSWR anywhere in the band would
 * be, and walks downhill.
 *
 * The cost is the WORST case, not the average. A network that is perfect at
 * band centre and dreadful at both edges is worse than one that is mediocre
 * everywhere, and minimizing the average would prefer the wrong one. This is
 * also why the answers look odd to anyone used to designing by hand: the
 * optimizer never centres the match, because the worst case always lives at
 * an edge.
 *
 * Differences from QuickSmith: the topology is not chosen here, the ladder
 * the user built is improved in place (every element with a single primary
 * value takes part, RLC blocks stay as they are); lumped parts are searched
 * in log coordinates so a 250:1 bound does not cram the small values into
 * the last percent of the range; the first start is the current design, so
 * the result is never worse than it.
 */
import { cabs, type Complex } from './complex.js';
import { vswr, zToGamma } from './conversions.js';
import { ladderAbcd, type Element } from './elements.js';
import { throughAbcd } from './abcd.js';
import type { Ladder } from './ladder.js';

/** A load that is the same at every frequency, or one read per frequency (measured data). */
export type LoadModel = Complex | ((f: number) => Complex);

function loadAt(load: LoadModel, f: number): Complex {
  return typeof load === 'function' ? load(f) : load;
}

/** The cost of a candidate that cannot be evaluated or reflects everything. */
export const OPTIMIZE_FAIL = 1e6;

/**
 * The highest VSWR the ladder shows at any of the frequencies, or
 * OPTIMIZE_FAIL when any point is a total reflection or cannot be evaluated.
 * Zin comes from the same ABCD cascade the chart draws, so the number
 * promised here is the number shown after applying the result.
 */
export function worstVswr(
  elements: readonly Element[],
  load: LoadModel,
  z0: number,
  frequencies: readonly number[],
): number {
  let worst = 0;
  for (const f of frequencies) {
    const zin = throughAbcd(ladderAbcd(elements, f), loadAt(load, f));
    const g = cabs(zToGamma(zin, z0));
    if (!Number.isFinite(g) || g >= 1) return OPTIMIZE_FAIL;
    const v = vswr(g);
    if (v >= OPTIMIZE_FAIL) return OPTIMIZE_FAIL;
    if (v > worst) worst = v;
  }
  return worst;
}

/* ------------------------------------------------------------------ bounds
 *
 * The optimizer will happily return a 6 ohm stub, which is electrically
 * correct and not something you can fabricate. Bounds are part of the
 * problem statement, not a detail.
 *
 * Lumped parts are bounded by what they are worth in ohms at the centre of
 * the band, not by henries and farads, because the same component is a
 * different animal at each end of the spectrum: at 10.5 GHz a 200 pF
 * capacitor is 0.08 ohm, which is a short, and a 200 nH inductor is 13 kohm,
 * which is an open. Reactance between Z0 / 25 and 10 Z0 instead, which for
 * 50 ohm is 2 to 500 ohm. Lines and stubs are bounded in electrical length
 * at band centre, 10 to 170 degrees, the range you would actually cut.
 */
export interface ParameterBound {
  readonly lo: number;
  readonly hi: number;
  /** Search in log coordinates (lumped parts, transformer ratio) or linearly (lengths). */
  readonly log: boolean;
}

/** The bound of an element's primary value at band centre f0, or null when it has none. */
export function parameterBound(el: Element, z0: number, f0: number): ParameterBound | null {
  const w = 2 * Math.PI * f0;
  const xLo = z0 / 25;
  const xHi = z0 * 10;
  switch (el.kind) {
    case 'L':
      return { lo: xLo / w, hi: xHi / w, log: true };
    case 'C':
      return { lo: 1 / (w * xHi), hi: 1 / (w * xLo), log: true };
    case 'R':
      return { lo: xLo, hi: xHi, log: true };
    case 'transformer':
      return { lo: 0.1, hi: 10, log: true };
    case 'line':
    case 'openStub':
    case 'shortStub': {
      // `length` is in wavelengths at refFrequency; the bound is on the
      // electrical length at band centre, so a reference below the band
      // allows proportionally shorter stored lengths.
      const scale =
        el.refFrequency === undefined || !(el.refFrequency > 0) ? 1 : el.refFrequency / f0;
      return { lo: (10 / 360) * scale, hi: (170 / 360) * scale, log: false };
    }
    case 'RLC':
      return null;
  }
}

/** The value the optimizer varies. */
export function primaryValueOf(el: Element): number | null {
  switch (el.kind) {
    case 'R':
    case 'L':
    case 'C':
      return el.value;
    case 'transformer':
      return el.n;
    case 'line':
    case 'openStub':
    case 'shortStub':
      return el.length;
    case 'RLC':
      return null;
  }
}

export function withPrimaryValue<T extends Element>(el: T, value: number): T {
  switch (el.kind) {
    case 'R':
    case 'L':
    case 'C':
      return { ...el, value };
    case 'transformer':
      return { ...el, n: value };
    case 'line':
    case 'openStub':
    case 'shortStub':
      return { ...el, length: value };
    case 'RLC':
      return el;
  }
}

/* -------------------------------------------------------------- the search
 *
 * Nelder-Mead, because the worst case over a band is a maximum and therefore
 * not smooth, so anything wanting derivatives is the wrong tool.
 *
 * The random restarts are seeded. Two runs on the same data give the same
 * answer, which matters more for a tool people are asked to trust than the
 * occasional better optimum a fresh seed might find.
 */
function seeded(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

interface Minimum {
  readonly x: number[];
  readonly value: number;
}

/** Downhill simplex on `cost`, starting at x0 with one vertex per `step`. */
export function nelderMead(
  cost: (x: readonly number[]) => number,
  x0: readonly number[],
  step: readonly number[],
  iterations: number,
): Minimum {
  const n = x0.length;
  let pts: number[][] = [x0.slice()];
  for (let i = 0; i < n; i++) {
    const p = x0.slice();
    p[i] = (p[i] as number) + (step[i] as number);
    pts.push(p);
  }
  let vals = pts.map(cost);

  for (let it = 0; it < iterations; it++) {
    const order = pts.map((_, i) => i).sort((a, b) => (vals[a] as number) - (vals[b] as number));
    pts = order.map((k) => pts[k] as number[]);
    vals = order.map((k) => vals[k] as number);
    const last = pts.length - 1;
    if (Math.abs((vals[last] as number) - (vals[0] as number)) < 1e-7) break;

    const cen: number[] = [];
    for (let i = 0; i < n; i++) {
      let sum = 0;
      for (let j = 0; j < last; j++) sum += (pts[j] as number[])[i] as number;
      cen.push(sum / n);
    }
    const worst = pts[last] as number[];
    const ref = cen.map((c, k) => c + (c - (worst[k] as number)));
    const fr = cost(ref);

    if (fr < (vals[0] as number)) {
      const exp = cen.map((c, k) => c + 2 * (c - (worst[k] as number)));
      const fe = cost(exp);
      if (fe < fr) {
        pts[last] = exp;
        vals[last] = fe;
      } else {
        pts[last] = ref;
        vals[last] = fr;
      }
    } else if (fr < (vals[last - 1] as number)) {
      pts[last] = ref;
      vals[last] = fr;
    } else {
      const con = cen.map((c, k) => c + 0.5 * ((worst[k] as number) - c));
      const fc = cost(con);
      if (fc < (vals[last] as number)) {
        pts[last] = con;
        vals[last] = fc;
      } else {
        const best = pts[0] as number[];
        for (let i = 1; i < pts.length; i++) {
          pts[i] = (pts[i] as number[]).map((v, k) => (v + (best[k] as number)) / 2);
          vals[i] = cost(pts[i] as number[]);
        }
      }
    }
  }
  let best = 0;
  for (let i = 1; i < vals.length; i++) if ((vals[i] as number) < (vals[best] as number)) best = i;
  return { x: pts[best] as number[], value: vals[best] as number };
}

export interface OptimizeProgress {
  /** Restarts finished so far. */
  readonly done: number;
  readonly total: number;
  /** Best worst-case VSWR found so far. */
  readonly best: number;
}

export interface OptimizeOptions {
  /** Indices of the elements to vary; default every element with a primary value. */
  readonly indices?: readonly number[];
  /** Bounds per element index, replacing the reactance-based default. */
  readonly bounds?: Readonly<Record<number, { readonly lo: number; readonly hi: number }>>;
  /** Random restarts after the one from the current values. Default 12. */
  readonly restarts?: number;
  /** Nelder-Mead iterations per restart. Default 300. */
  readonly iterations?: number;
  readonly seed?: number;
  /** Load per frequency when it is not the ladder's fixed load (measured data). */
  readonly load?: LoadModel;
  readonly onProgress?: (p: OptimizeProgress) => void;
}

export interface OptimizeResult {
  /** Worst VSWR over the band of the ladder as given. */
  readonly before: number;
  /** Worst VSWR over the band of the returned ladder; equals `before` when nothing helped. */
  readonly after: number;
  /** The whole ladder with the varied values replaced, same order and kinds. */
  readonly elements: readonly Element[];
  /** Which elements were varied. */
  readonly indices: readonly number[];
  readonly frequencies: readonly number[];
  readonly evaluations: number;
}

/**
 * Improve the ladder's existing parts against the band: minimize the worst
 * VSWR at `frequencies` by Nelder-Mead over the primary value of every
 * tunable element, starting from the current values and then from seeded
 * random points inside the bounds. The current design is kept when no
 * candidate beats it.
 */
export function optimizeBand(
  ladder: Ladder,
  frequencies: readonly number[],
  options: OptimizeOptions = {},
): OptimizeResult {
  const load: LoadModel = options.load ?? ladder.load;
  const freqs = frequencies.filter((f) => f > 0);
  const before = worstVswr(ladder.elements, load, ladder.z0, freqs);
  const indices = (
    options.indices ??
    ladder.elements
      .map((_, i) => i)
      .filter((i) => primaryValueOf(ladder.elements[i] as Element) !== null)
  ).filter(
    (i) =>
      i >= 0 &&
      i < ladder.elements.length &&
      primaryValueOf(ladder.elements[i] as Element) !== null,
  );
  const unchanged: OptimizeResult = {
    before,
    after: before,
    elements: ladder.elements,
    indices,
    frequencies: freqs,
    evaluations: 1,
  };
  if (indices.length === 0 || freqs.length === 0) return unchanged;

  const f0 = ((freqs[0] as number) + (freqs[freqs.length - 1] as number)) / 2;
  const bounds: ParameterBound[] = indices.map((i) => {
    const el = ladder.elements[i] as Element;
    const base = parameterBound(el, ladder.z0, f0) as ParameterBound;
    const override = options.bounds?.[i];
    return override ? { lo: override.lo, hi: override.hi, log: base.log } : base;
  });

  // Search coordinates: u in [0, 1] per parameter, log or linear within its bound.
  const toValue = (u: number, b: ParameterBound): number =>
    b.log ? b.lo * (b.hi / b.lo) ** u : b.lo + u * (b.hi - b.lo);
  const toU = (v: number, b: ParameterBound): number => {
    const u = b.log ? Math.log(v / b.lo) / Math.log(b.hi / b.lo) : (v - b.lo) / (b.hi - b.lo);
    return Number.isFinite(u) ? Math.min(1, Math.max(0, u)) : 0.5;
  };
  const build = (x: readonly number[]): Element[] => {
    const out = ladder.elements.slice();
    indices.forEach((i, k) => {
      out[i] = withPrimaryValue(
        out[i] as Element,
        toValue(x[k] as number, bounds[k] as ParameterBound),
      );
    });
    return out;
  };

  let evaluations = 1;
  const cost = (x: readonly number[]): number => {
    for (const u of x) if (!(u >= 0 && u <= 1)) return OPTIMIZE_FAIL;
    evaluations++;
    return worstVswr(build(x), load, ladder.z0, freqs);
  };

  const rand = seeded(options.seed ?? 20260927);
  const restarts = Math.max(0, Math.floor(options.restarts ?? 12));
  const iterations = Math.max(1, Math.floor(options.iterations ?? 300));
  const step = bounds.map(() => 0.12);

  const x0 = indices.map((i, k) =>
    toU(primaryValueOf(ladder.elements[i] as Element) as number, bounds[k] as ParameterBound),
  );
  let best = nelderMead(cost, x0, step, iterations);
  options.onProgress?.({ done: 0, total: restarts, best: best.value });
  for (let r = 0; r < restarts; r++) {
    const start = bounds.map(() => rand());
    const got = nelderMead(cost, start, step, iterations);
    if (got.value < best.value) best = got;
    options.onProgress?.({ done: r + 1, total: restarts, best: best.value });
  }

  if (!(best.value < before)) return { ...unchanged, evaluations };
  return {
    before,
    after: best.value,
    elements: build(best.x),
    indices,
    frequencies: freqs,
    evaluations,
  };
}

/* -------------------------------------------------------------- feasibility
 *
 * The Bode-Fano floor, for a given load Q and fractional bandwidth: the best
 * worst-case VSWR any lossless network could reach, with no limit on how
 * many elements it may use. It is a wall and not a target; a three-part
 * network will not get near it. Its use is deciding whether to bother: a
 * floor of 1.05 says keep going, a floor of 2.5 says the band is too wide
 * for this load and no amount of cleverness will fix it.
 */
export function bodeFano(q: number, fractionalBandwidth: number): number | null {
  if (!(q > 0) || !(fractionalBandwidth > 0)) return null;
  const g = Math.exp(-Math.PI / (q * fractionalBandwidth));
  return (1 + g) / (1 - g);
}

const Q_WINDOW = 2; // samples either side of the least-squares fit

/** Slope of ys against xs around index i from a least-squares line through the window. */
function slopeAt(xs: readonly number[], ys: readonly number[], i: number): number {
  const lo = Math.max(0, i - Q_WINDOW);
  const hi = Math.min(xs.length - 1, i + Q_WINDOW);
  const n = hi - lo + 1;
  let mx = 0;
  let my = 0;
  for (let j = lo; j <= hi; j++) {
    mx += xs[j] as number;
    my += ys[j] as number;
  }
  mx /= n;
  my /= n;
  let num = 0;
  let den = 0;
  for (let j = lo; j <= hi; j++) {
    num += ((xs[j] as number) - mx) * ((ys[j] as number) - my);
    den += ((xs[j] as number) - mx) ** 2;
  }
  return den ? num / den : 0;
}

/**
 * The Q of a load measured over frequency, at the centre of the band. The
 * textbook Q = (f0 / 2R) dX/df needs a resonance, and a real antenna often
 * has none inside the band you care about. This is the Yaghjian-Best form,
 * defined at every frequency and equal to the textbook one where X does
 * cross zero:
 *
 *     Q(f) = (f / 2R) sqrt( (dR/df)^2 + (dX/df + |X| / f)^2 )
 *
 * Slopes come from a least-squares line through a window of samples, not
 * from two neighbouring points: measured data is noisy, and the difference
 * of two noisy numbers is mostly noise. Null for fewer than five points or a
 * load without resistance.
 */
export function loadQ(load: (f: number) => Complex, frequencies: readonly number[]): number | null {
  const n = frequencies.length;
  if (n < 2 * Q_WINDOW + 1) return null;
  const r: number[] = [];
  const x: number[] = [];
  for (const f of frequencies) {
    const z = load(f);
    if (!Number.isFinite(z.re) || !Number.isFinite(z.im) || !(z.re > 0)) return null;
    r.push(z.re);
    x.push(z.im);
  }
  const m = (n - 1) >> 1;
  const dR = slopeAt(frequencies, r, m);
  const dX = slopeAt(frequencies, x, m) + Math.abs(x[m] as number) / (frequencies[m] as number);
  const q = ((frequencies[m] as number) / (2 * (r[m] as number))) * Math.sqrt(dR * dR + dX * dX);
  return Number.isFinite(q) && q > 0 ? q : null;
}

export interface Feasibility {
  /** Load Q at band centre. */
  readonly q: number;
  readonly fractionalBandwidth: number;
  /** Best worst-case VSWR any lossless network could reach over the band. */
  readonly floor: number;
}

/**
 * What the band is asking for, before any network is chosen. Only for a load
 * known across frequency: a fixed R + jX sits at the same impedance at every
 * frequency, which has no resonance in it and so no Q worth the name (the
 * formula would return |X| / 2R and a floor of 1.0, cheerfully promising a
 * perfect octave match). Better to say nothing than to say that.
 */
export function feasibility(load: LoadModel, frequencies: readonly number[]): Feasibility | null {
  if (typeof load !== 'function') return null;
  const freqs = frequencies.filter((f) => f > 0);
  if (freqs.length < 2) return null;
  const lo = freqs[0] as number;
  const hi = freqs[freqs.length - 1] as number;
  const centre = (lo + hi) / 2;
  if (!(centre > 0) || !(hi > lo)) return null;
  const q = loadQ(load, freqs);
  if (q === null) return null;
  const fractionalBandwidth = (hi - lo) / centre;
  const floor = bodeFano(q, fractionalBandwidth);
  return floor === null ? null : { q, fractionalBandwidth, floor };
}
