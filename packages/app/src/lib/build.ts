/**
 * Build-support settings of a design that are stored with it and decoded from
 * links and autosaves: limit areas on the response plots. Each decoder takes
 * whatever the payload held and returns only what is valid.
 */
import { LIMIT_QUANTITIES, type LimitArea, type LimitQuantity } from '@smithonline/core';
import { newId } from './design';

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
