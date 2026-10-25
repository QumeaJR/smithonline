/**
 * S-Plot mode of Smith V4.1: reading S-parameter files into plain data,
 * the per-frequency analysis behind the graphs and the gain table, and
 * the hand-over to the Smith chart.
 */
import {
  cabs,
  cargDeg,
  impedanceRows,
  linearToDb,
  mag,
  msg,
  portsFromFileName,
  readCiti,
  readTouchstone,
  reflectionAt,
  sIndex,
  stability,
  touchstoneFromCiti,
  vnaCsvToTouchstone,
  zToGamma,
  gammaToZ,
  type Complex,
  type FrequencyUnit,
  type SParameters,
  type SweepLoad,
  type TouchstoneData,
} from '@smithonline/core';
import { importKind, readTableFile, vnaDescription } from './import';

export type SPlotKind = 'touchstone' | 'citi' | 'eznec' | 'vna';

/** One file as it enters the S-Plot list. */
export interface ParsedSPlotFile {
  readonly fileName: string;
  readonly kind: SPlotKind;
  readonly description: string;
  readonly data: TouchstoneData;
}

/** Whether an Open of this file name belongs to the S-Plot list. */
export function isSPlotFile(fileName: string): boolean {
  const kind = importKind(fileName);
  return kind === 'touchstone' || kind === 'citi' || kind === 'csv' || kind === 'text';
}

/**
 * Parse a Touchstone, CITI, EZNEC or VNA CSV file. A CITIfile with several
 * packages gives one entry per package that holds S arrays; a VNA file with
 * S21, S12 or S22 is a two-port whose missing parameters are NaN. Throws on
 * anything else.
 */
export function readSPlotFiles(fileName: string, text: string): ParsedSPlotFile[] {
  const kind = importKind(fileName);
  if (kind === 'touchstone') {
    const data = readTouchstone(text, portsFromFileName(fileName));
    if (data.parameter !== 'S') {
      throw new Error(
        `${data.parameter}-parameter files are not supported; convert the file to S-parameters first`,
      );
    }
    return [
      {
        fileName,
        kind,
        data,
        description: `Touchstone ${data.ports}-port, ${data.format}, Z0 ${data.z0} Ω`,
      },
    ];
  }
  if (kind === 'citi') {
    const packages = readCiti(text).filter((p) => p.arrays.some((a) => /^S\s*\[/i.test(a.name)));
    if (packages.length === 0) throw new Error('No S-parameter package in the CITIfile');
    return packages.map((pkg, i) => {
      const data = touchstoneFromCiti(pkg, 50);
      const label = pkg.name || `package ${i + 1}`;
      return {
        fileName: packages.length > 1 ? `${fileName} [${label}]` : fileName,
        kind,
        data,
        description: `CITIfile ${label}, ${data.ports}-port, Z0 ${data.z0} Ω assumed`,
      };
    });
  }
  if (kind === 'csv' || kind === 'text') {
    const table = readTableFile(fileName, text);
    if (table.kind === 'touchstone') {
      const data = table.data;
      if (data.parameter !== 'S') {
        throw new Error(
          `${data.parameter}-parameter files are not supported; convert the file to S-parameters first`,
        );
      }
      return [
        {
          fileName,
          kind: 'touchstone',
          data,
          description: `Touchstone text, ${data.ports}-port, ${data.format}, Z0 ${data.z0} Ω`,
        },
      ];
    }
    if (table.kind === 'vna') {
      const data = vnaCsvToTouchstone(table.data);
      const notes = table.data.notes.length > 0 ? `. ${table.data.notes.join('. ')}` : '';
      return [
        { fileName, kind: 'vna', data, description: `${vnaDescription(table.data)}${notes}` },
      ];
    }
    const d = table.data;
    const first = d.rows[0]?.source ?? 1;
    const z0 = 50;
    const points = d.rows
      .filter((r) => r.source === first)
      .map((r) => ({ frequency: r.frequency, s: [zToGamma(r.z, z0)] }));
    const data: TouchstoneData = {
      ports: 1,
      parameter: 'S',
      format: 'RI',
      frequencyUnit: 'MHZ',
      z0,
      points,
      noise: [],
      comments: d.header,
    };
    return [
      {
        fileName,
        kind: 'eznec',
        data,
        description: `EZNEC feedpoint impedance as s11 against ${z0} Ω${d.header[0] ? `, ${d.header[0]}` : ''}`,
      },
    ];
  }
  throw new Error('Not an S-parameter, CITI, EZNEC or VNA CSV file');
}

export const FREQUENCY_UNITS: readonly FrequencyUnit[] = ['HZ', 'KHZ', 'MHZ', 'GHZ'];
export const FREQUENCY_SCALE: Readonly<Record<FrequencyUnit, number>> = {
  HZ: 1,
  KHZ: 1e3,
  MHZ: 1e6,
  GHZ: 1e9,
};

/**
 * The file's frequencies read as `unit` instead of the unit its option line
 * (or the format) declared: the numbers in the file stay, their meaning changes.
 */
export function reinterpretFrequencyUnit(
  data: TouchstoneData,
  unit: FrequencyUnit,
): TouchstoneData {
  const k = FREQUENCY_SCALE[unit] / FREQUENCY_SCALE[data.frequencyUnit];
  if (k === 1) return data;
  return {
    ...data,
    frequencyUnit: unit,
    points: data.points.map((p) => ({ ...p, frequency: p.frequency * k })),
    noise: data.noise.map((p) => ({ ...p, frequency: p.frequency * k })),
  };
}

/** The unit that shows a frequency range without long numbers. */
export function suggestUnit(high: number): FrequencyUnit {
  if (high >= 1e9) return 'GHZ';
  if (high >= 1e6) return 'MHZ';
  if (high >= 1e3) return 'KHZ';
  return 'HZ';
}

/** Everything the graphs and the gain table need, one entry per file point. */
export interface SPlotAnalysis {
  readonly ports: number;
  readonly frequency: readonly number[];
  /** Complex S-parameters; null when the file has fewer than two ports (s12, s21, s22). */
  readonly s11: readonly Complex[];
  readonly s12: readonly Complex[] | null;
  readonly s21: readonly Complex[] | null;
  readonly s22: readonly Complex[] | null;
  readonly db: Readonly<Record<'s11' | 's12' | 's21' | 's22', readonly number[] | null>>;
  readonly phase: Readonly<Record<'s11' | 's12' | 's21' | 's22', readonly number[] | null>>;
  /** Return loss, positive dB: -20 log |s11| and -20 log |s22|. */
  readonly returnLoss1: readonly number[];
  readonly returnLoss2: readonly number[] | null;
  readonly k: readonly number[] | null;
  readonly mu: readonly number[] | null;
  /** MAG in dB where K >= 1 (K within 1e-9 of 1 counts as 1), NaN elsewhere. */
  readonly magDb: readonly number[] | null;
  /** MSG in dB, |s21 / s12|, at every point. */
  readonly msgDb: readonly number[] | null;
}

function column(data: TouchstoneData, i: number, j: number): Complex[] {
  const k = sIndex(data.ports, i, j);
  return data.points.map((p) => p.s[k] as Complex);
}

const db20 = (c: Complex): number => 20 * Math.log10(cabs(c));

export function analyze(data: TouchstoneData): SPlotAnalysis {
  const two = data.ports >= 2;
  const s11 = column(data, 1, 1);
  const s12 = two ? column(data, 1, 2) : null;
  const s21 = two ? column(data, 2, 1) : null;
  const s22 = two ? column(data, 2, 2) : null;
  const dbOf = (v: readonly Complex[] | null): number[] | null => (v ? v.map(db20) : null);
  const phOf = (v: readonly Complex[] | null): number[] | null => (v ? v.map(cargDeg) : null);
  let k: number[] | null = null;
  let mu: number[] | null = null;
  let magDb: number[] | null = null;
  let msgDb: number[] | null = null;
  if (s12 && s21 && s22) {
    k = [];
    mu = [];
    magDb = [];
    msgDb = [];
    for (let n = 0; n < s11.length; n++) {
      const s: SParameters = {
        s11: s11[n] as Complex,
        s12: s12[n] as Complex,
        s21: s21[n] as Complex,
        s22: s22[n] as Complex,
      };
      // K and mu within 1e-9 of 1 are 1 (stability), so a lossless network reads K = mu = 1
      // and MAG = MSG, not "potentially unstable" with a blank MAG on half its rows.
      const st = stability(s);
      k.push(st.k);
      mu.push(st.mu);
      msgDb.push(linearToDb(msg(s)));
      magDb.push(linearToDb(mag(s)));
    }
  }
  return {
    ports: data.ports,
    frequency: data.points.map((p) => p.frequency),
    s11,
    s12,
    s21,
    s22,
    db: { s11: dbOf(s11), s12: dbOf(s12), s21: dbOf(s21), s22: dbOf(s22) },
    phase: { s11: phOf(s11), s12: phOf(s12), s21: phOf(s21), s22: phOf(s22) },
    returnLoss1: s11.map((c) => -db20(c)),
    returnLoss2: s22 ? s22.map((c) => -db20(c)) : null,
    k,
    mu,
    magDb,
    msgDb,
  };
}

/** The sorted union of the frequencies of several files, duplicates removed. */
export function unionGrid(lists: readonly (readonly number[])[]): number[] {
  return [...new Set(lists.flat())].sort((a, b) => a - b);
}

/**
 * `values` (sampled at `frequency`) placed on `grid`: the value at a shared
 * frequency, null elsewhere. Each file keeps its own samples; nothing is
 * interpolated.
 */
export function alignToGrid(
  grid: readonly number[],
  frequency: readonly number[],
  values: readonly number[],
): (number | null)[] {
  const at = new Map<number, number>();
  frequency.forEach((f, i) => at.set(f, values[i] as number));
  return grid.map((f) => {
    const v = at.get(f);
    return v === undefined || !Number.isFinite(v) ? null : v;
  });
}

/** Index of the sample nearest to `f`; null for an empty list. */
export function nearestIndex(frequency: readonly number[], f: number): number | null {
  if (frequency.length === 0) return null;
  let best = 0;
  for (let i = 1; i < frequency.length; i++) {
    if (Math.abs((frequency[i] as number) - f) < Math.abs((frequency[best] as number) - f))
      best = i;
  }
  return best;
}

/** The impedance rows of port 1 or 2 (s11 or s22), absolute ohm. */
export function portRows(data: TouchstoneData, port: 1 | 2): SweepLoad[] {
  return impedanceRows(data, port);
}

/** The impedance of port `port` at frequency `f`, interpolated; null when the file lacks the port. */
export function portImpedance(data: TouchstoneData, port: 1 | 2, f: number): Complex | null {
  const g = reflectionAt(data, f, port);
  return g ? gammaToZ(g, data.z0) : null;
}

const analysisCache = new WeakMap<TouchstoneData, SPlotAnalysis>();

/** `analyze` memoized per data object, so a redraw does not recompute K and mu. */
export function analysisOf(data: TouchstoneData): SPlotAnalysis {
  let a = analysisCache.get(data);
  if (!a) {
    a = analyze(data);
    analysisCache.set(data, a);
  }
  return a;
}

/** Round scale limit above `max`: 1, 2 or 5 times a power of ten. */
export function niceLimit(max: number): number {
  if (!(max > 0) || !Number.isFinite(max)) return 1;
  const e = 10 ** Math.floor(Math.log10(max));
  for (const m of [1, 2, 5, 10]) if (m * e >= max * 0.999) return m * e;
  return 10 * e;
}
