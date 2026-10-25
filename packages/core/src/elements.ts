/**
 * Ladder elements as ABCD two-ports.
 *
 * Every element is plain data with an explicit `kind`. Series and shunt R, L
 * and C carry an `orientation`; the two RLC blocks carry an orientation and the
 * way their three parts are connected; lines are series by nature, stubs shunt.
 * All values are SI (ohm, henry, farad, hertz); line and stub lengths are
 * electrical lengths in wavelengths at `refFrequency`.
 *
 * Portions derived from QuickSmith-Web, copyright 2017 Nathan Iyer, MIT license
 * (engine.js, commit ca1b69e612f3e7c753591e2a09c38e19110136ef): the L and C
 * models with finite Q, the lossless line and stub two-ports, and the element
 * locus (arc) construction. The lossy line follows the Smith V4.1 model
 * (docs/01-original-analysis.md, section 3.3): attenuation in dB per metre of
 * physical length, physical length = free-space electrical length / sqrt(er),
 * attenuation scaled by sqrt(f / refFrequency) away from the design frequency.
 */
import {
  cadd,
  ccosh,
  cdiv,
  cinv,
  cmul,
  complex,
  cscale,
  csinh,
  csub,
  TINY,
  type Complex,
} from './complex.js';
import { cascade, seriesAbcd, shuntAbcd, throughAbcd, type Abcd } from './abcd.js';
import type { PackageId } from './realize/packages.js';
import { microstripAbcd, microstripProperties } from './line.js';
import type { Stackup } from './stackup.js';
import { partAbcd, type LibraryPart } from './parts.js';

import { SPEED_OF_LIGHT } from './constants.js';
export { SPEED_OF_LIGHT };

/** Nepers per decibel (1 / (20 log10 e)). */
const NEPER_PER_DB = Math.LN10 / 20;

export type Orientation = 'series' | 'shunt';

export interface ResistorElement {
  readonly kind: 'R';
  readonly orientation: Orientation;
  /** Ohm. */
  readonly value: number;
  /** Board parasitics of the part as built; omitted means none. */
  readonly board?: BoardParasitics;
}

/** A straight microstrip of a width and a physical length on a stackup. */
export interface MicrostripTrace {
  /** Track width, m. */
  readonly width: number;
  /** Physical length, m. */
  readonly length: number;
  /** The board it is built on. */
  readonly stackup: Stackup;
}

/**
 * What the board adds to a lumped part (phase D4). Like the package
 * parasitics these are not typed in: `withBoard` (board.ts) fills them in
 * for the network as built, so a design never stores them.
 */
export interface BoardParasitics {
  /**
   * Inductance of the via (or vias in parallel) from a shunt part's ground
   * end to the ground plane, H; in series with the shunt branch. Not used on
   * a series part.
   */
  readonly via?: number;
  /**
   * The interconnect trace on the load side of the part: from the previous
   * lumped part to this one, as a microstrip segment. `withBoard` gives the
   * first element none (the load is taken as connected right at it), nor a
   * part next to a line, stub, microstrip or transformer.
   */
  readonly trace?: MicrostripTrace;
}

/**
 * Parasitics of a real inductor or capacitor. They are not typed in by the
 * user: `packageEquivalent` (realize/packages.ts) fills them in from the
 * part's `package` and the parasitics table, so a design never stores them.
 * A missing or zero field contributes nothing.
 */
export interface Parasitics {
  /** Series inductance of a capacitor (ESL), H. Not used on an inductor. */
  readonly esl?: number;
  /** Parallel capacitance of an inductor, F. Not used on a capacitor. */
  readonly cp?: number;
  /** Series resistance of an inductor, ohm, on top of the loss from Q. Not used on a capacitor. */
  readonly esr?: number;
  /**
   * Capacitance of both pads to ground together, F. A series part has half
   * of it at each end; a shunt part has one pad at ground, so only half acts.
   */
  readonly pad?: number;
}

export interface InductorElement {
  /** Board parasitics of the part as built; omitted means none. */
  readonly board?: BoardParasitics;
  readonly kind: 'L';
  readonly orientation: Orientation;
  /** Henry. */
  readonly value: number;
  /** Quality factor; omitted, 0 or Infinity means ideal. Series R = X / Q. */
  readonly q?: number;
  /** Component package the part is built in (see PACKAGE_IDS); omitted means not chosen. */
  readonly package?: PackageId;
  /** Parasitics of the real part, derived from `package`; omitted means none. */
  readonly parasitics?: Parasitics;
}

export interface CapacitorElement {
  /** Board parasitics of the part as built; omitted means none. */
  readonly board?: BoardParasitics;
  readonly kind: 'C';
  readonly orientation: Orientation;
  /** Farad. */
  readonly value: number;
  /** Quality factor; omitted, 0 or Infinity means ideal. Series R = |X| / Q. */
  readonly q?: number;
  /** Component package the part is built in (see PACKAGE_IDS); omitted means not chosen. */
  readonly package?: PackageId;
  /** Parasitics of the real part, derived from `package`; omitted means none. */
  readonly parasitics?: Parasitics;
}

/**
 * Three parts in one branch. Smith V4.1 offers the series element with R, L
 * and C connected in parallel and the shunt element with R, L and C connected
 * in series; both connections are allowed in both orientations here. A part
 * with value 0 (or omitted) is left out of the branch.
 */
export interface RlcElement {
  readonly kind: 'RLC';
  readonly orientation: Orientation;
  readonly connection: 'series' | 'parallel';
  /** Ohm. */
  readonly r?: number;
  /** Henry. */
  readonly l?: number;
  /** Farad. */
  readonly c?: number;
  /** Board parasitics of the block as built; omitted means none. */
  readonly board?: BoardParasitics;
}

/** Ideal transformer with voltage ratio n: the source sees n^2 times the load impedance. */
export interface TransformerElement {
  readonly kind: 'transformer';
  readonly n: number;
}

/** Series transmission line, lossless or lossy. */
export interface LineElement {
  readonly kind: 'line';
  /** Characteristic impedance, ohm. */
  readonly z0: number;
  /** Electrical length in wavelengths at `refFrequency`. */
  readonly length: number;
  /**
   * Frequency at which `length` holds, Hz. The physical length is fixed, so the
   * electrical length scales with f / refFrequency. When omitted the length is
   * taken as given at every evaluation frequency.
   */
  readonly refFrequency?: number;
  /** Effective relative permittivity, default 1. */
  readonly er?: number;
  /** Attenuation in dB per metre of physical length at `refFrequency`, default 0. */
  readonly alphaDbPerM?: number;
}

/** Shunt stub, open or shorted at its far end. Lossless. */
export interface StubElement {
  readonly kind: 'openStub' | 'shortStub';
  /** Characteristic impedance, ohm. */
  readonly z0: number;
  /** Electrical length in wavelengths at `refFrequency`. */
  readonly length: number;
  /** See LineElement.refFrequency. */
  readonly refFrequency?: number;
}

/**
 * A microstrip line on a board (phase D4): a track width and a physical
 * length on a stackup, evaluated with the frequency-dependent Z0 and
 * propagation of the microstrip model (line.ts): dispersion, conductor and
 * dielectric loss. Series, like a line.
 */
export interface MicrostripElement extends MicrostripTrace {
  readonly kind: 'microstrip';
}

/**
 * A part from the user's part library (phase D5): a real inductor or
 * capacitor evaluated from its manufacturer's measured S-parameters
 * (parts.ts), in series or in shunt. It carries the part's names, its fitted
 * equivalent circuit and, unless it came from a share link, the measured
 * data itself, so a design file reopens complete. Outside the data's
 * frequency range it has no value (NaN), never an extrapolated one.
 */
export interface PartElement {
  readonly kind: 'part';
  readonly orientation: Orientation;
  readonly part: LibraryPart;
  /** Board parasitics of the part as built (a via under a shunt part, the trace before it); omitted means none. */
  readonly board?: BoardParasitics;
}

export type LumpedElement = ResistorElement | InductorElement | CapacitorElement | RlcElement;

export type Element =
  LumpedElement | TransformerElement | LineElement | StubElement | MicrostripElement | PartElement;

/** Shunt elements add admittance at a node, everything else is in the series path. */
export function isShunt(el: Element): boolean {
  switch (el.kind) {
    case 'R':
    case 'L':
    case 'C':
    case 'RLC':
    case 'part':
      return el.orientation === 'shunt';
    case 'openStub':
    case 'shortStub':
      return true;
    default:
      return false;
  }
}

/** Zero is not a usable value for a reactive part; treat it as "almost zero" as QuickSmith does. */
function nz(v: number): number {
  return v === 0 ? TINY : v;
}

function idealQ(q: number | undefined): boolean {
  return q === undefined || !(q > 0) || !Number.isFinite(q);
}

/**
 * The impedance of a lumped element's branch at angular frequency w, before
 * it is placed in series or in shunt.
 */
export function branchImpedance(el: LumpedElement, w: number): Complex {
  switch (el.kind) {
    case 'R':
      return complex(el.value, 0);
    case 'L': {
      // (R_Q + ESR + jwL) || Cp: the real inductor with its winding capacitance.
      const x = w * nz(el.value);
      const p = el.parasitics;
      const series = complex((idealQ(el.q) ? 0 : x / (el.q as number)) + (p?.esr ?? 0), x);
      const cp = p?.cp ?? 0;
      return cp > 0 ? cinv(cadd(cinv(series), complex(0, w * cp))) : series;
    }
    case 'C': {
      // R_Q + jwESL + 1/(jwC): the real capacitor with its series inductance.
      const x = -1 / (w * nz(el.value));
      const esl = el.parasitics?.esl ?? 0;
      return complex(idealQ(el.q) ? 0 : -x / (el.q as number), x + w * esl);
    }
    case 'RLC': {
      const r = el.r ?? 0;
      const l = el.l ?? 0;
      const c = el.c ?? 0;
      if (el.connection === 'series') {
        // R + jwL + 1/(jwC); a missing part contributes nothing.
        const x = (l > 0 ? w * l : 0) - (c > 0 ? 1 / (w * c) : 0);
        return complex(r, x);
      }
      // R || L || C: Y = 1/R + jwC + 1/(jwL); a missing part contributes nothing.
      const g = r > 0 ? 1 / r : 0;
      const b = (c > 0 ? w * c : 0) - (l > 0 ? 1 / (w * l) : 0);
      return cinv(complex(g, b));
    }
  }
}

/** Electrical length in radians at frequency f. */
export function electricalLengthRad(el: LineElement | StubElement, f: number): number {
  const scale = el.refFrequency === undefined ? 1 : f / el.refFrequency;
  return 2 * Math.PI * el.length * scale;
}

/**
 * Physical length in metres: the free-space wavelength at the reference
 * frequency times the electrical length, divided by sqrt(er).
 */
export function physicalLength(el: LineElement, f: number): number {
  const fref = el.refFrequency ?? f;
  const er = el.er ?? 1;
  return (el.length * (SPEED_OF_LIGHT / fref)) / Math.sqrt(er);
}

/** Attenuation of the whole line in nepers at frequency f. */
export function lineAttenuationNp(el: LineElement, f: number): number {
  const alpha = el.alphaDbPerM ?? 0;
  if (alpha === 0) return 0;
  const fref = el.refFrequency ?? f;
  return alpha * NEPER_PER_DB * physicalLength(el, f) * Math.sqrt(f / fref);
}

/**
 * Two-port of a line with propagation gamma l = alpha l + j beta l:
 *   [ cosh(gl)        Zc sinh(gl) ]
 *   [ sinh(gl) / Zc   cosh(gl)    ]
 * With alpha = 0 this is exactly the lossless cos / j sin form.
 */
function lineAbcd(el: LineElement, f: number): Abcd {
  const gl = complex(lineAttenuationNp(el, f), electricalLengthRad(el, f));
  const zc = complex(Math.abs(nz(el.z0)));
  const ch = ccosh(gl);
  const sh = csinh(gl);
  return { a: ch, b: cmul(zc, sh), c: cdiv(sh, zc), d: ch };
}

/** Input admittance of a lossless stub: open j Y0 tan(bl), shorted -j Y0 cot(bl). */
export function stubAdmittance(el: StubElement, f: number): Complex {
  const bl = electricalLengthRad(el, f);
  const z0 = Math.abs(nz(el.z0));
  // nz keeps a zero-length shorted stub a (huge, finite) short instead of NaN.
  return el.kind === 'openStub'
    ? complex(0, Math.tan(bl) / z0)
    : complex(0, -1 / (z0 * nz(Math.tan(bl))));
}

/** The pad capacitance of a lumped element, F (both pads together); 0 without parasitics. */
export function padCapacitance(el: LumpedElement): number {
  if (el.kind !== 'L' && el.kind !== 'C') return 0;
  const pad = el.parasitics?.pad ?? 0;
  return pad > 0 && Number.isFinite(pad) ? pad : 0;
}

/** The via inductance of a shunt lumped element, H; 0 without one or on a series part. */
export function viaInductanceOf(el: LumpedElement): number {
  if (el.orientation !== 'shunt') return 0;
  const via = el.board?.via ?? 0;
  return via > 0 && Number.isFinite(via) ? via : 0;
}

/** The board trace on the load side of a lumped element, or null without one. */
export function traceOf(el: Element): MicrostripTrace | null {
  if (
    el.kind !== 'R' &&
    el.kind !== 'L' &&
    el.kind !== 'C' &&
    el.kind !== 'RLC' &&
    el.kind !== 'part'
  )
    return null;
  const t = el.board?.trace;
  return t && t.length > 0 && t.width > 0 ? t : null;
}

/**
 * The admittance of a shunt lumped element at angular frequency w: the
 * branch in series with its via, and its node pad in parallel (the other pad
 * is at the ground end, where the via shorts it out).
 */
export function shuntAdmittance(el: LumpedElement, w: number): Complex {
  const z = branchImpedance(el, w);
  const via = viaInductanceOf(el);
  const y = cinv(via > 0 ? cadd(z, complex(0, w * via)) : z);
  const pad = padCapacitance(el);
  return pad > 0 ? cadd(y, complex(0, (w * pad) / 2)) : y;
}

/**
 * The ABCD matrix of a lumped part itself, without its trace. A series part
 * with pad capacitance has half of it to ground at each end; a shunt part has
 * its node pad in parallel with the branch and its via in series with it.
 */
export function lumpedPartAbcd(el: LumpedElement, w: number): Abcd {
  if (el.orientation === 'shunt') return shuntAbcd(shuntAdmittance(el, w));
  const z = branchImpedance(el, w);
  const pad = padCapacitance(el);
  if (pad === 0) return seriesAbcd(z);
  const half = shuntAbcd(complex(0, (w * pad) / 2));
  return cascade(half, cascade(seriesAbcd(z), half));
}

/** The ABCD matrix of a board trace at frequency f. */
export function traceAbcd(t: MicrostripTrace, f: number): Abcd {
  return microstripAbcd(t.stackup, t.width, t.length, f);
}

/** The ABCD matrix of a lumped element: the part, and its trace on the load side. */
function lumpedAbcd(el: LumpedElement, f: number): Abcd {
  const part = lumpedPartAbcd(el, 2 * Math.PI * f);
  const trace = traceOf(el);
  return trace ? cascade(part, traceAbcd(trace, f)) : part;
}

/** The via inductance under a shunt library part, H; 0 without one or on a series part. */
export function partViaOf(el: PartElement): number {
  if (el.orientation !== 'shunt') return 0;
  const via = el.board?.via ?? 0;
  return via > 0 && Number.isFinite(via) ? via : 0;
}

/** The ABCD matrix of a library part: the part (with its via in shunt) and its trace on the load side. */
function partElementAbcd(el: PartElement, f: number): Abcd {
  const part = partAbcd(el.part, el.orientation, f, partViaOf(el));
  const trace = traceOf(el);
  return trace ? cascade(part, traceAbcd(trace, f)) : part;
}

/** The ABCD matrix of one element at frequency f (Hz). */
export function elementAbcd(el: Element, f: number): Abcd {
  switch (el.kind) {
    case 'R':
    case 'L':
    case 'C':
    case 'RLC':
      return lumpedAbcd(el, f);
    case 'transformer': {
      const n = nz(el.n);
      return { a: complex(n), b: complex(0), c: complex(0), d: complex(1 / n) };
    }
    case 'line':
      return lineAbcd(el, f);
    case 'openStub':
    case 'shortStub':
      return shuntAbcd(stubAdmittance(el, f));
    case 'microstrip':
      return microstripAbcd(el.stackup, el.width, el.length, f);
    case 'part':
      return partElementAbcd(el, f);
  }
}

/** The impedance seen towards the load through this element: Zin = (A z + B) / (C z + D). */
export function applyElement(el: Element, z: Complex, f: number): Complex {
  return throughAbcd(elementAbcd(el, f), z);
}

/**
 * The locus the element traces on the chart while it grows from nothing to
 * its full value, as `steps + 1` impedances from z to applyElement(el, z, f).
 *
 * A series part adds its impedance, so the path is the straight segment in
 * the impedance plane (the constant-R arc for a pure reactance). A shunt part
 * and a stub are the same statement in admittance (the constant-G arc; a stub
 * walked by length would start at a short or an open, not at the node). A line
 * is walked by length, a transformer by its ratio. A series part with pad
 * capacitance walks its three pieces in turn: pad, branch, pad.
 */
export function elementArc(el: Element, z: Complex, f: number, steps = 32): Complex[] {
  const n = Math.max(1, Math.floor(steps));
  const points: Complex[] = [];
  const fraction = (i: number): number => i / n;

  const shuntPath = (from: Complex, dy: Complex): Complex[] => {
    const y = cinv(from);
    const out: Complex[] = [];
    for (let i = 0; i <= n; i++) out.push(cinv(cadd(y, cscale(dy, fraction(i)))));
    return out;
  };
  const shuntArc = (dy: Complex): Complex[] => {
    points.push(...shuntPath(z, dy));
    return points;
  };

  switch (el.kind) {
    case 'line': {
      for (let i = 0; i <= n; i++) {
        const part = { ...el, length: el.length * fraction(i) };
        points.push(applyElement(part, z, f));
      }
      return points;
    }
    case 'openStub':
    case 'shortStub':
      return shuntArc(stubAdmittance(el, f));
    case 'transformer': {
      for (let i = 0; i <= n; i++) {
        const ratio = 1 + (el.n - 1) * fraction(i);
        points.push(cscale(z, ratio * ratio));
      }
      return points;
    }
    case 'microstrip': {
      for (let i = 0; i <= n; i++) {
        points.push(
          throughAbcd(microstripAbcd(el.stackup, el.width, el.length * fraction(i), f), z),
        );
      }
      return points;
    }
    case 'part': {
      // The trace first, as for a lumped part; then the part as one step, a straight path in
      // impedance (series) or admittance (shunt) from where the trace ends to the output.
      const trace = traceOf(el);
      const lead: Complex[] = [];
      if (trace) {
        for (let i = 0; i <= n; i++) {
          lead.push(throughAbcd(traceAbcd({ ...trace, length: trace.length * fraction(i) }, f), z));
        }
      }
      const from = lead.length > 0 ? (lead[lead.length - 1] as Complex) : z;
      const to = throughAbcd(partAbcd(el.part, el.orientation, f, partViaOf(el)), from);
      let part: Complex[];
      if (el.orientation === 'shunt') {
        part = shuntPath(from, csub(cinv(to), cinv(from)));
      } else {
        part = [];
        for (let i = 0; i <= n; i++) part.push(cadd(from, cscale(csub(to, from), fraction(i))));
      }
      return lead.length > 0 ? [...lead, ...part.slice(1)] : part;
    }
    default: {
      // A trace on the load side is walked first, by length; the part starts where it ends.
      const trace = traceOf(el);
      const lead: Complex[] = [];
      if (trace) {
        for (let i = 0; i <= n; i++) {
          lead.push(throughAbcd(traceAbcd({ ...trace, length: trace.length * fraction(i) }, f), z));
        }
      }
      const from = lead.length > 0 ? (lead[lead.length - 1] as Complex) : z;
      const w = 2 * Math.PI * f;
      let part: Complex[];
      if (el.orientation === 'shunt') {
        part = shuntPath(from, shuntAdmittance(el, w));
      } else {
        const zb = branchImpedance(el, w);
        const pad = padCapacitance(el);
        const yPad = complex(0, (w * pad) / 2);
        part = pad > 0 ? shuntPath(from, yPad) : [from];
        const z1 = part[part.length - 1] as Complex;
        for (let i = 1; i <= n; i++) {
          part.push(cadd(z1, cscale(zb, fraction(i))));
        }
        if (pad > 0) part.push(...shuntPath(part[part.length - 1] as Complex, yPad).slice(1));
      }
      return lead.length > 0 ? [...lead, ...part.slice(1)] : part;
    }
  }
}

/** The ABCD matrix of a whole ladder, load side first in the array. */
export function ladderAbcd(elements: readonly Element[], f: number): Abcd {
  let m: Abcd = { a: complex(1), b: complex(0), c: complex(0), d: complex(1) };
  for (const el of elements) {
    m = cascade(elementAbcd(el, f), m);
  }
  return m;
}

/**
 * The locus a node can reach by varying one element over its whole useful
 * range, as impedances: lumped parts from a hundredth to a hundred times the
 * given value (which spans the constant-R or constant-G circle almost from
 * end to end), lines and stubs over half a wavelength, a transformer from
 * 0.1 to 10. Used to preview where an element can take the design before it
 * is added. RLC blocks and library parts (no value to vary) return an empty list.
 */
export function elementReach(el: Element, z: Complex, f: number, steps = 96): Complex[] {
  const n = Math.max(2, Math.floor(steps));
  const points: Complex[] = [];
  switch (el.kind) {
    case 'RLC':
    case 'part':
      return points;
    case 'line':
    case 'openStub':
    case 'shortStub': {
      for (let i = 0; i <= n; i++) {
        points.push(applyElement({ ...el, length: (0.5 * i) / n }, z, f));
      }
      return points;
    }
    case 'microstrip': {
      // Half a guided wavelength at f.
      const half = Math.PI / microstripProperties(el.stackup, el.width, f).beta;
      for (let i = 0; i <= n; i++) {
        points.push(applyElement({ ...el, length: (half * i) / n }, z, f));
      }
      return points;
    }
    case 'transformer': {
      for (let i = 0; i <= n; i++) {
        const ratio = 10 ** (-1 + (2 * i) / n);
        points.push(cscale(z, ratio * ratio));
      }
      return points;
    }
    default: {
      for (let i = 0; i <= n; i++) {
        const value = el.value * 10 ** (-2 + (4 * i) / n);
        points.push(applyElement({ ...el, value }, z, f));
      }
      return points;
    }
  }
}
