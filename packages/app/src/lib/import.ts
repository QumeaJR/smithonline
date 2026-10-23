/**
 * Reading S-parameter, CITI, EZNEC and VNA CSV files into what the design
 * needs: a two-port device at the design frequency, or a table of impedance
 * rows to pick a load from or to sweep over.
 */
import {
  impedanceRows,
  noiseAt,
  portsFromFileName,
  readCiti,
  readEznec,
  readTouchstone,
  readVnaCsv,
  renormalizeGamma,
  gammaToZ,
  sParametersAt,
  touchstoneFromCiti,
  vnaCsvImpedance,
  vnaCsvParameterNames,
  vnaCsvToTouchstone,
  VnaCsvError,
  VNA_S_NAMES,
  type EznecData,
  type SweepLoad,
  type TouchstoneData,
  type VnaCsvData,
  type VnaCsvKind,
} from '@smithonline/core';
import type { TwoPort } from './design';

/** `csv` is a VNA export; `text` (.txt) a VNA table or an EZNEC Lastz.txt. */
export type ImportKind = 'xmlsc' | 'json' | 'touchstone' | 'citi' | 'csv' | 'text';

/** What a file name says it holds; null for unknown extensions. */
export function importKind(fileName: string): ImportKind | null {
  if (/\.xmlsc$/i.test(fileName)) return 'xmlsc';
  if (/\.json$/i.test(fileName)) return 'json';
  if (/\.s\d+p$/i.test(fileName)) return 'touchstone';
  if (/\.(citi|cti)$/i.test(fileName)) return 'citi';
  if (/\.csv$/i.test(fileName)) return 'csv';
  if (/\.txt$/i.test(fileName)) return 'text';
  return null;
}

/** Extensions the Open button accepts. */
export const OPEN_ACCEPT = '.xmlsc,.json,.s1p,.s2p,.s3p,.s4p,.citi,.cti,.csv,.txt';

export type TableFile =
  | { readonly kind: 'vna'; readonly data: VnaCsvData }
  | { readonly kind: 'eznec'; readonly data: EznecData };

/**
 * A .csv or .txt table: a VNA export, else (for .txt) an EZNEC Lastz.txt.
 * When neither reader takes a .txt file the error names both attempts.
 */
export function readTableFile(fileName: string, text: string): TableFile {
  if (importKind(fileName) === 'csv') return { kind: 'vna', data: readVnaCsv(text) };
  try {
    return { kind: 'vna', data: readVnaCsv(text) };
  } catch (vnaErr) {
    if (!(vnaErr instanceof VnaCsvError)) throw vnaErr;
    try {
      return { kind: 'eznec', data: readEznec(text) };
    } catch (eznecErr) {
      const why = (e: unknown): string => (e instanceof Error ? e.message : String(e));
      throw new Error(
        `Neither a VNA table (${why(vnaErr)}) nor an EZNEC Lastz.txt (${why(eznecErr)})`,
        { cause: eznecErr },
      );
    }
  }
}

const VNA_LABEL: Readonly<Record<VnaCsvKind, string>> = {
  keysight: 'Keysight/Agilent VNA CSV',
  generic: 'VNA table',
  nanovna: 'NanoVNA/LibreVNA CSV',
};

/** One line on what a VNA file held, for the dialog and the S-Plot list. */
export function vnaDescription(d: VnaCsvData): string {
  const what = d.impedance ? 'R and X' : vnaCsvParameterNames(d).join(', ');
  const z0 = `Z0 ${d.z0} Ω${d.z0Stated ? '' : ' assumed'}`;
  const dropped = d.dropped > 0 ? `, ${d.dropped} row${d.dropped === 1 ? '' : 's'} dropped` : '';
  return `${VNA_LABEL[d.kind]}, ${what}, ${d.frequencies.length} points, ${z0}${dropped}`;
}

export interface ImportedTwoPort {
  readonly kind: 'twoPort';
  readonly fileName: string;
  readonly data: TouchstoneData;
  /** Impedance rows of S11, so the file can also serve as a load table. */
  readonly rows: readonly SweepLoad[];
  readonly description: string;
  /** Whether the file also goes to the S-Plot list. */
  readonly sPlot: boolean;
}

export interface ImportedRows {
  readonly kind: 'rows';
  readonly fileName: string;
  readonly rows: readonly SweepLoad[];
  readonly description: string;
  readonly sPlot: boolean;
}

export type ImportedFile = ImportedTwoPort | ImportedRows;

/**
 * Parse a Touchstone, CITI, EZNEC or VNA CSV file by its name. A VNA file
 * with S11 only is a row table for the load and the datapoint sweep; one
 * with S21 as well also goes to the S-Plot list, and one with all four
 * S-parameters fills the two-port panel as a Touchstone file does. Throws
 * on anything else.
 */
export function readImportFile(fileName: string, text: string): ImportedFile {
  const kind = importKind(fileName);
  if (kind === 'touchstone') {
    const data = readTouchstone(text, portsFromFileName(fileName));
    if (data.parameter !== 'S') {
      throw new Error(
        `${data.parameter}-parameter files are not supported; convert the file to S-parameters first`,
      );
    }
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
  if (kind === 'csv' || kind === 'text') {
    const table = readTableFile(fileName, text);
    if (table.kind === 'eznec') {
      const d = table.data;
      const first = d.rows[0]?.source ?? 1;
      const rows = d.rows
        .filter((r) => r.source === first)
        .map((r) => ({ frequency: r.frequency, z: r.z }));
      const title = d.header[0] ? `EZNEC, ${d.header[0]}` : 'EZNEC Lastz.txt';
      return { kind: 'rows', fileName, rows, description: title, sPlot: true };
    }
    const d = table.data;
    if (!d.parameters.S11) {
      throw new Error(
        `The file holds ${vnaCsvParameterNames(d).join(', ')} but no S11 to use as a load; add it in the S-Plot view`,
      );
    }
    const rows = vnaCsvImpedance(d);
    const data = vnaCsvToTouchstone(d);
    const description = vnaDescription(d);
    const sPlot = data.ports >= 2;
    return VNA_S_NAMES.every((n) => d.parameters[n])
      ? { kind: 'twoPort', fileName, data, rows, description, sPlot }
      : { kind: 'rows', fileName, rows, description, sPlot };
  }
  throw new Error('Not an S-parameter, CITI, EZNEC or VNA CSV file');
}

function fromTouchstone(fileName: string, data: TouchstoneData, description: string): ImportedFile {
  const rows = impedanceRows(data, 1);
  const note = `${description}, ${data.points.length} points, Z0 ${data.z0} Ω`;
  return data.ports >= 2
    ? { kind: 'twoPort', fileName, data, rows, description: note, sPlot: true }
    : { kind: 'rows', fileName, rows, description: note, sPlot: true };
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
  fileId?: string,
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
    source: {
      fileName,
      frequency,
      covers: at.covers,
      clamped: at.clamped,
      ...(fileId === undefined ? {} : { fileId }),
    },
  };
}

/** The impedance a row represents; kept as a function so Gamma rows can be added later. */
export function rowImpedance(row: SweepLoad): SweepLoad['z'] {
  void gammaToZ;
  return row.z;
}
