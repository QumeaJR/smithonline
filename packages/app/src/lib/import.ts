/**
 * Reading S-parameter, CITI and EZNEC files into what the design needs: a
 * two-port device at the design frequency, or a table of impedance rows to
 * pick a load from or to sweep over.
 */
import {
  impedanceRows,
  noiseAt,
  portsFromFileName,
  readCiti,
  readEznec,
  readTouchstone,
  renormalizeGamma,
  gammaToZ,
  sParametersAt,
  touchstoneFromCiti,
  type SweepLoad,
  type TouchstoneData,
} from '@smithonline/core';
import type { TwoPort } from './design';

export type ImportKind = 'xmlsc' | 'json' | 'touchstone' | 'citi' | 'eznec';

/** What a file name says it holds; null for unknown extensions. */
export function importKind(fileName: string): ImportKind | null {
  if (/\.xmlsc$/i.test(fileName)) return 'xmlsc';
  if (/\.json$/i.test(fileName)) return 'json';
  if (/\.s\d+p$/i.test(fileName)) return 'touchstone';
  if (/\.(citi|cti)$/i.test(fileName)) return 'citi';
  if (/\.txt$/i.test(fileName)) return 'eznec';
  return null;
}

/** Extensions the Open button accepts. */
export const OPEN_ACCEPT = '.xmlsc,.json,.s1p,.s2p,.s3p,.s4p,.citi,.cti,.txt';

export interface ImportedTwoPort {
  readonly kind: 'twoPort';
  readonly fileName: string;
  readonly data: TouchstoneData;
  /** Impedance rows of S11, so the file can also serve as a load table. */
  readonly rows: readonly SweepLoad[];
  readonly description: string;
}

export interface ImportedRows {
  readonly kind: 'rows';
  readonly fileName: string;
  readonly rows: readonly SweepLoad[];
  readonly description: string;
}

export type ImportedFile = ImportedTwoPort | ImportedRows;

/** Parse a Touchstone, CITI or EZNEC file by its name. Throws on anything else. */
export function readImportFile(fileName: string, text: string): ImportedFile {
  const kind = importKind(fileName);
  if (kind === 'touchstone') {
    const data = readTouchstone(text, portsFromFileName(fileName));
    return fromTouchstone(fileName, data, `Touchstone ${data.ports}-port, ${data.format}`);
  }
  if (kind === 'citi') {
    const packages = readCiti(text);
    const pkg = packages.find((p) => p.arrays.some((a) => /^S\s*\[/i.test(a.name))) ?? packages[0];
    if (!pkg) throw new Error('No data package in the CITIfile');
    const data = touchstoneFromCiti(pkg, 50);
    const extra = packages.length > 1 ? `, ${packages.length} packages, first used` : '';
    return fromTouchstone(fileName, data, `CITIfile ${pkg.name || ''} ${data.ports}-port${extra}`);
  }
  if (kind === 'eznec') {
    const d = readEznec(text);
    const first = d.rows[0]?.source ?? 1;
    const rows = d.rows
      .filter((r) => r.source === first)
      .map((r) => ({ frequency: r.frequency, z: r.z }));
    const title = d.header[0] ? `EZNEC, ${d.header[0]}` : 'EZNEC Lastz.txt';
    return { kind: 'rows', fileName, rows, description: title };
  }
  throw new Error('Not an S-parameter, CITI or EZNEC file');
}

function fromTouchstone(fileName: string, data: TouchstoneData, description: string): ImportedFile {
  const rows = impedanceRows(data, 1);
  const note = `${description}, ${data.points.length} points, Z0 ${data.z0} Ω`;
  return data.ports >= 2
    ? { kind: 'twoPort', fileName, data, rows, description: note }
    : { kind: 'rows', fileName, rows, description: note };
}

/**
 * The device parameters of a file at the design frequency, re-referenced to
 * the design Z0 when the file used another one.
 */
export function twoPortFromFile(
  data: TouchstoneData,
  frequency: number,
  fileName: string,
  z0: number,
): TwoPort | null {
  const at = sParametersAt(data, frequency);
  if (!at) return null;
  const noise = noiseAt(data, frequency);
  const s =
    Math.abs(data.z0 - z0) < 1e-9
      ? at.s
      : // Renormalizing a full two-port exactly needs the Z-matrix; for the
        // reflection terms the one-port rule is exact and the through terms
        // are left as they are. Files with a different Z0 are rare enough.
        {
          ...at.s,
          s11: renormalizeGamma(at.s.s11, data.z0, z0),
          s22: renormalizeGamma(at.s.s22, data.z0, z0),
        };
  return {
    s,
    noise:
      noise && Math.abs(data.z0 - z0) >= 1e-9
        ? {
            ...noise,
            gammaOpt: renormalizeGamma(noise.gammaOpt, data.z0, z0),
            rn: (noise.rn * data.z0) / z0,
          }
        : noise,
    source: { fileName, frequency, covers: at.covers, clamped: at.clamped },
  };
}

/** The impedance a row represents; kept as a function so Gamma rows can be added later. */
export function rowImpedance(row: SweepLoad): SweepLoad['z'] {
  void gammaToZ;
  return row.z;
}
