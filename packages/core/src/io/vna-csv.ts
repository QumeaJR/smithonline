/**
 * Vector network analyser CSV exports, read into frequencies and the
 * S-parameters S11 to S22 they hold. Three layouts are recognized:
 *
 * - `keysight`: Keysight/Agilent ENA and PNA exports. `!` header lines, then
 *   one or more `BEGIN CH1_DATA` ... `END` blocks, each with a column header
 *   such as `Freq(Hz),S11(REAL),S11(IMAG),S21(DB),S21(DEG)`.
 * - `generic`: a comma, semicolon or tab separated table with a header row
 *   naming a frequency column (unit in the header, `Freq [MHz]`, or on the
 *   numbers, `1.5 GHz`) and S-parameter columns in re/im, mag/angle or
 *   dB/angle pairs, or R and X columns holding an impedance directly.
 * - `nanovna`: NanoVNA-Saver and LibreVNA style tables of frequency, re, im
 *   triples per parameter (one frequency column per trace, or value columns
 *   named only Re and Im), and headerless `f re im [re im ...]` rows.
 *
 * Lines starting with `!` or `#` are comments. With a semicolon, tab or space
 * delimiter a comma in a number is a decimal comma. Rows at zero, negative or
 * non-finite frequency and rows with a non-numeric value are dropped and
 * counted. An EZNEC Lastz.txt table (it has a `Src #` column) is left to the
 * EZNEC reader, which keeps the sources apart.
 */
import { complex, polar, type Complex } from '../complex.js';
import { gammaToZ, zToGamma } from '../conversions.js';
import type { SweepLoad } from '../ladder.js';
import type { FrequencyUnit, TouchstoneData, TouchstoneFormat } from './touchstone.js';

export class VnaCsvError extends Error {
  override readonly name = 'VnaCsvError';
}

export type VnaCsvKind = 'keysight' | 'generic' | 'nanovna';

export const VNA_S_NAMES = ['S11', 'S21', 'S12', 'S22'] as const;
export type VnaSName = (typeof VNA_S_NAMES)[number];

export interface VnaCsvData {
  readonly kind: VnaCsvKind;
  /** Hz, in file order. */
  readonly frequencies: readonly number[];
  /** The S-parameters found; each array is as long as `frequencies`. */
  readonly parameters: Readonly<Partial<Record<VnaSName, readonly Complex[]>>>;
  /** How the file wrote each parameter. */
  readonly formats: Readonly<Partial<Record<VnaSName, TouchstoneFormat>>>;
  /** Impedance from R and X columns, ohm, or null; S11 is then computed from it against `z0`. */
  readonly impedance: readonly Complex[] | null;
  /** Reference impedance, ohm: the value the file states, else 50. */
  readonly z0: number;
  readonly z0Stated: boolean;
  /** The frequency unit the file wrote. */
  readonly frequencyUnit: FrequencyUnit;
  /** Comment and header lines without their `!` or `#`. */
  readonly comments: readonly string[];
  /** Rows left out for their frequency or a non-numeric value. */
  readonly dropped: number;
  /** Columns or blocks the reader could not use, one sentence each. */
  readonly notes: readonly string[];
}

type Delimiter = ',' | ';' | '\t' | ' ';
type Quantity = 're' | 'im' | 'db' | 'mag' | 'deg' | 'rad';

type Column =
  | { readonly role: 'freq'; readonly scale: number | null }
  | { readonly role: 's'; readonly name: string | null; readonly q: Quantity }
  | { readonly role: 'r' }
  | { readonly role: 'x' }
  | { readonly role: 'src' }
  | { readonly role: 'other' };

const UNIT_SCALE: Readonly<Record<string, number>> = { hz: 1, khz: 1e3, mhz: 1e6, ghz: 1e9 };
const SCALE_UNIT: ReadonlyMap<number, FrequencyUnit> = new Map([
  [1, 'HZ'],
  [1e3, 'KHZ'],
  [1e6, 'MHZ'],
  [1e9, 'GHZ'],
]);

const NUMBER = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/i;

function toNumber(cell: string, decimalComma: boolean): number {
  const t = decimalComma ? cell.trim().replace(',', '.') : cell.trim();
  return NUMBER.test(t) ? Number(t) : NaN;
}

/** A frequency cell, optionally with its own unit (`1.5 GHz`); `scale` applies otherwise. */
function toFrequency(cell: string, decimalComma: boolean, scale: number): number {
  const m = /^(.*?)\s*(ghz|mhz|khz|hz)$/i.exec(cell.trim());
  if (m)
    return (
      toNumber(m[1] as string, decimalComma) *
      (UNIT_SCALE[(m[2] as string).toLowerCase()] as number)
    );
  return toNumber(cell, decimalComma) * scale;
}

function cellUnit(cell: string): number | null {
  const m = /(ghz|mhz|khz|hz)\s*$/i.exec(cell.trim());
  return m ? (UNIT_SCALE[(m[1] as string).toLowerCase()] as number) : null;
}

function delimiterOf(line: string): Delimiter {
  if (line.includes(';')) return ';';
  if (line.includes('\t')) return '\t';
  if (line.includes(',')) return ',';
  return ' ';
}

/** Cells of a line, quotes removed, trailing empty cells dropped. */
function splitCells(line: string, d: Delimiter): string[] {
  // A space delimiter is any run of white space; quoted text stays one cell either way.
  let out: string[] = [];
  let cur = '';
  let quoted = false;
  for (const ch of d === ' ' ? line.trim() : line) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && (d === ' ' ? /\s/.test(ch) : ch === d)) {
      if (d !== ' ' || cur !== '') out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  out = out.map((c) => c.trim());
  while (out.length > 0 && out[out.length - 1] === '') out.pop();
  return out;
}

const IM_WORDS = new Set(['im', 'imag', 'imaginary', 'img']);
const RE_WORDS = new Set(['re', 'real']);
const DB_WORDS = new Set(['db', 'log', 'logmag']);
const MAG_WORDS = new Set(['mag', 'lin', 'linmag', 'abs', 'magnitude', 'linear']);
const ANGLE_WORDS = new Set(['deg', 'degree', 'degrees', 'phase', 'ang', 'angle', 'arg', 'pha']);

function quantityOf(words: readonly string[]): Quantity | null {
  const has = (set: ReadonlySet<string>): boolean => words.some((w) => set.has(w));
  if (has(IM_WORDS)) return 'im';
  if (has(RE_WORDS)) return 're';
  if (has(DB_WORDS)) return 'db';
  if (has(MAG_WORDS)) return 'mag';
  if (words.includes('rad') || words.includes('radian') || words.includes('radians'))
    return has(ANGLE_WORDS) || words.length === 1 ? 'rad' : null;
  if (has(ANGLE_WORDS)) return 'deg';
  return null;
}

/** Words that mark a column as something other than an unnamed S-parameter: Return loss (dB), SWR, Q. */
const NOT_S_WORDS = new Set(['z', 'swr', 'vswr', 'loss', 'return', 'gain', 'q', 'delay', 'group']);

function classify(header: string): Column {
  const h = header.toLowerCase().trim();
  if (/^freq/.test(h) || /^f(?:\s*[([]|\s+(?:ghz|mhz|khz|hz)\b|$)/.test(h)) {
    const m = /(?:^|[^a-z])(ghz|mhz|khz|hz)(?:[^a-z]|$)/.exec(h);
    return { role: 'freq', scale: m ? (UNIT_SCALE[m[1] as string] as number) : null };
  }
  const sm = /(?:^|[^a-z])s\s*\[?\s*(\d)\s*,?\s*(\d)/.exec(h);
  const rest = sm ? h.slice(0, sm.index) + ' ' + h.slice(sm.index + sm[0].length) : h;
  const words = rest.split(/[^a-z]+/).filter(Boolean);
  if (sm) {
    const q = quantityOf(words);
    return q ? { role: 's', name: `S${sm[1]}${sm[2]}`, q } : { role: 'other' };
  }
  const first = words[0];
  if (first === 'src' || first === 'source') return { role: 'src' };
  if (first === 'r' || first === 'rs' || first === 'resistance') return { role: 'r' };
  if (first === 'x' || first === 'xs' || first === 'reactance') return { role: 'x' };
  const q = quantityOf(words);
  if (words.includes('z') && q === 're') return { role: 'r' };
  if (words.includes('z') && q === 'im') return { role: 'x' };
  if (q && !words.some((w) => NOT_S_WORDS.has(w))) return { role: 's', name: null, q };
  return { role: 'other' };
}

interface Pair {
  a: number;
  b: number;
  format: TouchstoneFormat;
  rad: boolean;
  /** The frequency column this parameter belongs to. */
  freq: number;
}

interface Table {
  readonly kind: 'generic' | 'nanovna';
  readonly frequencies: number[];
  readonly parameters: Partial<Record<VnaSName, Complex[]>>;
  readonly formats: Partial<Record<VnaSName, TouchstoneFormat>>;
  readonly impedance: Complex[] | null;
  readonly scale: number;
  readonly dropped: number;
  readonly notes: string[];
}

const NO_FREQUENCY =
  'No frequency column: the header names none (expected Freq, Frequency or Freq(Hz) as a column name)';
const NO_VALUES =
  'No S-parameter or impedance columns: expected re/im, mag/angle or dB/angle pairs such as S11(REAL), S11(IMAG), or R and X columns';

/** Read one table: an optional header line followed by data lines. */
function readTable(header: string | null, lines: readonly string[], z0: number): Table {
  const delimiter = delimiterOf(header ?? lines[0] ?? '');
  const decimalComma = delimiter !== ',';
  const notes: string[] = [];
  let columns: Column[];
  let headerless = false;
  if (header === null) {
    headerless = true;
    const n = splitCells(lines[0] ?? '', delimiter).length;
    if (n >= 3 && n <= 9 && n % 2 === 1) {
      // f re im [re im ...]: S11, S21, S12, S22 in turn.
      columns = [{ role: 'freq', scale: null }];
      for (let k = 0; k < (n - 1) / 2; k++) {
        columns.push({ role: 's', name: VNA_S_NAMES[k] as string, q: 're' });
        columns.push({ role: 's', name: VNA_S_NAMES[k] as string, q: 'im' });
      }
    } else if (n === 6) {
      columns = [];
      for (let k = 0; k < 2; k++) {
        columns.push({ role: 'freq', scale: null });
        columns.push({ role: 's', name: VNA_S_NAMES[k] as string, q: 're' });
        columns.push({ role: 's', name: VNA_S_NAMES[k] as string, q: 'im' });
      }
    } else {
      throw new VnaCsvError(
        `${NO_FREQUENCY}; a table without a header needs frequency, re, im columns, this one has ${n} per row`,
      );
    }
  } else {
    columns = splitCells(header, delimiter).map(classify);
  }
  if (columns.some((c) => c.role === 'src'))
    throw new VnaCsvError('An EZNEC Lastz.txt table (it has a Src column), not a VNA export');
  const freqCols = columns.flatMap((c, i) => (c.role === 'freq' ? [i] : []));
  const f0 = freqCols[0];
  if (f0 === undefined) throw new VnaCsvError(NO_FREQUENCY);

  // Columns that name no parameter take the next free name: S11, then S21, ...
  const named = new Set(
    columns.flatMap((c) => (c.role === 's' && c.name !== null ? [c.name] : [])),
  );
  let unnamed = false;
  let current: string | null = null;
  columns = columns.map((c) => {
    if (c.role === 'freq') current = null;
    if (c.role !== 's' || c.name !== null) return c;
    unnamed = true;
    const opens = c.q === 're' || c.q === 'db' || c.q === 'mag';
    if (opens || current === null) {
      current = VNA_S_NAMES.find((n) => !named.has(n)) ?? null;
      if (current) named.add(current);
    }
    return current ? { ...c, name: current } : { role: 'other' };
  });

  // Pair the columns of each parameter.
  const found = new Map<string, Map<Quantity, number>>();
  const owner = new Map<string, number>();
  let lastFreq = f0;
  columns.forEach((c, i) => {
    if (c.role === 'freq') lastFreq = i;
    if (c.role !== 's' || c.name === null) return;
    const m = found.get(c.name) ?? new Map<Quantity, number>();
    if (!m.has(c.q)) m.set(c.q, i);
    found.set(c.name, m);
    if (!owner.has(c.name)) owner.set(c.name, lastFreq);
  });
  const pairs = new Map<VnaSName, Pair>();
  for (const [name, m] of found) {
    if (!(VNA_S_NAMES as readonly string[]).includes(name)) {
      notes.push(`${name} skipped: only S11 to S22 are read`);
      continue;
    }
    const angle = m.get('deg') ?? m.get('rad');
    const rad = m.get('deg') === undefined && m.get('rad') !== undefined;
    const freq = owner.get(name) as number;
    const re = m.get('re');
    const im = m.get('im');
    const mag = m.get('mag');
    const db = m.get('db');
    let pair: Pair | null = null;
    if (re !== undefined && im !== undefined) pair = { a: re, b: im, format: 'RI', rad, freq };
    else if (mag !== undefined && angle !== undefined)
      pair = { a: mag, b: angle, format: 'MA', rad, freq };
    else if (db !== undefined && angle !== undefined)
      pair = { a: db, b: angle, format: 'DB', rad, freq };
    if (pair) pairs.set(name as VnaSName, pair);
    else notes.push(`${name} skipped: it needs re and im, mag and angle, or dB and angle columns`);
  }
  const ri = columns.findIndex((c) => c.role === 'r');
  const xi = columns.findIndex((c) => c.role === 'x');
  const hasZ = ri >= 0 && xi >= 0;
  if (ri >= 0 !== xi >= 0) notes.push('Impedance skipped: it needs both an R and an X column');
  if (pairs.size === 0 && !hasZ) throw new VnaCsvError(NO_VALUES);

  const headerScale = (columns[f0] as { scale: number | null }).scale;
  const firstCell = splitCells(lines[0] ?? '', delimiter)[f0] ?? '';
  const scale = headerScale ?? cellUnit(firstCell) ?? 1;
  const kind =
    headerless || unnamed || freqCols.length > 1 ? ('nanovna' as const) : ('generic' as const);

  const frequencies: number[] = [];
  const values = new Map<VnaSName, Complex[]>([...pairs.keys()].map((n) => [n, []]));
  const impedance: Complex[] | null = hasZ ? [] : null;
  const mismatch = new Set<VnaSName>();
  let dropped = 0;
  for (const line of lines) {
    const cells = splitCells(line, delimiter);
    const num = (i: number): number => toNumber(cells[i] ?? '', decimalComma);
    const f = toFrequency(cells[f0] ?? '', decimalComma, headerScale ?? 1);
    if (!(f > 0) || !Number.isFinite(f)) {
      dropped += 1;
      continue;
    }
    const row = new Map<VnaSName, Complex>();
    let ok = true;
    for (const [name, p] of pairs) {
      const a = num(p.a);
      const b = num(p.b);
      if (!Number.isFinite(a) || !Number.isFinite(b)) {
        ok = false;
        break;
      }
      if (p.freq !== f0) {
        const fp = toFrequency(cells[p.freq] ?? '', decimalComma, headerScale ?? 1);
        if (!(Math.abs(fp - f) <= 1e-9 * f)) mismatch.add(name);
      }
      const angle = p.rad ? b : (b * Math.PI) / 180;
      row.set(
        name,
        p.format === 'RI' ? complex(a, b) : polar(p.format === 'DB' ? 10 ** (a / 20) : a, angle),
      );
    }
    let z: Complex | null = null;
    if (ok && hasZ) {
      const r = num(ri);
      const x = num(xi);
      if (Number.isFinite(r) && Number.isFinite(x)) z = complex(r, x);
      else ok = false;
    }
    if (!ok) {
      dropped += 1;
      continue;
    }
    frequencies.push(f);
    for (const [name, v] of row) (values.get(name) as Complex[]).push(v);
    if (impedance && z) impedance.push(z);
  }
  const parameters: Partial<Record<VnaSName, Complex[]>> = {};
  const formats: Partial<Record<VnaSName, TouchstoneFormat>> = {};
  for (const name of VNA_S_NAMES) {
    const p = pairs.get(name);
    if (!p) continue;
    if (mismatch.has(name)) {
      notes.push(`${name} skipped: its frequency column differs from the first one`);
      continue;
    }
    parameters[name] = values.get(name) as Complex[];
    formats[name] = p.format;
  }
  if (impedance && !parameters.S11) {
    parameters.S11 = impedance.map((z) => zToGamma(z, z0));
    formats.S11 = 'RI';
  }
  return { kind, frequencies, parameters, formats, impedance, scale, dropped, notes };
}

const Z0_STATED =
  /(?:\bz\s*0\b|reference\s+impedance|ref\.?\s*imp(?:edance)?|port\s+impedance|system\s+impedance)\s*(?:\(ohms?\))?\s*[:=]?\s*(\d+(?:[.,]\d+)?)/i;
const OPTION_LINE = /^\s*(?:ghz|mhz|khz|hz)\s+s\s+(?:ri|ma|db)\s+r\s+(\d+(?:\.\d+)?)\s*$/i;

function statedZ0(comments: readonly string[]): number | null {
  for (const c of comments) {
    const m = Z0_STATED.exec(c) ?? OPTION_LINE.exec(c);
    if (!m) continue;
    const v = Number((m[1] as string).replace(',', '.'));
    if (v > 0 && Number.isFinite(v)) return v;
  }
  return null;
}

const isComment = (line: string): boolean => line.startsWith('!') || line.startsWith('#');

/** Whether a line holds only numbers (a data row), with any delimiter. */
function isNumericLine(line: string): boolean {
  const d = delimiterOf(line);
  const cells = splitCells(line, d);
  return cells.length > 0 && cells.every((c) => Number.isFinite(toFrequency(c, d !== ',', 1)));
}

/** Parse a VNA CSV export. Throws `VnaCsvError` naming what is missing. */
export function readVnaCsv(text: string): VnaCsvData {
  // trim() also removes a byte order mark.
  const lines = text
    .split(/\r\n|\r|\n/)
    .map((l) => l.trim())
    .filter((l) => l !== '');
  const comments = lines.filter(isComment).map((l) => l.slice(1).trim());
  const body = lines.filter((l) => !isComment(l));
  const stated = statedZ0([...comments, ...body.filter((l) => !isNumericLine(l))]);
  const z0 = stated ?? 50;

  let kind: VnaCsvKind;
  let tables: { label: string; table: Table }[] = [];
  const preamble: string[] = [];
  if (body.some((l) => /^begin\b/i.test(l))) {
    kind = 'keysight';
    for (let i = 0; i < body.length; i++) {
      const line = body[i] as string;
      const begin = /^begin\b\s*(.*)$/i.exec(line);
      if (!begin) {
        preamble.push(line);
        continue;
      }
      const label = (begin[1] as string).trim() || `block ${tables.length + 1}`;
      let end = i + 1;
      while (end < body.length && !/^end\b/i.test(body[end] as string)) end++;
      const block = body.slice(i + 1, end);
      i = end;
      const header = block[0];
      if (header === undefined || isNumericLine(header))
        throw new VnaCsvError(`${label} has no column header after BEGIN`);
      tables.push({ label, table: readTable(header, block.slice(1), z0) });
    }
  } else {
    // A header has at least two cells, so a title line such as "Frequency sweep" is not one.
    const h = body.findIndex((l) => {
      const cells = classifyLine(l);
      return !isNumericLine(l) && cells.length >= 2 && cells.some((c) => c.role === 'freq');
    });
    const firstData = body.findIndex(isNumericLine);
    let table: Table;
    if (h >= 0 && (firstData < 0 || h < firstData)) {
      preamble.push(...body.slice(0, h));
      table = readTable(body[h] as string, body.slice(h + 1), z0);
    } else if (firstData >= 0) {
      const named = body.slice(0, firstData).some((l) => splitCells(l, delimiterOf(l)).length > 1);
      if (named) throw new VnaCsvError(NO_FREQUENCY);
      preamble.push(...body.slice(0, firstData));
      table = readTable(null, body.slice(firstData), z0);
    } else {
      throw new VnaCsvError(
        body.length === 0 ? 'Empty file: no header and no data rows' : NO_FREQUENCY,
      );
    }
    kind = table.kind;
    tables = [{ label: 'table', table }];
  }

  const first = tables[0];
  if (!first) throw new VnaCsvError('No BEGIN ... END data block');
  const frequencies = first.table.frequencies;
  const parameters: Partial<Record<VnaSName, readonly Complex[]>> = {};
  const formats: Partial<Record<VnaSName, TouchstoneFormat>> = {};
  const notes = [...first.table.notes];
  let dropped = first.table.dropped;
  let impedance = first.table.impedance;
  for (const { label, table } of tables) {
    if (table !== first.table) {
      notes.push(...table.notes);
      dropped += table.dropped;
      const same =
        table.frequencies.length === frequencies.length &&
        table.frequencies.every((f, i) => Math.abs(f - (frequencies[i] as number)) <= 1e-9 * f);
      if (!same) {
        notes.push(`${label} skipped: its frequencies differ from ${first.label}`);
        continue;
      }
      impedance ??= table.impedance;
    }
    for (const name of VNA_S_NAMES) {
      const v = table.parameters[name];
      if (v && !parameters[name]) {
        parameters[name] = v;
        formats[name] = table.formats[name] as TouchstoneFormat;
      }
    }
  }
  if (frequencies.length < 2) {
    throw new VnaCsvError(
      `Only ${frequencies.length} data row${frequencies.length === 1 ? '' : 's'} with a finite, non-zero frequency; at least two are needed`,
    );
  }
  return {
    kind,
    frequencies,
    parameters,
    formats,
    impedance,
    z0,
    z0Stated: stated !== null,
    frequencyUnit: SCALE_UNIT.get(first.table.scale) ?? 'HZ',
    comments: [...comments, ...preamble],
    dropped,
    notes,
  };
}

function classifyLine(line: string): Column[] {
  return splitCells(line, delimiterOf(line)).map(classify);
}

/** The layout of a VNA export, or null when the text is not one this reader takes. */
export function detectVnaCsv(text: string): VnaCsvKind | null {
  try {
    return readVnaCsv(text).kind;
  } catch {
    return null;
  }
}

/** Impedance points of S11 (or another reflection term) for a datapoint sweep. */
export function vnaCsvImpedance(data: VnaCsvData, name: 'S11' | 'S22' = 'S11'): SweepLoad[] {
  if (name === 'S11' && data.impedance) {
    return data.frequencies.map((frequency, i) => ({
      frequency,
      z: data.impedance?.[i] as Complex,
    }));
  }
  const s = data.parameters[name];
  if (!s) throw new VnaCsvError(`The file has no ${name}`);
  return data.frequencies.map((frequency, i) => ({
    frequency,
    z: gammaToZ(s[i] as Complex, data.z0),
  }));
}

const MISSING = complex(NaN, NaN);

/**
 * The file as Touchstone data for the S-Plot view and the two-port helpers:
 * a one-port when only S11 is present, else a two-port in which the
 * parameters the file lacks are NaN.
 */
export function vnaCsvToTouchstone(data: VnaCsvData): TouchstoneData {
  const p = data.parameters;
  const two = Boolean(p.S21 || p.S12 || p.S22);
  // Row-major: S11 S12 S21 S22.
  const order: readonly VnaSName[] = two ? ['S11', 'S12', 'S21', 'S22'] : ['S11'];
  const firstFormat = VNA_S_NAMES.map((n) => data.formats[n]).find((f) => f !== undefined);
  return {
    ports: two ? 2 : 1,
    parameter: 'S',
    format: firstFormat ?? 'RI',
    frequencyUnit: data.frequencyUnit,
    z0: data.z0,
    points: data.frequencies.map((frequency, i) => ({
      frequency,
      s: order.map((n) => p[n]?.[i] ?? MISSING),
    })),
    noise: [],
    comments: data.comments,
  };
}

/** Names of the S-parameters a file holds, in S11 S21 S12 S22 order. */
export function vnaCsvParameterNames(data: VnaCsvData): VnaSName[] {
  return VNA_S_NAMES.filter((n) => data.parameters[n] !== undefined);
}
