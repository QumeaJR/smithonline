/**
 * Voltage and current stress as the app uses it: the source power and the
 * limits per part kind kept in the design, and the stress of the network the
 * design shows (the realized values when Realize is on, with the loss model).
 */
import {
  dbmToWatt,
  ladderStress,
  type ElementStress,
  type Realization,
  type StressLimits,
} from '@smithonline/core';
import type { Design, DesignElement, StressSettings } from './design';
import { designLadder } from './realize';

export const DEFAULT_STRESS: StressSettings = { power: 0, unit: 'W', limits: {} };

/** The stress settings of a design; a design that never set any has the defaults (power off). */
export function stressSettings(design: Pick<Design, 'stress'>): StressSettings {
  return design.stress ?? DEFAULT_STRESS;
}

/** Source power typed in the chosen unit, as watts; null for text that is not a power. */
export function powerToWatt(value: number, unit: StressSettings['unit']): number | null {
  if (!Number.isFinite(value)) return null;
  const w = unit === 'dBm' ? dbmToWatt(value) : value;
  return w >= 0 && Number.isFinite(w) ? w : null;
}

/**
 * The stress of each element of the network the design shows, or null when
 * no source power is set. Realize on: the realized parts; otherwise the
 * elements as evaluated.
 */
export function designStress(
  design: Design,
  elements: readonly DesignElement[],
  realization: Realization | null,
): (ElementStress | null)[] | null {
  const { power } = stressSettings(design);
  if (!(power > 0)) return null;
  const ladder = realization ? realization.ladder : designLadder(design, elements);
  return ladderStress(ladder, power);
}

/** The limits as the core wants them: only positive numbers count. */
export function activeLimits(settings: StressSettings): StressLimits {
  const out: Record<string, { vPeak?: number; iRms?: number }> = {};
  for (const [kind, lim] of Object.entries(settings.limits)) {
    const v = lim?.vPeak;
    const i = lim?.iRms;
    const entry: { vPeak?: number; iRms?: number } = {};
    if (v !== undefined && v > 0) entry.vPeak = v;
    if (i !== undefined && i > 0) entry.iRms = i;
    if (entry.vPeak !== undefined || entry.iRms !== undefined) out[kind] = entry;
  }
  return out as StressLimits;
}
