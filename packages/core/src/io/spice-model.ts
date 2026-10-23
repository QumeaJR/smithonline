/**
 * A ladder as simulator stages, shared by the SPICE netlist and LTspice
 * schematic writers: each element becomes a branch of parts (with a loss
 * resistor in series where a Q is set) or an ideal transmission line, and the
 * source and the load become a Z0 generator and a series R-L or R-C branch.
 *
 * The load is a series R with L or C taken at the design frequency, which is
 * exact there and an approximation elsewhere; a ladder evaluated over a band
 * against a frequency-dependent load is not representable.
 */
import type { Complex } from '../complex.js';
import type { Element, LumpedElement } from '../elements.js';
import type { Ladder } from '../ladder.js';

export class SpiceError extends Error {
  override readonly name = 'SpiceError';
}

export interface SpicePart {
  readonly kind: 'R' | 'L' | 'C';
  /** Instance name, unique in the design: R3, L3, C3. */
  readonly name: string;
  /** Ohm, henry or farad. */
  readonly value: number;
  /** Loss resistor in series with the part, from its Q at the design frequency. */
  readonly loss?: { readonly name: string; readonly value: number };
}

export interface LumpedStage {
  readonly type: 'lumped';
  /** 1-based position in the ladder. */
  readonly index: number;
  readonly orientation: 'series' | 'shunt';
  /** How the parts are connected to each other. */
  readonly connection: 'series' | 'parallel';
  readonly parts: readonly SpicePart[];
}

export interface LineStage {
  readonly type: 'line' | 'openStub' | 'shortStub';
  readonly index: number;
  readonly z0: number;
  /** One-way delay, s. */
  readonly delay: number;
  /** The element has attenuation that an ideal line does not model. */
  readonly lossy: boolean;
}

export type Stage = LumpedStage | LineStage;

function positiveValue(v: number | undefined, what: string): number {
  if (v === undefined || !Number.isFinite(v) || !(v > 0)) {
    throw new SpiceError(`${what} must be positive to be written (it is ${String(v)})`);
  }
  return v;
}

function part(
  kind: 'R' | 'L' | 'C',
  index: number,
  value: number,
  q: number | undefined,
  w: number,
): SpicePart {
  const v = positiveValue(value, `${kind} of element ${index}`);
  if (q !== undefined && q > 0 && Number.isFinite(q) && (kind === 'L' || kind === 'C')) {
    const loss = kind === 'L' ? (w * v) / q : 1 / (w * v * q);
    return {
      kind,
      name: `${kind}${index}`,
      value: v,
      loss: { name: `R${kind}${index}`, value: loss },
    };
  }
  return { kind, name: `${kind}${index}`, value: v };
}

function lumpedStage(el: LumpedElement, index: number, w: number): LumpedStage {
  switch (el.kind) {
    case 'R':
      return {
        type: 'lumped',
        index,
        orientation: el.orientation,
        connection: 'series',
        parts: [part('R', index, el.value, undefined, w)],
      };
    case 'L':
    case 'C':
      return {
        type: 'lumped',
        index,
        orientation: el.orientation,
        connection: 'series',
        parts: [part(el.kind, index, el.value, el.q, w)],
      };
    case 'RLC': {
      const parts: SpicePart[] = [];
      if ((el.r ?? 0) > 0) parts.push(part('R', index, el.r as number, undefined, w));
      if ((el.l ?? 0) > 0) parts.push(part('L', index, el.l as number, undefined, w));
      if ((el.c ?? 0) > 0) parts.push(part('C', index, el.c as number, undefined, w));
      if (parts.length === 0) throw new SpiceError(`RLC block of element ${index} has no parts`);
      return {
        type: 'lumped',
        index,
        orientation: el.orientation,
        connection: el.connection,
        parts,
      };
    }
  }
}

/**
 * The stages of the ladder, load side first. Throws SpiceError for a part with
 * no positive value (a zero resistor is a wire, not a netlist line) and for the
 * ideal transformer, which has no single primitive in a ground-referenced netlist.
 */
export function ladderStages(ladder: Ladder): Stage[] {
  const f = ladder.frequency;
  if (!(f > 0)) throw new SpiceError('The design frequency must be positive');
  const w = 2 * Math.PI * f;
  return ladder.elements.map((el, k): Stage => {
    const index = k + 1;
    switch (el.kind) {
      case 'R':
      case 'L':
      case 'C':
      case 'RLC':
        return lumpedStage(el, index, w);
      case 'transformer':
        throw new SpiceError(
          `Element ${index} is an ideal transformer, which this export cannot write; replace it before exporting`,
        );
      case 'line':
      case 'openStub':
      case 'shortStub': {
        const fref = el.refFrequency ?? f;
        return {
          type: el.kind,
          index,
          z0: positiveValue(el.z0, `Z0 of element ${index}`),
          delay: Math.abs(el.length) / fref,
          lossy: el.kind === 'line' && (el.alphaDbPerM ?? 0) > 0,
        };
      }
    }
  });
}

/** The load as a series R and, when it has reactance, an L or C. */
export function loadBranch(load: Complex, f: number): SpicePart[] {
  const w = 2 * Math.PI * f;
  const parts: SpicePart[] = [];
  // A negative resistance is written as it is (ngspice accepts it); only a zero or bad value is floored.
  const r = Number.isFinite(load.re) && load.re !== 0 ? load.re : 1e-6;
  parts.push({ kind: 'R', name: 'RLOAD', value: r });
  if (load.im > 0) parts.push({ kind: 'L', name: 'LLOAD', value: load.im / w });
  else if (load.im < 0) parts.push({ kind: 'C', name: 'CLOAD', value: -1 / (w * load.im) });
  return parts;
}

/** Whether the ladder has distributed elements that the LTspice schematic writer leaves to the netlist. */
export function hasDistributed(elements: readonly Element[]): boolean {
  return elements.some((e) => e.kind === 'line' || e.kind === 'openStub' || e.kind === 'shortStub');
}

/** Every terminator a text editor or a SPICE reader may honour (CR, LF, NEL, LS, PS, VT, FF) and NUL. */
const LINE_BREAKS = new RegExp(
  '[' + String.fromCharCode(13, 10, 0x85, 0x2028, 0x2029, 11, 12, 0) + ']+',
  'g',
);

/** A design name as one line: a line break in it would otherwise inject rows into an exported file. */
export function cleanName(name: string): string {
  return name.replace(LINE_BREAKS, ' ').trim();
}
