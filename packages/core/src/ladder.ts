/**
 * Ladder evaluation: walk the elements from the load towards the source,
 * collecting the impedance at every node, the total two-port and S21.
 *
 * Portions derived from QuickSmith-Web, copyright 2017 Nathan Iyer, MIT license
 * (engine.js, commit ca1b69e612f3e7c753591e2a09c38e19110136ef): solve, loadedQ
 * and sweepValues. The 12-slot alternating ladder is replaced by a free list
 * of elements, each with its own orientation.
 */
import {
  cascade,
  IDENTITY,
  throughAbcd,
  transmissionS21,
  type Abcd,
  type Transmission,
} from './abcd.js';
import type { Complex } from './complex.js';
import { datapointInfo, type DatapointInfo } from './conversions.js';
import { elementAbcd, elementArc, type Element } from './elements.js';

export interface Ladder {
  /** Reference impedance for Gamma and S21, ohm. */
  readonly z0: number;
  /** Evaluation frequency, Hz. */
  readonly frequency: number;
  /** Load impedance, ohm. The chain starts here. */
  readonly load: Complex;
  /** Elements from the load towards the source. */
  readonly elements: readonly Element[];
}

export interface EvaluateOptions {
  /** Points per element locus; 0 skips the arcs. Default 32. */
  readonly arcSteps?: number;
}

export interface LadderResult {
  readonly frequency: number;
  readonly z0: number;
  /** Impedance at each node: index 0 is the load, index i the node after element i - 1. */
  readonly datapoints: readonly Complex[];
  /** Derived values per datapoint, same indexing. */
  readonly info: readonly DatapointInfo[];
  /** Locus of each element from its input node to its output node, as impedances. */
  readonly arcs: readonly (readonly Complex[])[];
  /** Two-port of the whole ladder, port 1 at the source. */
  readonly abcd: Abcd;
  /** Input impedance at the source end. */
  readonly zin: Complex;
  /** Transducer gain from a Z0 source into the load. */
  readonly s21: Transmission;
  /** Highest |X| / R reached at any node; the loaded Q a match is designed against. */
  readonly loadedQ: number;
}

/** Evaluate the ladder at its own frequency. */
export function evaluateLadder(ladder: Ladder, options: EvaluateOptions = {}): LadderResult {
  return evaluateAt(ladder, ladder.frequency, ladder.load, options);
}

/** Evaluate the ladder with another load or frequency without copying it. */
export function evaluateAt(
  ladder: Ladder,
  frequency: number,
  load: Complex,
  options: EvaluateOptions = {},
): LadderResult {
  const arcSteps = options.arcSteps ?? 32;
  const datapoints: Complex[] = [load];
  const arcs: Complex[][] = [];
  let m = IDENTITY;
  let z = load;
  for (const el of ladder.elements) {
    const mi = elementAbcd(el, frequency);
    m = cascade(mi, m);
    const before = z;
    z = throughAbcd(mi, z);
    datapoints.push(z);
    arcs.push(arcSteps > 0 ? elementArc(el, before, frequency, arcSteps) : []);
  }
  const info = datapoints.map((p) => datapointInfo(p, ladder.z0));
  return {
    frequency,
    z0: ladder.z0,
    datapoints,
    info,
    arcs,
    abcd: m,
    zin: z,
    s21: transmissionS21(m, load, ladder.z0),
    loadedQ: loadedQ(datapoints),
  };
}

/** The highest Q the network reaches between the load and Zin. */
export function loadedQ(datapoints: readonly Complex[]): number {
  let worst = 0;
  for (const z of datapoints) {
    if (z.re > 0) worst = Math.max(worst, Math.abs(z.im) / z.re);
  }
  return worst;
}

export interface SweepPoint {
  readonly frequency: number;
  /** Input impedance at the source end. */
  readonly zin: Complex;
  readonly info: DatapointInfo;
  readonly s21: Transmission;
}

/**
 * Frequency sweep: the ladder's input impedance at each frequency with the
 * same load. Lumped parts scale with frequency; lines and stubs scale through
 * their `refFrequency`.
 */
export function sweepFrequency(ladder: Ladder, frequencies: readonly number[]): SweepPoint[] {
  return frequencies.map((f) => toSweepPoint(evaluateAt(ladder, f, ladder.load, { arcSteps: 0 })));
}

export interface SweepLoad {
  readonly frequency: number;
  readonly z: Complex;
}

/**
 * Datapoint sweep: the ladder applied to several loads, each at its own
 * frequency (Smith V4.1 "sweep versus datapoints").
 */
export function sweepDatapoints(ladder: Ladder, loads: readonly SweepLoad[]): SweepPoint[] {
  return loads.map((l) => toSweepPoint(evaluateAt(ladder, l.frequency, l.z, { arcSteps: 0 })));
}

function toSweepPoint(r: LadderResult): SweepPoint {
  const last = r.info[r.info.length - 1] as DatapointInfo;
  return { frequency: r.frequency, zin: r.zin, info: last, s21: r.s21 };
}

/**
 * The values a sweep visits: from start, stepping by step, never past stop.
 * The epsilon absorbs a stored step's rounding, so a step meant to divide the
 * span evenly does, and the last value lands exactly on stop when the last
 * step reaches it within a thousandth of a step.
 */
export function sweepValues(start: number, stop: number, step: number): number[] {
  const out: number[] = [];
  const s = Math.abs(step);
  if (!Number.isFinite(start) || !Number.isFinite(stop) || !(s > 0)) return out;
  const dir = stop < start ? -1 : 1;
  const n = Math.floor(Math.abs(stop - start) / s + 1e-9) + 1;
  for (let i = 0; i < n; i++) {
    let v = start + dir * s * i;
    if (Math.abs(v - stop) < s * 1e-3) v = stop;
    out.push(v);
  }
  return out;
}

/** Evenly spaced sweep frequencies from the number of points, inclusive of both ends. */
export function sweepPoints(start: number, stop: number, points: number): number[] {
  const n = Math.max(1, Math.floor(points));
  if (n === 1) return [start];
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(start + ((stop - start) * i) / (n - 1));
  return out;
}
