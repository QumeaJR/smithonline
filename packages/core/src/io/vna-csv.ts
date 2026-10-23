/**
 * Vector network analyser CSV exports, read into frequencies and the
 * S-parameters S11 to S22 they hold. Three layouts are recognized:
 *
 * - `keysight`: Keysight/Agilent ENA and PNA exports. `!` header lines, then
 *   one or more `BEGIN CH1_DATA` ... `END` blocks, each with a column header
 *   such as `Freq(Hz),S11(REAL),S11(IMAG),S21(DB),S21(DEG)`.
 * - `generic`: a comma, semicolon, tab or space separated table with a header
 *   row naming a frequency column (unit in the header, `Freq [MHz]`, or on the
 *   numbers, `1.5 GHz`) and S-parameter columns in re/im, mag/angle or
 *   dB/angle pairs, or R and X (or impedance re/im) columns holding an
 *   impedance directly. A header written as a `#` comment (numpy savetxt) is
 *   used when the body has none.
 * - `nanovna`: NanoVNA-Saver and LibreVNA style tables of frequency, re, im
 *   triples per parameter (one frequency column per trace, or value columns
 *   named only Re and Im), and headerless `f re im [re im ...]` rows.
 *
 * Lines starting with `!` or `#` are comments. With a semicolon, tab or space
 * delimiter a comma in a number is a decimal comma; with a comma delimiter a
 * quoted cell may hold one. Rows are sorted by frequency; rows at zero,
 * negative or non-finite frequency, rows repeating a frequency and rows with a
 * value that is not a number (or that overflows) are dropped and counted.
 * Y, Z, H and G parameter columns, return loss, SWR and delay columns are
 * skipped with a note. Touchstone text (an option line such as
 * `# MHz S MA R 50` above headerless rows) is refused: `isTouchstoneText`
 * tells the caller to use the Touchstone reader. An EZNEC Lastz.txt table
 * (it has a `Src #` column) is left to the EZNEC reader, which keeps the
 * sources apart.
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

export interface VnaDropped {
  /** Zero, negative or non-finite frequency. */
  readonly frequency: number;
  /** A value that is not a number, or overflows when converted. */
  readonly value: number;
  /** A frequency an earlier row already had. */
  readonly duplicate: number;
}

export interface VnaCsvData {
  readonly kind: VnaCsvKind;
  /** Hz, ascending. */
  readonly frequencies: readonly number[];
  /** The S-parameters found; each array is as long as `frequencies`. */
  readonly parameters: Readonly<Partial<Record<VnaSName, readonly Complex[]>>>;
  /** How the file wrote each parameter. */
  readonly formats: Readonly<Partial<Record<VnaSName, TouchstoneFormat>>>;
  /** Impedance from R and X columns, ohm, or null; S11 is then computed from it against `z0` unless the file has S11 columns. */
  readonly impedance: readonly Complex[] | null;
  /** True when S11 was computed from the R and X columns (the file has no S11 columns). */
  readonly s11FromImpedance: boolean;
  /** Reference impedance, ohm: the value the file states, else 50. */
  readonly z0: number;
  readonly z0Stated: boolean;
  /** The frequency unit the file wrote. */
  readonly frequencyUnit: FrequencyUnit;
  /** Comment and header lines without their `!` or `#`. */
  readonly comments: readonly string[];
  /** Rows left out, all reasons together. */
  readonly dropped: number;
  readonly droppedBy: VnaDropped;
  /** Columns, blocks or rows the reader could not use, one sentence each. */
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
  | { readonly role: 'other'; readonly note?: string };

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

/**
 * Semicolon, then tab, then comma; a line whose commas all sit between
 * digits and whose cells are separated by spaces (`1000000 0,25 -0,5`) is
 * space separated with decimal commas.
 */
function delimiterOf(line: string): Delimiter {
  if (line.includes(';')) return ';';
  if (line.includes('\t')) return '\t';
  if (line.includes(',')) {
    const decimalOnly = !/,(?!\d)|(?<!\d),/.test(line);
    return decimalOnly && /\S\s+\S/.test(line) ? ' ' : ',';
  }
  return ' ';
}

/** A bare parameter name: `S11`, `S(2,1)`, `S_21`, `S[1,2]`. */
const S_NAME_ONLY = /^s\s*[[(_]?\s*\d\s*[,_]?\s*\d\s*[\])]?$/i;
/** One word naming a number format or unit of an S-parameter column. */
const QUANTITY_WORD =
  /^(?:re|im|real|imag|imaginary|mag|magnitude|db|deg|degrees?|phase|ang|angle|rad|lin|log)$/i;

/**
 * Cells of a line, quotes removed, trailing empty cells dropped. A quoted
 * cell in a comma separated line may hold a decimal comma. With a space
 * delimiter a unit token such as `(MHz)` or `[dB]` stays with the cell
 * before it.
 */
function splitCells(line: string, d: Delimiter): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  let wasQuoted = false;
  const push = (): void => {
    let c = cur.trim();
    if (wasQuoted && d === ',' && /^[-+]?\d+,\d+(?:e[-+]?\d+)?$/i.test(c)) c = c.replace(',', '.');
    out.push(c);
    cur = '';
    wasQuoted = false;
  };
  for (const ch of d === ' ' ? line.trim() : line) {
    if (ch === '"') {
      quoted = !quoted;
      wasQuoted = true;
    } else if (!quoted && (d === ' ' ? /\s/.test(ch) : ch === d)) {
      if (d !== ' ' || cur !== '') push();
    } else cur += ch;
  }
  push();
  if (d === ' ') {
    for (let i = out.length - 1; i > 0; i--) {
      if (/^[([].*[)\]]$/.test(out[i] as string)) {
        out[i - 1] = `${out[i - 1] as string} ${out[i] as string}`;
        out.splice(i, 1);
      }
    }
    // "S11 dB" and "Freq MHz" written with spaces stay one cell.
    for (let i = out.length - 2; i >= 0; i--) {
      const a = out[i] as string;
      const b = out[i + 1] as string;
      if (
        (S_NAME_ONLY.test(a) && QUANTITY_WORD.test(b)) ||
        (/^f(?:req(?:uency)?)?$/i.test(a) && /^(?:ghz|mhz|khz|hz)$/i.test(b))
      ) {
        out[i] = `${a} ${b}`;
        out.splice(i + 1, 1);
      }
    }
  }
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

/** Words that mark a column as something other than a complex S-parameter: return loss, SWR, Q, delay. */
const NOT_S_WORDS = new Set(['swr', 'vswr', 'loss', 'return', 'q', 'delay', 'group', 'smith']);
/** Words that name an impedance: `Impedance Real`, `Zin Re`, `Z (re)`. */
const Z_WORDS = new Set(['z', 'zin', 'zl', 'impedance']);
/**
 * The only words a column that names no parameter may hold (`Re`, `Phase (deg)`,
 * `Magnitude (dB)`); `Admittance Real` or `Thru Mag` is not taken for S11.
 */
const UNNAMED_WORDS = new Set([
  ...IM_WORDS,
  ...RE_WORDS,
  ...DB_WORDS,
  ...MAG_WORDS,
  ...ANGLE_WORDS,
  'rad',
  'radian',
  'radians',
  'part',
  'value',
  'units',
]);

/** `S11`, `S 21`, `S[2,1]`, `S(2,1)`, `S_21`, `dB(S(2,1))` (HFSS, ADS, Microwave Office). */
const S_NAME = /(?:^|[^a-z])s\s*[[(_]?\s*(\d)\s*[,_]?\s*(\d)\s*[\])]?/;
const OTHER_NAME = /(?:^|[^a-z])([yzhg])\s*[[(_]?\s*(\d)\s*[,_]?\s*(\d)\s*[\])]?/;

function classify(header: string): Column {
  const h = header.toLowerCase().trim();
  if (/^freq/.test(h) || /^f(?:[\s_]*[([]|[\s_]+(?:ghz|mhz|khz|hz)\b|$)/.test(h)) {
    const m = /(?:^|[^a-z])(ghz|mhz|khz|hz)(?:[^a-z]|$)/.exec(h);
    return { role: 'freq', scale: m ? (UNIT_SCALE[m[1] as string] as number) : null };
  }
  const other = OTHER_NAME.exec(h);
  const sm = S_NAME.exec(h);
  if (other && !sm) {
    const name = `${(other[1] as string).toUpperCase()}${other[2]}${other[3]}`;
    return { role: 'other', note: `${name} skipped: only S-parameters are read` };
  }
  const rest = sm ? h.slice(0, sm.index) + ' ' + h.slice(sm.index + sm[0].length) : h;
  const words = rest.split(/[^a-z]+/).filter(Boolean);
  const notS = words.some((w) => NOT_S_WORDS.has(w));
  if (sm) {
    const name = `S${sm[1]}${sm[2]}`;
    if (notS) return { role: 'other', note: `"${header}" skipped: not a complex ${name} column` };
    const q = quantityOf(words);
    return q ? { role: 's', name, q } : { role: 'other' };
  }
  const first = words[0];
  if (first === 'src' || first === 'source') return { role: 'src' };
  if (first === 'r' || first === 'rs' || first === 'resistance') return { role: 'r' };
  if (first === 'x' || first === 'xs' || first === 'reactance') return { role: 'x' };
  const q = quantityOf(words);
  if (words.some((w) => Z_WORDS.has(w))) {
    if (q === 're') return { role: 'r' };
    if (q === 'im') return { role: 'x' };
    return { role: 'other' };
  }
  if (q && words.every((w) => UNNAMED_WORDS.has(w))) return { role: 's', name: null, q };
  if (q) {
    return {
      role: 'other',
      note: `"${header}" skipped: not an S-parameter or impedance column`,
    };
  }
  return { role: 'other' };
}

/** re, dB and mag open a pair; im and angles close it. */
const opensPair = (q: Quantity): boolean => q === 're' || q === 'db' || q === 'mag';

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
  readonly s11FromZ: boolean;
  readonly scale: number;
  readonly droppedFrequency: number;
  readonly droppedValue: number;
  readonly notes: string[];
  /** Data line of each kept row, so blocks of one sweep can be matched row by row. */
  readonly rows: number[];
  /** Frequency of every data line, NaN where it is unusable. */
  readonly lineFrequencies: number[];
}

const NO_FREQUENCY = 'No frequency column; expected a column named Freq, Frequency or Freq(Hz)';
const NO_VALUES =
  'No S-parameter or impedance columns; expected re/im, mag/angle or dB/angle pairs such as S11(REAL), S11(IMAG), or R and X columns';

const finite = (c: Complex): boolean => Number.isFinite(c.re) && Number.isFinite(c.im);

/** (n) / (d) with both scaled first, so a huge but finite value does not overflow. */
function ratio(n: Complex, d: Complex): Complex {
  const k = Math.max(Math.abs(d.re), Math.abs(d.im));
  if (!(k > 0) || !Number.isFinite(k)) return complex(NaN, NaN);
  const nr = n.re / k;
  const ni = n.im / k;
  const dr = d.re / k;
  const di = d.im / k;
  const den = dr * dr + di * di;
  return complex((nr * dr + ni * di) / den, (ni * dr - nr * di) / den);
}

/** Gamma = (Z - Z0) / (Z + Z0); scaled first when the plain quotient overflows (a huge Z). */
function gammaOf(z: Complex, z0: number): Complex {
  const g = zToGamma(z, z0);
  return finite(g) ? g : ratio(complex(z.re - z0, z.im), complex(z.re + z0, z.im));
}

/** Z = Z0 (1 + Gamma) / (1 - Gamma); scaled first when the plain quotient overflows (a huge Gamma). */
function impedanceOf(g: Complex, z0: number): Complex {
  const z = gammaToZ(g, z0);
  if (finite(z)) return z;
  const q = ratio(complex(1 + g.re, g.im), complex(1 - g.re, -g.im));
  return complex(z0 * q.re, z0 * q.im);
}

/** Read one table: an optional header line followed by data lines. */
function readTable(header: string | null, lines: readonly string[], z0: number): Table {
  // The header and the rows may use different delimiters (numpy writes a
  // space separated `# f S11_re S11_im` over comma rows).
  const delimiter = delimiterOf(lines[0] ?? header ?? '');
  const headerDelimiter = header === null ? delimiter : delimiterOf(header);
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
    columns = splitCells(header, headerDelimiter).map(classify);
  }
  if (columns.some((c) => c.role === 'src'))
    throw new VnaCsvError('An EZNEC Lastz.txt table (it has a Src column), not a VNA export');
  for (const c of columns)
    if (c.role === 'other' && c.note && !notes.includes(c.note)) notes.push(c.note);
  const freqCols = columns.flatMap((c, i) => (c.role === 'freq' ? [i] : []));
  const f0 = freqCols[0];
  if (f0 === undefined) throw new VnaCsvError(NO_FREQUENCY);

  // A column that names no parameter joins the parameter before it unless
  // that one already has its kind (`S11 dB, Phase`; `Phase, Mag` pairs as
  // well as `Mag, Phase`), else it takes the next free name, S11, then S21.
  const named = new Set(
    columns.flatMap((c) => (c.role === 's' && c.name !== null ? [c.name] : [])),
  );
  let unnamed = false;
  let current: { name: string; opened: boolean; closed: boolean } | null = null;
  columns = columns.map((c) => {
    if (c.role === 'freq') current = null;
    if (c.role !== 's') return c;
    const opens = opensPair(c.q);
    if (c.name !== null) {
      if (current?.name !== c.name) current = { name: c.name, opened: false, closed: false };
      if (opens) current.opened = true;
      else current.closed = true;
      return c;
    }
    unnamed = true;
    if (current === null || (opens ? current.opened : current.closed)) {
      const name = VNA_S_NAMES.find((n) => !named.has(n));
      current = name ? { name, opened: false, closed: false } : null;
      if (name) named.add(name);
    }
    if (!current) return { role: 'other' };
    if (opens) current.opened = true;
    else current.closed = true;
    return { ...c, name: current.name };
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
  if (pairs.size === 0 && !hasZ) {
    throw new VnaCsvError(notes.length > 0 ? `${NO_VALUES}. ${notes.join('. ')}` : NO_VALUES);
  }
  const s11FromZ = hasZ && !pairs.has('S11');

  const headerScale = (columns[f0] as { scale: number | null }).scale;
  const firstCell = splitCells(lines[0] ?? '', delimiter)[f0] ?? '';
  const scale = headerScale ?? cellUnit(firstCell) ?? 1;
  const kind =
    headerless || unnamed || freqCols.length > 1 ? ('nanovna' as const) : ('generic' as const);

  const frequencies: number[] = [];
  const values = new Map<VnaSName, Complex[]>([...pairs.keys()].map((n) => [n, []]));
  if (s11FromZ) values.set('S11', []);
  const impedance: Complex[] | null = hasZ ? [] : null;
  const mismatch = new Set<VnaSName>();
  let droppedFrequency = 0;
  let droppedValue = 0;
  const rows: number[] = [];
  const lineFrequencies: number[] = [];
  for (const [lineNo, line] of lines.entries()) {
    const cells = splitCells(line, delimiter);
    const num = (i: number): number => toNumber(cells[i] ?? '', decimalComma);
    const f = toFrequency(cells[f0] ?? '', decimalComma, headerScale ?? 1);
    const usable = f > 0 && Number.isFinite(f);
    lineFrequencies.push(usable ? f : NaN);
    if (!usable) {
      droppedFrequency += 1;
      continue;
    }
    const row = new Map<VnaSName, Complex>();
    let ok = true;
    for (const [name, p] of pairs) {
      const a = num(p.a);
      const b = num(p.b);
      if (p.freq !== f0) {
        const fp = toFrequency(cells[p.freq] ?? '', decimalComma, headerScale ?? 1);
        if (!(Math.abs(fp - f) <= 1e-9 * f)) mismatch.add(name);
      }
      const angle = p.rad ? b : (b * Math.PI) / 180;
      const v =
        p.format === 'RI' ? complex(a, b) : polar(p.format === 'DB' ? 10 ** (a / 20) : a, angle);
      // The converted value must be finite too (a dB of 7000 overflows) and give a finite impedance.
      if (!finite(v) || ((name === 'S11' || name === 'S22') && !finite(gammaToZ(v, z0)))) {
        ok = false;
        break;
      }
      row.set(name, v);
    }
    let z: Complex | null = null;
    if (ok && hasZ) {
      z = complex(num(ri), num(xi));
      if (!finite(z)) ok = false;
      else if (s11FromZ) {
        const g = gammaOf(z, z0);
        if (finite(g)) row.set('S11', g);
        else ok = false;
      }
    }
    if (!ok) {
      droppedValue += 1;
      continue;
    }
    frequencies.push(f);
    rows.push(lineNo);
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
  if (s11FromZ) {
    parameters.S11 = values.get('S11') as Complex[];
    formats.S11 = 'RI';
  }
  return {
    kind,
    frequencies,
    parameters,
    formats,
    impedance,
    s11FromZ,
    scale,
    droppedFrequency,
    droppedValue,
    notes,
    rows,
    lineFrequencies,
  };
}

const Z0_STATED =
  /(?:\bz\s*0\b|reference\s+impedance|ref\.?\s*imp(?:edance)?|port\s+impedance|system\s+impedance)\s*(?:\(ohms?\))?\s*[:=]?\s*(\d+(?:[.,]\d+)?(?:e[-+]?\d+)?)/i;

const OPTION_WORDS = new Set([
  'hz',
  'khz',
  'mhz',
  'ghz',
  's',
  'y',
  'z',
  'g',
  'h',
  'ma',
  'db',
  'ri',
]);

/** A line without its `!` comment (Touchstone allows one after the option line and the data). */
const withoutBang = (line: string): string => line.replace(/!.*$/, '').trim();

/**
 * The R of a Touchstone option line (`MHz S MA R 50`, words in any order,
 * a trailing `! comment` allowed), 50 when the line has none (a bare `#`
 * means GHz S MA R 50), or null when the comment is not an option line.
 */
function optionLineR(comment: string): number | null {
  const words = withoutBang(comment).toLowerCase().split(/\s+/).filter(Boolean);
  let r = 50;
  for (let i = 0; i < words.length; i++) {
    const w = words[i] as string;
    if (w === 'r') {
      const v = Number(words[i + 1]);
      if (!(v > 0) || !Number.isFinite(v)) return null;
      r = v;
      i++;
    } else if (!OPTION_WORDS.has(w)) return null;
  }
  return r;
}

function statedZ0(comments: readonly string[], options: readonly string[]): number | null {
  for (const c of comments) {
    const m = Z0_STATED.exec(c);
    if (!m) continue;
    const v = Number((m[1] as string).replace(',', '.'));
    if (v > 0 && Number.isFinite(v)) return v;
  }
  for (const o of options) {
    const r = optionLineR(o);
    if (r !== null && /\br\b/i.test(withoutBang(o))) return r;
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

function classifyLine(line: string): Column[] {
  return splitCells(line, delimiterOf(line)).map(classify);
}

/** A header: two or more cells, a frequency column, and (when `values`) a value column. */
function isHeader(line: string, values: boolean): boolean {
  if (isNumericLine(line)) return false;
  const cells = classifyLine(line);
  return (
    cells.length >= 2 &&
    cells.some((c) => c.role === 'freq') &&
    (!values || cells.some((c) => c.role === 's' || c.role === 'r' || c.role === 'x'))
  );
}

function splitLines(text: string): string[] {
  // trim() also removes a byte order mark.
  return text
    .split(/\r\n|\r|\n/)
    .map((l) => l.trim())
    .filter((l) => l !== '');
}

/**
 * Whether the text is Touchstone data: a Touchstone 2 `[Version]` keyword,
 * or a `#` option line (`# MHz S MA R 50`, or a bare `#`) with rows of
 * numbers (a trailing `!` comment allowed) and no column header before them.
 */
export function isTouchstoneText(text: string): boolean {
  const lines = splitLines(text);
  if (lines.some((l) => /^\[version\]/i.test(l))) return true;
  const option = lines.find((l) => l.startsWith('#') && optionLineR(l.slice(1)) !== null);
  if (option === undefined) return false;
  const body = lines.filter((l) => !isComment(l));
  const first = body[0] === undefined ? '' : withoutBang(body[0]);
  return first !== '' && isNumericLine(first);
}

const sameFrequency = (a: number, b: number): boolean =>
  (Number.isNaN(a) && Number.isNaN(b)) || Math.abs(a - b) <= 1e-9 * Math.abs(a);

/** Parse a VNA CSV export. Throws `VnaCsvError` naming what is missing. */
export function readVnaCsv(text: string): VnaCsvData {
  const lines = splitLines(text);
  const comments = lines.filter(isComment).map((l) => l.slice(1).trim());
  const options = lines.filter((l) => l.startsWith('#')).map((l) => l.slice(1).trim());
  const body = lines.filter((l) => !isComment(l));
  if (isTouchstoneText(text)) {
    const option = options.find((o) => optionLineR(o) !== null);
    const named = option === undefined ? '' : ` (option line "# ${withoutBang(option)}")`;
    throw new VnaCsvError(`Touchstone data${named}, not a VNA table: open it as .s1p or .s2p`);
  }
  const stated = statedZ0([...comments, ...body.filter((l) => !isNumericLine(l))], options);
  const z0 = stated ?? 50;

  let kind: VnaCsvKind;
  const tables: { label: string; table: Table }[] = [];
  const preamble: string[] = [];
  const notes: string[] = [];
  if (body.some((l) => /^begin\b/i.test(l))) {
    kind = 'keysight';
    let firstError: VnaCsvError | null = null;
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
      try {
        if (header === undefined || isNumericLine(header))
          throw new VnaCsvError(`${label} has no column header after BEGIN`);
        const table = readTable(header, block.slice(1), z0);
        if (table.frequencies.length === 0)
          throw new VnaCsvError(
            table.lineFrequencies.length === 0 ? 'no data rows' : 'no usable data rows',
          );
        tables.push({ label, table });
      } catch (err) {
        if (!(err instanceof VnaCsvError)) throw err;
        // One block the reader cannot use does not refuse the others.
        firstError ??= err;
        notes.push(`${label} skipped: ${err.message}`);
      }
    }
    if (tables.length === 0) {
      throw firstError
        ? new VnaCsvError(notes.join('. '))
        : new VnaCsvError('No BEGIN ... END data block');
    }
  } else {
    // The header is the last line before the data naming a frequency and a
    // value column; a title such as "Frequency sweep" is not one. Failing
    // that, a header written as a comment above the data (numpy savetxt),
    // then a line naming a frequency only, so the error says which columns
    // are missing.
    const firstData = body.findIndex(isNumericLine);
    const above = firstData < 0 ? body : body.slice(0, firstData);
    const lastIndex = (pred: (l: string) => boolean): number => {
      for (let i = above.length - 1; i >= 0; i--) if (pred(above[i] as string)) return i;
      return -1;
    };
    let h = lastIndex((l) => isHeader(l, true));
    const firstDataLine = lines.findIndex((l) => !isComment(l) && isNumericLine(l));
    const commented =
      h < 0 && firstDataLine >= 0
        ? lines
            .slice(0, firstDataLine)
            .filter(isComment)
            .reverse()
            .find((l) => isHeader(l.slice(1).trim(), true))
        : undefined;
    if (h < 0 && commented === undefined) h = lastIndex((l) => isHeader(l, false));
    let table: Table;
    if (h >= 0) {
      preamble.push(...body.slice(0, h));
      table = readTable(body[h] as string, body.slice(h + 1), z0);
    } else if (commented !== undefined) {
      preamble.push(...body.slice(0, firstData));
      table = readTable(commented.slice(1).trim(), body.slice(firstData), z0);
    } else if (firstData >= 0) {
      const named = body.slice(0, firstData).some((l) => splitCells(l, delimiterOf(l)).length > 1);
      if (named) throw new VnaCsvError(NO_FREQUENCY);
      preamble.push(...body.slice(0, firstData));
      table = readTable(null, body.slice(firstData), z0);
    } else {
      throw new VnaCsvError(body.length === 0 ? 'The file is empty' : NO_FREQUENCY);
    }
    if (table.lineFrequencies.length === 0) throw new VnaCsvError('No data rows below the header');
    kind = table.kind;
    tables.push({ label: 'table', table });
  }

  // Blocks of one sweep (the same frequency on every data line) are merged
  // row by row; a row dropped in one block is dropped in all of them.
  const first = tables[0] as { label: string; table: Table };
  notes.push(...first.table.notes);
  const merged: Table[] = [first.table];
  for (const { label, table } of tables.slice(1)) {
    notes.push(...table.notes);
    const same =
      table.lineFrequencies.length === first.table.lineFrequencies.length &&
      table.lineFrequencies.every((f, i) =>
        sameFrequency(f, first.table.lineFrequencies[i] as number),
      );
    if (same) merged.push(table);
    else notes.push(`${label} skipped: its frequencies differ from ${first.label}`);
  }
  const common = merged
    .map((t) => new Set(t.rows))
    .reduce((acc, s) => new Set([...acc].filter((r) => s.has(r))));
  const at = (t: Table): number[] => t.rows.flatMap((line, k) => (common.has(line) ? [k] : []));
  const fileFrequencies = at(first.table).map((k) => first.table.frequencies[k] as number);
  const parameters: Partial<Record<VnaSName, readonly Complex[]>> = {};
  const formats: Partial<Record<VnaSName, TouchstoneFormat>> = {};
  let impedance: Complex[] | null = null;
  let s11FromImpedance = false;
  for (const table of merged) {
    const ks = at(table);
    for (const name of VNA_S_NAMES) {
      const v = table.parameters[name];
      if (v && !parameters[name]) {
        parameters[name] = ks.map((k) => v[k] as Complex);
        formats[name] = table.formats[name] as TouchstoneFormat;
        if (name === 'S11') s11FromImpedance = table.s11FromZ;
      }
    }
    if (!impedance && table.impedance) {
      const z = table.impedance;
      impedance = ks.map((k) => z[k] as Complex);
    }
  }
  const droppedFrequency = first.table.droppedFrequency;
  const droppedValue = first.table.lineFrequencies.length - droppedFrequency - common.size;

  // Ascending frequency, the first of equal frequencies kept: the
  // interpolation and the Touchstone writer rely on it.
  const order = fileFrequencies
    .map((_, i) => i)
    .sort((a, b) => {
      const d = (fileFrequencies[a] as number) - (fileFrequencies[b] as number);
      return d !== 0 ? d : a - b;
    });
  const keep = order.filter(
    (i, k) => k === 0 || fileFrequencies[i] !== fileFrequencies[order[k - 1] as number],
  );
  const duplicate = order.length - keep.length;
  if (duplicate > 0)
    notes.push(
      `${duplicate} row${duplicate === 1 ? '' : 's'} repeating a frequency dropped; the first was kept`,
    );
  const sorted = keep.some((i, k) => i !== k);
  if (sorted && duplicate === 0) notes.push('Rows sorted by frequency');
  const pick = <T>(v: readonly T[]): T[] => keep.map((i) => v[i] as T);
  const frequencies = pick(fileFrequencies);
  for (const name of VNA_S_NAMES) {
    const v = parameters[name];
    if (v) parameters[name] = pick(v);
  }

  if (frequencies.length < 2) {
    const n = frequencies.length;
    const why: string[] = [];
    if (droppedFrequency > 0)
      why.push(`${droppedFrequency} for a zero, negative or non-finite frequency`);
    if (droppedValue > 0) why.push(`${droppedValue} for a value that is not a number`);
    if (duplicate > 0) why.push(`${duplicate} repeating a frequency`);
    throw new VnaCsvError(
      `Only ${n} usable data row${n === 1 ? '' : 's'}${why.length > 0 ? ` (dropped: ${why.join(', ')})` : ''}; at least two are needed`,
    );
  }
  return {
    kind,
    frequencies,
    parameters,
    formats,
    impedance: impedance ? pick(impedance) : null,
    s11FromImpedance: impedance !== null && s11FromImpedance,
    z0,
    z0Stated: stated !== null,
    frequencyUnit: SCALE_UNIT.get(first.table.scale) ?? 'HZ',
    comments: [...comments, ...preamble],
    dropped: droppedFrequency + droppedValue + duplicate,
    droppedBy: { frequency: droppedFrequency, value: droppedValue, duplicate },
    notes,
  };
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
  // The reader keeps only rows whose reflection gives a finite impedance.
  return data.frequencies.map((frequency, i) => ({
    frequency,
    z: impedanceOf(s[i] as Complex, data.z0),
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
