/**
 * The matching network as simulator files: a SPICE netlist, an LTspice
 * schematic and a Touchstone .s2p. All three use the network the design shows:
 * the realized values when Realize is on, the loss model when Losses is on.
 */
import {
  sweepPoints,
  writeLadderS2p,
  writeLtspice,
  writeSpice,
  type Ladder,
  type Realization,
} from '@smithonline/core';
import type { Design } from './design';
import { designLadder, effectiveElements } from './realize';

/** The ladder to export. */
export function exportLadderOf(design: Design, realization: Realization | null): Ladder {
  return realization ? realization.ladder : designLadder(design, effectiveElements(design));
}

/** The frequency range of the exports: the design's sweep range when it has one, else half to one and a half times f. */
export function exportBand(design: Design): { start: number; stop: number; points: number } {
  const { start, stop, points } = design.sweep;
  const lo = Math.min(start, stop);
  const hi = Math.max(start, stop);
  if (lo > 0 && hi > lo) {
    return { start: lo, stop: hi, points: Math.min(2001, Math.max(2, Math.round(points))) };
  }
  return { start: 0.5 * design.frequency, stop: 1.5 * design.frequency, points: 201 };
}

export function designToSpice(design: Design, realization: Realization | null): string {
  return writeSpice(exportLadderOf(design, realization), {
    name: design.name,
    sweep: exportBand(design),
  });
}

export function designToLtspice(design: Design, realization: Realization | null): string {
  return writeLtspice(exportLadderOf(design, realization), {
    name: design.name,
    sweep: exportBand(design),
  });
}

export function designToS2p(design: Design, realization: Realization | null): string {
  const band = exportBand(design);
  return writeLadderS2p(
    exportLadderOf(design, realization),
    sweepPoints(band.start, band.stop, band.points),
    { name: design.name },
  );
}
