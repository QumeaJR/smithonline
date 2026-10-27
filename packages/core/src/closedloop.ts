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
 *   to the board: the retune and the figures against the target leave it out,
 *   and it is never judged against a board built as designed, only against
 *   the range the fit takes (MAX_PLANE, 1 ns either way, less with coarse
 *   frequency steps: planeRange). It is searched globally (planeSearch): a
 *   profile over the whole range with the other drifts refitted at every step,
 *   its best minima run to convergence; a second minimum the data cannot reject
 *   makes the fit ambiguous, not trusted.
 * - a library part (kind 'part'): its value is a scale on its measured
 *   impedance (prior 5 %, approximate), and on the board its lands add pad
 *   capacitance (nominal 0).
 *
 * The fit is weighted least squares on the complex reflection coefficient at
 * the measured frequencies, Gamma referred to the design's Z0 (the VNA's
 * reference), with every parameter scaled by a prior width (what a typical
 * drift of its kind is) and a small Tikhonov term towards no drift, which
 * keeps the normal equations well conditioned. The Jacobian of a part value
 * is the analytic derivative of D3 (sensitivity.ts `sensitivityAt`); the board
 * parameters, which change several elements at once, take central differences.
 *
 * Identifiability. Before fitting, the prior-scaled Jacobian at the start (no
 * drift, the plane at its first start) is taken column by column, largest
 * remaining first (as QR with column pivoting): a parameter with no effect, or
 * whose column has a cosine above LIKE_ONE (0.99875: less than 5 % of it outside
 * the other) with one picked before it, cannot be told apart from that one by
 * any data of this shape; it is fixed at no drift and named with it. A column
 * that is a numerically exact combination of several (less than 1e-6 of it
 * outside their span) is fixed too. A column merely near the span of several
 * is fitted: whether the data resolves it depends on the noise, which the next
 * rule judges. After the fit, a parameter whose standard uncertainty is half
 * its prior width or more is not resolved; it is fixed and the rest fitted
 * again. Fitted pairs whose estimates correlate above 0.95 are reported: the
 * data fixes their joint effect, not how it is shared between them.
 *
 * The reference plane, not free: the same parameters are fitted again with
 * it (and, with a microstrip in the network, with er and h), and the drop in
 * the residual sum of squares is tested against the residual variance with it
 * (against the floor, times kappa), an F-test for nested models with
 * (2N - P) / kappa degrees of freedom. Below p = 0.001 (PLANE_P) with the plane
 * at least twice its uncertainty, it explains the data better; a drift it
 * moves by more than MOVED_SIGMAS of the larger of the two fits' uncertainty
 * changes the conclusion. Either way the fit without it is not trusted, and
 * the stated uncertainty of each drift is the larger of the two fits'.
 * The fit is refused when the free parameters number more than 2N - 2 for N
 * measured frequencies (each gives two numbers, and two are kept for the
 * residual), or when fewer than three frequencies are usable.
 *
 * The uncertainty of a fitted drift is the square root of the diagonal of
 * s^2 kappa (J^T J + D)^-1 in the prior-scaled coordinates, with s^2 the larger
 * of the residual sum of squares over (2N - P) and the floor's variance
 * (floorUsed^2 / 2), and kappa the residual's correlation inflation when the
 * scatter sets s^2 (correlationInflation). Which parameters the data resolves
 * is judged on its own scatter, so clean data is fitted exactly. The other
 * explanations the data allows (BuildFit.alternatives) go to the retune,
 * which offers only a change that leaves the board no worse under each.
 * The rules and their thresholds: docs/08-depth-plan.md, D6, "Fail-safe rules
 * (QA round 3)".
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
  /**
   * A library part's value: a scale on its measured impedance (approximate: the data is of one
   * sample), its nominal the effective value at the design frequency, its prior a typical tolerance.
   */
  readonly library?: boolean;
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
  /** A library part's impedance: 5 %, a typical tolerance of an RF inductor or capacitor (the library holds none). */
  library: 0.05,
} as const;

/**
 * The physical bound of a relative drift: the factor it scales by stays above this (a drift of
 * -95 %), approached smoothly (softAbove), never clamped.
 */
export const MIN_FACTOR = 0.05;

/**
 * A smooth lower bound: x itself down to lo + c, below it lo + c^2 / (2c - (x - lo)), which meets
 * x with the same value and slope at lo + c, stays above lo and is never flat. A hard clamp
 * (max(lo, x)) has no slope below lo: a fit step that lands there stalls, and on clean data the
 * fit stops short of the truth. Inside the physical range (x at least lo + c) the model is exact.
 */
export function softAbove(x: number, lo: number, c: number): number {
  const t = x - lo;
  return t >= c ? x : lo + (c * c) / (2 * c - t);
}

/** The slope of softAbove at x: 1 inside the physical range, (c / (2c - t))^2 below it. */
function softAboveSlope(x: number, lo: number, c: number): number {
  const t = x - lo;
  if (t >= c) return 1;
  const k = c / (2 * c - t);
  return k * k;
}

/** How close a relative factor comes to MIN_FACTOR before the smooth bound bends it: 1 % of the factor. */
const FACTOR_SOFT = 0.01;
/** How close a pad comes to none before the smooth bound bends it: 1 % of the pad prior, 2 fF. */
/** How close a trace comes to no length before the smooth bound bends it: 10 µm. */
const TRACE_SOFT = 1e-5;

const factor = (x: number): number => softAbove(1 + x, MIN_FACTOR, FACTOR_SOFT);

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
    if (el.kind === 'part') {
      const v = partAt(el.part, model.frequency)?.value ?? null;
      if (v === null || !(v > 0) || !Number.isFinite(v)) return;
      out.push({
        id: `value:${index}`,
        kind: 'value',
        index,
        relative: true,
        nominal: v,
        prior: DRIFT_PRIOR.library,
        freeByDefault: true,
        library: true,
      });
      return;
    }
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
  const lands = model.board.enabled && isUsableStackup(model.board.stackup);
  model.base.forEach((el, index) => {
    // A library part has no package pads in the model (its data is of the part); on the board its
    // lands add capacitance, which the fit may find (nominal 0).
    if (el.kind === 'part') {
      if (!lands) return;
      out.push({
        id: `pad:${index}`,
        kind: 'pad',
        index,
        relative: false,
        nominal: 0,
        prior: DRIFT_PRIOR.pad,
        freeByDefault: true,
      });
      return;
    }
    if (!isLC(el)) return;
    const b = built[index];
    const pad = isLC(b) ? (b.parasitics?.pad ?? 0) : 0;
    // Without pads in the network as built (the board off, no pad in the table) none is offered.
    if (!(pad > 0)) return;
    anyPad = true;
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
          er: softAbove(el.stackup.er * factor(er), 1, FACTOR_SOFT),
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
            er: softAbove(model.board.stackup.er * factor(er), 1, FACTOR_SOFT),
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
    if (out.kind === 'part') {
      const scale = factor(d(`value:${i}`));
      // The lands of a library part against the fixture its data was measured on: linear and of
      // either sign in the model (no clamp, no flat region), judged against what is physical by
      // checkFit.
      const pad = d(`pad:${i}`);
      if (scale !== 1 || pad !== 0) out = { ...out, drift: { scale, pad } };
    }
    if (isLC(out)) {
      const pad0 = out.parasitics?.pad ?? 0;
      // Linear in the drift and of either sign in the model (no clamp, no flat region): a fit
      // step past no pad comes back; checkFit judges a result past what is physical.
      const pad = pad0 * padScale + d(`pad:${i}`);
      if (pad !== pad0) out = { ...out, parasitics: { ...(out.parasitics ?? {}), pad } };
    }
    if ('board' in out && out.board && (viaScale !== 1 || traceAdd !== 0)) {
      const b = out.board;
      const via = b.via !== undefined ? b.via * viaScale : undefined;
      const trace =
        b.trace !== undefined
          ? { ...b.trace, length: softAbove(b.trace.length + traceAdd, 0, TRACE_SOFT) }
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

/**
 * Two parameters whose effects (columns of the scaled Jacobian) leave less than this fraction of
 * one outside the other cannot be told apart: a cosine above LIKE_ONE.
 */
export const UNRESOLVED_RATIO = 0.05;
/** The cosine between two parameters' effects above which one acts like the other: sqrt(1 - 0.05^2), 0.99875. */
export const LIKE_ONE = Math.sqrt(1 - UNRESOLVED_RATIO * UNRESOLVED_RATIO);
/** A column less than this fraction outside the span of the picked ones is a numerically exact combination of them. */
export const DEGENERATE = 1e-6;
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
  /**
   * Like another: its effect is within UNRESOLVED_RATIO of the span of several fitted
   * parameters together, though no single one is that close (the partner is only the closest).
   */
  readonly combination?: boolean;
  /**
   * Fitted, but the data cannot tell it from this parameter, set aside for its uncertainty with a
   * correlation above CORRELATED ("X or Y"): the drift is their joint effect, not a finding about
   * this one.
   */
  readonly orWith?: string;
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
  /** The residual's correlation inflation along frequency: N / kappa independent points (1: white). */
  readonly kappa: number;
  /** Largest over smallest singular value of the scaled Jacobian of the fitted set at the solution. */
  readonly condition: number;
  readonly iterations: number;
  /**
   * Pairs of fitted parameters correlated above 0.95; with `either`, b was set aside for its
   * uncertainty and a carries their joint effect ("X or Y").
   */
  readonly correlated: readonly {
    readonly a: string;
    readonly b: string;
    readonly rho: number;
    readonly either?: true;
  }[];
  /**
   * Fitted pairs correlated above 0.95 whose drifts are each resolved (uncertainty at most
   * AMBIGUOUS_PAIR of the typical drift): they move together in the fit, each is told.
   */
  readonly together: readonly { readonly a: string; readonly b: string; readonly rho: number }[];
  /**
   * The other explanations the data allows, as drifts (the plane left to the measurement): the
   * corners of the joint region of each pass, the passes before a parameter was set aside, a
   * second minimum, the fit with the plane or the laminate added, an "X or Y" pair swapped. A
   * retune is offered only when it leaves none of them worse than the board as it is.
   */
  readonly alternatives: readonly Drifts[];
  /** The range the plane search covered, s, either way. */
  readonly planeRange: number;
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
  /**
   * The accuracy of the instrument, |ΔΓ| RMS: the smooth error its calibration leaves, which the
   * point-to-point scatter does not show. Default MIN_NOISE_FLOOR (a lab VNA); a hobby VNA such
   * as a NanoVNA is nearer HOBBY_VNA_ACCURACY.
   */
  readonly accuracy?: number;
  /** With the plane not free, fit again with it and compare (default true). */
  readonly planeCheck?: boolean;
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
  let model: Complex[] | null = null;
  p.params.forEach((q, j) => {
    if (q.kind === 'plane') {
      // The plane only rotates: d/dtau of exp(-j 4 pi f tau) Gamma is -j 4 pi f times the model.
      model ??= modelGammas(p.model, drifts, p.freqs);
      const g = model;
      const col: number[] = [];
      p.freqs.forEach((f, k) => {
        const gk = g[k] as Complex;
        const w = 4 * Math.PI * f * q.prior;
        col.push(w * gk.im, -w * gk.re);
      });
      cols.push(col);
      return;
    }
    if (q.kind === 'value' && q.index !== undefined && !q.library) {
      // D3's analytic derivative: dGamma/dvalue at the drifted value, times dvalue/du.
      const col: number[] = [];
      const x = (u[j] as number) * q.prior;
      const dvdu = q.nominal * q.prior * softAboveSlope(1 + x, MIN_FACTOR, FACTOR_SOFT);
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
 * The columns the fit takes, in the order picked (largest remaining norm first, as QR with
 * column pivoting), and for each column left over why: no effect; like one picked column (the
 * cosine between their effects above LIKE_ONE, 0.9987: one moves the response as the other
 * does, the data cannot share a change between them); a numerically degenerate combination of
 * the picked ones (less than DEGENERATE of its norm outside their span); or past the cap. A
 * column merely close to the span of several (5 % outside it, say) is fitted: whether the data
 * resolves it depends on the noise, which the uncertainty rule after the fit (UNRESOLVED_SIGMA)
 * judges, not the geometry alone.
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
  const closest = (j: number): { partner: number | null; cosine: number } => {
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
    return { partner, cosine };
  };
  for (const j of [...left]) {
    const n = norms[j] as number;
    if (!(n > 1e-9 * maxNorm) || !(n > 1e-12)) {
      dropped.push({ j, why: 'no-effect', partner: null, cosine: 0 });
      left.delete(j);
    }
  }
  while (left.size > 0) {
    let best = -1;
    let bestNorm = -1;
    for (const j of left) {
      const n = Math.sqrt(dot(work[j] as number[], work[j] as number[]));
      if (n > bestNorm) {
        bestNorm = n;
        best = j;
      }
    }
    left.delete(best);
    const near = closest(best);
    const ratio = bestNorm / (norms[best] as number);
    if (Math.abs(near.cosine) > LIKE_ONE || ratio < DEGENERATE) {
      dropped.push({ j: best, why: 'unresolved', ...near });
      continue;
    }
    if (picked.length >= cap) {
      dropped.push({ j: best, why: 'cap', ...near });
      continue;
    }
    picked.push(best);
    const q = (work[best] as number[]).map((v) => v / bestNorm);
    for (const j of left) {
      const w = work[j] as number[];
      const k = dot(w, q);
      for (let i = 0; i < w.length; i++) w[i] = (w[i] as number) - k * (q[i] as number);
    }
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
  start?: readonly number[],
): Solved {
  const n = p.params.length;
  let u = start ? [...start] : new Array<number>(n).fill(0);
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

/** The widest reference plane the fit takes, s, either way: 1 ns, about 20 cm of coaxial cable. */
export const MAX_PLANE = 1e-9;

/**
 * Where the fit starts the reference plane, s: the slope of the phase of the measured Gamma over
 * the designed Gamma against frequency; the phase of exp(-j 4 pi f tau) falls by 4 pi tau per
 * hertz. Taken from the phase steps between neighbouring frequencies (each wrapped to plus or
 * minus pi, so an unwrapping error near a match, where the phase is noise, cannot shift the rest),
 * weighted by the smaller |Gamma| squared of the pair: tau = -sum(w dphi) / (4 pi sum(w df)).
 * 0 with fewer than two steps where both |Gamma| are above 0.001. Clamped to MAX_PLANE.
 */
export function planeFromPhase(model: BuildModel, points: readonly MeasuredReflection[]): number {
  const sorted = [...points].sort((a, b) => a.frequency - b.frequency);
  const g = modelGammas(
    model,
    {},
    sorted.map((p) => p.frequency),
  );
  let num = 0;
  let den = 0;
  let steps = 0;
  let last: { f: number; phi: number; w: number } | null = null;
  sorted.forEach((pt, k) => {
    const d = g[k] as Complex;
    const w = Math.min(cabs(d), cabs(pt.gamma)) ** 2;
    if (!(w > 1e-6) || !Number.isFinite(w)) {
      last = null;
      return;
    }
    const r = cdiv(pt.gamma, d);
    const phi = Math.atan2(r.im, r.re);
    const prev = last as { f: number; phi: number; w: number } | null;
    if (prev && pt.frequency > prev.f) {
      let dphi = phi - prev.phi;
      dphi -= 2 * Math.PI * Math.round(dphi / (2 * Math.PI));
      const wk = Math.min(w, prev.w);
      num += wk * dphi;
      den += wk * (pt.frequency - prev.f);
      steps += 1;
    }
    last = { f: pt.frequency, phi, w };
  });
  if (steps < 2 || !(den > 0)) return 0;
  const tau = -num / den / (4 * Math.PI);
  return Number.isFinite(tau) ? Math.max(-MAX_PLANE, Math.min(MAX_PLANE, tau)) : 0;
}

/**
 * The reference plane that alone (no other drift) brings the designed Gamma closest to the
 * measured one, s: a scan over plus and minus MAX_PLANE in steps of 1 / (40 f_max) (the residual
 * repeats every 1 / (2 f), so no minimum falls between two steps), refined by a parabola through
 * the best step and its neighbours. Only the rotation is computed per step, not the network.
 */
export function planeFromScan(model: BuildModel, points: readonly MeasuredReflection[]): number {
  const fs = points.map((p) => p.frequency);
  const fMax = Math.max(0, ...fs);
  if (!(fMax > 0) || points.length < 3) return 0;
  const g = modelGammas(model, {}, fs);
  const step = 1 / (40 * fMax);
  const n = Math.min(4000, Math.ceil(MAX_PLANE / step));
  const cost = (tau: number): number => {
    let c = 0;
    points.forEach((pt, k) => {
      const d = g[k] as Complex;
      const phi = -4 * Math.PI * pt.frequency * tau;
      const re = d.re * Math.cos(phi) - d.im * Math.sin(phi);
      const im = d.re * Math.sin(phi) + d.im * Math.cos(phi);
      c += (re - pt.gamma.re) ** 2 + (im - pt.gamma.im) ** 2;
    });
    return c;
  };
  let best = 0;
  let bestCost = Infinity;
  for (let i = -n; i <= n; i++) {
    const c = cost(i * step);
    if (c < bestCost) {
      bestCost = c;
      best = i;
    }
  }
  const t = best * step;
  const a = cost(t - step);
  const b = bestCost;
  const c = cost(t + step);
  const curv = a - 2 * b + c;
  const shift = curv > 0 ? (0.5 * (a - c)) / curv : 0;
  const tau = t + Math.max(-1, Math.min(1, shift)) * step;
  return Math.max(-MAX_PLANE, Math.min(MAX_PLANE, tau));
}

/**
 * The regularized incomplete beta function I_x(a, b) (continued fraction, Lentz's method, as in
 * Numerical Recipes 6.4); used for the F-test of the reference plane.
 */
export function incompleteBeta(x: number, a: number, b: number): number {
  if (!(x > 0)) return 0;
  if (!(x < 1)) return 1;
  const lnBeta = lnGamma(a + b) - lnGamma(a) - lnGamma(b);
  const front = Math.exp(lnBeta + a * Math.log(x) + b * Math.log(1 - x));
  const cf = (xx: number, aa: number, bb: number): number => {
    const tiny = 1e-300;
    let c = 1;
    let d = 1 - ((aa + bb) * xx) / (aa + 1);
    if (Math.abs(d) < tiny) d = tiny;
    d = 1 / d;
    let h = d;
    for (let m = 1; m <= 300; m++) {
      const m2 = 2 * m;
      let num = (m * (bb - m) * xx) / ((aa + m2 - 1) * (aa + m2));
      d = 1 + num * d;
      if (Math.abs(d) < tiny) d = tiny;
      c = 1 + num / c;
      if (Math.abs(c) < tiny) c = tiny;
      d = 1 / d;
      h *= d * c;
      num = (-(aa + m) * (aa + bb + m) * xx) / ((aa + m2) * (aa + m2 + 1));
      d = 1 + num * d;
      if (Math.abs(d) < tiny) d = tiny;
      c = 1 + num / c;
      if (Math.abs(c) < tiny) c = tiny;
      d = 1 / d;
      const del = d * c;
      h *= del;
      if (Math.abs(del - 1) < 1e-14) break;
    }
    return h;
  };
  return x < (a + 1) / (a + b + 2) ? (front * cf(x, a, b)) / a : 1 - (front * cf(1 - x, b, a)) / b;
}

/** ln Gamma(x) for x > 0 (Lanczos, g = 7, nine terms). */
function lnGamma(x: number): number {
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
    1.5056327351493116e-7,
  ];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lnGamma(1 - x);
  const xx = x - 1;
  let s = c[0] as number;
  for (let i = 1; i < 9; i++) s += (c[i] as number) / (xx + i);
  const t = xx + 7.5;
  return 0.5 * Math.log(2 * Math.PI) + (xx + 0.5) * Math.log(t) - t + Math.log(s);
}

/** The probability that an F(d1, d2) variable exceeds f: the p-value of d1 added parameters with d2 degrees of freedom left. */
export function fTestP(f: number, d1: number, d2: number): number {
  if (!(f > 0) || !(d1 > 0) || !(d2 > 0)) return 1;
  return incompleteBeta(d2 / (d2 + d1 * f), d2 / 2, d1 / 2);
}

/** The reference plane (or the laminate) is called significant when adding it leaves a p-value below this. */
export const PLANE_P = 0.001;
/**
 * The confidence level of the joint region a second minimum, or another explanation, is judged
 * against: inside the 99 % region the data cannot reject it (Beale's F region for nonlinear least
 * squares: RSS at most RSS_min + P s^2 kappa F(P, (2N - P) / kappa; 0.99)).
 */
export const AMBIGUOUS_LEVEL = 0.99;
/**
 * The confidence level of the region whose principal corners the retune is checked against: the
 * 95 % joint region of the fitted drifts.
 */
export const CORNER_LEVEL = 0.95;
/**
 * A drift that moves by more than this many of its standard uncertainties when another
 * explanation (the reference plane, the laminate) is added changes the conclusion: the fit
 * without it is not trusted.
 */
export const MOVED_SIGMAS = 2;
/**
 * Two fitted parameters correlated above CORRELATED are told apart ("X did not move, Y moved by")
 * when each is uncertain by at most this fraction of its typical drift; else "X or Y".
 */
export const AMBIGUOUS_PAIR = 1 / 3;
/** The plane search grid: this many steps per 1 / f_max (the cost repeats every 1 / (2 f)). */
const PLANE_GRID = 40;
/** Local minima of the linearized plane profile tried, per round (two rounds). */
const PLANE_STARTS = 5;
/**
 * Iterations each start of the plane search runs before the starts are compared; those within
 * reach of the best (PLANE_KEEP of its cost, or three times the ambiguity region) run on to
 * convergence, at most PLANE_FINISH of them.
 */
const PLANE_SCREEN = 5;
const PLANE_KEEP = 0.25;
const PLANE_FINISH = 4;
/** The plane search screens its starts on at most this many frequencies. */
const SCREEN_POINTS = 201;

type Status = Omit<FittedParameter, keyof DriftParameter>;

/** One converged solution of a set of free parameters. */
interface Solution {
  readonly active: readonly DriftParameter[];
  readonly u: readonly number[];
  /** The residual sum of squares (without the regularization). */
  readonly rss: number;
}

/** A pass of a fit: its solution and the covariance of its scaled parameters. */
interface Pass extends Solution {
  readonly cov: number[][] | null;
  readonly dof: number;
  readonly kappa: number;
}

interface SetFit {
  readonly status: Map<string, Status>;
  readonly active: readonly DriftParameter[];
  readonly solved: Solved | null;
  readonly cov: number[][] | null;
  readonly iterations: number;
  /** Every pass, the parameters dropped after it still free; the last is the result. */
  readonly passes: readonly Pass[];
  /** Other minima the plane search converged to, distinct from the best (first pass). */
  readonly others: readonly Solution[];
  /** The residual variance per number taken: the larger of RSS / (2N - P) and the floor's. */
  readonly s2: number;
  /** The variance inflation of the residual's correlation along frequency (1: independent points). */
  readonly kappa: number;
}

interface SetOptions {
  readonly cap: number;
  readonly maxIt: number;
  /** The residual variance per number the floor allows: floorUsed^2 / 2 (|ΔΓ| has two parts). */
  readonly s2Floor: number;
  /** How far either way the plane search goes, s. */
  readonly planeRange: number;
  readonly onProgress?: (p: BuildFitProgress) => void;
  /** Where to start (drifts by id); the plane search also starts from here. */
  readonly seed?: Readonly<Record<string, number>>;
}

/**
 * The variance inflation of a residual whose neighbouring points are correlated (an averaged or
 * smoothed trace, a smooth calibration error): 1 + 2 sum of its autocorrelations along frequency
 * (re and im together), summed while they stay above 2 / sqrt(2N) (what independent noise gives by
 * chance). N / kappa is the effective number of independent points; the uncertainties are
 * scaled by sqrt(kappa) and the tests take (2N - P) / kappa degrees of freedom. Between 1 and N / 4.
 * The residual must be in order of frequency (re, im per point).
 */
export function correlationInflation(r: readonly number[]): number {
  const n = Math.floor(r.length / 2);
  if (n < 8) return 1;
  const r0 = dot(r, r);
  if (!(r0 > 0)) return 1;
  const significant = 2 / Math.sqrt(2 * n);
  let sum = 0;
  for (let lag = 1; lag <= n / 4; lag++) {
    let c = 0;
    for (let i = 0; i + lag < n; i++)
      c +=
        (r[2 * i] as number) * (r[2 * (i + lag)] as number) +
        (r[2 * i + 1] as number) * (r[2 * (i + lag) + 1] as number);
    const rho = c / r0;
    if (!(rho > significant)) break;
    sum += rho;
  }
  return Math.min(n / 4, Math.max(1, 1 + 2 * sum));
}

/** The residual variance and its inflation: the floor's when the scatter is below it (then 1). */
function varianceOf(
  r: readonly number[],
  dof: number,
  s2Floor: number,
): { s2: number; kappa: number } {
  const raw = dot(r, r) / Math.max(1, dof);
  if (!(raw > s2Floor)) return { s2: s2Floor, kappa: 1 };
  return { s2: raw, kappa: correlationInflation(r) };
}

/** The quantile of the F(d1, d2) distribution at level q (bisection on fTestP). */
export function fQuantile(q: number, d1: number, d2: number): number {
  const target = 1 - q;
  let lo = 0;
  let hi = 1;
  while (fTestP(hi, d1, d2) > target && hi < 1e12) hi *= 2;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    if (fTestP(mid, d1, d2) > target) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * The plane range a measurement resolves, s: MAX_PLANE, and less when the frequency steps are
 * coarse: the plane rotates Gamma by 4 pi df tau between neighbouring points, which aliases past
 * half a turn, so |tau| below 1 / (4 df_max).
 */
export function planeRange(frequencies: readonly number[]): number {
  const fs = [...frequencies].sort((a, b) => a - b);
  let step = 0;
  for (let i = 1; i < fs.length; i++)
    step = Math.max(step, (fs[i] as number) - (fs[i - 1] as number));
  return step > 0 ? Math.min(MAX_PLANE, 1 / (4 * step)) : MAX_PLANE;
}

/** The Jacobi eigenvalues and eigenvectors (columns) of a small symmetric matrix. */
function symmetricEigen(a: readonly (readonly number[])[]): {
  values: number[];
  vectors: number[][];
} {
  const n = a.length;
  const m = a.map((row) => [...row]);
  const v = m.map((_, i) => m.map((__, j) => (i === j ? 1 : 0)));
  const at = (x: number[][], i: number, j: number): number => (x[i] as number[])[j] as number;
  const set = (x: number[][], i: number, j: number, value: number): void => {
    (x[i] as number[])[j] = value;
  };
  for (let sweep = 0; sweep < 60; sweep++) {
    let off = 0;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) off += at(m, i, j) ** 2;
    if (!(off > 1e-30)) break;
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        const mpq = at(m, p, q);
        if (Math.abs(mpq) < 1e-300) continue;
        const theta = (at(m, q, q) - at(m, p, p)) / (2 * mpq);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < n; k++) {
          const kp = at(m, k, p);
          const kq = at(m, k, q);
          set(m, k, p, c * kp - s * kq);
          set(m, k, q, s * kp + c * kq);
        }
        for (let k = 0; k < n; k++) {
          const pk = at(m, p, k);
          const qk = at(m, q, k);
          set(m, p, k, c * pk - s * qk);
          set(m, q, k, s * pk + c * qk);
        }
        for (let k = 0; k < n; k++) {
          const kp = at(v, k, p);
          const kq = at(v, k, q);
          set(v, k, p, c * kp - s * kq);
          set(v, k, q, s * kp + c * kq);
        }
      }
    }
  }
  return {
    values: m.map((_, i) => at(m, i, i)),
    vectors: m.map((_, j) => v.map((row) => row[j] as number)),
  };
}

const costOfSolved = (s: Solved, reg: readonly number[]): number => {
  let c = dot(s.r, s.r);
  s.u.forEach((v, i) => (c += (reg[i] as number) * v * v));
  return c;
};

/**
 * The global search over the reference plane: the plane is scanned over plus and minus the range
 * on a grid of 1 / (40 f_max) (the cost repeats every 1 / (2 f) at each f, so no minimum falls
 * between steps), with every other free parameter refitted at each step, linearized: the plane
 * only rotates Gamma, so |rotated model - measured| equals |board model - measured rotated back|,
 * and each step is one linear least-squares solve with the board's Jacobian (computed once). The
 * start given (the seed, or no drift, with its plane), the phase slope's plane and the best local
 * minima of that profile (PLANE_STARTS) are each run on by the full nonlinear fit to convergence;
 * then the profile is taken again around the best solution and its new minima run too. Returns
 * the converged solutions, distinct ones only, best first.
 */
function planeSearch(
  p: Problem,
  reg: readonly number[],
  maxIt: number,
  start: readonly number[],
  range: number,
  s2Floor: number,
  progress: (iteration: number, rms: number) => void,
): { solutions: Solved[]; iterations: number } {
  const k = p.params.findIndex((q) => q.kind === 'plane');
  const prior = (p.params[k] as DriftParameter).prior;
  const boardIdx = p.params.map((_, i) => i).filter((i) => i !== k);
  const pb: Problem = { ...p, params: boardIdx.map((i) => p.params[i] as DriftParameter) };
  const regB = boardIdx.map((i) => reg[i] as number);
  const fMax = Math.max(...p.freqs);
  const step = 1 / (PLANE_GRID * fMax);
  const n = Math.max(1, Math.min(20000, Math.floor(range / step)));
  const assemble = (ub: readonly number[], tau: number): number[] => {
    const u = new Array<number>(p.params.length).fill(0);
    boardIdx.forEach((i, j) => (u[i] = Math.max(-5, Math.min(5, ub[j] as number))));
    u[k] = tau / prior;
    return u;
  };
  const profile = (ub: readonly number[]): { tau: number; ub: number[]; cost: number }[] => {
    const g0 = modelGammas(p.model, driftsOf(pb, ub), p.freqs);
    const cols = pb.params.length > 0 ? jacobian(pb, ub) : [];
    const a = cols.map((ci, i) =>
      cols.map((cj, j) => dot(ci, cj) + (i === j ? (regB[i] as number) : 0)),
    );
    const inv = cols.length > 0 ? inverse(a) : [];
    if (!inv) return [];
    const out: { tau: number; ub: number[]; cost: number }[] = [];
    const y = new Array<number>(2 * p.points.length).fill(0);
    for (let i = -n; i <= n; i++) {
      const tau = i * step;
      let yy = 0;
      p.points.forEach((pt, kk) => {
        const phi = 4 * Math.PI * pt.frequency * tau;
        const c = Math.cos(phi);
        const s = Math.sin(phi);
        const g = g0[kk] as Complex;
        const re = pt.gamma.re * c - pt.gamma.im * s - g.re;
        const im = pt.gamma.re * s + pt.gamma.im * c - g.im;
        y[2 * kk] = re;
        y[2 * kk + 1] = im;
        yy += re * re + im * im;
      });
      const w = cols.map((c) => dot(c, y));
      const du = inv.map((row) => dot(row, w));
      out.push({ tau, ub: ub.map((v, j) => v + (du[j] as number)), cost: yy - dot(w, du) });
    }
    const minima = out.filter((o, i) => {
      const before = out[i - 1];
      const after = out[i + 1];
      return (!before || o.cost <= before.cost) && (!after || o.cost < after.cost);
    });
    return minima.sort((x, z) => x.cost - z.cost);
  };
  const solutions: Solved[] = [];
  const tried: number[] = [];
  let iterations = 0;
  const pc = p.params.length;
  const dof = Math.max(1, 2 * p.points.length - pc);
  const reach = 3 * pc * s2Floor * fQuantile(AMBIGUOUS_LEVEL, pc, dof);
  // Each start screened (on at most SCREEN_POINTS of the frequencies, evenly taken: the screen
  // only ranks the starts), the ones within reach of the best run on to convergence on all.
  const every = Math.max(1, Math.ceil(p.points.length / SCREEN_POINTS));
  const thin: Problem =
    every === 1
      ? p
      : {
          ...p,
          points: p.points.filter((_, i) => i % every === 0),
          freqs: p.freqs.filter((_, i) => i % every === 0),
        };
  const scale = thin.points.length / p.points.length;
  const round = (starts: readonly { ub: readonly number[]; tau: number }[]): void => {
    const screened: Solved[] = [];
    for (const s0 of starts) {
      tried.push(s0.tau);
      const s = levenbergMarquardt(thin, reg, PLANE_SCREEN, progress, assemble(s0.ub, s0.tau));
      iterations += s.iterations;
      if (s.r.every(Number.isFinite)) screened.push(s);
    }
    screened.sort((x, z) => costOfSolved(x, reg) - costOfSolved(z, reg));
    const cost = (s: Solved): number => costOfSolved(s, reg) / scale;
    const all = [...solutions.map((s) => costOfSolved(s, reg)), ...screened.map(cost)];
    const c0 = Math.min(...all);
    for (const s of screened.slice(0, PLANE_FINISH)) {
      if (cost(s) > c0 + Math.max(reach, PLANE_KEEP * c0)) continue;
      const done = levenbergMarquardt(p, reg, maxIt, progress, s.u);
      iterations += done.iterations;
      if (done.r.every(Number.isFinite)) solutions.push(done);
    }
  };
  const far = (tau: number): boolean => tried.every((t) => Math.abs(t - tau) > 2 * step);
  const ub0 = boardIdx.map((i) => start[i] as number);
  const first: { ub: readonly number[]; tau: number }[] = [
    { ub: ub0, tau: (start[k] as number) * prior },
  ];
  const phase = planeFromPhase(p.model, p.points);
  if (Math.abs(phase) <= range && Math.abs(phase - (first[0]?.tau ?? 0)) > 2 * step)
    first.push({ ub: ub0, tau: phase });
  for (const m of profile(ub0).slice(0, PLANE_STARTS))
    if (first.every((s) => Math.abs(s.tau - m.tau) > 2 * step)) first.push(m);
  round(first);
  const best0 = solutions.reduce<Solved | null>(
    (b, s) => (b === null || costOfSolved(s, reg) < costOfSolved(b, reg) ? s : b),
    null,
  );
  if (best0) {
    const ub1 = boardIdx.map((i) => best0.u[i] as number);
    round(
      profile(ub1)
        .slice(0, PLANE_STARTS)
        .filter((m) => far(m.tau)),
    );
  }
  solutions.sort((x, z) => costOfSolved(x, reg) - costOfSolved(z, reg));
  const distinct: Solved[] = [];
  for (const s of solutions) {
    const same = distinct.some((d) => d.u.every((v, i) => Math.abs(v - (s.u[i] as number)) < 1e-4));
    if (!same) distinct.push(s);
  }
  return { solutions: distinct, iterations };
}

/**
 * Fit one set of free parameters: the identifiability check at the start (the geometry of the
 * columns does not depend on the plane: it rotates every column of a frequency alike), then
 * Levenberg-Marquardt, with the global plane search (planeSearch) when the plane is free; then
 * the least resolved parameter fixed and the rest fitted again from where they were. The
 * covariance takes s^2 as the larger of RSS / (2N - P) and the floor's variance, and scales it
 * by the residual's correlation inflation kappa when the scatter sets s^2.
 */
function fitSet(
  model: BuildModel,
  points: readonly MeasuredReflection[],
  freqs: readonly number[],
  free: readonly DriftParameter[],
  o: SetOptions,
): SetFit {
  const startU = (
    params: readonly DriftParameter[],
    from?: Readonly<Record<string, number>>,
  ): number[] =>
    params.map((q) => {
      const v = from?.[q.id];
      return v !== undefined && Number.isFinite(v) ? v / q.prior : 0;
    });
  const full: Problem = { model, params: free, points, freqs };
  const j0 = jacobian(full, startU(free, o.seed));
  const { picked, dropped } = pivotedSelection(j0, o.cap);
  const status = new Map<string, Status>();
  for (const d of dropped) {
    const q = free[d.j] as DriftParameter;
    const partner = d.partner !== null ? (free[d.partner] as DriftParameter).id : undefined;
    status.set(q.id, {
      status: d.why === 'no-effect' ? 'no-effect' : 'unresolved',
      drift: 0,
      sigma: null,
      ...(partner !== undefined ? { partner, correlation: d.cosine } : {}),
      ...(d.why === 'no-effect' ? {} : { why: d.why === 'cap' ? 'too-many' : 'like-another' }),
      ...(d.why === 'unresolved' && Math.abs(d.cosine) < LIKE_ONE ? { combination: true } : {}),
    });
  }
  let active: DriftParameter[] = picked
    .slice()
    .sort((a, b) => a - b)
    .map((j) => free[j] as DriftParameter);
  let iterations = 0;
  let pass = 0;
  const passes: Pass[] = [];
  let others: Solution[] = [];
  let solved: Solved | null = null;
  let cov: number[][] | null = null;
  let s2 = o.s2Floor;
  let kappa = 1;
  let prev: Record<string, number> | null = null;
  for (let guard = 0; active.length > 0 && guard <= free.length + 1; guard++) {
    pass += 1;
    const thisPass = pass;
    const problem: Problem = { model, params: active, points, freqs };
    const zero = jacobian(problem, new Array<number>(active.length).fill(0));
    const norms2 = zero.map((c) => dot(c, c));
    const floor2 = 1e-18 * Math.max(0, ...norms2);
    const reg = norms2.map((n2) => MU * MU * Math.max(n2, floor2));
    const progress = (iteration: number, rms: number): void =>
      o.onProgress?.({ pass: thisPass, iteration, rms });
    const hasPlane = active.some((q) => q.kind === 'plane');
    let best: Solved;
    if (prev === null && hasPlane) {
      const s = planeSearch(
        problem,
        reg,
        o.maxIt,
        startU(active, o.seed),
        o.planeRange,
        o.s2Floor,
        progress,
      );
      iterations += s.iterations;
      const first = s.solutions[0];
      if (!first) break;
      best = first;
      const act = active;
      others = s.solutions.slice(1).map((x) => ({ active: act, u: x.u, rss: dot(x.r, x.r) }));
    } else {
      best = levenbergMarquardt(problem, reg, o.maxIt, progress, startU(active, prev ?? o.seed));
      iterations += best.iterations;
    }
    solved = best;
    const jc = best.cols;
    const a = jc.map((ci) => jc.map((cj) => dot(ci, cj)));
    for (let i = 0; i < a.length; i++)
      (a[i] as number[])[i] = ((a[i] as number[])[i] as number) + (reg[i] as number);
    const dof = 2 * points.length - active.length;
    const v = varianceOf(best.r, dof, o.s2Floor);
    s2 = v.s2;
    kappa = v.kappa;
    const inv = inverse(a);
    cov = inv ? inv.map((row) => row.map((x) => x * s2 * kappa)) : null;
    passes.push({ active, u: best.u, rss: dot(best.r, best.r), cov, dof, kappa });
    // The parameter least resolved by the data, if any, is fixed and the rest fitted again: its
    // uncertainty UNRESOLVED_SIGMA of its prior or more; the plane's, of an eighth of a period at
    // the highest frequency (its prior is a scale, not a bound: the bench's plane may be far off).
    // What the data resolves is judged on its own scatter (s^2 = RSS / (2N - P), times kappa):
    // against the floor a clean measurement would set parameters aside and the rest would take
    // their drift, not exact. The stated uncertainty and every decision after take the floor.
    const scatterScale = (dot(best.r, best.r) / Math.max(1, dof)) * kappa;
    const own = inv ? inv.map((row) => row.map((x) => x * scatterScale)) : null;
    let worst = -1;
    let worstRatio = 1;
    active.forEach((q, i) => {
      const s = own ? Math.sqrt(Math.max(0, (own[i] as number[])[i] as number)) : Infinity;
      const limit =
        q.kind === 'plane'
          ? UNRESOLVED_SIGMA / (4 * Math.max(...freqs) * q.prior)
          : UNRESOLVED_SIGMA;
      if (s / limit >= worstRatio) {
        worstRatio = s / limit;
        worst = i;
      }
    });
    if (worst < 0) break;
    const q = active[worst] as DriftParameter;
    let partner: string | undefined;
    let rho = 0;
    if (cov) {
      const cv = cov;
      active.forEach((other, i) => {
        if (i === worst) return;
        const c =
          ((cv[worst] as number[])[i] as number) /
          Math.sqrt(
            ((cv[worst] as number[])[worst] as number) * ((cv[i] as number[])[i] as number),
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
    const sol: Record<string, number> = {};
    active.forEach((p, i) => {
      if (i !== worst) sol[p.id] = (best.u[i] as number) * p.prior;
    });
    active = active.filter((_, i) => i !== worst);
    prev = sol;
    solved = null;
    cov = null;
  }
  return { status, active, solved, cov, iterations, passes, others, s2, kappa };
}

/** The drifts of a solution, by id. */
function driftsOfSolution(s: Solution): Record<string, number> {
  const out: Record<string, number> = {};
  s.active.forEach((q, i) => {
    out[q.id] = (s.u[i] as number) * q.prior;
  });
  return out;
}

/**
 * The corners of a pass's joint confidence region (CORNER_LEVEL) along its principal axes: the
 * drifts plus and minus sqrt(P F(P, dof / kappa; level) lambda) v for each eigenpair of the
 * covariance of the scaled parameters. The retune is checked against each.
 */
function regionCorners(pass: Pass): Record<string, number>[] {
  if (!pass.cov || pass.active.length === 0) return [];
  const pc = pass.active.length;
  const scale = Math.sqrt(pc * fQuantile(CORNER_LEVEL, pc, Math.max(1, pass.dof / pass.kappa)));
  const { values, vectors } = symmetricEigen(pass.cov);
  const out: Record<string, number>[] = [];
  values.forEach((lambda, k) => {
    if (!(lambda > 0)) return;
    const v = vectors[k] as number[];
    for (const sign of [1, -1]) {
      const u = pass.u.map((x, i) => x + sign * scale * Math.sqrt(lambda) * (v[i] as number));
      out.push(driftsOfSolution({ active: pass.active, u, rss: 0 }));
    }
  });
  return out;
}

/**
 * Fit what moved: the drifts of the free parameters that bring the network as built closest to
 * the measured reflection coefficients (see the file comment for the weighting, the
 * identifiability rules and the refusals). With the reference plane free the plane is searched
 * globally, and a second minimum the data cannot reject makes the fit ambiguous. With the plane not
 * free (and, with a microstrip in the network, the laminate not free), the same parameters are
 * fitted again with them added, silently, and compared (see checkFit). The other explanations the
 * data allows are kept for the retune's check (BuildFit.alternatives).
 */
export function fitBuild(
  model: BuildModel,
  measured: readonly MeasuredReflection[],
  options: BuildFitOptions = {},
): BuildFitOutcome {
  const all = driftParameters(model);
  const freeIds = new Set(options.free ?? all.filter((q) => q.freeByDefault).map((q) => q.id));
  const free = all.filter((q) => freeIds.has(q.id));
  const usable = usableMeasurement(model, measured);
  // In order of frequency: the correlation of the residual is taken between neighbours.
  const points = [...usable.points].sort((a, b) => a.frequency - b.frequency);
  const leftOut = usable.leftOut;
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
  const maxIt = options.maxIterations ?? 60;
  const accuracy = accuracyOf(options.accuracy);
  const scatter = noiseFloor(points);
  const floorUsed = Math.max(Number.isFinite(scatter) ? scatter : 0, accuracy);
  const range = planeRange(freqs);
  const base: Omit<SetOptions, 'seed' | 'onProgress'> = {
    cap,
    maxIt,
    s2Floor: (floorUsed * floorUsed) / 2,
    planeRange: range,
  };
  const main = fitSet(model, points, freqs, free, {
    ...base,
    ...(options.onProgress ? { onProgress: options.onProgress } : {}),
  });
  const { status, active, solved, cov } = main;

  const drifts: Record<string, number> = {};
  const sigmas: Record<string, number> = {};
  const correlated: { a: string; b: string; rho: number; either?: true }[] = [];
  const pairs: { a: string; b: string; rho: number }[] = [];
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
      if (sigma !== null) sigmas[q.id] = sigma;
      let partner: string | undefined;
      let rho = 0;
      if (cov) {
        const cv = cov;
        active.forEach((other, k) => {
          if (k === i) return;
          const c =
            ((cv[i] as number[])[k] as number) /
            Math.sqrt(((cv[i] as number[])[i] as number) * ((cv[k] as number[])[k] as number));
          if (Math.abs(c) > Math.abs(rho)) {
            rho = c;
            partner = other.id;
          }
          if (k > i && Math.abs(c) > CORRELATED) pairs.push({ a: q.id, b: other.id, rho: c });
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
  const rssBest = dot(after, after);
  const dofMain = 2 * points.length - active.length;
  // The joint region of the fit: a solution with RSS within this of the best is not rejected.
  const region = (level: number, k: number, s2: number, kappa: number, dof: number): number =>
    k * s2 * kappa * fQuantile(level, Math.max(1, k), Math.max(1, dof / kappa));
  const inside = (rss: number): boolean =>
    rss - rssBest <=
    region(AMBIGUOUS_LEVEL, Math.max(1, active.length), main.s2, main.kappa, dofMain);
  // Two solutions lead to different conclusions when a drift differs by more than twice its
  // uncertainty (a parameter without one: by a twentieth of its prior).
  const differs = (other: Readonly<Record<string, number>>): boolean =>
    all.some((q) => {
      const a = drifts[q.id] ?? 0;
      const b = other[q.id] ?? 0;
      const s = sigmas[q.id];
      return Math.abs(a - b) > (s !== undefined ? MOVED_SIGMAS * s : 0.05 * q.prior);
    });
  const alternatives: Record<string, number>[] = [];
  // A second minimum of the plane search the data cannot reject: the fit is ambiguous.
  const ambiguous: { drifts: Record<string, number>; rms: number }[] = [];
  for (const other of main.others) {
    const d = driftsOfSolution(other);
    if (inside(other.rss) && differs(d)) {
      ambiguous.push({ drifts: d, rms: Math.sqrt(other.rss / points.length) });
      alternatives.push(d);
    }
  }
  // Every pass (the parameters set aside later still free) and the corners of its region.
  main.passes.forEach((pass, i) => {
    if (i < main.passes.length - 1) alternatives.push(driftsOfSolution(pass));
    alternatives.push(...regionCorners(pass));
  });
  // "X or Y": a parameter set aside for its uncertainty, correlated above CORRELATED with one
  // fitted: the data fixes their joint effect, not which moved. The partner's drift is not a
  // finding (orWith), and the fit with the two swapped is another explanation for the retune.
  const either = new Map<string, string>();
  for (const q of all) {
    const st = status.get(q.id);
    if (st?.status !== 'unresolved' || st.why !== 'uncertain' || st.partner === undefined) continue;
    if (!(Math.abs(st.correlation ?? 0) > CORRELATED)) continue;
    const kept = status.get(st.partner);
    if (kept?.status !== 'fitted') continue;
    either.set(st.partner, q.id);
    correlated.push({ a: st.partner, b: q.id, rho: st.correlation ?? 0, either: true });
    const swapFree = free.filter((x) => x.id !== st.partner);
    const seed: Record<string, number> = { ...drifts };
    delete seed[st.partner];
    const swap = fitSet(model, points, freqs, swapFree, { ...base, seed });
    if (swap.solved && inside(dot(swap.solved.r, swap.solved.r))) {
      const last = swap.passes[swap.passes.length - 1];
      if (last) alternatives.push(driftsOfSolution(last));
    }
  }
  for (const [keptId, droppedId] of either) {
    const st = status.get(keptId);
    if (st) status.set(keptId, { ...st, orWith: droppedId });
  }

  // Another explanation not free (the plane; the laminate with a microstrip in the network):
  // fitted silently with it added, and compared.
  const nested = (group: readonly DriftParameter[]): NestedCheck | undefined => {
    if (group.length === 0 || active.length + group.length > cap) return undefined;
    const alt = fitSet(model, points, freqs, [...free, ...group], { ...base, seed: drifts });
    if (!alt.solved) return undefined;
    const added = alt.active.filter((q) => group.some((g) => g.id === q.id));
    if (added.length === 0) {
      // The data cannot resolve it at all: for the plane (no bound but the range) the drifts are
      // as uncertain as it is; the fit is not trusted (checkFit). The laminate is bounded by its
      // typical tolerance, which the data then shows not to matter.
      const rss1 = dot(alt.solved.r, alt.solved.r);
      return {
        ids: group.map((q) => q.id),
        drifts: {},
        sigmas: {},
        rmsWith: rmsOf(alt.solved.r),
        rssWith: rss1,
        f: 0,
        p: 1,
        extra: group.length,
        dof: 2 * points.length - alt.active.length,
        kappa: alt.kappa,
        better: false,
        moved: [],
        ambiguous: false,
        unresolved: group.some((q) => q.kind === 'plane'),
      };
    }
    const rss1 = dot(alt.solved.r, alt.solved.r);
    const dof1 = 2 * points.length - alt.active.length;
    const extra = Math.max(1, alt.active.length - active.length);
    const f = Math.max(0, rssBest - rss1) / extra / (alt.s2 * alt.kappa);
    const p = fTestP(f, extra, Math.max(1, dof1 / alt.kappa));
    const altDrifts: Record<string, number> = {};
    const altSigmas: Record<string, number | null> = {};
    alt.active.forEach((q, i) => {
      altDrifts[q.id] = (alt.solved?.u[i] as number) * q.prior;
      altSigmas[q.id] = alt.cov
        ? Math.sqrt(Math.max(0, (alt.cov[i] as number[])[i] as number)) * q.prior
        : null;
    });
    const moved: { id: string; from: number; to: number; sigma: number | null }[] = [];
    for (const q of alt.active) {
      if (group.some((g) => g.id === q.id)) continue;
      const to = altDrifts[q.id] as number;
      const from = drifts[q.id] ?? 0;
      const sMain = sigmas[q.id];
      const sAlt = altSigmas[q.id] ?? null;
      const s = movedSigma(sMain ?? null, sAlt);
      if (s !== null && Math.abs(to - from) > MOVED_SIGMAS * s)
        moved.push({ id: q.id, from, to, sigma: s });
    }
    const significant = added.some((q) => {
      const s = altSigmas[q.id];
      return s !== null && s !== undefined && Math.abs(altDrifts[q.id] as number) >= 2 * s;
    });
    const board: Record<string, number> = {};
    for (const [id, v] of Object.entries(altDrifts)) if (id !== 'plane') board[id] = v;
    const last = alt.passes[alt.passes.length - 1];
    if (last) for (const c of regionCorners(last)) alternatives.push(c);
    alternatives.push(board);
    return {
      ids: added.map((q) => q.id),
      drifts: altDrifts,
      sigmas: altSigmas,
      rmsWith: rmsOf(alt.solved.r),
      rssWith: rss1,
      f,
      p,
      extra,
      dof: dof1,
      kappa: alt.kappa,
      better: p < PLANE_P && significant,
      moved,
      ambiguous: alt.others.some(
        (x) =>
          x.rss - rss1 <=
          region(AMBIGUOUS_LEVEL, Math.max(1, alt.active.length), alt.s2, alt.kappa, dof1),
      ),
    };
  };
  const planeParam = all.find((q) => q.kind === 'plane');
  const planeFree = freeIds.has('plane');
  let plane: PlaneCheck | undefined;
  let laminate: NestedCheck | undefined;
  if (options.planeCheck !== false) {
    if (planeParam && !planeFree) {
      const n = nested([planeParam]);
      if (n) {
        const tau = n.drifts.plane ?? 0;
        plane = { ...n, drift: tau, sigma: n.sigmas.plane ?? null };
      }
    }
    // The laminate: with a microstrip in the network, er and h move its delay as a plane would.
    const strip = model.base.some((el) => el.kind === 'microstrip' && isUsableStackup(el.stackup));
    const lam = all.filter((q) => (q.kind === 'er' || q.kind === 'h') && !freeIds.has(q.id));
    if (
      strip &&
      lam.length > 0 &&
      !all.some((q) => (q.kind === 'er' || q.kind === 'h') && freeIds.has(q.id))
    )
      laminate = nested(lam);
    if (plane && laminate)
      plane = {
        ...plane,
        laminateToo:
          laminate.better ||
          laminate.rssWith <=
            plane.rssWith + region(AMBIGUOUS_LEVEL, 1, main.s2, main.kappa, dofMain),
      };
  }
  // The plane (and the laminate) not free is not known to be none: the bench decides it. Each
  // drift's stated uncertainty is the larger of the fit's and the fit's with it added, so the ±
  // in the table covers what the data cannot tell about them.
  for (const n of [plane, laminate]) {
    if (!n) continue;
    for (const [id, s] of status) {
      const wide = n.sigmas[id];
      if (s.status === 'fitted' && s.sigma !== null && wide != null && wide > s.sigma)
        status.set(id, { ...s, sigma: wide });
    }
  }
  const parameters: FittedParameter[] = all.map((q) => ({
    ...q,
    ...(status.get(q.id) ?? { status: 'not-free' as const, drift: 0, sigma: null }),
  }));
  // A fitted pair is ambiguous ("X or Y") when either is uncertain by more than AMBIGUOUS_PAIR
  // of its typical drift; else each is resolved, and they merely move together.
  const together: { a: string; b: string; rho: number }[] = [];
  const loose = (id: string): boolean => {
    const p = parameters.find((q) => q.id === id);
    return !p || p.sigma === null || p.sigma > AMBIGUOUS_PAIR * p.prior;
  };
  for (const pr of pairs) (loose(pr.a) || loose(pr.b) ? correlated : together).push(pr);
  const rmsAfter = rmsOf(after);
  return {
    ok: true,
    fit: {
      parameters,
      drifts,
      used: points.length,
      leftOut,
      rmsBefore: rmsOf(before),
      rmsAfter,
      worstBefore: worstPair(before),
      worstAfter: worstPair(after),
      dof: dofMain,
      kappa: main.kappa,
      condition,
      iterations: main.iterations,
      correlated,
      together,
      alternatives,
      planeRange: range,
      check: checkFit(model, points, parameters, rmsAfter, {
        accuracy,
        ...(plane ? { plane } : {}),
        ...(laminate ? { laminate } : {}),
        ambiguous,
      }),
    },
  };
}

/**
 * The uncertainty a moved drift is judged against: the larger of the two fits' (the one with the
 * explanation added: what the drift is known to with it unknown). Against the smaller, the fit
 * without the plane, a plane of one sigma moves the sample's pads by 12 of their sigmas (the plane
 * and the series C pads correlate 0.9995 over 0.7 to 1.3 GHz): most noisy measurements with no
 * plane at all would be called untrusted. Against the larger, a move beyond 2 sigma means the
 * explanation is significant at about 5 % and changes the conclusion by more than its own
 * uncertainty; the table states that larger uncertainty.
 */
function movedSigma(main: number | null, alt: number | null): number | null {
  if (main === null) return alt;
  if (alt === null) return main;
  return Math.max(main, alt);
}

/* ------------------------------------------------------- plausibility */

/** The model explains the data when the residual RMS is at most this many noise floors. */
export const EXPLAINED_RATIO = 3;
/** Above this many noise floors the model does not explain the board: the fit is not acted on. */
export const UNEXPLAINED_RATIO = 10;
/**
 * The accuracy of a lab VNA after a careful calibration, |ΔΓ| RMS (-54 dB): the smallest floor
 * the check takes. A smoothed or averaged trace can scatter less than that; its residual is not
 * held against a floor it cannot reach.
 */
export const MIN_NOISE_FLOOR = 0.002;
/**
 * The accuracy of a hobby VNA such as a NanoVNA, |ΔΓ| RMS (-34 dB): its directivity and source
 * match after an SOL calibration leave a smooth error of this size, which the scatter does not see.
 */
export const HOBBY_VNA_ACCURACY = 0.02;
/** A fitted drift larger than this many typical drifts is not one of a board built as designed. */
export const IMPLAUSIBLE_PRIORS = 3;
/**
 * A drift past a physical bound (a negative pad or trace, a value scaled below 5 %) by less than
 * this many of its standard uncertainties, plus a thousandth of its prior, is physical: the data
 * puts it at the bound, within its uncertainty.
 */
export const PHYSICAL_SIGMAS = 2;

/** The instrument accuracy taken: the one given when it is a positive number, else a lab VNA's. */
function accuracyOf(a: number | undefined): number {
  return a !== undefined && a > 0 && Number.isFinite(a) ? a : MIN_NOISE_FLOOR;
}

/**
 * Another explanation fitted silently and compared with the fit (the reference plane, or the
 * laminate's er and h): the same free parameters with it added.
 */
export interface NestedCheck {
  /** The parameters it adds that the fit took (ids). */
  readonly ids: readonly string[];
  /** Every drift of that fit and its standard uncertainty (null when not resolved). */
  readonly drifts: Readonly<Record<string, number>>;
  readonly sigmas: Readonly<Record<string, number | null>>;
  /** The residual RMS and sum of squares with it. */
  readonly rmsWith: number;
  readonly rssWith: number;
  /** The F statistic of the parameters it adds and its p-value (s^2 against the floor, kappa). */
  readonly f: number;
  readonly p: number;
  /** The F-test's degrees of freedom: the parameters added, and 2N - P with them (before kappa). */
  readonly extra: number;
  readonly dof: number;
  /** The residual's correlation inflation with it. */
  readonly kappa: number;
  /**
   * p below PLANE_P and a drift it adds at least twice its uncertainty: it explains the data
   * better, by more than chance and by more than its own uncertainty; the fit without it is not
   * trusted.
   */
  readonly better: boolean;
  /**
   * Drifts that move by more than MOVED_SIGMAS of their uncertainty (the smaller of the two fits')
   * when it is added: the conclusion depends on it, the fit without it is not trusted.
   */
  readonly moved: readonly {
    readonly id: string;
    readonly from: number;
    readonly to: number;
    readonly sigma: number | null;
  }[];
  /** Its own fit has a second minimum the data cannot reject (the plane search). */
  readonly ambiguous: boolean;
  /**
   * The plane, added, is not resolved by the data at all (its uncertainty an eighth of a period
   * at the highest frequency or more): the drifts are as uncertain as it is, not trusted.
   */
  readonly unresolved?: boolean;
}

/** The reference plane fitted silently, when it was not free: does it explain the data better? */
export interface PlaneCheck extends NestedCheck {
  /** The plane the data puts, s, and its standard uncertainty. */
  readonly drift: number;
  readonly sigma: number | null;
  /** With a microstrip in the network: the laminate (er, h) explains the data as well. */
  readonly laminateToo?: boolean;
}

/** What a senior engineer checks before trusting a fit (see checkFit). */
export interface FitCheck {
  /** The measurement's noise floor, |ΔΓ| RMS per point, from its point-to-point scatter; NaN when it cannot be told. */
  readonly noiseFloor: number;
  /** The floor the residual is held against: the larger of the scatter and the instrument's accuracy. */
  readonly floorUsed: number;
  /** Where the floor comes from: the scatter, or the instrument's accuracy (the larger). */
  readonly floorFrom: 'scatter' | 'accuracy';
  /** The instrument's accuracy taken, |ΔΓ| RMS. */
  readonly accuracy: number;
  /** The residual RMS over the floor used. */
  readonly residualRatio: number;
  /**
   * 'noise': the residual is noise (up to EXPLAINED_RATIO floors); 'above': the model explains
   * most of the board but leaves a pattern (up to UNEXPLAINED_RATIO); 'unexplained': it does not
   * explain this board (the calibration plane, the file, the design or an assembly fault).
   */
  readonly residual: 'noise' | 'above' | 'unexplained';
  /**
   * Fitted drifts that are not plausible: several typical drifts ('large'), past what is
   * physical by more than PHYSICAL_SIGMAS of their uncertainty ('unphysical'), or a reference
   * plane beyond the range the fit takes ('range'). The reference plane belongs to the bench,
   * not to the board: it is never 'large'.
   */
  readonly implausible: readonly {
    readonly id: string;
    readonly why: 'large' | 'unphysical' | 'range';
  }[];
  /** The design frequency lies outside the measured frequencies. */
  readonly frequencyOutside: boolean;
  /** With the plane not free: the same fit with the plane, compared. */
  readonly plane?: PlaneCheck;
  /** With a microstrip in the network and er, h not free: the same fit with them, compared. */
  readonly laminate?: NestedCheck;
  /**
   * Other minima of the plane search the data cannot reject (inside the AMBIGUOUS_LEVEL region)
   * that lead to other drifts: the band is too narrow to tell a plane from part drift.
   */
  readonly ambiguous: readonly {
    readonly drifts: Readonly<Record<string, number>>;
    readonly rms: number;
  }[];
  /** No parameter is resolved by the data: every one was set aside. */
  readonly noneFitted: boolean;
  /**
   * The residual at the floor ('noise': a residual above it leaves a pattern the model does not
   * explain, and the drifts are biased by it by an unknown amount), a drift fitted, every drift
   * plausible, the design frequency measured, no second minimum, and no plane or laminate that
   * explains the data better, moves a drift, or (the plane) cannot be resolved: the fit can be
   * acted on.
   */
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
 * The checks of a fit: the residual against the floor (the larger of the noise floor from the
 * scatter and the instrument's accuracy: a model that explains the board leaves noise and the
 * calibration's error; one that does not leaves a pattern several times that: the calibration
 * plane, the file, the design or an assembly fault), each fitted drift against its typical size
 * and against what is physical (within PHYSICAL_SIGMAS of its uncertainty of a bound is physical;
 * the reference plane against MAX_PLANE only: it is the bench's), the design frequency against the
 * measured span, a second minimum the data cannot reject, and, when given, whether the plane or
 * the laminate explains the data better or moves a drift (decided by fitBuild).
 */
export function checkFit(
  model: BuildModel,
  points: readonly MeasuredReflection[],
  parameters: readonly FittedParameter[],
  rmsAfter: number,
  extra: {
    readonly accuracy?: number;
    readonly plane?: PlaneCheck;
    readonly laminate?: NestedCheck;
    readonly ambiguous?: FitCheck['ambiguous'];
  } = {},
): FitCheck {
  const floor = noiseFloor(points);
  const accuracy = accuracyOf(extra.accuracy);
  const scatter = Number.isFinite(floor) ? floor : 0;
  const floorUsed = Math.max(scatter, accuracy);
  const residualRatio = rmsAfter / floorUsed;
  const residual =
    residualRatio <= EXPLAINED_RATIO
      ? 'noise'
      : residualRatio <= UNEXPLAINED_RATIO
        ? 'above'
        : 'unexplained';
  const implausible: { id: string; why: 'large' | 'unphysical' | 'range' }[] = [];
  for (const q of parameters) {
    if (q.status !== 'fitted') continue;
    if (q.kind === 'plane') {
      if (Math.abs(q.drift) > MAX_PLANE * (1 + 1e-9)) implausible.push({ id: q.id, why: 'range' });
      continue;
    }
    // How far past its physical bound, in the drift's unit: a relative drift's factor below
    // MIN_FACTOR, an absolute one's quantity (pad, trace) below none.
    const past = q.relative ? MIN_FACTOR - (1 + q.drift) : -(q.nominal + q.drift);
    const allowed = PHYSICAL_SIGMAS * (q.sigma ?? 0) + 1e-3 * q.prior;
    if (past > allowed) implausible.push({ id: q.id, why: 'unphysical' });
    else if (Math.abs(q.drift) > IMPLAUSIBLE_PRIORS * q.prior)
      implausible.push({ id: q.id, why: 'large' });
  }
  const fs = points.map((p) => p.frequency);
  const lo = Math.min(...fs);
  const hi = Math.max(...fs);
  const frequencyOutside =
    fs.length > 0 && (model.frequency < lo * (1 - 1e-9) || model.frequency > hi * (1 + 1e-9));
  const ambiguous = extra.ambiguous ?? [];
  const fitted = parameters.some((q) => q.status === 'fitted');
  const against = (n: NestedCheck | undefined): boolean =>
    n !== undefined && (n.better || n.moved.length > 0 || n.unresolved === true);
  return {
    noiseFloor: floor,
    floorUsed,
    floorFrom: scatter > accuracy ? 'scatter' : 'accuracy',
    accuracy,
    residualRatio,
    residual,
    implausible,
    frequencyOutside,
    ...(extra.plane ? { plane: extra.plane } : {}),
    ...(extra.laminate ? { laminate: extra.laminate } : {}),
    ambiguous,
    noneFitted: !fitted,
    trusted:
      residual === 'noise' &&
      fitted &&
      implausible.length === 0 &&
      !frequencyOutside &&
      ambiguous.length === 0 &&
      !against(extra.plane) &&
      !against(extra.laminate),
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
  /**
   * The other explanations of the measurement the data allows (BuildFit.alternatives): a change
   * is suggested only when it leaves the board no worse under every one of them than it is.
   */
  readonly alternatives?: readonly Drifts[];
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
  /**
   * With alternatives: the worst VSWR of the change under the explanation that suits it least,
   * and whether it is inside the target under every explanation.
   */
  readonly worstAlternative?: number;
  readonly insideAll?: boolean;
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
  /** No change of the parts in reach does better than the board as it is: no suggestion. */
  readonly noImprovement?: boolean;
  /**
   * The best change makes the board worse under another explanation the data allows, and no
   * single change is safe under all: no suggestion (how many explanations it was checked against).
   */
  readonly notRobust?: { readonly explanations: number };
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
): (replace: ReadonlyMap<number, Element>, bound?: number) => Worst {
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
      // The board's around it stays: the via, the trace and a fitted pad drift.
      const board = 'board' in b ? b.board : undefined;
      const pd = drifts[`pad:${i}`];
      const pad = pd !== undefined && Number.isFinite(pd) ? Math.max(0, pd) : 0;
      return {
        kind: 'part',
        orientation: to.orientation,
        part: to.part,
        ...(board ? { board } : {}),
        ...(pad > 0 ? { drift: { pad } } : {}),
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
  const gammaAt = (zin: Complex): Complex =>
    target
      ? cdiv(csub(zin, target), cadd(zin, complex(target.re, -target.im)))
      : gammaOfZ(zin, model.z0);
  // The band in order of the board's own VSWR, worst first: a retune that is no better than a
  // bound is usually told at the first few frequencies.
  const order = band
    .map((_, k) => ({ k, v: vswrOfGamma(gammaAt((into[k] as Complex[])[n] as Complex)) }))
    .sort((x, y) => (y.v > x.v ? 1 : y.v < x.v ? -1 : x.k - y.k) || x.k - y.k)
    .map((x) => x.k);
  return (replace, bound = Infinity) => {
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
    let worstK = -1;
    for (const k of order) {
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
      const v = vswrOfGamma(gammaAt(zin));
      // Ties go to the lowest frequency index, as a pass in band order gives.
      if (!(v <= worst.vswr) || (v === worst.vswr && k < worstK)) {
        worst = { vswr: v, frequency: band[k] as number };
        worstK = k;
      }
      // Past the bound: worse than it whatever the rest of the band gives.
      if (v > bound) return worst;
    }
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
 * change, then, when none of those does, over all their options); when no pair does,
 * coordinate descent over all changeable parts from the best of the board as it is, the best
 * single and the best pair.
 * That result is pruned (a change whose removal keeps it inside the target, or does not make it
 * worse, is dropped), and when more than two changes are left the pairs among those parts are
 * searched again over all their options. The suggestion is the fewest changes that reach the
 * target (ties to the lower worst VSWR); when none does, the lowest worst VSWR found, and only
 * when it is lower than the board's as it is (else no suggestion and noImprovement). Each
 * combination is judged with a bound: the band in order of the board's own worst first, given
 * up once past the best found (exact for every comparison it is used in). A heuristic, not a
 * proof that no better combination exists.
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
  const evalMap = (m: ReadonlyMap<number, Element>, bound?: number): Worst => {
    evaluated += 1;
    return evaluate(m, bound);
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
      const w = evalMap(m, single?.worst.vswr);
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
            const w = evalMap(m, best?.worst.vswr);
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
    const windowed = changeable.length > 3;
    let p = pairs(changeable, windowed);
    // No pair of the nearest values reaches the target: every pair over all the options of all
    // changeable parts before more changes (about 2,500 combinations for six parts).
    if (windowed && !p.inside) {
      const every = pairs(changeable, false);
      if (every.inside || (every.best && better(every.best.worst, p.best?.worst ?? null)))
        p = every;
    }
    pair = p.best;
    if (p.inside && p.best) suggestion = toSuggestion(p.best.m, p.best.worst);
  }
  if (!suggestion && changeable.length > 0) {
    // Coordinate descent over every changeable part, from the best of the board as it is, the
    // best single change and the best pair.
    let current = new Map<number, Element>();
    let currentWorst = before;
    if (single && better(single.worst, currentWorst)) {
      current = new Map(single.changes.map((c) => [c.index, c.to] as [number, Element]));
      currentWorst = single.worst;
    }
    if (pair && better(pair.worst, currentWorst)) {
      current = new Map(pair.m);
      currentWorst = pair.worst;
    }
    for (let sweep = 0; sweep < 8 && changeable.length > 2; sweep++) {
      let moved = false;
      for (const c of changeable) {
        for (const el of c.options) {
          const m = new Map(current);
          m.set(c.index, el);
          const w = evalMap(m, currentWorst.vswr);
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
        const w = evalMap(m, inside ? limit : best.worst.vswr + 1e-12);
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
  // Never a change that leaves the board no better than it is (worst VSWR over the band).
  let noImprovement = false;
  if (suggestion && !suggestion.inside && !(suggestion.worst.vswr < before.vswr * (1 - 1e-9))) {
    suggestion = null;
  }
  // Under every other explanation the data allows, the change must leave the board no worse than
  // it is; else the safest single change that improves the board as fitted, else none.
  let notRobust: { explanations: number } | undefined;
  const alts = options.alternatives ?? [];
  if (suggestion && suggestion.changes.length > 0 && alts.length > 0) {
    const evs = alts.map((d) => retuneEvaluator(model, d, band, target));
    const asIs = evs.map((ev) => ev(new Map()).vswr);
    // The worst VSWR under the explanation that suits the change least; null when one is worse.
    const robust = (m: ReadonlyMap<number, Element>): number | null => {
      let worst = 0;
      for (let i = 0; i < evs.length; i++) {
        evaluated += 1;
        const w = (evs[i] as (r: ReadonlyMap<number, Element>) => Worst)(m).vswr;
        if (!(w <= (asIs[i] as number) * (1 + 1e-9))) return null;
        worst = Math.max(worst, w);
      }
      return worst;
    };
    const mapOf = (s: RetuneSuggestion): Map<number, Element> =>
      new Map(s.changes.map((c) => [c.index, c.to]));
    let r = robust(mapOf(suggestion));
    if (r === null) {
      let pick: { s: RetuneSuggestion; r: number } | null = null;
      for (const c of changeable) {
        for (const el of c.options) {
          const m = new Map([[c.index, el]]);
          const w = evalMap(m);
          if (!(w.vswr < before.vswr * (1 - 1e-9))) continue;
          const rr = robust(m);
          if (rr === null) continue;
          const s = toSuggestion(m, w);
          // Inside under every explanation first, then the lowest worst VSWR as fitted.
          const key = (x: { s: RetuneSuggestion; r: number }): [number, number] => [
            x.r <= limit && x.s.inside ? 0 : 1,
            x.s.worst.vswr,
          ];
          const cand = { s, r: rr };
          if (
            !pick ||
            key(cand)[0] < key(pick)[0] ||
            (key(cand)[0] === key(pick)[0] && key(cand)[1] < key(pick)[1])
          )
            pick = cand;
        }
      }
      if (pick) {
        suggestion = pick.s;
        r = pick.r;
      } else {
        suggestion = null;
        notRobust = { explanations: alts.length };
      }
    }
    if (suggestion && r !== null)
      suggestion = {
        ...suggestion,
        worstAlternative: r,
        insideAll: suggestion.inside && r <= limit,
      };
  }
  if (!suggestion && changeable.length > 0 && !notRobust) noImprovement = true;
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
  return {
    before,
    single,
    suggestion,
    first,
    evaluated,
    ...(noImprovement ? { noImprovement: true } : {}),
    ...(notRobust ? { notRobust } : {}),
  };
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
