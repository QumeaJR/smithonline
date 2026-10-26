/**
 * The matching network as simulator files: a SPICE netlist, an LTspice
 * schematic and a Touchstone .s2p. All three use the network the design shows:
 * the realized values when Realize is on, the loss model when Losses is on;
 * the .s2p (like the S-Plot network entry) also resolves the component
 * packages the parts name. One frequency range serves every export and the
 * S-Plot entry: the measured band of a measured load, the sweep when a frequency sweep is
 * on, else 0.5 f to 2 f.
 */
import {
  boardActive,
  DEFAULT_BOARD,
  DEFAULT_PACKAGES,
  formatEngineering,
  partRangeProblem,
  stackupSummary,
  sweepPoints,
  writeLadderS2p,
  writeLtspice,
  writeSpice,
  type BoardSettings,
  type Element,
  type Ladder,
  type PackageTable,
  type Realization,
} from '@smithonline/core';
import { designHasDatapointSweep } from './datapoints';
import type { Design } from './design';
import { designBand, hasMeasuredLoad } from './measuredLoad';
import { designLadder, effectiveElements, packagedElements, realizeDesign } from './realize';

/** Most points an export gets. */
const MAX_POINTS = 2001;

/** Points of the default range. */
export const DEFAULT_EXPORT_POINTS = 201;

/** The ladder to export. */
export function exportLadderOf(design: Design, realization: Realization | null): Ladder {
  return realization ? realization.ladder : designLadder(design, effectiveElements(design));
}

/**
 * The frequency range of the network exports (.s2p, SPICE, LTspice) and of
 * the S-Plot network entry: the band of the measured load when the design is
 * judged against one (in 201 points), the design's frequency sweep when it is
 * on with a usable range (reversed ends swapped, 2 to 2001 points), else half
 * to twice the design frequency in 201 points.
 */
export function exportBand(design: Design): { start: number; stop: number; points: number } {
  if (hasMeasuredLoad(design)) {
    const band = designBand(design);
    if (band.measured) return { start: band.start, stop: band.stop, points: DEFAULT_EXPORT_POINTS };
  }
  const { start, stop, points } = design.sweep;
  const lo = Math.min(start, stop);
  const hi = Math.max(start, stop);
  if (sweepSetsExportBand(design)) {
    return { start: lo, stop: hi, points: Math.min(MAX_POINTS, Math.max(2, Math.round(points))) };
  }
  return {
    start: 0.5 * design.frequency,
    stop: 2 * design.frequency,
    points: DEFAULT_EXPORT_POINTS,
  };
}

/**
 * The network as built: the realized values when Realize is on (or the given
 * realization), else the ideal ones with the loss model, the component
 * packages resolved through the table when any part names one, and the board
 * (pads from the stackup, vias, traces) when it is in the network.
 */
export function builtNetwork(
  design: Design,
  table: PackageTable,
  realization?: Realization | null,
  board: BoardSettings = DEFAULT_BOARD,
): { ladder: Ladder; realized: boolean; packaged: boolean; board: boolean } {
  const elements = effectiveElements(design);
  const real = realization === undefined ? realizeDesign(design, elements) : realization;
  const base = real ? real.ladder.elements : elements;
  const packaged = packagedElements(base, table, board, {
    z0: design.z0,
    frequency: design.frequency,
  });
  return {
    ladder: {
      z0: design.z0,
      frequency: design.frequency,
      load: design.load,
      elements: packaged ?? base,
    },
    realized: real !== null,
    packaged: packaged !== null && base.some((el) => 'package' in el && el.package !== undefined),
    board: packaged !== null && boardActive(board),
  };
}

/** The frequencies of exportBand, as the points the network is evaluated at. */
export function exportFrequencies(design: Design): number[] {
  const band = exportBand(design);
  if (!(band.start > 0) || !(band.stop > band.start)) {
    throw new Error('the design frequency gives no usable range');
  }
  return sweepPoints(band.start, band.stop, band.points);
}

/** The note the SPICE and LTspice exports carry when a part names a package. */
export const PACKAGE_NOTE = 'Component package parasitics are not included; see the .s2p export';

/** The note they carry when the board is in the network as built. */
export const BOARD_NOTE =
  'The board (pads from the stackup, vias, traces between parts) is not included; see the .s2p export';

/** The note when both apply. */
export const PACKAGE_BOARD_NOTE =
  'Component package parasitics and the board (pads, vias, traces between parts) are not included; see the .s2p export';

/** True when any part of the design names a component package. */
function namesPackage(design: Design): boolean {
  return design.elements.some((el) => 'package' in el && el.package !== undefined);
}

/** The comment a SPICE or LTspice export carries about what it leaves out, or null. */
export function simLeftOutNote(design: Design, board: BoardSettings): string | null {
  const pkg = namesPackage(design);
  const onBoard =
    boardActive(board) &&
    design.elements.some(
      (el) =>
        el.kind === 'R' ||
        el.kind === 'L' ||
        el.kind === 'C' ||
        el.kind === 'RLC' ||
        el.kind === 'part',
    );
  if (pkg && onBoard) return PACKAGE_BOARD_NOTE;
  if (pkg) return PACKAGE_NOTE;
  if (onBoard) return BOARD_NOTE;
  return null;
}

/**
 * The SPICE netlist of the ideal or realized values. The parasitics of the
 * component packages and the board are not in it (the .s2p has them): a
 * comment under the title line says so when a part names a package or the
 * board is in the network.
 */
export function designToSpice(
  design: Design,
  realization: Realization | null,
  board: BoardSettings = DEFAULT_BOARD,
): string {
  const text = writeSpice(exportLadderOf(design, realization), {
    name: design.name,
    sweep: exportBand(design),
  });
  const note = simLeftOutNote(design, board);
  if (!note) return text;
  const lines = text.split('\n');
  lines.splice(1, 0, `* ${note}`);
  return lines.join('\n');
}

/** The LTspice schematic; like the SPICE netlist it notes that packages and the board are left out. */
export function designToLtspice(
  design: Design,
  realization: Realization | null,
  board: BoardSettings = DEFAULT_BOARD,
): string {
  const text = writeLtspice(exportLadderOf(design, realization), {
    name: design.name,
    sweep: exportBand(design),
  });
  const note = simLeftOutNote(design, board);
  if (!note) return text;
  const lines = text.split('\r\n');
  const sheet = lines.findIndex((l) => l.startsWith('SHEET '));
  // A comment at the top of the sheet, above the title text.
  lines.splice(sheet + 1, 0, `TEXT 416 0 Left 2 ;${note}`);
  return lines.join('\r\n');
}

/**
 * The comment lines of the .s2p that say what the network holds: ideal or
 * realized values, the loss model, the packages, the board and its stackup.
 */
export function s2pContents(
  design: Design,
  built: { realized: boolean; packaged: boolean; board: boolean },
  board: BoardSettings,
  elements?: readonly Element[],
): string[] {
  const values = built.realized ? 'realized values' : 'ideal values';
  const what = [
    values + (design.losses.enabled ? ' with the loss model' : ''),
    built.packaged ? 'component package parasitics' : 'no package parasitics',
    built.board ? 'the board (pads, vias, traces between parts)' : 'no board',
  ];
  const out = [`Contains: ${what.join('; ')}`];
  if (built.board) out.push(`Board stackup: ${stackupSummary(board.stackup)}`);
  const parts = (elements ?? []).flatMap((el) => (el.kind === 'part' ? [el.part] : []));
  if (parts.length > 0) {
    const fitted = parts.filter((p) => p.data === undefined).map((p) => p.partNumber);
    out.push(
      fitted.length === 0
        ? 'Library parts: from their measured S-parameters'
        : `Library parts: measured S-parameters, except ${fitted.join(', ')} (fitted equivalent circuit, approximate)`,
    );
  }
  return out;
}

/**
 * Why the export range reaches past a library part's data, or null when every part covers it.
 * `sweepOn` says where the range comes from: the frequency sweep (narrow it), or, with the
 * sweep off, 0.5 f to 2 f (set a sweep inside the data, which then sets the range).
 */
export function partRangeRefusal(
  elements: readonly Element[],
  frequencies: readonly number[],
  sweepOn = true,
): string | null {
  if (frequencies.length === 0) return null;
  const lo = Math.min(...frequencies);
  const hi = Math.max(...frequencies);
  const hz = (f: number): string => formatEngineering(f, { unit: 'Hz', digits: 4 });
  for (const [i, el] of elements.entries()) {
    if (el.kind !== 'part') continue;
    const problem = partRangeProblem(el.part, lo) ?? partRangeProblem(el.part, hi);
    if (problem) {
      const data = `element ${i + 1} (${el.part.partNumber}) has data from ${hz(el.part.range[0])} to ${hz(el.part.range[1])}`;
      return sweepOn
        ? `${data}, and the sweep (${hz(lo)} to ${hz(hi)}) reaches past it; narrow the sweep to that range`
        : `${data}, and the export range, 0.5 f to 2 f with the sweep off (${hz(lo)} to ${hz(hi)}), reaches past it; turn on a frequency sweep inside the data, which then sets the export range`;
    }
  }
  return null;
}

/** The network as built (with its packages and the board) as Touchstone, over exportBand. */
export function designToS2p(
  design: Design,
  realization: Realization | null,
  table: PackageTable = DEFAULT_PACKAGES,
  board: BoardSettings = DEFAULT_BOARD,
): string {
  const built = builtNetwork(design, table, realization, board);
  const frequencies = exportFrequencies(design);
  const refusal = partRangeRefusal(built.ladder.elements, frequencies, sweepSetsExportBand(design));
  if (refusal) throw new Error(refusal);
  return writeLadderS2p(built.ladder, frequencies, {
    name: design.name,
    notes: s2pContents(design, built, board, built.ladder.elements),
  });
}

/** True when a usable frequency sweep sets the export range (else it is 0.5 f to 2 f). */
export function sweepSetsExportBand(design: Design): boolean {
  const { enabled, start, stop, points } = design.sweep;
  const lo = Math.min(start, stop);
  const hi = Math.max(start, stop);
  return (
    enabled &&
    !designHasDatapointSweep(design) &&
    Number.isFinite(lo) &&
    Number.isFinite(hi) &&
    lo > 0 &&
    hi > lo &&
    Number.isFinite(points)
  );
}
