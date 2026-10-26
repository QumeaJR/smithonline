/**
 * The one rule for an element of a design: every field its kind needs, each in range. The
 * readers (share links, design files, the autosave) refuse an element that breaks it, and the
 * design store refuses a change that would make one (useDesignStore update), so the application
 * never holds or writes a design its own readers refuse.
 */
import {
  COPPER_RESISTIVITY,
  MICROSTRIP_LENGTH,
  formatEngineering,
  isPackageId,
  isUsableMicrostripLength,
  isUsableStackup,
  isUsableWidth,
  libraryPartOf,
  normalizeStackup,
  stackupProblem,
  type Element,
  type Stackup,
} from '@smithonline/core';

/** The longest microstrip element in words ("1 km"), for refusals. */
export const MICROSTRIP_MAX_WORDS = formatEngineering(MICROSTRIP_LENGTH.max, { unit: 'm' });

const ELEMENT_KINDS = new Set([
  'R',
  'L',
  'C',
  'RLC',
  'transformer',
  'line',
  'openStub',
  'shortStub',
  'microstrip',
  'part',
]);

function finite(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}
function positive(v: unknown): v is number {
  return finite(v) && v > 0;
}
const optional = (v: unknown, ok: (x: unknown) => boolean): boolean => v === undefined || ok(v);

/** True when every number of a stored stackup was usable (normalizing it changed none). */
export function sameStackup(raw: Record<string, unknown>, n: Stackup): boolean {
  const norm = n as unknown as Record<string, unknown>;
  const rhoOk = raw.rho === undefined || raw.rho === (n.rho ?? COPPER_RESISTIVITY);
  return rhoOk && ['h', 'er', 'tanD', 'fRef', 't', 'roughness'].every((k) => raw[k] === norm[k]);
}

/**
 * Why a value is not an element a design may hold, in words that follow the element's name
 * ("Microstrip 2 ..."), or null when it is one.
 */
export function elementProblem(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) return 'is not an element';
  const e = value as Record<string, unknown>;
  if (typeof e.kind !== 'string' || !ELEMENT_KINDS.has(e.kind)) return 'is of no known kind';
  const orientation = e.orientation === 'series' || e.orientation === 'shunt';
  const bad = 'has a value out of range';
  switch (e.kind) {
    case 'R':
      if (!finite(e.value) || e.value < 0) return 'must have a resistance of 0 or more';
      return orientation && e.board === undefined ? null : bad;
    case 'L':
    case 'C':
      // The package is a name the table resolves; parasitics are derived and never travel.
      if (!finite(e.value) || e.value < 0) return 'must have a value of 0 or more';
      return orientation &&
        optional(e.q, finite) &&
        optional(e.package, isPackageId) &&
        e.parasitics === undefined &&
        e.board === undefined
        ? null
        : bad;
    case 'RLC':
      return orientation &&
        (e.connection === 'series' || e.connection === 'parallel') &&
        optional(e.r, finite) &&
        optional(e.l, finite) &&
        optional(e.c, finite) &&
        e.board === undefined
        ? null
        : bad;
    case 'transformer':
      return positive(e.n) ? null : 'must have a turns ratio above 0';
    case 'line':
      if (!positive(e.z0)) return 'must have a Z0 above 0';
      return finite(e.length) &&
        optional(e.refFrequency, positive) &&
        optional(e.er, (v) => positive(v) && (v as number) >= 1) &&
        optional(e.alphaDbPerM, finite)
        ? null
        : bad;
    case 'openStub':
    case 'shortStub':
      if (!positive(e.z0)) return 'must have a Z0 above 0';
      return finite(e.length) && optional(e.refFrequency, positive) ? null : bad;
    case 'part':
      // Names, fitted circuit and (from a file or the autosave) the measured data, every number
      // checked by core's libraryPartOf; board parasitics are derived and never travel.
      return orientation && libraryPartOf(e.part) !== null && e.board === undefined
        ? null
        : 'is not a usable library part';
    case 'microstrip': {
      // The stackup travels with the line, so the link evaluates the same in any browser. Every
      // number must be one the model can use as it stands: a value normalizing would change
      // (bad resistivity, out of range, an unphysical er and tanD) refuses it.
      if (typeof e.stackup !== 'object' || e.stackup === null) return 'has no stackup';
      if (!finite(e.length) || !isUsableMicrostripLength(e.length)) {
        return `must be 0 to ${MICROSTRIP_MAX_WORDS} long${
          finite(e.length) ? ` (it would be ${formatEngineering(e.length, { unit: 'm' })})` : ''
        }`;
      }
      const stackup = normalizeStackup(e.stackup);
      if (
        !isUsableStackup(stackup) ||
        !sameStackup(e.stackup as Record<string, unknown>, stackup)
      ) {
        const why = stackupProblem(e.stackup as Stackup);
        return `has a stackup the model cannot use${why ? ` (${why.field} ${why.reason})` : ''}`;
      }
      return positive(e.width) && isUsableWidth(e.width, stackup)
        ? null
        : 'must have a width of 1 µm to 1 m and a W/h of 0.001 to 1000 on its stackup';
    }
    default:
      return bad;
  }
}

/** True when the value is an element a design may hold (elementProblem gives null). */
export function isElement(value: unknown): value is Element {
  return elementProblem(value) === null;
}
