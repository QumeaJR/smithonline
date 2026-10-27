/**
 * Closed loop (phase D6 of docs/08-depth-plan.md): compare the measured S11
 * of a built board with the network as designed, fit what moved, and
 * suggest a retune that brings the built board back inside the target.
 *
 * The model is the network as built (board.ts `withBoard`: the realized
 * values, the package parasitics, pads from the land size, a via under each
 * shunt part, traces between parts) with a set of drift parameters on top:
 *
 * - value: a part's value scaled by (1 + x), x a fraction;
 * - pad: capacitance added to a part's pads (both lands together), F; as for
 *   every pad, a series part has half at each end, a shunt part half at its node;
 * - padScale: every pad scaled by (1 + x);
 * - via: every via inductance scaled by (1 + x);
 * - trace: every trace between parts made longer by x, m;
 * - er, h: the stackup's permittivity or height scaled by (1 + x) (pads,
 *   vias and traces follow through the board model, and so does every
 *   microstrip of the network: it is on the same laminate);
 * - plane: the VNA's reference plane, a one-way delay between the calibration
 *   plane and the board's input, s (a port extension): the measured Gamma is
 *   the board's times exp(-j 4 pi f tau). It belongs to the measurement, not
 *   to the board: the retune and the figures against the target leave it out.
 *
 * The fit is weighted least squares on the complex reflection coefficient at
 * the measured frequencies, Gamma referred to the design's Z0 (the VNA's
 * reference), with every parameter scaled by a prior width (what a typical
 * drift of its kind is) and a small Tikhonov term towards no drift, which
 * keeps the normal equations well conditioned. The Jacobian of a part value
 * is the analytic derivative of D3 (sensitivity.ts `sensitivityAt`); the board
 * parameters, which change several elements at once, take central differences.
 *
 * Identifiability. Before fitting, the prior-scaled Jacobian at no drift is
 * factored by QR with column pivoting (largest remaining column first): a
 * parameter whose column has no effect, or whose column is within 5 % of the
 * span of the ones picked before it (a correlation above 0.9987), cannot be
 * told apart from them by this data. It is fixed at no drift and reported
 * with the parameter it cannot be told from, rather than fitted to the noise.
 * After the fit, a parameter whose standard uncertainty is half its prior
 * width or more is not resolved either; it is fixed and the rest fitted again.
 * Correlations above 0.95 between fitted parameters are reported in pairs.
 * The fit is refused when the free parameters number more than 2N - 2 for N
 * measured frequencies (each gives two numbers, and two are kept for the
 * residual), or when fewer than three frequencies are usable.
 *
 * The uncertainty of a fitted drift is the square root of the diagonal of
 * s^2 (J^T J + mu^2 I)^-1 in the prior-scaled coordinates, with s^2 the
 * residual sum of squares over (2N - P): the usual linearized estimate, which
 * assumes independent errors of equal size on every number and a model that
 * can explain the data.
 */
import { cabs, cadd, cdiv, cmul, complex, csub, type Complex } from './complex.js';
import { withBoard, type BoardContext, type BoardSettings } from './board.js';
import { elementAbcd, traceAbcd, traceOf, type Element, type PartElement } from './elements.js';
import { inPartRange, partAt, type LibraryPart } from './parts.js';
import { realizableValues } from './realize/matching.js';
import type { ValueSource } from './realize/snap.js';
import { cascade, IDENTITY, throughAbcd, type Abcd } from './abcd.js';
import { interpolatedLoad } from './broadband.js';
import { measuredLoadInfo } from './measured.js';
import type { PackageTable } from './realize/packages.js';
import { sensitivityAt } from './sensitivity.js';
import type { SweepLoad } from './ladder.js';
import { isUsableStackup } from './stackup.js';

/** What the fit varies. */
export type DriftKind = 'value' | 'pad' | 'padScale' | 'via' | 'trace' | 'er' | 'h' | 'plane';

/** One parameter the fit can vary. */
export interface DriftParameter {
  /** Unique within a model: "value:1", "pad:0", "via". */
  readonly id: string;
  readonly kind: DriftKind;
  /** The element (load side first) for value and pad. */
  readonly index?: number;
  /** The drift is a fraction of the nominal (value, padScale, via, er, h) or in its own unit (pad F, trace m). */
  readonly relative: boolean;
  /** The nominal quantity the drift applies to, in SI units (value in H, F or ohm; via in H; trace and h in m). */
  readonly nominal: number;
  /** A typical drift of this kind, in the drift's own unit: the scale and the prior width. */
  readonly prior: number;
  /** Free by default: the parameters a first fit should try. */
  readonly freeByDefault: boolean;
}

/**
 * The network the board was built from: the elements before packages and the
 * board (the realized values when Realize is on), the package table and the
 * board, the design's Z0 and frequency (a trace width of 0 follows them), and
 * the load at port 2: a fixed impedance, or measured points (the measured load,
 * rebuilt with interpolatedLoad as every band tool does).
 */
export interface BuildModel {
  readonly z0: number;
  readonly frequency: number;
  readonly base: readonly Element[];
  readonly table: PackageTable;
  readonly board: BoardSettings;
  readonly load: Complex | readonly SweepLoad[];
}

/** One measured frequency: the reflection coefficient at the input, referred to the model's Z0. */
export interface MeasuredReflection {
  readonly frequency: number;
  readonly gamma: Complex;
}

/** Drift of each parameter, by id; a parameter left out has none. */
export type Drifts = Readonly<Record<string, number>>;

/** Prior widths: what a typical drift of each kind is. */
export const DRIFT_PRIOR = {
  /** Part values: 10 %. */
  value: 0.1,
  /** Extra pad capacitance: 0.2 pF. */
  pad: 0.2e-12,
  /** All pads together: 50 %. */
  padScale: 0.5,
  /** Via inductance: 50 %. */
  via: 0.5,
  /** Trace length: 1 mm. */
  trace: 1e-3,
  /** Permittivity: 10 %. */
  er: 0.1,
  /** Dielectric height: 10 %. */
  h: 0.1,
  /** Reference plane: 20 ps one way (about 3 mm of microstrip on FR-4, 6 mm of air line). */
  plane: 20e-12,
} as const;

/** The smallest factor a relative drift may scale anything to: a drift of -95 % at most. */
const MIN_FACTOR = 0.05;

const factor = (x: number): number => Math.max(MIN_FACTOR, 1 + x);

const isLC = (el: Element | undefined): el is Extract<Element, { kind: 'L' | 'C' }> =>
  el !== undefined && (el.kind === 'L' || el.kind === 'C');

const hasValue = (el: Element): el is Extract<Element, { kind: 'R' | 'L' | 'C' }> =>
  (el.kind === 'R' || el.kind === 'L' || el.kind === 'C') &&
  el.value > 0 &&
  Number.isFinite(el.value);

const ctxOf = (m: BuildModel): BoardContext => ({ z0: m.z0, frequency: m.frequency });

/** The network as built with no drift. */
export function builtElements(model: BuildModel): Element[] {
  return withBoard(model.base, model.table, model.board, ctxOf(model));
}

/**
 * The parameters the fit can vary for this model, in a stable order: each part
 * value, each inductor's and capacitor's pads, then the board (all pads
 * together, the vias, the traces, er and h) where it puts them in the network.
 * Free by default: part values, the pads of each part where the network as
 * built has pads, the vias and the traces. All pads together, er and h are
 * offered but not free by default: they move with the per-part pads and with
 * each other.
 */
export function driftParameters(model: BuildModel): DriftParameter[] {
  const built = builtElements(model);
  const out: DriftParameter[] = [];
  model.base.forEach((el, index) => {
    if (!hasValue(el)) return;
    out.push({
      id: `value:${index}`,
      kind: 'value',
      index,
      relative: true,
      nominal: el.value,
      prior: DRIFT_PRIOR.value,
      freeByDefault: true,
    });
  });
  let anyPad = false;
  model.base.forEach((el, index) => {
    if (!isLC(el)) return;
    const b = built[index];
    const pad = isLC(b) ? (b.parasitics?.pad ?? 0) : 0;
    if (pad > 0) anyPad = true;
    out.push({
      id: `pad:${index}`,
      kind: 'pad',
      index,
      relative: false,
      nominal: pad,
      prior: DRIFT_PRIOR.pad,
      freeByDefault: pad > 0,
    });
  });
  if (anyPad) {
    out.push({
      id: 'padScale',
      kind: 'padScale',
      relative: true,
      nominal: 1,
      prior: DRIFT_PRIOR.padScale,
      freeByDefault: false,
    });
  }
  const via = built.find((el) => 'board' in el && (el.board?.via ?? 0) > 0);
  if (via && 'board' in via && via.board?.via) {
    out.push({
      id: 'via',
      kind: 'via',
      relative: true,
      nominal: via.board.via,
      prior: DRIFT_PRIOR.via,
      freeByDefault: true,
    });
  }
  const trace = built.find((el) => 'board' in el && el.board?.trace !== undefined);
  if (trace && 'board' in trace && trace.board?.trace) {
    out.push({
      id: 'trace',
      kind: 'trace',
      relative: false,
      nominal: trace.board.trace.length,
      prior: DRIFT_PRIOR.trace,
      freeByDefault: true,
    });
  }
  // er and h are offered only where something depends on them: the pads, vias and traces the
  // board puts in, or a microstrip of the network (on the same laminate).
  const boardOn = model.board.enabled && isUsableStackup(model.board.stackup);
  const fromBoard =
    boardOn &&
    built.some(
      (el) =>
        (isLC(el) && (el.parasitics?.pad ?? 0) > 0) ||
        ('board' in el && el.board !== undefined && (el.board.via ?? 0) > 0) ||
        ('board' in el && el.board?.trace !== undefined),
    );
  const strip = model.base.find(
    (el): el is Extract<Element, { kind: 'microstrip' }> =>
      el.kind === 'microstrip' && isUsableStackup(el.stackup),
  );
  const s = fromBoard ? model.board.stackup : strip?.stackup;
  if (s) {
    out.push(
      {
        id: 'er',
        kind: 'er',
        relative: true,
        nominal: s.er,
        prior: DRIFT_PRIOR.er,
        freeByDefault: false,
      },
      {
        id: 'h',
        kind: 'h',
        relative: true,
        nominal: s.h,
        prior: DRIFT_PRIOR.h,
        freeByDefault: false,
      },
    );
  }
  out.push({
    id: 'plane',
    kind: 'plane',
    relative: false,
    nominal: 0,
    prior: DRIFT_PRIOR.plane,
    freeByDefault: false,
  });
  return out;
}

/** The network as built with the drifts applied. */
export function driftedElements(model: BuildModel, drifts: Drifts): Element[] {
  const d = (id: string): number => {
    const v = drifts[id];
    return v !== undefined && Number.isFinite(v) ? v : 0;
  };
  const er = d('er');
  const h = d('h');
  const base = model.base.map((el, i) => {
    // A microstrip is on the board's laminate: an er or h drift is a drift of its stackup too.
    if (el.kind === 'microstrip' && (er !== 0 || h !== 0)) {
      return {
        ...el,
        stackup: {
          ...el.stackup,
          er: Math.max(1.0001, el.stackup.er * factor(er)),
          h: el.stackup.h * factor(h),
        },
      };
    }
    const x = d(`value:${i}`);
    return x !== 0 && hasValue(el) ? ({ ...el, value: el.value * factor(x) } as Element) : el;
  });
  const board =
    er !== 0 || h !== 0
      ? {
          ...model.board,
          stackup: {
            ...model.board.stackup,
            er: Math.max(1.0001, model.board.stackup.er * factor(er)),
            h: model.board.stackup.h * factor(h),
          },
        }
      : model.board;
  const built = withBoard(base, model.table, board, ctxOf(model));
  const padScale = factor(d('padScale'));
  const viaScale = factor(d('via'));
  const traceAdd = d('trace');
  return built.map((el, i) => {
    let out: Element = el;
    if (isLC(out)) {
      const pad0 = out.parasitics?.pad ?? 0;
      const pad = Math.max(0, pad0 * padScale + d(`pad:${i}`));
      if (pad !== pad0) out = { ...out, parasitics: { ...(out.parasitics ?? {}), pad } };
    }
    if ('board' in out && out.board && (viaScale !== 1 || traceAdd !== 0)) {
      const b = out.board;
      const via = b.via !== undefined ? b.via * viaScale : undefined;
      const trace =
        b.trace !== undefined
          ? { ...b.trace, length: Math.max(0, b.trace.length + traceAdd) }
          : undefined;
      out = {
        ...out,
        board: { ...(via !== undefined ? { via } : {}), ...(trace ? { trace } : {}) },
      } as Element;
    }
    return out;
  });
}

/** The load at port 2 as a function of frequency, and the band it is known over (null: any). */
export function modelLoad(model: BuildModel): {
  readonly at: (f: number) => Complex;
  readonly band: readonly [number, number] | null;
} {
  const load = model.load;
  if (!Array.isArray(load)) {
    const z = load as Complex;
    return { at: () => z, band: null };
  }
  const points = load as readonly SweepLoad[];
  if (points.length === 1) {
    const z = (points[0] as SweepLoad).z;
    return { at: () => z, band: null };
  }
  const fn = interpolatedLoad(points, { z0: model.z0 });
  const info = measuredLoadInfo(fn);
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of points) {
    lo = Math.min(lo, p.frequency);
    hi = Math.max(hi, p.frequency);
  }
  return { at: typeof fn === 'function' ? fn : () => fn, band: info ? info.band : [lo, hi] };
}

/** Gamma at the input of a ladder (load side first) towards a real Z0. */
export function inputGamma(
  elements: readonly Element[],
  load: Complex,
  z0: number,
  f: number,
): Complex {
  let m = IDENTITY;
  for (const el of elements) m = cascade(elementAbcd(el, f), m);
  const zin = cdiv(cadd(cmul(m.a, load), m.b), cadd(cmul(m.c, load), m.d));
  return gammaOfZ(zin, z0);
}

/** The reflection coefficient of an impedance towards a real Z0; 1 for an open. */
export function gammaOfZ(z: Complex, z0: number): Complex {
  if (!Number.isFinite(z.re) || !Number.isFinite(z.im)) return complex(1, 0);
  return cdiv(csub(z, complex(z0, 0)), cadd(z, complex(z0, 0)));
}

/** The reflection coefficients of the drifted network at the given frequencies. */
export function modelGammas(
  model: BuildModel,
  drifts: Drifts,
  frequencies: readonly number[],
): Complex[] {
  const els = driftedElements(model, drifts);
  const { at } = modelLoad(model);
  const tau = drifts.plane !== undefined && Number.isFinite(drifts.plane) ? drifts.plane : 0;
  return frequencies.map((f) => {
    const g = inputGamma(els, at(f), model.z0, f);
    if (tau === 0) return g;
    // The reference plane: a matched line of delay tau ahead of the board, there and back.
    const phi = -4 * Math.PI * f * tau;
    return cmul(g, complex(Math.cos(phi), Math.sin(phi)));
  });
}

/** Measured impedances as reflection coefficients towards Z0. */
export function measuredReflections(
  points: readonly SweepLoad[],
  z0: number,
): MeasuredReflection[] {
  return points.map((p) => ({ frequency: p.frequency, gamma: gammaOfZ(p.z, z0) }));
}

/** The VSWR of a reflection coefficient; Infinity at or beyond total reflection. */
export function vswrOfGamma(g: Complex): number {
  const m = cabs(g);
  return Number.isFinite(m) && m < 1 ? (1 + m) / (1 - m) : Infinity;
}

/* ------------------------------------------------------------- compare */

export interface ComparePoint {
  readonly frequency: number;
  readonly measured: Complex;
  readonly designed: Complex;
  /** |Gamma measured - Gamma designed|. */
  readonly delta: number;
}

export interface Worst {
  readonly vswr: number;
  readonly frequency: number;
}

export interface Comparison {
  readonly points: readonly ComparePoint[];
  /** Measured frequencies left out: outside the measured load's band, or not a number. */
  readonly leftOut: number;
  readonly rmsDelta: number;
  readonly worstDelta: number;
  readonly worstDeltaAt: number;
  /** Worst VSWR (towards Z0) over the band, or over every compared point when no band is given. */
  readonly measuredWorst: Worst | null;
  readonly designedWorst: Worst | null;
}

/** The measured points the model can be compared at: finite, |Gamma| under 2, inside the load's band. */
export function usableMeasurement(
  model: BuildModel,
  measured: readonly MeasuredReflection[],
): { readonly points: MeasuredReflection[]; readonly leftOut: number } {
  const { band } = modelLoad(model);
  const points = measured.filter(
    (p) =>
      p.frequency > 0 &&
      Number.isFinite(p.frequency) &&
      Number.isFinite(p.gamma.re) &&
      Number.isFinite(p.gamma.im) &&
      cabs(p.gamma) < 2 &&
      (band === null ||
        (p.frequency >= band[0] * (1 - 1e-9) && p.frequency <= band[1] * (1 + 1e-9))),
  );
  return { points, leftOut: measured.length - points.length };
}

function worstOf(
  pts: readonly { readonly frequency: number; readonly gamma: Complex }[],
  band: readonly [number, number] | null,
): Worst | null {
  let worst: Worst | null = null;
  for (const p of pts) {
    if (band && (p.frequency < band[0] || p.frequency > band[1])) continue;
    const v = vswrOfGamma(p.gamma);
    if (!worst || v > worst.vswr || Number.isNaN(v)) worst = { vswr: v, frequency: p.frequency };
  }
  return worst;
}

/** The measured board against the network as designed (or with drifts), point by point. */
export function compareMeasurement(
  model: BuildModel,
  measured: readonly MeasuredReflection[],
  options: { readonly drifts?: Drifts; readonly band?: readonly [number, number] } = {},
): Comparison {
  const { points, leftOut } = usableMeasurement(model, measured);
  const designed = modelGammas(
    model,
    options.drifts ?? {},
    points.map((p) => p.frequency),
  );
  const cmp: ComparePoint[] = points.map((p, i) => {
    const g = designed[i] as Complex;
    return {
      frequency: p.frequency,
      measured: p.gamma,
      designed: g,
      delta: cabs(csub(p.gamma, g)),
    };
  });
  let ss = 0;
  let worst = 0;
  let worstAt = NaN;
  for (const c of cmp) {
    ss += c.delta * c.delta;
    if (c.delta > worst || Number.isNaN(worstAt)) {
      worst = c.delta;
      worstAt = c.frequency;
    }
  }
  const band = options.band ?? null;
  return {
    points: cmp,
    leftOut,
    rmsDelta: cmp.length > 0 ? Math.sqrt(ss / cmp.length) : NaN,
    worstDelta: worst,
    worstDeltaAt: worstAt,
    measuredWorst: worstOf(
      cmp.map((c) => ({ frequency: c.frequency, gamma: c.measured })),
      band,
    ),
    designedWorst: worstOf(
      cmp.map((c) => ({ frequency: c.frequency, gamma: c.designed })),
      band,
    ),
  };
}

/* ------------------------------------------------------ linear algebra */

/** Solve A x = b for a small symmetric positive (semi)definite A; null when singular. */
function solve(a: readonly number[][], b: readonly number[]): number[] | null {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i] as number]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) {
      if (Math.abs((m[r] as number[])[c] as number) > Math.abs((m[p] as number[])[c] as number))
        p = r;
    }
    const pivot = (m[p] as number[])[c] as number;
    if (!(Math.abs(pivot) > 1e-300) || !Number.isFinite(pivot)) return null;
    [m[c], m[p]] = [m[p] as number[], m[c] as number[]];
    const rc = m[c] as number[];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const rr = m[r] as number[];
      const k = (rr[c] as number) / pivot;
      if (k === 0) continue;
      for (let j = c; j <= n; j++) rr[j] = (rr[j] as number) - k * (rc[j] as number);
    }
  }
  return m.map((row, i) => (row[n] as number) / (row[i] as number));
}

/** The inverse of a small matrix by solving for each column; null when singular. */
function inverse(a: readonly number[][]): number[][] | null {
  const n = a.length;
  const cols: number[][] = [];
  for (let j = 0; j < n; j++) {
    const e = Array.from({ length: n }, (_, i) => (i === j ? 1 : 0));
    const x = solve(a, e);
    if (!x) return null;
    cols.push(x);
  }
  return Array.from({ length: n }, (_, i) => cols.map((c) => c[i] as number));
}

/** The singular values of a tall matrix (columns given), from the eigenvalues of its Gram matrix by Jacobi rotations. */
export function singularValues(columns: readonly (readonly number[])[]): number[] {
  const n = columns.length;
  const g = columns.map((a) => columns.map((b) => dot(a, b)));
  for (let sweep = 0; sweep < 60; sweep++) {
    let off = 0;
    for (let p = 0; p < n; p++)
      for (let q = p + 1; q < n; q++) off += ((g[p] as number[])[q] as number) ** 2;
    if (off < 1e-30) break;
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        const gp = g[p] as number[];
        const gq = g[q] as number[];
        const apq = gp[q] as number;
        if (Math.abs(apq) < 1e-300) continue;
        const theta = ((gq[q] as number) - (gp[p] as number)) / (2 * apq);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < n; k++) {
          const gk = g[k] as number[];
          const kp = gk[p] as number;
          const kq = gk[q] as number;
          gk[p] = c * kp - s * kq;
          gk[q] = s * kp + c * kq;
        }
        for (let k = 0; k < n; k++) {
          const pk = gp[k] as number;
          const qk = gq[k] as number;
          gp[k] = c * pk - s * qk;
          gq[k] = s * pk + c * qk;
        }
      }
    }
  }
  return g.map((row, i) => Math.sqrt(Math.max(0, row[i] as number))).sort((x, y) => y - x);
}

function dot(a: readonly number[], b: readonly number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] as number) * (b[i] as number);
  return s;
}

/* ------------------------------------------------------------------ fit */

/** Columns within this fraction of the span of the ones before them cannot be told apart (correlation above 0.9987). */
export const UNRESOLVED_RATIO = 0.05;
/** A fitted parameter whose standard uncertainty is this fraction of its prior width or more is not resolved. */
export const UNRESOLVED_SIGMA = 0.5;
/** Correlations above this between two fitted parameters are reported. */
export const CORRELATED = 0.95;
/**
 * The Tikhonov weight, relative to each parameter's own column of the scaled Jacobian at no
 * drift: the pull towards no drift is 1e-12 of the parameter's own curvature, so a weak but
 * resolvable parameter is shrunk by about 1e-12 of its drift, like a strong one.
 */
const MU = 1e-6;

export type ParameterStatus = 'fitted' | 'unresolved' | 'no-effect' | 'not-free';

export interface FittedParameter extends DriftParameter {
  readonly status: ParameterStatus;
  /** The estimated drift; 0 for a parameter not fitted. */
  readonly drift: number;
  /** Its standard uncertainty (one sigma), in the drift's unit; null when not fitted. */
  readonly sigma: number | null;
  /** Unresolved: the parameter it cannot be told apart from (id); fitted: the one it is most correlated with, above 0.95. */
  readonly partner?: string;
  /** The correlation with the partner (fitted), or the cosine between their effects (unresolved). */
  readonly correlation?: number;
  /** Why it is unresolved: its effect is like another's, or its uncertainty is too large. */
  readonly why?: 'like-another' | 'uncertain' | 'too-many';
}

export interface BuildFit {
  readonly parameters: readonly FittedParameter[];
  /** The drifts of the fitted parameters, by id. */
  readonly drifts: Drifts;
  /** Measured frequencies the fit used, and those it left out. */
  readonly used: number;
  readonly leftOut: number;
  /** RMS of |Gamma measured - Gamma model| before (no drift) and after the fit. */
  readonly rmsBefore: number;
  readonly rmsAfter: number;
  readonly worstBefore: number;
  readonly worstAfter: number;
  /** Degrees of freedom left: 2N - P. */
  readonly dof: number;
  /** Largest over smallest singular value of the scaled Jacobian of the fitted set at the solution. */
  readonly condition: number;
  readonly iterations: number;
  /** Pairs of fitted parameters correlated above 0.95. */
  readonly correlated: readonly { readonly a: string; readonly b: string; readonly rho: number }[];
  /** Whether the model explains the data and the drifts are those of a board built as designed. */
  readonly check: FitCheck;
}

export type BuildFitOutcome =
  { readonly ok: true; readonly fit: BuildFit } | { readonly ok: false; readonly reason: string };

export interface BuildFitProgress {
  readonly pass: number;
  readonly iteration: number;
  readonly rms: number;
}

export interface BuildFitOptions {
  /** Ids of the parameters to fit; default the ones free by default. */
  readonly free?: readonly string[];
  /** Iterations of Levenberg-Marquardt at most per pass; default 60. */
  readonly maxIterations?: number;
  readonly onProgress?: (p: BuildFitProgress) => void;
}

/** The fewest usable measured frequencies a fit needs. */
export const MIN_FIT_POINTS = 3;

/** Most parameters a fit takes for N usable frequencies: 2N numbers, two kept for the residual. */
export function maxUnknowns(points: number): number {
  return Math.max(0, 2 * points - 2);
}

interface Problem {
  readonly model: BuildModel;
  readonly params: readonly DriftParameter[];
  readonly points: readonly MeasuredReflection[];
  readonly freqs: readonly number[];
}

function driftsOf(p: Problem, u: readonly number[]): Record<string, number> {
  const out: Record<string, number> = {};
  p.params.forEach((q, j) => {
    out[q.id] = (u[j] as number) * q.prior;
  });
  return out;
}

function residuals(p: Problem, u: readonly number[]): number[] {
  const g = modelGammas(p.model, driftsOf(p, u), p.freqs);
  const r: number[] = [];
  p.points.forEach((pt, k) => {
    const gk = g[k] as Complex;
    r.push(gk.re - pt.gamma.re, gk.im - pt.gamma.im);
  });
  return r;
}

/** The Jacobian of the residuals by the scaled parameters, as columns. */
function jacobian(p: Problem, u: readonly number[]): number[][] {
  const drifts = driftsOf(p, u);
  const els = driftedElements(p.model, drifts);
  const { at } = modelLoad(p.model);
  const tau = drifts.plane ?? 0;
  const cols: number[][] = [];
  p.params.forEach((q, j) => {
    if (q.kind === 'value' && q.index !== undefined) {
      // D3's analytic derivative: dGamma/dvalue at the drifted value, times dvalue/du.
      const col: number[] = [];
      const x = (u[j] as number) * q.prior;
      const dvdu = 1 + x > MIN_FACTOR ? q.nominal * q.prior : 0;
      for (const f of p.freqs) {
        const s = sensitivityAt(els, at(f), p.model.z0, f, {
          parameters: [{ index: q.index, parameter: 'value' }],
        });
        let dg = s.dGamma[0] as Complex;
        if (tau !== 0) {
          const phi = -4 * Math.PI * f * tau;
          dg = cmul(dg, complex(Math.cos(phi), Math.sin(phi)));
        }
        col.push(dg.re * dvdu, dg.im * dvdu);
      }
      cols.push(col);
      return;
    }
    const h = 1e-4;
    const up = [...u];
    const dn = [...u];
    up[j] = (u[j] as number) + h;
    dn[j] = (u[j] as number) - h;
    const rp = residuals(p, up);
    const rm = residuals(p, dn);
    cols.push(rp.map((v, i) => (v - (rm[i] as number)) / (2 * h)));
  });
  return cols;
}

interface Dropped {
  readonly j: number;
  readonly why: 'no-effect' | 'unresolved' | 'cap';
  readonly partner: number | null;
  readonly cosine: number;
}

/**
 * QR with column pivoting on the scaled Jacobian: the columns in the order
 * they are picked (largest remaining first), and for each column left over,
 * why (no effect, or within UNRESOLVED_RATIO of the span of the picked ones,
 * or past the cap) and the picked column its effect is most like.
 */
function pivotedSelection(
  cols: readonly (readonly number[])[],
  cap: number,
): { picked: number[]; dropped: Dropped[] } {
  const norms = cols.map((c) => Math.sqrt(dot(c, c)));
  const maxNorm = Math.max(0, ...norms);
  const work = cols.map((c) => [...c]);
  const left = new Set(cols.map((_, j) => j));
  const picked: number[] = [];
  const dropped: Dropped[] = [];
  for (const j of [...left]) {
    const n = norms[j] as number;
    if (!(n > 1e-9 * maxNorm) || !(n > 1e-12)) {
      dropped.push({ j, why: 'no-effect', partner: null, cosine: 0 });
      left.delete(j);
    }
  }
  while (left.size > 0 && picked.length < cap) {
    let best = -1;
    let bestRatio = -1;
    let bestNorm = 0;
    for (const j of left) {
      const n = Math.sqrt(dot(work[j] as number[], work[j] as number[]));
      if (n > bestNorm || best < 0) {
        bestNorm = n;
        best = j;
        bestRatio = n / (norms[j] as number);
      }
    }
    if (bestRatio < UNRESOLVED_RATIO) break;
    left.delete(best);
    picked.push(best);
    const q = (work[best] as number[]).map((v) => v / bestNorm);
    for (const j of left) {
      const w = work[j] as number[];
      const k = dot(w, q);
      for (let i = 0; i < w.length; i++) w[i] = (w[i] as number) - k * (q[i] as number);
    }
  }
  for (const j of left) {
    let partner: number | null = null;
    let cosine = 0;
    for (const i of picked) {
      const c =
        dot(cols[j] as number[], cols[i] as number[]) /
        ((norms[j] as number) * (norms[i] as number));
      if (Math.abs(c) > Math.abs(cosine)) {
        cosine = c;
        partner = i;
      }
    }
    const ratio = Math.sqrt(dot(work[j] as number[], work[j] as number[])) / (norms[j] as number);
    dropped.push({ j, why: ratio < UNRESOLVED_RATIO ? 'unresolved' : 'cap', partner, cosine });
  }
  return { picked, dropped };
}

interface Solved {
  readonly u: number[];
  readonly r: number[];
  readonly cols: number[][];
  readonly iterations: number;
}

/**
 * Levenberg-Marquardt on the scaled parameters with a small Tikhonov term towards no drift,
 * `reg[i]` (the squared weight) for parameter i.
 */
function levenbergMarquardt(
  p: Problem,
  reg: readonly number[],
  maxIterations: number,
  onIteration: (iteration: number, rms: number) => void,
): Solved {
  const n = p.params.length;
  let u = new Array<number>(n).fill(0);
  let r = residuals(p, u);
  const costOf = (rr: readonly number[], uu: readonly number[]): number => {
    let c = dot(rr, rr);
    for (let i = 0; i < uu.length; i++) c += (reg[i] as number) * (uu[i] as number) ** 2;
    return c;
  };
  let cost = costOf(r, u);
  let lambda = 1e-3;
  let cols = jacobian(p, u);
  let iterations = 0;
  for (let it = 0; it < maxIterations; it++) {
    iterations = it + 1;
    const a = cols.map((ci) => cols.map((cj) => dot(ci, cj)));
    const g = cols.map((ci, i) => dot(ci, r) + (reg[i] as number) * (u[i] as number));
    let improved = false;
    for (let tries = 0; tries < 16; tries++) {
      const m = a.map((row, i) =>
        row.map((v, j) => (i === j ? v * (1 + lambda) + (reg[i] as number) : v)),
      );
      const delta = solve(
        m,
        g.map((v) => -v),
      );
      if (!delta) {
        lambda *= 10;
        continue;
      }
      const un = u.map((v, i) => v + (delta[i] as number));
      const rn = residuals(p, un);
      const cn = costOf(rn, un);
      if (Number.isFinite(cn) && cn < cost) {
        const gain = (cost - cn) / Math.max(cost, 1e-300);
        u = un;
        r = rn;
        cost = cn;
        lambda = Math.max(1e-12, lambda / 3);
        improved = gain > 1e-13;
        break;
      }
      lambda *= 4;
    }
    onIteration(iterations, Math.sqrt(dot(r, r) / Math.max(1, r.length / 2)));
    if (!improved) break;
    cols = jacobian(p, u);
  }
  return { u, r, cols, iterations };
}

const rmsOf = (r: readonly number[]): number => Math.sqrt(dot(r, r) / Math.max(1, r.length / 2));

function worstPair(r: readonly number[]): number {
  let w = 0;
  for (let i = 0; i + 1 < r.length; i += 2)
    w = Math.max(w, Math.hypot(r[i] as number, r[i + 1] as number));
  return w;
}

/**
 * Fit what moved: the drifts of the free parameters that bring the network as
 * built closest to the measured reflection coefficients (see the file comment
 * for the weighting, the identifiability rules and the refusals).
 */
export function fitBuild(
  model: BuildModel,
  measured: readonly MeasuredReflection[],
  options: BuildFitOptions = {},
): BuildFitOutcome {
  const all = driftParameters(model);
  const freeIds = new Set(options.free ?? all.filter((q) => q.freeByDefault).map((q) => q.id));
  const free = all.filter((q) => freeIds.has(q.id));
  const { points, leftOut } = usableMeasurement(model, measured);
  if (points.length < MIN_FIT_POINTS) {
    return {
      ok: false,
      reason:
        points.length === 0
          ? 'no measured frequency can be compared with the network (outside the load data, or not a number)'
          : `only ${points.length} measured ${points.length === 1 ? 'frequency' : 'frequencies'} can be compared; a fit needs ${MIN_FIT_POINTS} at least`,
    };
  }
  if (free.length === 0) return { ok: false, reason: 'no parameter is chosen to fit' };
  const cap = maxUnknowns(points.length);
  if (free.length > cap) {
    return {
      ok: false,
      reason: `${free.length} unknowns from ${points.length} frequencies is more than the data supports (at most ${cap}: two numbers per frequency, two kept for the residual); choose fewer parameters or measure more points`,
    };
  }
  const freqs = points.map((p) => p.frequency);
  const before = residuals({ model, params: [], points, freqs }, []);
  if (!before.every(Number.isFinite)) {
    return {
      ok: false,
      reason:
        'the network as built has no value at some measured frequency (a library part outside its data)',
    };
  }

  // Identifiability at no drift: which free parameters this data can tell apart.
  const full: Problem = { model, params: free, points, freqs };
  const j0 = jacobian(full, new Array<number>(free.length).fill(0));
  const { picked, dropped } = pivotedSelection(j0, cap);
  const status = new Map<string, Omit<FittedParameter, keyof DriftParameter>>();
  for (const d of dropped) {
    const q = free[d.j] as DriftParameter;
    const partner = d.partner !== null ? (free[d.partner] as DriftParameter).id : undefined;
    status.set(q.id, {
      status: d.why === 'no-effect' ? 'no-effect' : 'unresolved',
      drift: 0,
      sigma: null,
      ...(partner !== undefined ? { partner, correlation: d.cosine } : {}),
      ...(d.why === 'no-effect' ? {} : { why: d.why === 'cap' ? 'too-many' : 'like-another' }),
    });
  }

  let active = picked
    .slice()
    .sort((a, b) => a - b)
    .map((j) => free[j] as DriftParameter);
  let solved: Solved | null = null;
  let cov: number[][] | null = null;
  let iterations = 0;
  const maxIt = options.maxIterations ?? 60;
  for (let pass = 1; active.length > 0 && pass <= free.length + 1; pass++) {
    const problem: Problem = { model, params: active, points, freqs };
    const zero = jacobian(problem, new Array<number>(active.length).fill(0));
    const norms2 = zero.map((c) => dot(c, c));
    const floor2 = 1e-18 * Math.max(0, ...norms2);
    const reg = norms2.map((n2) => MU * MU * Math.max(n2, floor2));
    solved = levenbergMarquardt(problem, reg, maxIt, (iteration, rms) =>
      options.onProgress?.({ pass, iteration, rms }),
    );
    iterations += solved.iterations;
    const jc = solved.cols;
    const a = jc.map((ci) => jc.map((cj) => dot(ci, cj)));
    for (let i = 0; i < a.length; i++)
      (a[i] as number[])[i] = ((a[i] as number[])[i] as number) + (reg[i] as number);
    const dof = 2 * points.length - active.length;
    const s2 = dot(solved.r, solved.r) / Math.max(1, dof);
    const inv = inverse(a);
    cov = inv ? inv.map((row) => row.map((v) => v * s2)) : null;
    // The parameter least resolved by the data, if any, is fixed and the rest fitted again.
    let worst = -1;
    let worstSigma = UNRESOLVED_SIGMA;
    active.forEach((_, i) => {
      const s = cov ? Math.sqrt(Math.max(0, (cov[i] as number[])[i] as number)) : Infinity;
      if (s >= worstSigma) {
        worstSigma = s;
        worst = i;
      }
    });
    if (worst < 0) break;
    const q = active[worst] as DriftParameter;
    let partner: string | undefined;
    let rho = 0;
    if (cov) {
      active.forEach((other, i) => {
        if (i === worst) return;
        const c =
          (((cov as number[][])[worst] as number[])[i] as number) /
          Math.sqrt(
            (((cov as number[][])[worst] as number[])[worst] as number) *
              (((cov as number[][])[i] as number[])[i] as number),
          );
        if (Math.abs(c) > Math.abs(rho)) {
          rho = c;
          partner = other.id;
        }
      });
    }
    status.set(q.id, {
      status: 'unresolved',
      drift: 0,
      sigma: null,
      why: 'uncertain',
      ...(partner !== undefined && Math.abs(rho) > CORRELATED ? { partner, correlation: rho } : {}),
    });
    active = active.filter((_, i) => i !== worst);
    solved = null;
    cov = null;
  }

  const drifts: Record<string, number> = {};
  const correlated: { a: string; b: string; rho: number }[] = [];
  let condition = 1;
  let after = before;
  if (solved && active.length > 0) {
    after = solved.r;
    const fittedU = solved.u;
    const sv = singularValues(solved.cols);
    condition = (sv[0] ?? 0) / Math.max(sv[sv.length - 1] ?? 0, 1e-300);
    active.forEach((q, i) => {
      const drift = (fittedU[i] as number) * q.prior;
      const sigma = cov
        ? Math.sqrt(Math.max(0, (cov[i] as number[])[i] as number)) * q.prior
        : null;
      drifts[q.id] = drift;
      let partner: string | undefined;
      let rho = 0;
      if (cov) {
        active.forEach((other, k) => {
          if (k === i) return;
          const c =
            (((cov as number[][])[i] as number[])[k] as number) /
            Math.sqrt(
              (((cov as number[][])[i] as number[])[i] as number) *
                (((cov as number[][])[k] as number[])[k] as number),
            );
          if (Math.abs(c) > Math.abs(rho)) {
            rho = c;
            partner = other.id;
          }
          if (k > i && Math.abs(c) > CORRELATED) correlated.push({ a: q.id, b: other.id, rho: c });
        });
      }
      status.set(q.id, {
        status: 'fitted',
        drift,
        sigma,
        ...(partner !== undefined && Math.abs(rho) > CORRELATED
          ? { partner, correlation: rho }
          : {}),
      });
    });
  }
  const parameters: FittedParameter[] = all.map((q) => ({
    ...q,
    ...(status.get(q.id) ?? { status: 'not-free' as const, drift: 0, sigma: null }),
  }));
  return {
    ok: true,
    fit: {
      parameters,
      drifts,
      used: points.length,
      leftOut,
      rmsBefore: rmsOf(before),
      rmsAfter: rmsOf(after),
      worstBefore: worstPair(before),
      worstAfter: worstPair(after),
      dof: 2 * points.length - active.length,
      condition,
      iterations,
      correlated,
      check: checkFit(model, points, parameters, rmsOf(after)),
    },
  };
}

/* ------------------------------------------------------- plausibility */

/** The model explains the data when the residual RMS is at most this many noise floors. */
export const EXPLAINED_RATIO = 3;
/** Above this many noise floors the model does not explain the board: the fit is not acted on. */
export const UNEXPLAINED_RATIO = 10;
/**
 * The smallest noise floor the check takes, |ΔΓ| RMS (-54 dB): the residual a careful VNA
 * calibration leaves. A smoothed or averaged trace can scatter less than that; its residual is
 * not held against a floor it cannot reach.
 */
export const MIN_NOISE_FLOOR = 0.002;
/** A fitted drift larger than this many typical drifts is not one of a board built as designed. */
export const IMPLAUSIBLE_PRIORS = 3;

/** What a senior engineer checks before trusting a fit (see checkFit). */
export interface FitCheck {
  /** The measurement's noise floor, |ΔΓ| RMS per point, from its point-to-point scatter; NaN when it cannot be told. */
  readonly noiseFloor: number;
  /** The residual RMS over the floor taken (the noise floor, at least MIN_NOISE_FLOOR). */
  readonly residualRatio: number;
  /**
   * 'noise': the residual is noise (up to EXPLAINED_RATIO floors); 'above': the model explains
   * most of the board but leaves a pattern (up to UNEXPLAINED_RATIO); 'unexplained': it does not
   * explain this board (the calibration plane, the file, the design or an assembly fault).
   */
  readonly residual: 'noise' | 'above' | 'unexplained';
  /** Fitted drifts that are not plausible: several typical drifts, or past what is physical. */
  readonly implausible: readonly {
    readonly id: string;
    readonly why: 'large' | 'unphysical';
  }[];
  /** The design frequency lies outside the measured frequencies. */
  readonly frequencyOutside: boolean;
  /** Not unexplained, every drift plausible and the design frequency measured: the fit can be acted on. */
  readonly trusted: boolean;
}

/**
 * The noise floor of a measurement, |ΔΓ| RMS per point, from the point-to-point scatter: each
 * point against the straight line through its two neighbours (the response is smooth on the
 * scale of the spacing, noise is not), normalized by the noise that difference carries, the
 * median taken so a resonance or a glitch does not set it (for complex normal noise the median
 * of |e|^2 is ln 2 times its mean). A coarse grid over a sharp response reads high, which only
 * makes the check more lenient. NaN with fewer than five usable points.
 */
export function noiseFloor(points: readonly MeasuredReflection[]): number {
  const p = points
    .filter(
      (q) =>
        q.frequency > 0 &&
        Number.isFinite(q.frequency) &&
        Number.isFinite(q.gamma.re) &&
        Number.isFinite(q.gamma.im),
    )
    .sort((a, b) => a.frequency - b.frequency)
    .filter((q, i, all) => i === 0 || q.frequency !== (all[i - 1] as MeasuredReflection).frequency);
  const e: number[] = [];
  for (let k = 1; k + 1 < p.length; k++) {
    const a = p[k - 1] as MeasuredReflection;
    const b = p[k] as MeasuredReflection;
    const c = p[k + 1] as MeasuredReflection;
    const w = (c.frequency - b.frequency) / (c.frequency - a.frequency);
    const re = b.gamma.re - (w * a.gamma.re + (1 - w) * c.gamma.re);
    const im = b.gamma.im - (w * a.gamma.im + (1 - w) * c.gamma.im);
    e.push((re * re + im * im) / (1 + w * w + (1 - w) * (1 - w)));
  }
  if (e.length < 3) return NaN;
  e.sort((x, y) => x - y);
  const mid = e.length >> 1;
  const median =
    e.length % 2 ? (e[mid] as number) : ((e[mid - 1] as number) + (e[mid] as number)) / 2;
  return Math.sqrt(median / Math.LN2);
}

/**
 * The checks of a fit: the residual against the noise floor (a model that explains the board
 * leaves noise; one that does not leaves a pattern several times the noise: the calibration
 * plane, the file, the design or an assembly fault), each fitted drift against its typical size
 * and against what is physical, and the design frequency against the measured span.
 */
export function checkFit(
  model: BuildModel,
  points: readonly MeasuredReflection[],
  parameters: readonly FittedParameter[],
  rmsAfter: number,
): FitCheck {
  const floor = noiseFloor(points);
  const residualRatio = rmsAfter / Math.max(Number.isFinite(floor) ? floor : 0, MIN_NOISE_FLOOR);
  const residual =
    residualRatio <= EXPLAINED_RATIO
      ? 'noise'
      : residualRatio <= UNEXPLAINED_RATIO
        ? 'above'
        : 'unexplained';
  const implausible: { id: string; why: 'large' | 'unphysical' }[] = [];
  for (const q of parameters) {
    if (q.status !== 'fitted') continue;
    const unphysical =
      q.kind === 'plane' ? false : q.relative ? 1 + q.drift <= MIN_FACTOR : q.nominal + q.drift < 0;
    if (unphysical) implausible.push({ id: q.id, why: 'unphysical' });
    else if (Math.abs(q.drift) > IMPLAUSIBLE_PRIORS * q.prior)
      implausible.push({ id: q.id, why: 'large' });
  }
  const fs = points.map((p) => p.frequency);
  const lo = Math.min(...fs);
  const hi = Math.max(...fs);
  const frequencyOutside =
    fs.length > 0 && (model.frequency < lo * (1 - 1e-9) || model.frequency > hi * (1 + 1e-9));
  return {
    noiseFloor: floor,
    residualRatio,
    residual,
    implausible,
    frequencyOutside,
    trusted: residual !== 'unexplained' && implausible.length === 0 && !frequencyOutside,
  };
}

/**
 * The band frequencies inside the measured span (the retune is judged only where the board
 * was measured), and how many lie outside it.
 */
export function measuredPart(
  band: readonly number[],
  measured: readonly { readonly frequency: number }[],
): { readonly inside: number[]; readonly outside: number } {
  const fs = measured.map((p) => p.frequency).filter((f) => f > 0 && Number.isFinite(f));
  if (fs.length === 0) return { inside: [], outside: band.length };
  const lo = Math.min(...fs) * (1 - 1e-9);
  const hi = Math.max(...fs) * (1 + 1e-9);
  const inside = band.filter((f) => f >= lo && f <= hi);
  return { inside, outside: band.length - inside.length };
}

/* --------------------------------------------------------------- retune */

/** The values or parts a part may be changed to, nearest first is not required. */
export type RetuneCandidates = (index: number, element: Element) => readonly Element[];

export interface RetuneOptions {
  /** The frequencies the target is judged at. */
  readonly band: readonly number[];
  /** The target: the worst VSWR over the band at most this. */
  readonly limit: number;
  /** The impedance the VSWR refers to; default Z0. */
  readonly target?: Complex;
  /** For each changeable element (load side first), what it may become (snapped values or library parts). */
  readonly candidates: RetuneCandidates;
  /** Elements that may not change (locked parts). */
  readonly locked?: readonly number[];
}

export interface RetuneChange {
  readonly index: number;
  /** The base element now and what it becomes. */
  readonly from: Element;
  readonly to: Element;
}

export interface RetuneSuggestion {
  readonly changes: readonly RetuneChange[];
  readonly worst: Worst;
  readonly inside: boolean;
}

export interface Retune {
  /** The built board as fitted, before any change. */
  readonly before: Worst;
  /** The best single change, or null when no part can change. */
  readonly single: RetuneSuggestion | null;
  /** The suggestion: the fewest changes that reach the target, else the best found. */
  readonly suggestion: RetuneSuggestion | null;
  /** The part to change first: the single change when it is enough, else the change that helps most alone; null with no change. */
  readonly first: number | null;
  /** Combinations evaluated. */
  readonly evaluated: number;
  /** Why nothing was searched (no frequency to judge at); absent when the search ran. */
  readonly refused?: string;
}

/**
 * The worst VSWR over the band of the built board (the fitted drifts kept) with
 * some base elements replaced. A value drift stays with its place: a part
 * changed to another value keeps the fitted drift of the one it replaces (the
 * pads, the reel offset and the via around it are the board's); a library part
 * is taken as measured.
 */
export function retunedWorst(
  model: BuildModel,
  drifts: Drifts,
  replace: ReadonlyMap<number, Element>,
  band: readonly number[],
  target?: Complex,
): Worst {
  const base = model.base.map((el, i) => replace.get(i) ?? el);
  const d: Record<string, number> = { ...drifts };
  for (const [i, el] of replace) if (el.kind === 'part') delete d[`value:${i}`];
  const els = driftedElements({ ...model, base }, d);
  const { at } = modelLoad(model);
  let worst: Worst = { vswr: 0, frequency: NaN };
  for (const f of band) {
    const g = reflection(els, at(f), model.z0, f, target);
    const v = vswrOfGamma(g);
    if (!(v <= worst.vswr)) worst = { vswr: v, frequency: f };
  }
  return worst;
}

/**
 * The worst VSWR of retunes, fast: the network as built with the drifts is resolved once, and
 * at every band frequency the impedance looking into each run of elements from the load, the
 * matrix of the elements from each place to the input, and every element's matrix are kept; a
 * retune then evaluates only the parts it changes and the runs between them (O(changes), not
 * O(parts)). Equal to `retunedWorst` (a value change keeps the part's package, pads, via and
 * trace, which do not depend on the value; a library part keeps the via and trace and has no
 * package pads, as `withBoard` gives it), checked in the tests.
 */
export function retuneEvaluator(
  model: BuildModel,
  drifts: Drifts,
  band: readonly number[],
  target?: Complex,
): (replace: ReadonlyMap<number, Element>) => Worst {
  const built = driftedElements(model, drifts);
  const n = built.length;
  const { at } = modelLoad(model);
  const loads = band.map((f) => at(f));
  const mats = band.map((f) => built.map((el) => elementAbcd(el, f)));
  // The trace on the load side of each part, kept apart: a changed part keeps its trace.
  const traces = band.map((f) =>
    built.map((el) => {
      const t = traceOf(el);
      return t ? traceAbcd(t, f) : null;
    }),
  );
  // The impedance looking into elements 0..i-1 (into[k][0] is the load).
  const into = band.map((_, k) => {
    const row = mats[k] as Abcd[];
    const z: Complex[] = [loads[k] as Complex];
    for (let i = 0; i < n; i++) z.push(throughAbcd(row[i] as Abcd, z[i] as Complex));
    return z;
  });
  // The elements i..n-1 as one matrix (toInput[k][n] is the identity).
  const toInput = band.map((_, k) => {
    const row = mats[k] as Abcd[];
    const s: Abcd[] = new Array<Abcd>(n + 1);
    s[n] = IDENTITY;
    for (let i = n - 1; i >= 0; i--) s[i] = cascade(s[i + 1] as Abcd, row[i] as Abcd);
    return s;
  });
  // The run of elements a..b-1 as one matrix per frequency, made when first needed.
  const runs = new Map<number, Abcd[]>();
  const run = (a: number, b: number): Abcd[] | null => {
    if (b <= a) return null;
    const key = a * (n + 1) + b;
    const hit = runs.get(key);
    if (hit) return hit;
    const out = band.map((_, k) => {
      const row = mats[k] as Abcd[];
      let m = row[a] as Abcd;
      for (let i = a + 1; i < b; i++) m = cascade(row[i] as Abcd, m);
      return m;
    });
    runs.set(key, out);
    return out;
  };
  const bare = (el: Element): Element => {
    if (!('board' in el) || !el.board?.trace) return el;
    const via = el.board.via;
    return { ...el, board: via !== undefined ? { via } : {} } as Element;
  };
  const placed = (i: number, to: Element): Element => {
    const b = built[i] as Element;
    if (to.kind === 'part') {
      const board = 'board' in b ? b.board : undefined;
      return {
        kind: 'part',
        orientation: to.orientation,
        part: to.part,
        ...(board ? { board } : {}),
      };
    }
    if ((to.kind === 'R' || to.kind === 'L' || to.kind === 'C') && b.kind === to.kind) {
      const x = drifts[`value:${i}`];
      const f = x !== undefined && Number.isFinite(x) ? factor(x) : 1;
      return { ...b, value: to.value * f } as Element;
    }
    // Anything else goes through the full model.
    return driftedElements(
      { ...model, base: model.base.map((el, k) => (k === i ? to : el)) },
      drifts,
    )[i] as Element;
  };
  // A changed element's matrices (with its trace) per frequency, kept per candidate.
  const changedMats = new Map<number, WeakMap<Element, Abcd[]>>();
  const matsOf = (i: number, to: Element): Abcd[] => {
    let memo = changedMats.get(i);
    if (!memo) {
      memo = new WeakMap();
      changedMats.set(i, memo);
    }
    const hit = memo.get(to);
    if (hit) return hit;
    const el = bare(placed(i, to));
    const out = band.map((f, k) => {
      const part = elementAbcd(el, f);
      const t = (traces[k] as (Abcd | null)[])[i];
      return t ? cascade(part, t) : part;
    });
    memo.set(to, out);
    return out;
  };
  return (replace) => {
    const changed = [...replace]
      .filter(([i]) => i >= 0 && i < n)
      .sort((x, y) => x[0] - y[0])
      .map(([i, to]) => ({ i, m: matsOf(i, to) }));
    const between = changed.map((c, j) => {
      const next = changed[j + 1];
      return next ? run(c.i + 1, next.i) : null;
    });
    const first = changed[0];
    const last = changed[changed.length - 1];
    let worst: Worst = { vswr: 0, frequency: NaN };
    band.forEach((f, k) => {
      let zin: Complex;
      if (!first || !last) {
        zin = (into[k] as Complex[])[n] as Complex;
      } else {
        let z = (into[k] as Complex[])[first.i] as Complex;
        changed.forEach((c, j) => {
          z = throughAbcd(c.m[k] as Abcd, z);
          const r = between[j];
          if (r) z = throughAbcd(r[k] as Abcd, z);
        });
        zin = throughAbcd((toInput[k] as Abcd[])[last.i + 1] as Abcd, z);
      }
      const g = target
        ? cdiv(csub(zin, target), cadd(zin, complex(target.re, -target.im)))
        : gammaOfZ(zin, model.z0);
      const v = vswrOfGamma(g);
      if (!(v <= worst.vswr)) worst = { vswr: v, frequency: f };
    });
    return worst;
  };
}

function reflection(
  els: readonly Element[],
  load: Complex,
  z0: number,
  f: number,
  target: Complex | undefined,
): Complex {
  let m = IDENTITY;
  for (const el of els) m = cascade(elementAbcd(el, f), m);
  const zin = cdiv(cadd(cmul(m.a, load), m.b), cadd(cmul(m.c, load), m.d));
  if (!target) return gammaOfZ(zin, z0);
  const t = target;
  return cdiv(csub(zin, t), cadd(zin, complex(t.re, -t.im)));
}

/** Options per part in the first pair search when more than three parts can change. */
const PAIR_WINDOW = 7;

/** The k options nearest an element's value (log distance); library parts come sorted by nearness already. */
function nearestOptions(el: Element, options: readonly Element[], k: number): readonly Element[] {
  if (options.length <= k) return options;
  if (el.kind !== 'R' && el.kind !== 'L' && el.kind !== 'C') return options.slice(0, k);
  const v = el.value;
  return [...options]
    .map((o) => ({
      o,
      d: 'value' in o && o.value > 0 ? Math.abs(Math.log(o.value / v)) : Infinity,
    }))
    .sort((a, b) => a.d - b.d)
    .slice(0, k)
    .map((x) => x.o);
}

interface Found {
  readonly m: Map<number, Element>;
  readonly worst: Worst;
}

/**
 * Suggest a retune: the part values (snapped to the candidates) that bring the built board, as
 * fitted, back inside the target. A board inside the target already needs no change; an empty
 * band judges nothing and is refused. Searched: every single change; when none reaches the
 * target, every pair (over the seven values nearest each part when more than three parts can
 * change); when no pair does, coordinate descent from the best pair over all changeable parts.
 * That result is pruned (a change whose removal keeps it inside the target, or does not make it
 * worse, is dropped), and when more than two changes are left the pairs among those parts are
 * searched again over all their options. The suggestion is the fewest changes that reach the
 * target (ties to the lower worst VSWR); when none does, the lowest worst VSWR found. A
 * heuristic, not a proof that no better combination exists.
 */
export function suggestRetune(model: BuildModel, drifts: Drifts, options: RetuneOptions): Retune {
  const locked = new Set(options.locked ?? []);
  const { band, target, limit } = options;
  if (band.length === 0) {
    return {
      before: { vswr: NaN, frequency: NaN },
      single: null,
      suggestion: null,
      first: null,
      evaluated: 0,
      refused: 'there is no frequency to judge the target at',
    };
  }
  let evaluated = 0;
  const evaluate = retuneEvaluator(model, drifts, band, target);
  const evalMap = (m: ReadonlyMap<number, Element>): Worst => {
    evaluated += 1;
    return evaluate(m);
  };
  const before = evalMap(new Map());
  const toSuggestion = (m: ReadonlyMap<number, Element>, worst: Worst): RetuneSuggestion => ({
    changes: [...m]
      .sort((a, b) => a[0] - b[0])
      .map(([index, to]) => ({ index, from: model.base[index] as Element, to })),
    worst,
    inside: worst.vswr <= limit,
  });
  if (before.vswr <= limit) {
    return {
      before,
      single: null,
      suggestion: { changes: [], worst: before, inside: true },
      first: null,
      evaluated,
    };
  }
  const same = (a: Element, b: Element): boolean => JSON.stringify(a) === JSON.stringify(b);
  type Part = { readonly index: number; readonly options: readonly Element[] };
  const changeable: Part[] = [];
  model.base.forEach((el, index) => {
    if (locked.has(index)) return;
    // A change to what is there already is no change.
    const opts = options.candidates(index, el).filter((o) => !same(o, el));
    if (opts.length > 0) changeable.push({ index, options: opts });
  });
  const better = (a: Worst, b: Worst | null): boolean =>
    b === null || (Number.isFinite(a.vswr) && !(a.vswr >= b.vswr));

  // Singles.
  let single: RetuneSuggestion | null = null;
  for (const c of changeable) {
    for (const el of c.options) {
      const m = new Map([[c.index, el]]);
      const w = evalMap(m);
      if (better(w, single?.worst ?? null)) single = toSuggestion(m, w);
    }
  }
  const pairs = (
    parts: readonly Part[],
    window: boolean,
  ): { best: Found | null; inside: boolean } => {
    const near = (c: Part): readonly Element[] =>
      window ? nearestOptions(model.base[c.index] as Element, c.options, PAIR_WINDOW) : c.options;
    let best: Found | null = null;
    let bestInside: Found | null = null;
    for (let a = 0; a < parts.length; a++) {
      for (let b = a + 1; b < parts.length; b++) {
        const ca = parts[a] as Part;
        const cb = parts[b] as Part;
        for (const ea of near(ca)) {
          for (const eb of near(cb)) {
            const m = new Map([
              [ca.index, ea],
              [cb.index, eb],
            ]);
            const w = evalMap(m);
            if (better(w, best?.worst ?? null)) best = { m, worst: w };
            if (w.vswr <= limit && better(w, bestInside?.worst ?? null))
              bestInside = { m, worst: w };
          }
        }
      }
    }
    return bestInside ? { best: bestInside, inside: true } : { best, inside: false };
  };

  let suggestion: RetuneSuggestion | null = single?.inside ? single : null;
  let pair: Found | null = null;
  if (!suggestion && changeable.length >= 2) {
    const p = pairs(changeable, changeable.length > 3);
    pair = p.best;
    if (p.inside && p.best) suggestion = toSuggestion(p.best.m, p.best.worst);
  }
  if (!suggestion && changeable.length > 0) {
    // Coordinate descent over every changeable part, from the best pair (or the best single).
    let current = new Map<number, Element>(
      pair?.m ?? (single ? single.changes.map((c) => [c.index, c.to] as [number, Element]) : []),
    );
    let currentWorst = pair?.worst ?? single?.worst ?? before;
    for (let sweep = 0; sweep < 8 && changeable.length > 2; sweep++) {
      let moved = false;
      for (const c of changeable) {
        for (const el of c.options) {
          const m = new Map(current);
          m.set(c.index, el);
          const w = evalMap(m);
          if (w.vswr < currentWorst.vswr - 1e-12) {
            current = m;
            currentWorst = w;
            moved = true;
          }
        }
      }
      if (!moved) break;
    }
    // The best of what was found, then pruned to the changes it needs.
    let best: Found = { m: current, worst: currentWorst };
    for (const s of [single, pair ? toSuggestion(pair.m, pair.worst) : null]) {
      if (s && better(s.worst, best.worst))
        best = { m: new Map(s.changes.map((c) => [c.index, c.to])), worst: s.worst };
    }
    for (let pruned = true; pruned && best.m.size > 1;) {
      pruned = false;
      let drop: Found | null = null;
      const inside = best.worst.vswr <= limit;
      for (const i of best.m.keys()) {
        const m = new Map(best.m);
        m.delete(i);
        const w = evalMap(m);
        const keeps = inside ? w.vswr <= limit : w.vswr <= best.worst.vswr + 1e-12;
        if (keeps && better(w, drop?.worst ?? null)) drop = { m, worst: w };
      }
      if (drop) {
        best = drop;
        pruned = true;
      }
    }
    // More than two changes left: the pairs among those parts, over all their options.
    if (best.m.size > 2) {
      const p = pairs(
        changeable.filter((c) => best.m.has(c.index)),
        false,
      );
      if (p.best && (p.inside || (best.worst.vswr > limit && better(p.best.worst, best.worst))))
        best = p.best;
    }
    if (best.m.size > 0) suggestion = toSuggestion(best.m, best.worst);
  }
  let first: number | null = null;
  const changes = suggestion?.changes ?? [];
  if (changes.length === 1) first = (changes[0] as RetuneChange).index;
  else if (changes.length > 1) {
    let bestW: Worst | null = null;
    for (const ch of changes) {
      const w = evalMap(new Map([[ch.index, ch.to]]));
      if (better(w, bestW)) {
        bestW = w;
        first = ch.index;
      }
    }
  }
  return { before, single, suggestion, first, evaluated };
}

/** The reflection coefficients of the built board as fitted with a retune applied, at the given frequencies. */
export function retunedGammas(
  model: BuildModel,
  drifts: Drifts,
  changes: readonly RetuneChange[],
  frequencies: readonly number[],
): Complex[] {
  const replace = new Map(changes.map((c) => [c.index, c.to]));
  const base = model.base.map((el, i) => replace.get(i) ?? el);
  const d: Record<string, number> = { ...drifts };
  for (const [i, el] of replace) if (el.kind === 'part') delete d[`value:${i}`];
  return modelGammas({ ...model, base }, d, frequencies);
}

/**
 * What each part may become in a retune, from the realization source: for a
 * series or a stock, the `span` values on each side of the part's value (its
 * package kept); for the part library, the library parts of its kind whose
 * data covers the band and that are below their resonance at the design
 * frequency, the 2 span + 1 nearest by effective value. Other elements: none.
 */
export function retuneCandidates(
  source: ValueSource,
  frequency: number,
  band: readonly number[],
  span = 6,
): RetuneCandidates {
  const lo = Math.min(...band, frequency);
  const hi = Math.max(...band, frequency);
  return (_index, el) => {
    if (source.kind === 'library') {
      const kind = el.kind === 'part' ? el.part.type : el.kind;
      if (kind !== 'L' && kind !== 'C') return [];
      if (el.kind !== 'part' && el.kind !== 'L' && el.kind !== 'C') return [];
      const current = el.kind === 'part' ? (partAt(el.part, frequency)?.value ?? null) : el.value;
      if (current === null || !(current > 0)) return [];
      const ok = source.parts
        .filter((p) => p.type === kind && inPartRange(p.range, lo) && inPartRange(p.range, hi))
        .map((p) => ({ p, v: partAt(p, frequency)?.value ?? null }))
        .filter((x): x is { p: LibraryPart; v: number } => x.v !== null && x.v > 0)
        .sort((a, b) => Math.abs(Math.log(a.v / current)) - Math.abs(Math.log(b.v / current)))
        .slice(0, 2 * span + 1);
      return ok.map(
        ({ p }) => ({ kind: 'part', orientation: el.orientation, part: p }) as PartElement,
      );
    }
    if ((el.kind !== 'R' && el.kind !== 'L' && el.kind !== 'C') || !(el.value > 0)) return [];
    return realizableValues(source, el.kind, el.value, span).map(
      (v) => ({ ...el, value: v }) as Element,
    );
  };
}
