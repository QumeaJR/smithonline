/**
 * Realize mode and the loss model as seen by the app: which elements the
 * chart evaluates, how the realization is built from the design, and the
 * text a ladder card shows for its realized value.
 */
import {
  formatEngineering,
  parseStock,
  realizeLadder,
  sweepFrequency,
  sweepPoints,
  type Ladder,
  type Realization,
  type RealizedElement,
  type SweepPoint,
  type ValueSource,
} from '@smithonline/core';
import type { Design, DesignElement } from './design';

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

function valueSource(design: Design): ValueSource {
  const { series, stockText } = design.realize;
  return series === 'stock'
    ? { kind: 'stock', stock: parseStock(stockText) }
    : { kind: 'series', series };
}

/** The realization of the design, or null when Realize is off. */
export function realizeDesign(
  design: Design,
  elements: readonly DesignElement[],
): Realization | null {
  if (!design.realize.enabled) return null;
  const locked = elements.flatMap((el, i) => (el.locked ? [i] : []));
  return realizeLadder(designLadder(design, elements), {
    source: valueSource(design),
    scope: design.realize.scope,
    locked,
  });
}

/** The realized network's input impedance over the design's sweep range, when the sweep is on. */
export function realizedSweep(
  realization: Realization,
  design: Design,
): readonly SweepPoint[] | null {
  if (!design.sweep.enabled) return null;
  if (design.sweep.loads && design.sweep.loads.length > 0) return null; // datapoint sweeps are drawn for the ideal network only
  const { start, stop, points } = design.sweep;
  if (!(start > 0) || !(stop > 0) || points < 2) return null;
  return sweepFrequency(realization.ladder, sweepPoints(start, stop, points));
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
