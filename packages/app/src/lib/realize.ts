/**
 * Realize mode and the loss model as seen by the app: which elements the
 * chart evaluates, how the realization is built from the design, what the
 * matching tools return when values must be standard or stocked, and the
 * text a ladder card shows for its realized value.
 */
import {
  chartDistance,
  formatEngineering,
  hasPackages,
  parseStock,
  realizableValues,
  realizeLadder,
  realizeSolutions,
  sweepFrequency,
  sweepPoints,
  vswrTowards,
  withPackages,
  type Complex,
  type Element,
  type FitResult,
  type Ladder,
  type MatchSolution,
  type PackageTable,
  type PartKind,
  type Realization,
  type RealizedElement,
  type RealizedSolution,
  type RealizeOptions,
  type SweepPoint,
  type ValueSource,
} from '@smithonline/core';
import { designHasDatapointSweep } from './datapoints';
import { targetOf, type Design, type DesignElement, type RealizeSettings } from './design';

/**
 * The elements the chart evaluates. With the loss model on, inductors and
 * capacitors without a Q of their own take the default Q. With it off the
 * design's own array is returned, so ideal mode is untouched.
 */
export function effectiveElements(design: Design): readonly DesignElement[] {
  const { losses } = design;
  if (!losses.enabled) return design.elements;
  return design.elements.map((el) => {
    if ((el.kind === 'L' || el.kind === 'C') && !(el.q !== undefined && el.q > 0)) {
      const q = el.kind === 'L' ? losses.inductorQ : losses.capacitorQ;
      return q > 0 && Number.isFinite(q) ? { ...el, q } : el;
    }
    return el;
  });
}

export function designLadder(design: Design, elements: readonly DesignElement[]): Ladder {
  return { z0: design.z0, frequency: design.frequency, load: design.load, elements };
}

/** The series or stock the Realize settings point at. */
export function valueSource(realize: RealizeSettings): ValueSource {
  const { series, stockText } = realize;
  return series === 'stock'
    ? { kind: 'stock', stock: parseStock(stockText) }
    : { kind: 'series', series };
}

/** The realize options of the design: source, scope, locked elements and the target the VSWR refers to. */
export function realizeOptions(
  design: Design,
  elements: readonly { readonly locked?: boolean }[],
): RealizeOptions {
  return {
    source: valueSource(design.realize),
    scope: design.realize.scope,
    locked: elements.flatMap((el, i) => (el.locked ? [i] : [])),
    target: targetOf(design),
  };
}

/** The realization of the design, or null when Realize is off. */
export function realizeDesign(
  design: Design,
  elements: readonly DesignElement[],
): Realization | null {
  if (!design.realize.enabled) return null;
  return realizeLadder(designLadder(design, elements), realizeOptions(design, elements));
}

/**
 * A derived network's input impedance over the design's frequency sweep, when
 * the sweep is on. Datapoint sweeps (imported points or several user
 * datapoints) are drawn for the ideal network only.
 */
export function derivedSweep(ladder: Ladder, design: Design): readonly SweepPoint[] | null {
  if (!design.sweep.enabled) return null;
  if (design.sweep.loads && design.sweep.loads.length > 0) return null;
  if (designHasDatapointSweep(design)) return null;
  const { start, stop, points } = design.sweep;
  if (!(start > 0) || !(stop > 0) || points < 2) return null;
  return sweepFrequency(ladder, sweepPoints(start, stop, points));
}

/** The realized network's input impedance over the design's sweep range, when the sweep is on. */
export function realizedSweep(
  realization: Realization,
  design: Design,
): readonly SweepPoint[] | null {
  return derivedSweep(realization.ladder, design);
}

/**
 * The network as built: the given elements (the realized ones when Realize is
 * on, else the ideal ones with the loss model) with every chosen package
 * resolved to its parasitics through the table. Null when no part names a
 * package, so nothing is drawn or computed for it.
 */
export function packagedElements<T extends Element>(
  elements: readonly T[],
  table: PackageTable,
): readonly T[] | null {
  return hasPackages(elements) ? withPackages(elements, table) : null;
}

/**
 * "Add parts" with Realize on: each solution appended to the network and
 * snapped with the design's settings, ranked by the VSWR it then gives.
 * Null when Realize is off.
 */
export function snapSolutions(
  design: Design,
  elements: readonly DesignElement[],
  solutions: readonly MatchSolution[],
): RealizedSolution[] | null {
  if (!design.realize.enabled) return null;
  return realizeSolutions(
    designLadder(design, elements),
    solutions,
    realizeOptions(design, elements),
  );
}

/** A fit's values after snapping: what Apply gives with Realize on. */
export interface SnappedFit {
  /** The whole ladder with the fitted parts snapped (and the others as Realize shows them). */
  readonly elements: readonly Element[];
  readonly zin: Complex;
  /** Chart distance from Zin to the target. */
  readonly distance: number;
  /** VSWR of Zin referred to the target. */
  readonly vswr: number;
  readonly sourceLabel: string;
}

/** "Tune existing parts" with Realize on: the fitted values snapped and the residual that leaves. */
export function snapFit(
  design: Design,
  elements: readonly DesignElement[],
  fit: FitResult,
): SnappedFit | null {
  if (!design.realize.enabled) return null;
  const target = targetOf(design);
  const r = realizeLadder(
    { ...designLadder(design, elements), elements: fit.elements },
    realizeOptions(design, elements),
  );
  return {
    elements: r.ladder.elements,
    zin: r.result.zin,
    distance: chartDistance(r.result.zin, target, design.z0),
    vswr: vswrTowards(r.result.zin, target),
    sourceLabel: r.sourceLabel,
  };
}

/**
 * The values a card's slider steps through with Realize on: the series or
 * stock values around `center` for an unlocked R, L or C that is in scope.
 * Null means a continuous slider.
 */
export function sliderSteps(
  realize: RealizeSettings,
  element: DesignElement,
  center: number,
  span = 10,
): number[] | null {
  if (!realize.enabled || element.locked) return null;
  if (element.kind !== 'R' && element.kind !== 'L' && element.kind !== 'C') return null;
  const part: PartKind = element.kind;
  if (realize.scope !== 'all' && realize.scope !== 'pairs' && realize.scope !== part) return null;
  const values = realizableValues(valueSource(realize), part, center, span);
  return values.length > 1 ? values : null;
}

const PART_UNIT = { R: 'Ω', L: 'H', C: 'F' } as const;

/** "E24: 16 nH (-0.2 %)" style text for a ladder card; parts of an RLC block are joined with commas. */
export function realizedText(re: RealizedElement, sourceLabel: string): string {
  if (re.parts.length === 0) return 'exact';
  const parts = re.parts.map((p) => {
    const value = formatEngineering(p.realized, { unit: PART_UNIT[p.part] });
    if (p.source === 'exact') return `${value} exact`;
    const pct = p.deviation * 100;
    const sign = pct > 0 ? '+' : '';
    return `${value} (${sign}${pct.toFixed(pct === 0 ? 0 : Math.abs(pct) < 0.1 ? 2 : 1)} %)`;
  });
  const prefix = re.parts.some((p) => p.source !== 'exact') ? `${sourceLabel}: ` : '';
  const detune = re.detuning !== undefined ? `, resonance ${(re.detuning * 100).toFixed(2)} %` : '';
  return `${prefix}${parts.join(', ')}${detune}`;
}
