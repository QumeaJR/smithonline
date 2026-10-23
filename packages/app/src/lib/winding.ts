/**
 * The inductor winding helper as the app uses it: the editable table of
 * toroid cores kept in local storage, and the text written to a card's note.
 */
import {
  formatEngineering,
  TOROID_CORES,
  type SolenoidResult,
  type ToroidCore,
  type ToroidResult,
} from '@smithonline/core';

export const CORES_KEY = 'smithonline.cores.v1';

function isCore(v: unknown): v is ToroidCore {
  if (typeof v !== 'object' || v === null) return false;
  const c = v as Record<string, unknown>;
  const pos = (x: unknown): boolean => typeof x === 'number' && Number.isFinite(x) && x > 0;
  return (
    typeof c.name === 'string' &&
    c.name.trim() !== '' &&
    pos(c.al) &&
    pos(c.od) &&
    pos(c.id) &&
    pos(c.height) &&
    (c.od as number) > (c.id as number)
  );
}

/** The core table as stored; the built-in one when nothing valid was kept. */
export function parseCores(text: string | null): ToroidCore[] {
  if (!text) return [...TOROID_CORES];
  try {
    const raw = JSON.parse(text) as unknown;
    const cores = Array.isArray(raw) ? raw.filter(isCore) : [];
    return cores.length > 0 ? cores : [...TOROID_CORES];
  } catch {
    return [...TOROID_CORES];
  }
}

export function loadCores(): ToroidCore[] {
  try {
    return parseCores(localStorage.getItem(CORES_KEY));
  } catch {
    return [...TOROID_CORES];
  }
}

/** Keep the table; false when the browser refuses (private mode, quota). */
export function saveCores(cores: readonly ToroidCore[]): boolean {
  try {
    localStorage.setItem(CORES_KEY, JSON.stringify(cores));
    return true;
  } catch {
    return false;
  }
}

const mm = (m: number): string => `${Number((m * 1e3).toPrecision(3))} mm`;
const turnsText = (n: number): string => `${n} turn${n === 1 ? '' : 's'}`;

/** The card note for an air-core solenoid. */
export function solenoidNote(r: SolenoidResult, diameter: number, pitch: number | null): string {
  const pitchText = pitch !== null ? `, pitch ${mm(pitch)}` : '';
  return (
    `Air core: ${turnsText(r.turns)} on ${mm(diameter)} mean diameter${pitchText}, ` +
    `length ${mm(r.length)}, wire ${mm(r.wireLength)}, L = ${formatEngineering(r.inductance, { unit: 'H', digits: 4 })} (Wheeler)`
  );
}

/** The card note for a toroid. */
export function toroidNote(core: string, r: ToroidResult): string {
  const wire = r.wireLength !== null ? `, wire ${mm(r.wireLength)}` : '';
  return `Toroid ${core}: ${turnsText(r.turns)}${wire}, L = ${formatEngineering(r.inductance, { unit: 'H', digits: 4 })}`;
}
