/**
 * Sensitivity of the match to each part: analytic derivatives of the input
 * reflection coefficient, its magnitude and the VSWR with respect to every
 * part's primary value (and its Q where one is set), through the ABCD
 * cascade the chart evaluates.
 *
 * Each element's ABCD matrix is differentiated in closed form with respect
 * to its own parameter (dE/dp), and the product rule along the chain gives
 * the derivative of the whole two-port: with M = E[n-1] ... E[1] E[0] (load
 * side first, as `ladderAbcd` multiplies) the derivative for a parameter of
 * element i is S[i] dE[i] P[i], where P[i] = E[i-1] ... E[0] is the part of
 * the chain on the load side and S[i] = E[n-1] ... E[i+1] the part on the
 * source side. From M the input impedance is Zin = (A ZL + B) / (C ZL + D),
 * so
 *
 *     dZin = (dA ZL + dB - Zin (dC ZL + dD)) / (C ZL + D),
 *
 * the reflection coefficient towards a target t is Gamma = (Z - t) / (Z + t*)
 * (the ordinary one for t = Z0), so dGamma = 2 Re(t) dZ / (Z + t*)^2, and for
 * a real parameter d|Gamma| = Re(conj(Gamma) dGamma) / |Gamma| and
 * dVSWR = 2 d|Gamma| / (1 - |Gamma|)^2.
 *
 * Two places where a derivative does not exist, and what is reported:
 *
 * - |Gamma| at a perfect match (Gamma = 0) is a cone, not a smooth surface:
 *   every direction increases it. dGamma (complex) is still exact there; the
 *   derivatives of |Gamma| and of the VSWR are reported as 0 (the symmetric
 *   difference of a cone). A synthesized match lands within rounding of
 *   Gamma = 0 (|Gamma| about 1e-16), where the direction of Gamma is noise and
 *   d|Gamma| would be an arbitrary projection, so |Gamma| below
 *   PERFECT_MATCH (1e-9, VSWR within 2e-9 of 1) counts as a perfect match. The spread
 *   ranking then falls back to the mean square of the change of Gamma,
 *   which is the second-order term of |Gamma|^2 at the match (spreadShares).
 * - The worst VSWR over a band is a maximum over frequencies and has a kink
 *   wherever two frequencies tie. `bandSensitivity` reports the derivative at
 *   the frequency of the worst case (exact on the side of the kink the
 *   nominal sits on) and, as a smooth alternative, the derivative of the
 *   power mean of the VSWR over the band,
 *
 *       S_p = ( (1/N) sum_k VSWR_k^p )^(1/p),   p = 32 by default,
 *
 *   which is smooth everywhere, lies between max VSWR * N^(-1/p) and the
 *   max VSWR (0.89 to 1 of it for 41 points), weights each frequency by
 *   (VSWR_k / S_p)^(p - 1), and tends to the worst case as p grows. A
 *   frequency where the VSWR is not finite (|Gamma| >= 1, an active load
 *   point) has no derivative and is left out of the mean and its weights.
 *
 * Normalized sensitivities are the change per percent of the parameter,
 * dX/dp * p / 100: "VSWR rises by 0.012 per percent of Shunt L 1".
 */
import {
  cabs,
  cadd,
  ccosh,
  cdiv,
  cmul,
  complex,
  conj,
  cscale,
  csinh,
  csub,
  ONE,
  ZERO,
  type Complex,
} from './complex.js';
import { cascade, IDENTITY, shuntAbcd, type Abcd } from './abcd.js';
import {
  branchImpedance,
  electricalLengthRad,
  elementAbcd,
  padCapacitance,
  SPEED_OF_LIGHT,
  traceAbcd,
  traceOf,
  viaInductanceOf,
  type Element,
  type LumpedElement,
} from './elements.js';
import { microstripProperties } from './line.js';
import type { LoadModel } from './optimize.js';

/** The parameters a derivative can be taken with respect to. */
export type SensitivityParameter =
  'value' | 'q' | 'r' | 'l' | 'c' | 'n' | 'length' | 'z0' | 'width';

/** One parameter of one element of the ladder. */
export interface ParameterRef {
  /** Element index, load side first. */
  readonly index: number;
  readonly parameter: SensitivityParameter;
}

/** |Gamma| at or below this is a perfect match: d|Gamma| and dVSWR are 0 there (see above). */
export const PERFECT_MATCH = 1e-9;

/** Nepers per decibel, as in elements.ts. */
const NEPER_PER_DB = Math.LN10 / 20;

const positive = (v: number | undefined): v is number =>
  v !== undefined && v > 0 && Number.isFinite(v);

/**
 * The parameters of an element that have a derivative: the primary value of
 * an R, L or C (and its Q when a finite Q is set), each part of an RLC block
 * that is present, a transformer's ratio, and a line's or stub's length and
 * characteristic impedance, a microstrip's length and track width. A value
 * of zero (which the element evaluates as "almost zero") has none.
 */
export function elementParameters(el: Element): SensitivityParameter[] {
  switch (el.kind) {
    case 'R':
      return positive(el.value) ? ['value'] : [];
    case 'L':
    case 'C': {
      if (!positive(el.value)) return [];
      return positive(el.q) ? ['value', 'q'] : ['value'];
    }
    case 'RLC': {
      const out: SensitivityParameter[] = [];
      if (positive(el.r)) out.push('r');
      if (positive(el.l)) out.push('l');
      if (positive(el.c)) out.push('c');
      return out;
    }
    case 'transformer':
      return el.n !== 0 && Number.isFinite(el.n) ? ['n'] : [];
    case 'line':
    case 'openStub':
    case 'shortStub': {
      const out: SensitivityParameter[] = [];
      if (Number.isFinite(el.length)) out.push('length');
      if (el.z0 !== 0 && Number.isFinite(el.z0)) out.push('z0');
      return out;
    }
    case 'microstrip': {
      const out: SensitivityParameter[] = [];
      if (Number.isFinite(el.length)) out.push('length');
      if (positive(el.width)) out.push('width');
      return out;
    }
    case 'part':
      // A library part is its measured data: no value to vary.
      return [];
  }
}

/** Every parameter of every element, in ladder order. */
export function ladderParameters(elements: readonly Element[]): ParameterRef[] {
  return elements.flatMap((el, index) =>
    elementParameters(el).map((parameter) => ({ index, parameter })),
  );
}

/** The value of a parameter; NaN when the element has no such parameter. */
export function parameterValue(el: Element, p: SensitivityParameter): number {
  switch (el.kind) {
    case 'R':
      return p === 'value' ? el.value : NaN;
    case 'L':
    case 'C':
      return p === 'value' ? el.value : p === 'q' ? (el.q ?? NaN) : NaN;
    case 'RLC':
      return p === 'r'
        ? (el.r ?? NaN)
        : p === 'l'
          ? (el.l ?? NaN)
          : p === 'c'
            ? (el.c ?? NaN)
            : NaN;
    case 'transformer':
      return p === 'n' ? el.n : NaN;
    case 'line':
    case 'openStub':
    case 'shortStub':
      return p === 'length' ? el.length : p === 'z0' ? el.z0 : NaN;
    case 'microstrip':
      return p === 'length' ? el.length : p === 'width' ? el.width : NaN;
    case 'part':
      return NaN;
  }
}

/** A copy of the element with one parameter set; the element itself when it has no such parameter. */
export function withParameter<T extends Element>(el: T, p: SensitivityParameter, v: number): T {
  switch (el.kind) {
    case 'R':
      return p === 'value' ? { ...el, value: v } : el;
    case 'L':
    case 'C':
      return p === 'value' ? { ...el, value: v } : p === 'q' ? { ...el, q: v } : el;
    case 'RLC':
      return p === 'r'
        ? { ...el, r: v }
        : p === 'l'
          ? { ...el, l: v }
          : p === 'c'
            ? { ...el, c: v }
            : el;
    case 'transformer':
      return p === 'n' ? { ...el, n: v } : el;
    case 'line':
    case 'openStub':
    case 'shortStub':
      return p === 'length' ? { ...el, length: v } : p === 'z0' ? { ...el, z0: v } : el;
    case 'microstrip':
      return p === 'length' ? { ...el, length: v } : p === 'width' ? { ...el, width: v } : el;
    case 'part':
      return el;
  }
}

/* ------------------------------------------------- element derivatives */

/** d(branch impedance)/dp of a lumped element at angular frequency w. */
function branchDerivative(el: LumpedElement, p: SensitivityParameter, w: number): Complex {
  switch (el.kind) {
    case 'R':
      return p === 'value' ? ONE : ZERO;
    case 'L': {
      // s = (x / q + ESR) + j x with x = w L; with Cp, z = s / (1 + j w Cp s).
      const x = w * el.value;
      const ideal = !positive(el.q);
      let ds: Complex;
      if (p === 'value') ds = complex(ideal ? 0 : w / (el.q as number), w);
      else if (p === 'q' && !ideal) ds = complex(-x / ((el.q as number) * (el.q as number)), 0);
      else return ZERO;
      const cp = el.parasitics?.cp ?? 0;
      if (!(cp > 0)) return ds;
      const s = complex((ideal ? 0 : x / (el.q as number)) + (el.parasitics?.esr ?? 0), x);
      const den = cadd(ONE, cmul(complex(0, w * cp), s));
      return cdiv(ds, cmul(den, den));
    }
    case 'C': {
      // z = -x / q + j (x + w ESL) with x = -1 / (w C).
      const x = -1 / (w * el.value);
      const ideal = !positive(el.q);
      if (p === 'value') {
        const dx = 1 / (w * el.value * el.value);
        return complex(ideal ? 0 : -dx / (el.q as number), dx);
      }
      if (p === 'q' && !ideal) return complex(x / ((el.q as number) * (el.q as number)), 0);
      return ZERO;
    }
    case 'RLC': {
      const r = el.r ?? 0;
      const l = el.l ?? 0;
      const c = el.c ?? 0;
      if (el.connection === 'series') {
        // z = R + j w L - j / (w C).
        if (p === 'r') return r > 0 ? ONE : ZERO;
        if (p === 'l') return l > 0 ? complex(0, w) : ZERO;
        if (p === 'c') return c > 0 ? complex(0, 1 / (w * c * c)) : ZERO;
        return ZERO;
      }
      // y = 1/R + j w C - j / (w L), z = 1 / y, dz = -z^2 dy.
      let dy: Complex;
      if (p === 'r' && r > 0) dy = complex(-1 / (r * r), 0);
      else if (p === 'l' && l > 0) dy = complex(0, 1 / (w * l * l));
      else if (p === 'c' && c > 0) dy = complex(0, w);
      else return ZERO;
      const z = branchImpedance(el, w);
      return cscale(cmul(cmul(z, z), dy), -1);
    }
  }
}

const ZERO_ABCD: Abcd = { a: ZERO, b: ZERO, c: ZERO, d: ZERO };

/**
 * dE/dp: the derivative of an element's ABCD matrix (as elementAbcd builds
 * it) with respect to one of its parameters at frequency f. The zero matrix
 * for a parameter the element does not have.
 */
export function elementAbcdDerivative(el: Element, p: SensitivityParameter, f: number): Abcd {
  const w = 2 * Math.PI * f;
  switch (el.kind) {
    case 'part':
      return ZERO_ABCD;
    case 'R':
    case 'L':
    case 'C':
    case 'RLC': {
      const dz = branchDerivative(el, p, w);
      if (dz.re === 0 && dz.im === 0) return ZERO_ABCD;
      const z = branchImpedance(el, w);
      const pad = padCapacitance(el);
      // A board trace on the load side multiplies the part's matrix from the right: E = P T.
      const trace = traceOf(el);
      const withTrace = (dPart: Abcd): Abcd =>
        trace ? cascade(dPart, traceAbcd(trace, f)) : dPart;
      if (el.orientation === 'shunt') {
        // y = 1/(z + j w Lvia) (+ j w pad / 2), dy = -dz / (z + j w Lvia)^2.
        const zt = cadd(z, complex(0, w * viaInductanceOf(el)));
        const dy = cscale(cdiv(dz, cmul(zt, zt)), -1);
        return withTrace({ a: ZERO, b: ZERO, c: dy, d: ZERO });
      }
      const dSeries: Abcd = { a: ZERO, b: dz, c: ZERO, d: ZERO };
      if (pad === 0) return withTrace(dSeries);
      const half = shuntAbcd(complex(0, (w * pad) / 2));
      return withTrace(cascade(half, cascade(dSeries, half)));
    }
    case 'microstrip': {
      // E = [cosh(gl), Zc sinh(gl); sinh(gl) / Zc, cosh(gl)] with Zc and gamma at f.
      const at = microstripProperties(el.stackup, el.width, f);
      const zc = at.z0;
      const gl = cscale(at.gamma, el.length);
      const ch = ccosh(gl);
      const sh = csinh(gl);
      if (p === 'length') {
        const da = cmul(sh, at.gamma);
        const dch = cmul(ch, at.gamma);
        return { a: da, b: cmul(zc, dch), c: cdiv(dch, zc), d: da };
      }
      if (p === 'width') {
        // Zc and gamma depend on the width through the whole microstrip model; their
        // derivatives are central differences (relative step 1e-6, error about 1e-12 relative).
        const hStep = el.width * 1e-6;
        const up = microstripProperties(el.stackup, el.width + hStep, f);
        const dn = microstripProperties(el.stackup, el.width - hStep, f);
        const dzc = cscale(csub(up.z0, dn.z0), 1 / (2 * hStep));
        const dgl = cscale(csub(up.gamma, dn.gamma), el.length / (2 * hStep));
        const da = cmul(sh, dgl);
        return {
          a: da,
          b: cadd(cmul(dzc, sh), cmul(cmul(zc, ch), dgl)),
          c: csub(cdiv(cmul(ch, dgl), zc), cdiv(cmul(dzc, sh), cmul(zc, zc))),
          d: da,
        };
      }
      return ZERO_ABCD;
    }
    case 'transformer': {
      if (p !== 'n') return ZERO_ABCD;
      const n = el.n;
      return { a: ONE, b: ZERO, c: ZERO, d: complex(-1 / (n * n), 0) };
    }
    case 'line': {
      const fref = el.refFrequency ?? f;
      const scale = el.refFrequency === undefined ? 1 : f / el.refFrequency;
      const alpha = el.alphaDbPerM ?? 0;
      const er = el.er ?? 1;
      const att =
        alpha === 0
          ? 0
          : alpha *
            NEPER_PER_DB *
            ((el.length * (SPEED_OF_LIGHT / fref)) / Math.sqrt(er)) *
            Math.sqrt(f / fref);
      const gl = complex(att, electricalLengthRad(el, f));
      const zc = Math.abs(el.z0);
      const ch = ccosh(gl);
      const sh = csinh(gl);
      if (p === 'length') {
        // d(gamma l)/d(length): the attenuation and the phase are both proportional to it.
        const dAtt =
          alpha === 0
            ? 0
            : alpha * NEPER_PER_DB * (SPEED_OF_LIGHT / fref / Math.sqrt(er)) * Math.sqrt(f / fref);
        const dgl = complex(dAtt, 2 * Math.PI * scale);
        const da = cmul(sh, dgl);
        return {
          a: da,
          b: cscale(cmul(ch, dgl), zc),
          c: cscale(cmul(ch, dgl), 1 / zc),
          d: da,
        };
      }
      if (p === 'z0') {
        const sign = Math.sign(el.z0);
        return { a: ZERO, b: cscale(sh, sign), c: cscale(sh, -sign / (zc * zc)), d: ZERO };
      }
      return ZERO_ABCD;
    }
    case 'openStub':
    case 'shortStub': {
      const bl = electricalLengthRad(el, f);
      const scale = el.refFrequency === undefined ? 1 : f / el.refFrequency;
      const z0 = Math.abs(el.z0);
      const t = Math.tan(bl);
      let dy: number;
      if (p === 'length') {
        const dbl = 2 * Math.PI * scale;
        // open: Y = j tan(bl) / Z0; short: Y = -j / (Z0 tan(bl)).
        dy = el.kind === 'openStub' ? (dbl * (1 + t * t)) / z0 : (dbl * (1 + 1 / (t * t))) / z0;
      } else if (p === 'z0') {
        const sign = Math.sign(el.z0);
        dy = el.kind === 'openStub' ? (-t / (z0 * z0)) * sign : (1 / (z0 * z0 * t)) * sign;
      } else {
        return ZERO_ABCD;
      }
      return { a: ZERO, b: ZERO, c: complex(0, dy), d: ZERO };
    }
  }
}

/* ------------------------------------------------------ at one frequency */

export interface PointSensitivity {
  readonly frequency: number;
  readonly zin: Complex;
  /** Reflection coefficient of Zin referred to the target (Z0 by default). */
  readonly gamma: Complex;
  readonly gammaMag: number;
  /** Infinity for |Gamma| >= 1. */
  readonly vswr: number;
  /** One entry per parameter, in the order of `parameters`. */
  readonly dZin: readonly Complex[];
  readonly dGamma: readonly Complex[];
  /** 0 at a perfect match (see the file comment). */
  readonly dGammaMag: readonly number[];
  /** 0 at a perfect match; NaN where |Gamma| >= 1. */
  readonly dVswr: readonly number[];
}

export interface SensitivityOptions {
  /** The parameters to differentiate by; default every parameter (ladderParameters). */
  readonly parameters?: readonly ParameterRef[];
  /** The impedance Gamma and the VSWR are referred to; default the real Z0. */
  readonly target?: Complex;
}

function gammaOf(z: Complex, z0: number, target: Complex | undefined): Complex {
  const t = target ?? complex(z0, 0);
  return cdiv(csub(z, t), cadd(z, conj(t)));
}

/**
 * Zin, Gamma, |Gamma| and the VSWR of the ladder at one frequency with their
 * analytic derivatives by every parameter.
 */
export function sensitivityAt(
  elements: readonly Element[],
  load: Complex,
  z0: number,
  f: number,
  options: SensitivityOptions = {},
): PointSensitivity {
  const parameters = options.parameters ?? ladderParameters(elements);
  const n = elements.length;
  const mats = elements.map((el) => elementAbcd(el, f));
  // prefix[i] = E[i-1] ... E[0]; suffix[i] = E[n-1] ... E[i+1].
  const prefix: Abcd[] = [IDENTITY];
  for (let i = 0; i < n; i++) prefix.push(cascade(mats[i] as Abcd, prefix[i] as Abcd));
  const suffix: Abcd[] = new Array<Abcd>(n);
  let acc = IDENTITY;
  for (let i = n - 1; i >= 0; i--) {
    suffix[i] = acc;
    acc = cascade(acc, mats[i] as Abcd);
  }
  const m = prefix[n] as Abcd;
  const den = cadd(cmul(m.c, load), m.d);
  const zin = cdiv(cadd(cmul(m.a, load), m.b), den);
  const t = options.target ?? complex(z0, 0);
  const gamma = gammaOf(zin, z0, options.target);
  const mag = cabs(gamma);
  const vswr = Number.isFinite(mag) && mag < 1 ? (1 + mag) / (1 - mag) : Infinity;
  const zPlus = cadd(zin, conj(t));
  const dGammaDz = cdiv(complex(2 * t.re, 0), cmul(zPlus, zPlus));

  const dZin: Complex[] = [];
  const dGamma: Complex[] = [];
  const dGammaMag: number[] = [];
  const dVswr: number[] = [];
  for (const ref of parameters) {
    const el = elements[ref.index];
    if (!el) throw new RangeError(`no element ${ref.index}`);
    const dE = elementAbcdDerivative(el, ref.parameter, f);
    const dM = cascade(suffix[ref.index] as Abcd, cascade(dE, prefix[ref.index] as Abcd));
    const dz = cdiv(
      csub(cadd(cmul(dM.a, load), dM.b), cmul(zin, cadd(cmul(dM.c, load), dM.d))),
      den,
    );
    const dg = cmul(dGammaDz, dz);
    const dm = mag > PERFECT_MATCH ? (gamma.re * dg.re + gamma.im * dg.im) / mag : 0;
    dZin.push(dz);
    dGamma.push(dg);
    dGammaMag.push(dm);
    dVswr.push(mag < 1 ? (2 * dm) / ((1 - mag) * (1 - mag)) : NaN);
  }
  return { frequency: f, zin, gamma, gammaMag: mag, vswr, dZin, dGamma, dGammaMag, dVswr };
}

/* ------------------------------------------------------------ over a band */

/** Default order of the power mean that smooths the worst VSWR over a band. */
export const SMOOTH_ORDER = 32;

export interface BandSensitivity {
  readonly parameters: readonly ParameterRef[];
  /** One entry per frequency, in the order given. */
  readonly points: readonly PointSensitivity[];
  /** The worst VSWR, the frequency it is at, and the derivatives there. */
  readonly worst: {
    readonly index: number;
    readonly frequency: number;
    readonly vswr: number;
    readonly dVswr: readonly number[];
  };
  /**
   * The power mean of order `order` of the VSWR over the band and its
   * derivatives, over the frequencies where the VSWR is finite.
   */
  readonly smooth: {
    readonly order: number;
    readonly value: number;
    readonly dValue: readonly number[];
    /**
     * Weight of each frequency in the derivative, (VSWR_k / S_p)^(p - 1) / N over the N finite
     * points; they sum to about 1. 0 for a frequency left out (VSWR not finite).
     */
    readonly weights: readonly number[];
    /** Frequencies left out because the VSWR there is not finite. */
    readonly excluded: number;
  };
}

export interface BandSensitivityOptions extends SensitivityOptions {
  /** Order p of the power mean; default SMOOTH_ORDER. */
  readonly order?: number;
}

/** The sensitivities at every frequency of a band, of its worst VSWR and of the smooth power mean. */
export function bandSensitivity(
  elements: readonly Element[],
  load: LoadModel,
  z0: number,
  frequencies: readonly number[],
  options: BandSensitivityOptions = {},
): BandSensitivity {
  const parameters = options.parameters ?? ladderParameters(elements);
  const points = frequencies.map((f) =>
    sensitivityAt(elements, typeof load === 'function' ? load(f) : load, z0, f, {
      parameters,
      ...(options.target ? { target: options.target } : {}),
    }),
  );
  const p = options.order !== undefined && options.order >= 1 ? options.order : SMOOTH_ORDER;
  let worstIndex = 0;
  for (let k = 1; k < points.length; k++) {
    if ((points[k] as PointSensitivity).vswr > (points[worstIndex] as PointSensitivity).vswr) {
      worstIndex = k;
    }
  }
  const worstPoint = points[worstIndex];
  const nParams = parameters.length;
  const N = points.length;
  let value = NaN;
  const dValue = new Array<number>(nParams).fill(NaN);
  const weights = new Array<number>(N).fill(NaN);
  // The frequencies with a finite VSWR and finite derivatives; the others carry no weight.
  const finite = points.map(
    (pt) => Number.isFinite(pt.vswr) && pt.dVswr.every((d) => Number.isFinite(d)),
  );
  const used = finite.filter(Boolean).length;
  if (used > 0) {
    let vmax = 0;
    points.forEach((pt, k) => {
      if (finite[k] && pt.vswr > vmax) vmax = pt.vswr;
    });
    let sum = 0;
    points.forEach((pt, k) => {
      if (finite[k]) sum += (pt.vswr / vmax) ** p;
    });
    value = vmax * (sum / used) ** (1 / p);
    dValue.fill(0);
    points.forEach((pt, k) => {
      if (!finite[k]) {
        weights[k] = 0;
        return;
      }
      const wk = (pt.vswr / value) ** (p - 1) / used;
      weights[k] = wk;
      for (let i = 0; i < nParams; i++)
        dValue[i] = (dValue[i] as number) + wk * (pt.dVswr[i] as number);
    });
  }
  return {
    parameters,
    points,
    worst: {
      index: worstIndex,
      frequency: worstPoint?.frequency ?? NaN,
      vswr: worstPoint?.vswr ?? NaN,
      dVswr: worstPoint?.dVswr ?? new Array<number>(nParams).fill(NaN),
    },
    smooth: { order: p, value, dValue, weights, excluded: N - used },
  };
}

/** A derivative as the change per percent of the parameter: d * value / 100. */
export function perPercent(derivative: number, value: number): number {
  return (derivative * value) / 100;
}

/* ------------------------------------------------- who causes the spread */

/** How one parameter varies: its tolerance and the group of parts it drifts with. */
export interface ParameterTolerance {
  readonly ref: ParameterRef;
  /** Tolerance as a fraction (0.05 for 5 percent): the band of the draw. */
  readonly tolerance: number;
  /**
   * Parts with the same group and a correlation above 0 drift together
   * (parts from one reel), with this correlation coefficient between any two.
   */
  readonly group?: string;
  readonly correlation?: number;
}

export interface SpreadShare {
  readonly ref: ParameterRef;
  /**
   * Share of the variance of the ranked quantity (Gamma for spreadShares, the quantity whose
   * derivatives scalarSpread is given otherwise); sum 1 over the parameters, negative when
   * the part offsets others.
   */
  readonly share: number;
  /** RMS change of the quantity this part causes alone, one standard deviation of its draw. */
  readonly rms: number;
}

export interface SpreadAnalysis {
  readonly shares: readonly SpreadShare[];
  /** RMS of the change of the quantity, all parts together (linearized). */
  readonly rms: number;
}

/**
 * The standard deviation of a relative draw with the given tolerance: the
 * band over sqrt(3) for a uniform draw, a third of it for a normal one (the
 * band is three standard deviations).
 */
export function relativeSigma(tolerance: number, distribution: 'uniform' | 'normal'): number {
  return distribution === 'normal' ? tolerance / 3 : tolerance / Math.sqrt(3);
}

/**
 * Which part dominates the spread of the match under its tolerance. The
 * change of Gamma is linearized, dGamma = sum_i dGamma/dp_i p_i delta_i with
 * delta_i the relative draw of part i, so its mean square is
 *
 *     E|dGamma|^2 = sum_k w_k sum_ij rho_ij sigma_i sigma_j Re(a_ik conj(a_jk)),
 *     a_ik = dGamma_k/dp_i p_i,
 *
 * over the judged frequencies k with weights w_k (one frequency with weight 1
 * at the design frequency; over a band the power-mean weights, which put the
 * weight where the VSWR is worst). Each part's share is its Euler
 * contribution, sigma_i sum_k w_k Re(a_ik conj(sum_j rho_ij sigma_j a_jk))
 * over the total: the shares add up to 1, are the plain variance shares
 * when nothing is correlated, and a part whose correlated drift cancels
 * another's gets a negative share.
 *
 * The complex Gamma is what to rank by at a perfect match: there |Gamma|
 * has no derivative, and E|Gamma|^2 = E|dGamma|^2 is exactly this mean
 * square (the second-order term of |Gamma|^2). Away from a match the phase
 * part of dGamma does not change |Gamma| or the VSWR, so the ranking that
 * decides the yield is the one of |Gamma| or the VSWR: scalarSpread with
 * their first-order derivatives (d|Gamma|, dVSWR, or the derivative of the
 * smooth band VSWR).
 *
 * A parameter whose value is zero or not finite has no relative draw and is
 * left out.
 */
export function spreadShares(
  points: readonly PointSensitivity[],
  weights: readonly number[],
  parameters: readonly ParameterRef[],
  tolerances: readonly ParameterTolerance[],
  elements: readonly Element[],
  distribution: 'uniform' | 'normal',
): SpreadAnalysis {
  return eulerSpread(
    points.map((pt) => pt.dGamma),
    weights,
    parameters,
    tolerances,
    elements,
    distribution,
  );
}

/**
 * The same Euler shares for a real quantity X with the derivatives dX/dp
 * given in the order of `parameters` (d|Gamma| or dVSWR at one frequency,
 * the derivative of the smooth band VSWR over a band): the variance of the
 * linearized change, sum_ij rho_ij sigma_i sigma_j b_i b_j with
 * b_i = dX/dp_i p_i, split into the parts' contributions. Non-finite
 * derivatives count as 0.
 */
export function scalarSpread(
  derivatives: readonly number[],
  parameters: readonly ParameterRef[],
  tolerances: readonly ParameterTolerance[],
  elements: readonly Element[],
  distribution: 'uniform' | 'normal',
): SpreadAnalysis {
  return eulerSpread(
    [derivatives.map((d) => complex(Number.isFinite(d) ? d : 0, 0))],
    [1],
    parameters,
    tolerances,
    elements,
    distribution,
  );
}

function eulerSpread(
  derivatives: readonly (readonly Complex[])[],
  weights: readonly number[],
  parameters: readonly ParameterRef[],
  tolerances: readonly ParameterTolerance[],
  elements: readonly Element[],
  distribution: 'uniform' | 'normal',
): SpreadAnalysis {
  const key = (r: ParameterRef): string => `${r.index}:${r.parameter}`;
  const position = new Map(parameters.map((r, i) => [key(r), i]));
  const valueOf = (t: ParameterTolerance): number =>
    parameterValue(elements[t.ref.index] as Element, t.ref.parameter);
  const used = tolerances.filter((t) => {
    if (!(t.tolerance > 0) || !position.has(key(t.ref))) return false;
    const v = valueOf(t);
    return Number.isFinite(v) && v !== 0;
  });
  const sigma = used.map((t) => relativeSigma(t.tolerance, distribution));
  const value = used.map(valueOf);
  const rho = (i: number, j: number): number => {
    if (i === j) return 1;
    const a = used[i] as ParameterTolerance;
    const b = used[j] as ParameterTolerance;
    if (a.group === undefined || a.group !== b.group) return 0;
    const r = Math.min(a.correlation ?? 0, b.correlation ?? 0);
    return r > 0 ? Math.min(r, 1) : 0;
  };
  const contrib = new Array<number>(used.length).fill(0);
  const alone = new Array<number>(used.length).fill(0);
  derivatives.forEach((row, k) => {
    const w = weights[k] ?? 0;
    if (!(w > 0) || !Number.isFinite(w)) return;
    // a_i sigma_i: the change of the quantity for one standard deviation of part i.
    const a = used.map((t, i) => {
      const d = row[position.get(key(t.ref)) as number] as Complex;
      const s = cscale(d, (value[i] as number) * (sigma[i] as number));
      return Number.isFinite(s.re) && Number.isFinite(s.im) ? s : ZERO;
    });
    for (let i = 0; i < used.length; i++) {
      let sumRe = 0;
      let sumIm = 0;
      for (let j = 0; j < used.length; j++) {
        const r = rho(i, j);
        if (r === 0) continue;
        sumRe += r * (a[j] as Complex).re;
        sumIm += r * (a[j] as Complex).im;
      }
      const ai = a[i] as Complex;
      contrib[i] = (contrib[i] as number) + w * (ai.re * sumRe + ai.im * sumIm);
      alone[i] = (alone[i] as number) + w * (ai.re * ai.re + ai.im * ai.im);
    }
  });
  const total = contrib.reduce((s, c) => s + c, 0);
  const shares = used.map((t, i) => ({
    ref: t.ref,
    share: total > 0 && Number.isFinite(total) ? (contrib[i] as number) / total : 0,
    rms: Math.sqrt(Math.max(0, alone[i] as number)),
  }));
  return { shares, rms: Math.sqrt(Math.max(0, total)) };
}

/** The input impedance with the parameter of one element replaced: for finite-difference checks. */
export function zinWith(
  elements: readonly Element[],
  ref: ParameterRef,
  value: number,
  load: Complex,
  f: number,
): Complex {
  let m = IDENTITY;
  elements.forEach((el, i) => {
    const e = i === ref.index ? withParameter(el, ref.parameter, value) : el;
    m = cascade(elementAbcd(e, f), m);
  });
  return cdiv(cadd(cmul(m.a, load), m.b), cadd(cmul(m.c, load), m.d));
}

/** The reflection coefficient of an impedance towards the target (Z0 by default). */
export function reflectionTowards(z: Complex, z0: number, target?: Complex): Complex {
  return gammaOf(z, z0, target);
}
