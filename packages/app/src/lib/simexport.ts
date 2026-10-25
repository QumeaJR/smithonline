/**
 * The matching network as simulator files: a SPICE netlist, an LTspice
 * schematic and a Touchstone .s2p. All three use the network the design shows:
 * the realized values when Realize is on, the loss model when Losses is on;
 * the .s2p (like the S-Plot network entry) also resolves the component
 * packages the parts name. One frequency range serves every export and the
 * S-Plot entry: the sweep when a frequency sweep is on, else 0.5 f to 2 f.
 */
import {
  boardActive,
  DEFAULT_BOARD,
  DEFAULT_PACKAGES,
  sweepPoints,
  writeLadderS2p,
  writeLtspice,
  writeSpice,
  type BoardSettings,
  type Ladder,
  type PackageTable,
  type Realization,
} from '@smithonline/core';
import { designHasDatapointSweep } from './datapoints';
import type { Design } from './design';
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
 * the S-Plot network entry: the design's frequency sweep when it is on with a
 * usable range (reversed ends swapped, 2 to 2001 points), else half to twice
 * the design frequency in 201 points.
 */
export function exportBand(design: Design): { start: number; stop: number; points: number } {
  const { enabled, start, stop, points } = design.sweep;
  const lo = Math.min(start, stop);
  const hi = Math.max(start, stop);
  if (
    enabled &&
    !designHasDatapointSweep(design) &&
    Number.isFinite(lo) &&
    Number.isFinite(hi) &&
    lo > 0 &&
    hi > lo &&
    Number.isFinite(points)
  ) {
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

/** True when any part of the design names a component package. */
function namesPackage(design: Design): boolean {
  return design.elements.some((el) => 'package' in el && el.package !== undefined);
}

/**
 * The SPICE netlist of the ideal or realized values. The parasitics of the
 * component packages are not in it (the .s2p has them): a comment under the
 * title line says so when any part names a package.
 */
export function designToSpice(design: Design, realization: Realization | null): string {
  const text = writeSpice(exportLadderOf(design, realization), {
    name: design.name,
    sweep: exportBand(design),
  });
  if (!namesPackage(design)) return text;
  const lines = text.split('\n');
  lines.splice(1, 0, `* ${PACKAGE_NOTE}`);
  return lines.join('\n');
}

/** The LTspice schematic; like the SPICE netlist it notes that packages are left out. */
export function designToLtspice(design: Design, realization: Realization | null): string {
  const text = writeLtspice(exportLadderOf(design, realization), {
    name: design.name,
    sweep: exportBand(design),
  });
  if (!namesPackage(design)) return text;
  const lines = text.split('\r\n');
  const sheet = lines.findIndex((l) => l.startsWith('SHEET '));
  // A comment at the top of the sheet, above the title text.
  lines.splice(sheet + 1, 0, `TEXT 416 0 Left 2 ;${PACKAGE_NOTE}`);
  return lines.join('\r\n');
}

/** The network as built (with its packages and the board) as Touchstone, over exportBand. */
export function designToS2p(
  design: Design,
  realization: Realization | null,
  table: PackageTable = DEFAULT_PACKAGES,
  board: BoardSettings = DEFAULT_BOARD,
): string {
  return writeLadderS2p(
    builtNetwork(design, table, realization, board).ladder,
    exportFrequencies(design),
    {
      name: design.name,
    },
  );
}
