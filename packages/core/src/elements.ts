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
  TINY,
  type Complex,
} from './complex.js';
import { cascade, seriesAbcd, shuntAbcd, throughAbcd, type Abcd } from './abcd.js';

/** Speed of light in vacuum, m/s. */
export const SPEED_OF_LIGHT = 299792458;

/** Nepers per decibel (1 / (20 log10 e)). */
const NEPER_PER_DB = Math.LN10 / 20;

export type Orientation = 'series' | 'shunt';

export interface ResistorElement {
  readonly kind: 'R';
  readonly orientation: Orientation;
  /** Ohm. */
  readonly value: number;
}

export interface InductorElement {
  readonly kind: 'L';
  readonly orientation: Orientation;
  /** Henry. */
  readonly value: number;
  /** Quality factor; omitted, 0 or Infinity means ideal. Series R = X / Q. */
  readonly q?: number;
}

export interface CapacitorElement {
  readonly kind: 'C';
  readonly orientation: Orientation;
  /** Farad. */
  readonly value: number;
  /** Quality factor; omitted, 0 or Infinity means ideal. Series R = |X| / Q. */
  readonly q?: number;
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

export type LumpedElement = ResistorElement | InductorElement | CapacitorElement | RlcElement;

export type Element = LumpedElement | TransformerElement | LineElement | StubElement;

/** Shunt elements add admittance at a node, everything else is in the series path. */
export function isShunt(el: Element): boolean {
  switch (el.kind) {
    case 'R':
    case 'L':
    case 'C':
    case 'RLC':
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
      const x = w * nz(el.value);
      return complex(idealQ(el.q) ? 0 : x / (el.q as number), x);
    }
    case 'C': {
      const x = -1 / (w * nz(el.value));
      return complex(idealQ(el.q) ? 0 : -x / (el.q as number), x);
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

/** The ABCD matrix of one element at frequency f (Hz). */
export function elementAbcd(el: Element, f: number): Abcd {
  switch (el.kind) {
    case 'R':
    case 'L':
    case 'C':
    case 'RLC': {
      const z = branchImpedance(el, 2 * Math.PI * f);
      return el.orientation === 'shunt' ? shuntAbcd(cinv(z)) : seriesAbcd(z);
    }
    case 'transformer': {
      const n = nz(el.n);
      return { a: complex(n), b: complex(0), c: complex(0), d: complex(1 / n) };
    }
    case 'line':
      return lineAbcd(el, f);
    case 'openStub':
    case 'shortStub':
      return shuntAbcd(stubAdmittance(el, f));
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
 * is walked by length, a transformer by its ratio.
 */
export function elementArc(el: Element, z: Complex, f: number, steps = 32): Complex[] {
  const n = Math.max(1, Math.floor(steps));
  const points: Complex[] = [];
  const fraction = (i: number): number => i / n;

  const shuntArc = (dy: Complex): Complex[] => {
    const y = cinv(z);
    for (let i = 0; i <= n; i++) {
      points.push(cinv(cadd(y, cscale(dy, fraction(i)))));
    }
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
    default: {
      const zb = branchImpedance(el, 2 * Math.PI * f);
      if (el.orientation === 'shunt') return shuntArc(cinv(zb));
      for (let i = 0; i <= n; i++) {
        points.push(cadd(z, cscale(zb, fraction(i))));
      }
      return points;
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
