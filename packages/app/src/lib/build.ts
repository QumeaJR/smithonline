/**
 * Build-support settings of a design that are stored with it and decoded from
 * links and autosaves: limit areas on the response plots. Each decoder takes
 * whatever the payload held and returns only what is valid.
 */
import { LIMIT_QUANTITIES, type LimitArea, type LimitQuantity } from '@smithonline/core';
import { newId, type StressSettings } from './design';

function finite(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** Limit areas with a known quantity, positive frequencies and a finite value; invalid ones are dropped. */
export function limitsOf(value: unknown): LimitArea[] {
  if (!Array.isArray(value)) return [];
  const out: LimitArea[] = [];
  for (const raw of value) {
    const a = (raw ?? {}) as Record<string, unknown>;
    if (
      !(LIMIT_QUANTITIES as readonly unknown[]).includes(a.quantity) ||
      !finite(a.f1) ||
      !finite(a.f2) ||
      !(a.f1 > 0) ||
      !(a.f2 > 0) ||
      (a.kind !== 'min' && a.kind !== 'max') ||
      !finite(a.value)
    ) {
      continue;
    }
    out.push({
      id: typeof a.id === 'string' && a.id ? a.id : newId(),
      quantity: a.quantity as LimitQuantity,
      f1: a.f1,
      f2: a.f2,
      kind: a.kind,
      value: a.value,
    });
  }
  return out;
}

/** The limit areas of a design, empty when it has none. */
export function limitsOfDesign(design: {
  readonly limits?: readonly LimitArea[];
}): readonly LimitArea[] {
  return design.limits ?? [];
}

/** A stress setting from a payload: power and unit, and limits that are positive numbers; null when it carries nothing. */
export function stressOf(value: unknown): StressSettings | null {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as Record<string, unknown>;
  const power = finite(raw.power) && raw.power > 0 ? raw.power : 0;
  const unit = raw.unit === 'dBm' ? 'dBm' : 'W';
  const limits: Record<string, { vPeak?: number; iRms?: number }> = {};
  const rawLimits = (raw.limits ?? {}) as Record<string, unknown>;
  for (const kind of ['R', 'L', 'C']) {
    const l = rawLimits[kind] as { vPeak?: unknown; iRms?: unknown } | undefined;
    const entry: { vPeak?: number; iRms?: number } = {};
    if (l && finite(l.vPeak) && l.vPeak > 0) entry.vPeak = l.vPeak;
    if (l && finite(l.iRms) && l.iRms > 0) entry.iRms = l.iRms;
    if (entry.vPeak !== undefined || entry.iRms !== undefined) limits[kind] = entry;
  }
  if (power === 0 && unit === 'W' && Object.keys(limits).length === 0) return null;
  return { power, unit, limits };
}

/** The `stress` entry of a decoded design: present only when the payload had any. */
export function stressPatch(value: unknown): { stress?: StressSettings } {
  const s = stressOf(value);
  return s ? { stress: s } : {};
}
