/**
 * The board in the network (phase D4 of docs/08-depth-plan.md): what the
 * printed circuit board adds to the parts of a matching network as built.
 *
 * - Pads: the capacitance of each package's two lands to ground, computed
 *   from the land size and the stackup (`landCapacitance` in line.ts: the
 *   parallel plate plus the fringing at the four edges, from the static
 *   microstrip model), replacing the fixed value of the package table. A
 *   package with no land size keeps the table value.
 * - Vias: every shunt part to ground reaches the ground plane through one or
 *   more vias, an inductance in series with the shunt branch. One via is
 *   modelled with the formula of M. E. Goldfarb and R. A. Pucel, "Modeling via
 *   hole grounds in microstrip", IEEE Microwave and Guided Wave Letters 1 (6),
 *   1991, pp. 135-137:
 *
 *     L = mu0 / (2 pi) [ h ln((h + sqrt(r^2 + h^2)) / r) + 1.5 (r - sqrt(r^2 + h^2)) ]
 *
 *   with h the via length (the dielectric height to the ground plane) and r
 *   the radius of the plated hole (half the drill diameter); stated for
 *   h < 0.03 lambda0. N vias in parallel are L / N: their mutual inductance is
 *   left out, so closely spaced vias are a little worse than this.
 * - Traces: the interconnect between two neighbouring lumped parts as a
 *   microstrip of a given length and width on the stackup, with dispersion and
 *   loss (line.ts), on the load side of the part it leads to. One length for
 *   every gap between two lumped parts; a gap next to a line, stub,
 *   microstrip or transformer gets none (those elements are their own
 *   interconnect), and neither does the first element: the load is taken as
 *   connected right at it.
 *
 * With the board enabled on a stackup the model cannot use (isUsableStackup)
 * nothing of the board goes in: no pads from the stackup, no vias, no traces.
 *
 * Not modelled: anything a field solver would see. No coupling between
 * traces, pads or parts; no discontinuity models (the step from a trace to a
 * pad, bends, tees, the via pad and antipad); no pad capacitance on an R or
 * RLC block (they have no package); no via on a shorted stub; the ground pad
 * of a shunt part is taken as shorted by its via.
 */
import { MICROSTRIP_RANGE, MU0, landCapacitance, microstripWidthAt } from './line.js';
import type { BoardParasitics, Element, MicrostripTrace } from './elements.js';
import {
  packageById,
  withPackages,
  type PackageParasitics,
  type PackageTable,
} from './realize/packages.js';
import {
  DEFAULT_STACKUP,
  isUsableStackup,
  normalizeStackup,
  stackupProblem,
  type Stackup,
} from './stackup.js';
import { formatEngineering } from './units.js';

/** The board settings of the application (Settings > Board). */
export interface BoardSettings {
  /** True: the network as built includes the board (pads from the stackup, vias, traces). */
  readonly enabled: boolean;
  readonly stackup: Stackup;
  /** Drill diameter of a via, m. */
  readonly viaDrill: number;
  /** Vias in parallel from each shunt part to ground. */
  readonly viasPerShunt: number;
  /** Length of the trace between two neighbouring lumped parts, m; 0 means not modelled. */
  readonly traceLength: number;
  /** Width of those traces, m; 0 means the width whose Z0 is the design's Z0 at the design frequency. */
  readonly traceWidth: number;
}

export const DEFAULT_BOARD: BoardSettings = {
  enabled: false,
  stackup: DEFAULT_STACKUP,
  viaDrill: 0.3e-3,
  viasPerShunt: 1,
  traceLength: 0,
  traceWidth: 0,
};

/** Board settings from stored or typed data, every unusable number replaced by the default. */
export function normalizeBoard(raw: unknown): BoardSettings {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_BOARD;
  const num = (v: unknown, fallback: number, ok: (x: number) => boolean): number =>
    typeof v === 'number' && Number.isFinite(v) && ok(v) ? v : fallback;
  return {
    enabled: r.enabled === true,
    stackup: normalizeStackup(r.stackup),
    viaDrill: num(r.viaDrill, d.viaDrill, (x) => x >= 1e-6 && x <= 0.01),
    viasPerShunt: num(
      r.viasPerShunt,
      d.viasPerShunt,
      (x) => Number.isInteger(x) && x >= 1 && x <= 100,
    ),
    traceLength: num(r.traceLength, d.traceLength, (x) => x >= 0 && x <= 1),
    traceWidth: num(r.traceWidth, d.traceWidth, (x) => x === 0 || (x >= 1e-6 && x <= 1)),
  };
}

/**
 * Goldfarb-Pucel inductance of one via of length h (the dielectric height)
 * and drill diameter d, both in metres, H. 0 for unusable input.
 */
export function viaInductance(h: number, drill: number): number {
  if (!(h > 0) || !(drill > 0) || !Number.isFinite(h) || !Number.isFinite(drill)) return 0;
  const r = drill / 2;
  const s = Math.sqrt(r * r + h * h);
  return (MU0 / (2 * Math.PI)) * (h * Math.log((h + s) / r) + 1.5 * (r - s));
}

/** The via inductance of a shunt part on this board: N vias in parallel, H. */
export function boardViaInductance(board: BoardSettings): number {
  return viaInductance(board.stackup.h, board.viaDrill) / Math.max(1, board.viasPerShunt);
}

/** Capacitance of both lands of a package to ground on the stackup, F; null without a land size. */
export function packagePadCapacitance(pkg: PackageParasitics, stackup: Stackup): number | null {
  if (!(pkg.padLength > 0) || !(pkg.padWidth > 0)) return null;
  return 2 * landCapacitance(stackup, pkg.padLength, pkg.padWidth);
}

/** What the trace width follows when it is 0: the design's Z0 at its frequency. */
export interface BoardContext {
  readonly z0: number;
  readonly frequency: number;
}

/** The width of the traces between parts, m; null when the design Z0 has no width on the stackup. */
export function boardTraceWidth(board: BoardSettings, ctx: BoardContext): number | null {
  if (board.traceWidth > 0) return board.traceWidth;
  return microstripWidthAt(board.stackup, ctx.z0, ctx.frequency);
}

/** The trace between two parts on this board, or null when none is modelled. */
export function boardTrace(board: BoardSettings, ctx: BoardContext): MicrostripTrace | null {
  if (!(board.traceLength > 0)) return null;
  const width = boardTraceWidth(board, ctx);
  return width === null ? null : { width, length: board.traceLength, stackup: board.stackup };
}

const isLumped = (el: Element | undefined): boolean =>
  el !== undefined && (el.kind === 'R' || el.kind === 'L' || el.kind === 'C' || el.kind === 'RLC');

/** True when the board settings put anything into the network. */
export function boardActive(board: BoardSettings): boolean {
  return board.enabled && isUsableStackup(board.stackup);
}

/**
 * The network as built: every element with its package resolved through the
 * table and, with the board enabled, its pads computed from the land size and
 * the stackup, a via under every shunt lumped part and a trace between every
 * two neighbouring lumped parts. With the board off this is `withPackages`.
 * Elements nothing applies to are returned as the same object.
 */
export function withBoard<T extends Element>(
  elements: readonly T[],
  table: PackageTable,
  board: BoardSettings,
  ctx: BoardContext,
): T[] {
  const packaged = withPackages(elements, table);
  if (!boardActive(board)) return packaged;
  const via = boardViaInductance(board);
  const trace = boardTrace(board, ctx);
  return packaged.map((el, i) => {
    if (!isLumped(el)) return el;
    let out = el;
    if ((el.kind === 'L' || el.kind === 'C') && el.package !== undefined) {
      const pkg = packageById(table, el.package);
      const pad = pkg ? packagePadCapacitance(pkg, board.stackup) : null;
      if (pad !== null) {
        out = { ...out, parasitics: { ...(el.parasitics ?? {}), pad } } as T;
      }
    }
    const extra: { -readonly [K in keyof BoardParasitics]: BoardParasitics[K] } = {};
    if ((el as { orientation?: string }).orientation === 'shunt' && via > 0) extra.via = via;
    if (trace && i > 0 && isLumped(packaged[i - 1])) extra.trace = trace;
    if (extra.via !== undefined || extra.trace !== undefined) out = { ...out, board: extra } as T;
    return out;
  });
}

/** True when withBoard would change anything: a part names a package, or the board is on. */
export function hasBoardOrPackages(elements: readonly Element[], board: BoardSettings): boolean {
  return (
    elements.some((el) => (el.kind === 'L' || el.kind === 'C') && el.package !== undefined) ||
    (boardActive(board) && elements.some((el) => isLumped(el)))
  );
}

const eng = (v: number, unit: string, digits = 3): string => formatEngineering(v, { unit, digits });

/** An inductance in nH whatever its size ("0.465 nH", "0.0823 nH"), as via data sheets give it. */
export function nanohenries(v: number): string {
  return `${Number((v * 1e9).toPrecision(3))} nH`;
}

/** True when a trace of this width on this stackup is inside the dispersion model's stated W/h range. */
function traceInRange(width: number, s: Stackup): boolean {
  const u = width / s.h;
  return u >= MICROSTRIP_RANGE.uMin && u <= MICROSTRIP_RANGE.uMax;
}

/** "h 1.6 mm, er 4.17 and tanD 0.0161 at 1 GHz (Djordjevic-Sarkar), copper 35 µm, roughness 3.2 µm RMS". */
export function stackupSummary(s: Stackup): string {
  return (
    `${s.name ? `${s.name}: ` : ''}h ${eng(s.h, 'm')}, er ${s.er} and tanD ${s.tanD} at ` +
    `${eng(s.fRef, 'Hz')} (Djordjevic-Sarkar), copper ${eng(s.t, 'm')}, roughness ` +
    `${eng(s.roughness, 'm')} RMS`
  );
}

/**
 * The layout assumptions of the network as built, one sentence each, for the
 * BOM and the report: the stackup, the pad model, the vias per shunt part and
 * the trace lengths. Packages are listed when a part names them.
 */
export function layoutAssumptions(
  elements: readonly Element[],
  table: PackageTable,
  board: BoardSettings,
  ctx: BoardContext,
): string[] {
  const used = [
    ...new Set(
      elements.flatMap((el) =>
        (el.kind === 'L' || el.kind === 'C') && el.package !== undefined ? [el.package] : [],
      ),
    ),
  ];
  if (!boardActive(board)) {
    const off = board.enabled
      ? `Board: left out, the stackup is not usable (${stackupProblemText(board.stackup)})`
      : 'Board: not in the network';
    return [
      used.length > 0
        ? `${off}; pads from the package table, no vias, no traces between parts`
        : off,
    ];
  }
  const out = [`Stackup: ${stackupSummary(board.stackup)}`];
  if (used.length > 0) {
    const pads = used.map((id) => {
      const pkg = packageById(table, id);
      if (!pkg) return `${id}: unknown package`;
      const c = packagePadCapacitance(pkg, board.stackup);
      return c === null
        ? `${pkg.id} ${eng(pkg.pad, 'F')} (table, no land size)`
        : `${pkg.id} lands ${eng(pkg.padLength, 'm')} x ${eng(pkg.padWidth, 'm')}, ${eng(c, 'F')}`;
    });
    out.push(
      `Pads: both lands to ground from the land size and the stackup (parallel plate plus ` +
        `fringing at the four edges, or for a land smaller than h the isolated-disc estimate ` +
        `when larger): ${pads.join('; ')}`,
    );
  }
  const n = board.viasPerShunt;
  out.push(
    `Vias: ${n} per shunt part to ground, ${eng(board.viaDrill, 'm')} drill through ` +
      `${eng(board.stackup.h, 'm')}, ${nanohenries(boardViaInductance(board))}` +
      `${n > 1 ? ` for the ${n} in parallel (${nanohenries(viaInductance(board.stackup.h, board.viaDrill))} each, no mutual inductance)` : ''} ` +
      '(Goldfarb-Pucel)',
  );
  const trace = boardTrace(board, ctx);
  out.push(
    board.traceLength > 0
      ? trace
        ? `Traces between parts: microstrip ${eng(trace.length, 'm')} long, ${eng(trace.width, 'm')} wide` +
          (board.traceWidth > 0
            ? ''
            : ` (the width for ${ctx.z0} ohm at ${eng(ctx.frequency, 'Hz')})`) +
          (traceInRange(trace.width, board.stackup)
            ? ''
            : `; W/h ${Number((trace.width / board.stackup.h).toPrecision(3))} is outside the dispersion model's range (0.1 to 10)`)
        : `Traces between parts: left out, no width gives ${ctx.z0} ohm on this stackup`
      : 'Traces between parts: off (length 0)',
  );
  out.push(
    'Not modelled: EM effects, coupling between traces and parts, discontinuities; ' +
      'pad estimates may be low for lands much smaller than h; vias without mutual inductance',
  );
  return out;
}

/** The reason a stackup is refused, as a short phrase ("tanD makes the permittivity ..."). */
function stackupProblemText(s: Stackup): string {
  const p = stackupProblem(s);
  return p ? `${p.field} ${p.reason}` : 'usable';
}
