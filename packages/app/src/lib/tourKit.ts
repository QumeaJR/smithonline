/**
 * What every guided tour is built from: the step and tour types, the
 * formatting of narrated numbers, the evaluation the chart uses, and the
 * L-network helpers. Tours live in tours.ts and toursAdvanced.ts.
 */
import {
  applyElement,
  chartDistance,
  complex,
  evaluateLadder,
  formatEngineering,
  isShunt,
  lMatch,
  seriesElementFor,
  shuntElementFor,
  type Complex,
  type Element,
  type LadderResult,
} from '@smithonline/core';
import { designVswrLimit } from './tolerance';
import { ladderBandwidth } from './bandwidth';
import { designLoadModel } from './measuredLoad';
import { emptyDesign, targetOf, withIdentity, type Design } from './design';
import { fmtComplex, fmtNum } from './format';
import { designLadder, effectiveElements } from './realize';

export interface TourStep {
  readonly title: string;
  /** The design this step leads to, from the one before it. */
  readonly apply: (design: Design) => Design;
  /** Paragraphs of narration for the design this step produced. */
  readonly narrate: (design: Design) => readonly string[];
}

export interface Tour {
  /** A lesson (the default); workflows are the other kind of tour (lib/workflowKit.ts). */
  readonly kind?: 'lesson';
  readonly id: string;
  readonly title: string;
  readonly blurb: string;
  /** The design the tour starts from; it replaces the current one in a single history entry. */
  readonly start: () => Design;
  /** The first step describes the start design, so its `apply` is the identity. */
  readonly steps: readonly TourStep[];
}

/* ------------------------------------------------------------ formatting */

export const hz = (f: number): string => formatEngineering(f, { unit: 'Hz', digits: 4 });
export const val = (v: number, unit: string): string => formatEngineering(v, { unit, digits: 3 });
/** Values that round to zero are written as +0, never as -j0.00. */
export const flush = (v: number, digits: number): number =>
  Math.abs(v) < 0.5 * 10 ** -digits ? 0 : v;
export const ohm = (z: Complex, digits = 1): string =>
  `${fmtComplex(complex(flush(z.re, digits), flush(z.im, digits)), digits)} Ω`;
export const signed = (v: number, digits = 1): string =>
  `${v < 0 ? '-' : '+'}${Math.abs(v).toFixed(digits)}`;
export const deg = (rad: number): number => (rad * 180) / Math.PI;
export const mS = (y: Complex, digits = 1): string =>
  `${fmtComplex({ re: y.re * 1e3, im: y.im * 1e3 }, digits)} mS`;

export function evaluate(d: Design): LadderResult {
  return evaluateLadder(designLadder(d, effectiveElements(d)), { arcSteps: 0 });
}

/** Reactance in ohm of a series L or C, susceptance in siemens of a shunt one; NaN for the rest. */
export function reactanceOf(el: Element | undefined, f: number): number {
  if (!el || (el.kind !== 'L' && el.kind !== 'C')) return NaN;
  const w = 2 * Math.PI * f;
  const x = el.kind === 'L' ? w * el.value : -1 / (w * el.value);
  return el.orientation === 'series' ? x : -1 / x;
}

/** One part in words: kind, orientation, value and what it adds at f. */
export function partText(el: Element | undefined, f: number): string {
  if (!el) return 'a part';
  switch (el.kind) {
    case 'L':
    case 'C': {
      const name = el.kind === 'L' ? 'inductor' : 'capacitor';
      const amount = reactanceOf(el, f);
      return el.orientation === 'series'
        ? `a series ${name} of ${val(el.value, el.kind === 'L' ? 'H' : 'F')} (X = ${signed(amount)} Ω at ${hz(f)})`
        : `a shunt ${name} of ${val(el.value, el.kind === 'L' ? 'H' : 'F')} (B = ${signed(amount * 1e3)} mS at ${hz(f)})`;
    }
    case 'line':
      return `a series line of ${el.length.toFixed(4)} wavelengths (${(el.length * 360).toFixed(1)} degrees), Z0 = ${fmtNum(el.z0, 1)} Ω`;
    case 'openStub':
      return `an open stub of ${el.length.toFixed(4)} wavelengths (${(el.length * 360).toFixed(1)} degrees), Z0 = ${fmtNum(el.z0, 1)} Ω`;
    case 'shortStub':
      return `a shorted stub of ${el.length.toFixed(4)} wavelengths (${(el.length * 360).toFixed(1)} degrees), Z0 = ${fmtNum(el.z0, 1)} Ω`;
    default:
      return 'a part';
  }
}

export function addElement(d: Design, el: Element): Design {
  return { ...d, elements: [...d.elements, withIdentity(el, d.elements)] };
}

/** Shown when the user has edited the design so far that a step has nothing to describe. */
export function edited(): readonly string[] {
  return [
    'This step has nothing to show: the network was edited, or the load that was set cannot be matched with this method (an L-network that starts with a series part needs a load resistance below Z0, a stub tuner needs a load with positive resistance). Go Back to restore the tour design, or press Next to carry on from what is here.',
  ];
}

export function startDesign(name: string, patch: Partial<Design>): Design {
  return { ...emptyDesign(), name: `Tour: ${name}`, ...patch };
}

/** The first of the two L-network parts, chosen as the shorter way round the chart. */
export function firstLPart(d: Design, prefer: 'series' | 'shunt' | 'any'): Element | null {
  const target = targetOf(d);
  let best: Element | null = null;
  let bestDistance = Infinity;
  for (const sol of lMatch(d.load, target, d.frequency)) {
    const first = sol.elements[0];
    if (sol.elements.length !== 2 || !first) continue;
    if (prefer === 'series' && isShunt(first)) continue;
    if (prefer === 'shunt' && !isShunt(first)) continue;
    const distance = chartDistance(applyElement(first, d.load, d.frequency), d.load, d.z0);
    if (distance < bestDistance) {
      best = first;
      bestDistance = distance;
    }
  }
  return best;
}

/** The second L-network part, which takes the point from where the first one left it to the target. */
export function closingLPart(d: Design): Element | null {
  const first = d.elements[0];
  if (!first) return null;
  const zin = evaluate(d).zin;
  const target = targetOf(d);
  const f = d.frequency;
  if (isShunt(first)) return seriesElementFor(target.im - zin.im, f);
  const yin = {
    re: zin.re / (zin.re ** 2 + zin.im ** 2),
    im: -zin.im / (zin.re ** 2 + zin.im ** 2),
  };
  const yt = {
    re: target.re / (target.re ** 2 + target.im ** 2),
    im: -target.im / (target.re ** 2 + target.im ** 2),
  };
  return shuntElementFor(yt.im - yin.im, f);
}

export function enableSweep(d: Design): Design {
  return {
    ...d,
    sweep: {
      ...d.sweep,
      enabled: true,
      start: d.frequency / 2,
      stop: d.frequency * 1.5,
      points: 91,
    },
  };
}

export function bandwidthText(d: Design): string {
  // The design's own limit, the one the readout shows, so the story and the readout agree.
  const limit = designVswrLimit(d);
  // The load the readout uses: the measured load of a datapoint sweep, else the fixed load.
  const bw =
    limit > 1
      ? ladderBandwidth(designLadder(d, effectiveElements(d)), limit, designLoadModel(d))
      : null;
  if (!bw) {
    return `The VSWR at ${hz(d.frequency)} is above ${fmtNum(limit, 2)}, so there is no band to measure.`;
  }
  return `For VSWR below ${fmtNum(limit, 2)} the usable band is ${hz(bw.low)} to ${hz(bw.high)}, a span of ${hz(bw.span)} or ${fmtNum((100 * bw.span) / d.frequency, 1)} % of the design frequency.`;
}

/* ----------------------------------------------------------- tour 1: L */
