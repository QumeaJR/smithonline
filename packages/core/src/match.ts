/**
 * Matching helpers: the networks that move one impedance to another.
 *
 * Portions derived from QuickSmith-Web, copyright 2017 Nathan Iyer, MIT license
 * (engine.js matchToZ0, commit ca1b69e612f3e7c753591e2a09c38e19110136ef),
 * generalized from a real Z0 target to any target impedance.
 *
 * Every two-element match from Z_in to Z_t is one of two shapes, each with
 * up to two solutions:
 *
 *   series first   Z_in --[X]--+--   the series part puts the node on the
 *                              |     constant-conductance circle through Z_t,
 *                             [B]    the shunt part then slides along it
 *
 *   shunt first    Z_in --+--[X]--   the same statement in admittance
 *                         |
 *                        [B]
 *
 * Series first: Re(1 / (Z_in + jX)) = G_t  ->  X = -X_in +/- sqrt(R_in / G_t - R_in^2),
 * which needs R_in <= 1 / G_t. Shunt first mirrors it with B and R_t.
 * Both are exact; nothing is iterated.
 */
import { cabs, cinv, complex, csub, type Complex } from './complex.js';
import { applyElement, type Element } from './elements.js';
import { tuneElement } from './tune.js';

export interface MatchSolution {
  /** Elements in ladder order, from Z_in towards the new source side. */
  readonly elements: readonly Element[];
  /** Highest |X| / R the path passes through; lower means wider bandwidth. */
  readonly q: number;
  /** Where the network actually lands; equals the target up to rounding. */
  readonly result: Complex;
  readonly description: string;
}

/** A series reactance as the part that realizes it at frequency f. */
export function seriesElementFor(x: number, f: number): Element {
  const w = 2 * Math.PI * f;
  return x >= 0
    ? { kind: 'L', orientation: 'series', value: x / w }
    : { kind: 'C', orientation: 'series', value: -1 / (w * x) };
}

/** A shunt susceptance as the part that realizes it. */
export function shuntElementFor(b: number, f: number): Element {
  const w = 2 * Math.PI * f;
  return b >= 0
    ? { kind: 'C', orientation: 'shunt', value: b / w }
    : { kind: 'L', orientation: 'shunt', value: -1 / (w * b) };
}

const MIN_REACTANCE = 1e-9;

function qOf(z: Complex): number {
  return z.re > 0 ? Math.abs(z.im) / z.re : Infinity;
}

/**
 * All two-element L-networks that move `zin` to `target` at frequency f,
 * sorted by loaded Q, lowest (widest bandwidth) first.
 */
export function lMatch(zin: Complex, target: Complex, f: number): MatchSolution[] {
  const out: MatchSolution[] = [];
  if (!(zin.re > 0) || !(target.re > 0) || !(f > 0)) return out;
  const yin = cinv(zin);
  const yt = cinv(target);

  // Series first: land on the constant-G circle of the target.
  const disc1 = zin.re / yt.re - zin.re * zin.re;
  if (disc1 >= 0) {
    for (const sign of [1, -1]) {
      const x = -zin.im + sign * Math.sqrt(disc1);
      const z1 = complex(zin.re, zin.im + x);
      const b = yt.im - cinv(z1).im;
      push(
        out,
        [
          { el: seriesElementFor(x, f), amount: x / scaleZ(target) },
          { el: shuntElementFor(b, f), amount: b * scaleZ(target) },
        ],
        zin,
        target,
        f,
        [z1],
      );
      if (disc1 === 0) break;
    }
  }

  // Shunt first: land on the constant-R circle of the target.
  const disc2 = yin.re / target.re - yin.re * yin.re;
  if (disc2 >= 0) {
    for (const sign of [1, -1]) {
      const b = -yin.im + sign * Math.sqrt(disc2);
      const y1 = complex(yin.re, yin.im + b);
      const z1 = cinv(y1);
      const x = target.im - z1.im;
      push(
        out,
        [
          { el: shuntElementFor(b, f), amount: b * scaleZ(target) },
          { el: seriesElementFor(x, f), amount: x / scaleZ(target) },
        ],
        zin,
        target,
        f,
        [z1],
      );
      if (disc2 === 0) break;
    }
  }

  out.sort((a, b) => a.q - b.q);
  return out;
}

/** Impedance scale used to judge whether a reactance or susceptance is "zero". */
function scaleZ(target: Complex): number {
  return Math.max(cabs(target), 1);
}

interface Part {
  readonly el: Element;
  /** The reactance or susceptance the part adds, normalized to the target impedance. */
  readonly amount: number;
}

function push(
  out: MatchSolution[],
  parts: Part[],
  zin: Complex,
  target: Complex,
  f: number,
  via: Complex[],
): void {
  // A zero-valued part is not a part: drop it and keep the other one alone.
  const kept = parts.filter((p) => Math.abs(p.amount) > MIN_REACTANCE).map((p) => p.el);
  if (kept.length === 0) return;
  let z = zin;
  for (const e of kept) z = applyElement(e, z, f);
  if (cabs(csub(z, target)) > 1e-6 * scaleZ(target)) return;
  const q = Math.max(qOf(zin), ...via.map(qOf), qOf(target));
  out.push({ elements: kept, q, result: z, description: describe(kept) });
}

function describe(elements: readonly Element[]): string {
  return elements
    .map((e) =>
      e.kind === 'L' || e.kind === 'C' || e.kind === 'R' ? `${e.orientation} ${e.kind}` : e.kind,
    )
    .join(' + ');
}

/**
 * Single elements that reach the target from zin on their own. Each
 * candidate is tuned towards the target and kept when it lands within
 * `tolerance` (relative to |target|), so the caller can offer "just add a
 * series C" when that is all it takes.
 */
export function singleMatch(
  candidates: readonly Element[],
  zin: Complex,
  target: Complex,
  f: number,
  tolerance = 0.02,
): MatchSolution[] {
  const out: MatchSolution[] = [];
  for (const base of candidates) {
    const tuned = tuneElement(base, zin, target, f);
    if (!tuned) continue;
    const z = applyElement(tuned, zin, f);
    if (cabs(csub(z, target)) <= tolerance * Math.max(cabs(target), 1)) {
      out.push({
        elements: [tuned],
        q: Math.max(qOf(zin), qOf(z)),
        result: z,
        description: describe([tuned]),
      });
    }
  }
  return out.sort((a, b) => a.q - b.q);
}

/** Two-element networks that move zin to a real impedance z0 (the chart centre). */
export function matchToZ0(zin: Complex, z0: number, f: number): MatchSolution[] {
  return lMatch(zin, complex(z0, 0), f);
}
