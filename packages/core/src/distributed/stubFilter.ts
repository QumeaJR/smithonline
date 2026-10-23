/**
 * Commensurate-line stub filters: a lumped low-pass prototype, Richards'
 * transform and the Kuroda identities turn into shunt stubs separated by
 * unit elements (Pozar, Microwave Engineering, 8.6).
 *
 * Richards' transform maps the prototype frequency onto Omega = tan(theta):
 * a series inductor g becomes a series shorted stub of impedance g, a shunt
 * capacitor g a shunt open stub of impedance 1 / g, and the cutoff Omega = 1
 * falls where every element is an eighth wave. So the stubs and lines are an
 * eighth wave at the cutoff frequency, a quarter wave at twice it (where the
 * open stubs short the line and the attenuation is infinite), and the
 * response repeats every four times the cutoff.
 *
 * The series stubs are then removed: redundant unit elements of the
 * termination impedance are added at the ends and pushed inwards with the
 * Kuroda identities, one gap between two stubs each. Every UE that crosses a
 * stub turns it from series to shunt or back, so the number brought in from
 * the source side fixes which stubs end up shunt; all ways that leave only
 * shunt stubs are tried and the one whose impedances stay closest to Z0 is
 * kept. The result has the prototype's response exactly.
 *
 * A high-pass of shunt shorted stubs cannot come out of Kuroda's identities
 * (they never turn a series open stub into a shunt shorted one), so it is
 * built the classic approximate way instead: shorted stubs a quarter wave at
 * twice the cutoff, joined by Z0 quarter-wave lines, stub impedances
 * pi Z0 Delta / (4 g_n) (Pozar 8.8), with Delta tuned so the cutoff lands
 * exactly. It passes from the cutoff to three times it.
 */
import type { LineElement, StubElement } from '../elements.js';
import { cabs } from '../complex.js';
import { commensurateS, kuroda, type CommensurateElement } from './kuroda.js';
import { lowpassPrototype, type PrototypeResponse } from './prototype.js';

export type StubFilterKind = 'lowpass' | 'highpass';

/** The stub impedances a printed board can usually make, ohm. */
export const REALIZABLE_IMPEDANCE: readonly [number, number] = [15, 150];

export interface StubFilterOptions {
  readonly kind: StubFilterKind;
  readonly response: PrototypeResponse;
  /** Number of stubs, 1 to 9. */
  readonly order: number;
  /** Chebyshev passband ripple, dB; default 0.5. */
  readonly rippleDb?: number;
  /** Cutoff frequency, Hz: the 3 dB point (Butterworth) or the ripple band edge (Chebyshev). */
  readonly cutoff: number;
  /** System impedance, ohm. */
  readonly z0: number;
  /** Impedances outside this range are reported as hard to build; default 15 to 150 ohm. */
  readonly range?: readonly [number, number];
}

export interface OutOfRange {
  /** Index in `elements`, load side first. */
  readonly index: number;
  readonly kind: 'line' | 'openStub' | 'shortStub';
  /** Ohm. */
  readonly z: number;
}

export interface StubFilterDesign {
  readonly kind: StubFilterKind;
  readonly response: PrototypeResponse;
  readonly order: number;
  readonly rippleDb: number | null;
  readonly cutoff: number;
  readonly z0: number;
  /** Prototype values g1 .. g_{N+1}. */
  readonly g: readonly number[];
  /** Ladder elements, load side first: shunt stubs with lines between. */
  readonly elements: readonly (LineElement | StubElement)[];
  /** Stub impedances, ohm, load side first. */
  readonly stubImpedances: readonly number[];
  /** Line (unit element) impedances, ohm, load side first. */
  readonly lineImpedances: readonly number[];
  /**
   * The load the filter is designed for, ohm: Z0, except for an even-order
   * Chebyshev low-pass, whose prototype ends in g_{N+1} instead of 1.
   */
  readonly designLoad: number;
  /** Electrical length of every stub and line at the cutoff, in wavelengths (an eighth). */
  readonly lengthAtCutoff: number;
  /** False for the high-pass, whose passband shape is approximate. */
  readonly exact: boolean;
  readonly range: readonly [number, number];
  readonly outOfRange: readonly OutOfRange[];
}

/**
 * True when z lies in the range, with a relative tolerance so that a value
 * that is exactly on a limit in theory (2 Z0 = 150 ohm for Z0 = 75 ohm) is
 * not pushed out by rounding.
 */
export function inRange(z: number, range: readonly [number, number]): boolean {
  const [lo, hi] = range;
  return z >= lo * (1 - 1e-9) && z <= hi * (1 + 1e-9);
}

/** Insertion loss in dB of the prototype at its cutoff: 3.01 dB for Butterworth, the ripple for Chebyshev. */
export function cutoffLossDb(response: PrototypeResponse, rippleDb = 0.5): number {
  return response === 'butterworth' ? 10 * Math.log10(2) : rippleDb;
}

type Orientation = 'series' | 'shunt';

/** Richards' transform of the prototype, from the source: inductors to series shorted stubs, capacitors to shunt open stubs. */
function richards(g: readonly number[], n: number, first: Orientation): CommensurateElement[] {
  return Array.from({ length: n }, (_, i) => {
    const series = (i % 2 === 0) === (first === 'series');
    const gi = g[i] as number;
    return series ? { kind: 'seriesShort', z: gi } : { kind: 'shuntOpen', z: 1 / gi };
  });
}

/** Push the UE at index `at` across `steps` stubs (+1 towards the load, -1 towards the source). */
function pushUe(list: CommensurateElement[], at: number, steps: number, dir: 1 | -1): void {
  let i = at;
  for (let s = 0; s < steps; s++) {
    const j = dir === 1 ? i : i - 1;
    const pair = kuroda(list[j] as CommensurateElement, list[j + 1] as CommensurateElement);
    list.splice(j, 2, ...pair);
    i += dir;
  }
}

/**
 * The low-pass network, normalized to the source, from the source to the
 * load: k redundant UEs brought in from the source end to gaps 1 .. k, the
 * rest from the load end. Null when a series stub is left over.
 */
function lowpassNetwork(
  g: readonly number[],
  n: number,
  first: Orientation,
  k: number,
  rLoad: number,
): CommensurateElement[] | null {
  const list: CommensurateElement[] = [
    ...Array.from({ length: k }, (): CommensurateElement => ({ kind: 'ue', z: 1 })),
    ...richards(g, n, first),
    ...Array.from({ length: n - 1 - k }, (): CommensurateElement => ({ kind: 'ue', z: rLoad })),
  ];
  // The source UE that goes deepest moves first, so no UE ever has to cross another.
  for (let u = k - 1; u >= 0; u--) pushUe(list, u, u + 1, 1);
  for (let u = 0; u < n - 1 - k; u++) pushUe(list, k + n + u, n - 1 - k - u, -1);
  return list.every((el) => el.kind === 'ue' || el.kind === 'shuntOpen') ? list : null;
}

/** How far the impedances stray from the normalized 1: the largest |ln z|. */
function spread(list: readonly CommensurateElement[]): number {
  let worst = 0;
  for (const el of list)
    if (el.kind !== 'transformer') worst = Math.max(worst, Math.abs(Math.log(el.z)));
  return worst;
}

function lowpass(
  g: readonly number[],
  n: number,
): { readonly network: CommensurateElement[]; readonly rLoad: number } {
  let best: { network: CommensurateElement[]; rLoad: number; spread: number } | null = null;
  const last = g[n] as number;
  for (const first of ['series', 'shunt'] as const) {
    // g_{N+1} is a resistance after a shunt capacitor, a conductance after a series inductor.
    const lastSeries = ((n - 1) % 2 === 0) === (first === 'series');
    const rLoad = lastSeries ? 1 / last : last;
    for (let k = 0; k <= n - 1; k++) {
      const network = lowpassNetwork(g, n, first, k, rLoad);
      if (!network) continue;
      const s = spread(network);
      if (!best || s < best.spread - 1e-12) best = { network, rLoad, spread: s };
    }
  }
  if (!best) throw new Error('No Kuroda realization found.');
  return best;
}

/** |S21| in dB of a normalized network between 1 ohm terminations at electrical length theta. */
function s21Db(network: readonly CommensurateElement[], theta: number): number {
  const s = commensurateS(network, theta, 1);
  return 20 * Math.log10(cabs(s[2] as { re: number; im: number }));
}

/** The approximate high-pass: shorted stubs pi Delta / (4 g_n) joined by unit lines, Delta tuned to the cutoff. */
function highpass(g: readonly number[], n: number, lossDb: number): CommensurateElement[] {
  const build = (delta: number): CommensurateElement[] => {
    const list: CommensurateElement[] = [];
    for (let i = 0; i < n; i++) {
      if (i > 0) list.push({ kind: 'ue', z: 1 });
      list.push({ kind: 'shuntShort', z: (Math.PI * delta) / (4 * (g[i] as number)) });
    }
    return list;
  };
  // The cutoff is where every element is an eighth wave; a wider Delta passes more there.
  const miss = (delta: number): number => s21Db(build(delta), Math.PI / 4) + lossDb;
  // Widen the bracket until it holds: a very small ripple needs a Delta far above 1.
  let lo = 1e-3;
  let hi = 20;
  while (!(miss(lo) < 0) && lo > 1e-12) lo /= 10;
  while (!(miss(hi) > 0) && hi < 1e12) hi *= 10;
  if (!(miss(lo) < 0 && miss(hi) > 0)) {
    throw new RangeError('No high-pass reaches this cutoff loss; try a larger ripple.');
  }
  for (let i = 0; i < 200; i++) {
    const mid = Math.sqrt(lo * hi);
    if (miss(mid) < 0) lo = mid;
    else hi = mid;
  }
  return build(Math.sqrt(lo * hi));
}

/**
 * Design a stub low-pass (shunt open stubs) or high-pass (shunt shorted
 * stubs) separated by lines, every element an eighth wave at the cutoff,
 * scaled to z0. The elements come back load side first, ready for the ladder.
 */
export function designStubFilter(options: StubFilterOptions): StubFilterDesign {
  const { kind, response, order, cutoff, z0 } = options;
  if (!(cutoff > 0) || !Number.isFinite(cutoff)) {
    throw new RangeError('The cutoff frequency must be a positive number.');
  }
  if (!(z0 > 0) || !Number.isFinite(z0)) throw new RangeError('Z0 must be a positive number.');
  const rippleDb = response === 'chebyshev' ? (options.rippleDb ?? 0.5) : null;
  const g = lowpassPrototype(order, { response, ...(rippleDb !== null ? { rippleDb } : {}) });
  const lossDb = cutoffLossDb(response, rippleDb ?? undefined);
  const range = options.range ?? REALIZABLE_IMPEDANCE;

  let network: CommensurateElement[];
  let rLoad = 1;
  if (kind === 'lowpass') {
    ({ network, rLoad } = lowpass(g, order));
  } else {
    network = highpass(g, order, lossDb);
  }

  const lengthAtCutoff = 0.125;
  // The ladder runs from the load: reverse the network, scale to ohm.
  const elements: (LineElement | StubElement)[] = [];
  for (const el of [...network].reverse()) {
    if (el.kind === 'transformer') continue;
    const z = el.z * z0;
    if (el.kind === 'ue') {
      elements.push({
        kind: 'line',
        z0: z,
        length: lengthAtCutoff,
        refFrequency: cutoff,
        er: 1,
        alphaDbPerM: 0,
      });
    } else {
      elements.push({
        kind: el.kind === 'shuntOpen' ? 'openStub' : 'shortStub',
        z0: z,
        length: lengthAtCutoff,
        refFrequency: cutoff,
      });
    }
  }
  const outOfRange: OutOfRange[] = [];
  elements.forEach((el, index) => {
    if (!inRange(el.z0, range)) outOfRange.push({ index, kind: el.kind, z: el.z0 });
  });
  return {
    kind,
    response,
    order,
    rippleDb,
    cutoff,
    z0,
    g,
    elements,
    stubImpedances: elements.filter((el) => el.kind !== 'line').map((el) => el.z0),
    lineImpedances: elements.filter((el) => el.kind === 'line').map((el) => el.z0),
    designLoad: rLoad * z0,
    lengthAtCutoff,
    exact: kind === 'lowpass',
    range,
    outOfRange,
  };
}
