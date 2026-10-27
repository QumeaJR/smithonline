/**
 * Touchstone v1 (.s1p to .s4p) reader and writer.
 *
 * Portions derived from QuickSmith-Web, copyright 2017 Nathan Iyer, MIT license
 * (touchstone.js, commit ca1b69e612f3e7c753591e2a09c38e19110136ef): option
 * line defaults, port inference from the row shape, the noise block detection
 * rule and the linear lookup between samples. Rewritten in TypeScript with SI
 * units (Hz) and a port-count independent matrix layout.
 *
 * A file looks like this:
 *
 *      ! measured 2026-09-08, dipole on the roof
 *      # MHZ S MA R 50
 *      100.0  0.590  -86.271
 *
 * Everything on the option line is optional and defaults to `# GHZ S MA R 50`.
 * Two-port rows list S11 S21 S12 S22 (21 before 12); three and four ports are
 * written as one line per matrix row in S11 S12 ... order. A two-port file
 * may carry a noise block after its S-parameters: frequency, NFmin in dB,
 * |Gamma_opt|, angle of Gamma_opt and rn normalized to the reference impedance.
 */
import { cabs, cargDeg, complex, polarDeg, type Complex } from '../complex.js';
import { gammaToZ, zToGamma } from '../conversions.js';
import type { NoiseParameters, SParameters } from '../twoport.js';

export class TouchstoneError extends Error {
  override readonly name = 'TouchstoneError';
}

export type TouchstoneParameter = 'S' | 'Y' | 'Z' | 'G' | 'H' | 'A';
export type TouchstoneFormat = 'MA' | 'DB' | 'RI';
export type FrequencyUnit = 'HZ' | 'KHZ' | 'MHZ' | 'GHZ';

const FREQ_SCALE: Readonly<Record<FrequencyUnit, number>> = {
  HZ: 1,
  KHZ: 1e3,
  MHZ: 1e6,
  GHZ: 1e9,
};

export interface TouchstonePoint {
  /** Hz. */
  readonly frequency: number;
  /** Row-major n by n matrix: `s[i * ports + j]` is S(i+1)(j+1). */
  readonly s: readonly Complex[];
}

export interface TouchstoneNoisePoint {
  /** Hz. */
  readonly frequency: number;
  /** Minimum noise figure, dB. */
  readonly nfMinDb: number;
  /** Source reflection coefficient for minimum noise. */
  readonly gammaOpt: Complex;
  /** Equivalent noise resistance normalized to the reference impedance. */
  readonly rn: number;
}

export interface TouchstoneData {
  readonly ports: number;
  readonly parameter: TouchstoneParameter;
  /** Number format the file used; the data is always returned as complex values. */
  readonly format: TouchstoneFormat;
  /** Frequency unit of the option line. */
  readonly frequencyUnit: FrequencyUnit;
  /** Reference impedance, ohm. */
  readonly z0: number;
  readonly points: readonly TouchstonePoint[];
  /** Empty unless the file carried a noise block. */
  readonly noise: readonly TouchstoneNoisePoint[];
  /** Comment lines (without the leading `!`) in file order. */
  readonly comments: readonly string[];
}

interface Options {
  parameter: TouchstoneParameter;
  format: TouchstoneFormat;
  unit: FrequencyUnit;
  z0: number;
  /** Touchstone 2 [Two-Port Data Order]: true when the file lists S12 before S21. */
  order12_21: boolean;
  /** [Reference] values collected so far while more are expected on the following lines. */
  refValues: number[] | null;
  /** [Number of Ports] when the file states it; tells how many [Reference] values to expect. */
  declaredPorts: number | null;
  /** Inside a [Begin Information] ... [End Information] block: free text, skipped. */
  inInformation: boolean;
  /** A [Version] keyword was seen: version 2 rules apply where they differ (rn in ohm). */
  version2: boolean;
}

/** [Reference] values: one per port; equal values set the reference impedance, unequal ones are refused. */
function readReference(values: string, opts: Options): void {
  const refs = values
    .split(/\s+/)
    .filter((t) => t !== '')
    .map(Number);
  if (!refs.every((r) => Number.isFinite(r) && r > 0)) {
    throw new TouchstoneError(`Invalid [Reference] values "${values}"`);
  }
  const all = [...(opts.refValues ?? []), ...refs];
  const needed = opts.declaredPorts ?? (all.length > 0 ? all.length : 1);
  if (all.length < needed) {
    // The values continue on the following lines (allowed by the version 2 format).
    opts.refValues = all;
    return;
  }
  opts.refValues = null;
  applyReference(all, opts);
}

/** Equal references set the reference impedance; unequal ones need the full version 2 model. */
function applyReference(all: readonly number[], opts: Options): void {
  if (all.some((r) => r !== all[0])) {
    throw new TouchstoneError('Touchstone 2 files with per-port references are not supported');
  }
  opts.z0 = all[0] as number;
}

/**
 * A [Reference] with fewer values than ports when the data (or the next
 * keyword) begins: one value is taken as the common reference, as writers
 * that give a single value mean it; none at all is an error.
 */
function finishReference(opts: Options): void {
  const pending = opts.refValues;
  if (pending === null) return;
  opts.refValues = null;
  if (pending.length === 0) throw new TouchstoneError('[Reference] without values');
  applyReference(pending, opts);
}

/** A line while [Reference] values are still expected: taken as values when it looks like them. */
function continuesReference(line: string, opts: Options): boolean {
  if (opts.refValues === null) return false;
  const count = line.split(/\s+/).filter((t) => t !== '').length;
  const remaining = (opts.declaredPorts ?? 1) - opts.refValues.length;
  // A data row holds at least three numbers; reference lines never hold more than are missing.
  return count > 0 && count <= remaining;
}

/**
 * Touchstone 2 bracket keywords. The ones that change the layout of plain
 * data are honoured; files that need the full version 2 model (mixed-mode
 * ports, lower or upper triangle matrices, per-port references) are refused
 * with a clear message rather than read wrongly.
 */
function readKeyword(line: string, opts: Options): void {
  const m = /^\[([^\]]+)\]\s*(.*)$/.exec(line);
  if (!m) return;
  const key = (m[1] as string).trim().toLowerCase();
  const value = (m[2] as string).trim().toUpperCase();
  switch (key) {
    case 'version':
      opts.version2 = true;
      return;
    case 'number of ports': {
      const n = Number(value);
      if (Number.isInteger(n) && n > 0) opts.declaredPorts = n;
      return;
    }
    case 'begin information':
      opts.inInformation = true;
      return;
    case 'end information':
      opts.inInformation = false;
      return;
    case 'two-port data order':
      opts.order12_21 = value === '12_21';
      return;
    case 'matrix format':
      if (value && value !== 'FULL') {
        throw new TouchstoneError(
          `Touchstone 2 [Matrix Format] ${value} is not supported (Full only)`,
        );
      }
      return;
    case 'mixed-mode order':
      throw new TouchstoneError('Touchstone 2 mixed-mode files are not supported');
    case 'reference':
      readReference(value, opts);
      return;
    default:
      return; // [Version], [Number of Ports], [Network Data], [End] and the like carry nothing to act on
  }
}

const PARAMETERS = new Set<string>(['S', 'Y', 'Z', 'G', 'H', 'A']);
const FORMATS = new Set<string>(['MA', 'DB', 'RI']);

function readOptionLine(line: string, opts: Options): void {
  const parts = line
    .slice(1)
    .trim()
    .toUpperCase()
    .split(/\s+/)
    .filter((t) => t !== '');
  let seenR = false;
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i] as string;
    if (p in FREQ_SCALE) opts.unit = p as FrequencyUnit;
    else if (PARAMETERS.has(p)) opts.parameter = p as TouchstoneParameter;
    else if (FORMATS.has(p)) opts.format = p as TouchstoneFormat;
    else if (p === 'R') {
      // R takes one number. A word after it ("R abc", "R 50OHM", "R 1,5") and a second R are
      // refused; a missing, zero or negative value keeps the 50 ohm default.
      if (seenR) throw new TouchstoneError('Two R values on the Touchstone option line');
      seenR = true;
      const text = parts[i + 1];
      if (text === undefined) continue;
      const r = Number(text);
      if (!Number.isFinite(r)) {
        throw new TouchstoneError(`Unknown option "${text}" after R on the Touchstone option line`);
      }
      if (r > 0) opts.z0 = r;
      i++;
    } else {
      throw new TouchstoneError(`Unknown option "${p}" on the Touchstone option line`);
    }
  }
}

function toComplex(a: number, b: number, format: TouchstoneFormat): Complex {
  if (format === 'RI') return complex(a, b);
  const mag = format === 'DB' ? 10 ** (a / 20) : a;
  return polarDeg(mag, b);
}

/** .s1p / .s2p / .s3p ... to 1 / 2 / 3; null when the name is not a Touchstone name. */
export function portsFromFileName(name: string): number | null {
  const m = /\.s(\d+)p$/i.exec(name);
  return m ? parseInt(m[1] as string, 10) : null;
}

/**
 * How many ports, when the file name did not say: one frequency plus 2 n^2
 * numbers per point. A four-port's first line also holds 9 numbers (one
 * matrix row per line), so a row of 9 followed by a row of 8 is a four-port.
 */
function inferPorts(rows: readonly number[][], total: number): number {
  const shape = shapePorts(rows);
  if (shape !== null) return shape;
  for (let p = 1; p <= 4; p++) if (total % (1 + 2 * p * p) === 0) return p;
  throw new TouchstoneError('Cannot tell the number of ports from the data rows');
}

/**
 * The port count the first two rows unmistakably show, or null when the
 * shape is ambiguous (a point wrapped over several lines, for example 3
 * numbers followed by 6 for a two-port).
 */
function shapePorts(rows: readonly number[][]): number | null {
  const first = rows[0]?.length;
  const second = rows[1]?.length;
  if (first === 3 && (second === undefined || second === 3)) return 1;
  if (first === 9 && (second === undefined || second === 9 || second === 5)) return 2;
  if (first === 9 && second === 8) return 4;
  if (first === 7 && second === 6) return 3;
  return null;
}

/**
 * How many of the numbers are S-parameters. A noise block row holds five
 * numbers, starts on a point boundary and restarts the sweep at a frequency
 * the S-parameters have already passed; wrapped two-port data never does.
 */
function sParameterCount(rows: readonly number[][], ports: number, stride: number): number {
  const all = rows.reduce((n, r) => n + r.length, 0);
  if (ports !== 2) return all;
  let seen = 0;
  let lastFreq = -Infinity;
  for (const row of rows) {
    const onBoundary = seen % stride === 0;
    if (row.length === 5 && seen > 0 && onBoundary && (row[0] as number) <= lastFreq) return seen;
    if (onBoundary) lastFreq = row[0] as number;
    seen += row.length;
  }
  return all;
}

/**
 * Parse a Touchstone v1 file. `ports` comes from the file extension when
 * known (`portsFromFileName`); otherwise it is inferred from the row shape.
 */
export function readTouchstone(text: string, ports?: number | null): TouchstoneData {
  if (typeof text !== 'string' || !text.trim()) throw new TouchstoneError('Empty file');
  const opts: Options = {
    parameter: 'S',
    format: 'MA',
    unit: 'GHZ',
    z0: 50,
    order12_21: false,
    refValues: null,
    declaredPorts: null,
    inInformation: false,
    version2: false,
  };
  const rows: number[][] = [];
  const comments: string[] = [];
  let sawOption = false;
  const lines = text.split(/\r\n|\r|\n/);
  for (let at = 0; at < lines.length; at++) {
    let line = lines[at] as string;
    const bang = line.indexOf('!');
    if (bang >= 0) {
      comments.push(line.slice(bang + 1).trim());
      line = line.slice(0, bang);
    }
    line = line.trim();
    if (!line) continue;
    if (line.startsWith('#')) {
      if (!sawOption) {
        readOptionLine(line, opts);
        sawOption = true;
      }
      continue;
    }
    if (line.startsWith('[')) {
      finishReference(opts);
      readKeyword(line, opts);
      continue;
    }
    if (opts.inInformation) continue;
    if (continuesReference(line, opts)) {
      readReference(line, opts);
      continue;
    }
    finishReference(opts);
    const row: number[] = [];
    for (const token of line.split(/[\s,]+/).filter((t) => t !== '')) {
      const v = Number(token);
      // The line number, so a bad file says where (D6 QA round 3).
      if (!Number.isFinite(v))
        throw new TouchstoneError(`Not a number on line ${at + 1}: "${token}"`);
      row.push(v);
    }
    rows.push(row);
  }
  const total = rows.reduce((n, r) => n + r.length, 0);
  if (total === 0) throw new TouchstoneError('No data rows');

  const n = ports && ports > 0 ? ports : inferPorts(rows, total);
  if (n > 4) throw new TouchstoneError(`${n}-port files are not supported (1 to 4 ports)`);
  const shape = shapePorts(rows);
  if (shape !== null && shape !== n) {
    throw new TouchstoneError(
      `The file name says ${n} ports but the rows hold ${shape}-port data (${rows[0]?.length} numbers on the first line)`,
    );
  }
  const stride = 1 + 2 * n * n;
  const numbers = rows.flat();
  const sCount = sParameterCount(rows, n, stride);
  const rest = numbers.slice(sCount);
  const data = numbers.slice(0, sCount);
  if (data.length % stride !== 0) {
    throw new TouchstoneError(
      `Expected ${stride} numbers per frequency for a ${n}-port file, got ${data.length} in total`,
    );
  }
  const scale = FREQ_SCALE[opts.unit];
  const points: TouchstonePoint[] = [];
  for (let k = 0; k < data.length; k += stride) {
    const raw: Complex[] = [];
    for (let p = 0; p < n * n; p++) {
      raw.push(
        toComplex(data[k + 1 + 2 * p] as number, data[k + 2 + 2 * p] as number, opts.format),
      );
    }
    // Two-port files list S11 S21 S12 S22 (unless a version 2 file says
    // 12_21); store row-major S11 S12 S21 S22.
    const s =
      n === 2 && !opts.order12_21 ? [raw[0], raw[2], raw[1], raw[3]].map((c) => c as Complex) : raw;
    points.push({ frequency: (data[k] as number) * scale, s });
  }
  if (points.some((p) => p.frequency < 0)) {
    throw new TouchstoneError('Frequencies must not be negative');
  }
  for (let i = 1; i < points.length; i++) {
    if ((points[i] as TouchstonePoint).frequency < (points[i - 1] as TouchstonePoint).frequency) {
      throw new TouchstoneError('Frequencies must be ascending');
    }
  }
  const noise: TouchstoneNoisePoint[] = [];
  if (rest.length > 0) {
    if (rest.length % 5 !== 0) {
      throw new TouchstoneError('Noise block must have five numbers per frequency');
    }
    for (let k = 0; k < rest.length; k += 5) {
      noise.push({
        frequency: (rest[k] as number) * scale,
        nfMinDb: rest[k + 1] as number,
        // Touchstone 1 writes Gamma_opt as magnitude and angle whatever the
        // option line says (docs/01 section 7); NFmin is dB and rn a ratio.
        gammaOpt: toComplex(rest[k + 2] as number, rest[k + 3] as number, 'MA'),
        // Version 1 normalizes rn to the reference impedance; version 2 writes ohm.
        rn: opts.version2 ? (rest[k + 4] as number) / opts.z0 : (rest[k + 4] as number),
      });
    }
  }
  return {
    ports: n,
    parameter: opts.parameter,
    format: opts.format,
    frequencyUnit: opts.unit,
    z0: opts.z0,
    points,
    noise,
    comments,
  };
}

/** Index of S(i,j) (1-based) in a point's matrix. */
export function sIndex(ports: number, i: number, j: number): number {
  return (i - 1) * ports + (j - 1);
}

/**
 * Where `f` sits between two samples: the bracketing indices and the mix
 * factor, clamped to the ends outside the measured range.
 */
function bracket(frequencies: readonly number[], f: number): [number, number, number] {
  const n = frequencies.length;
  if (n === 1) return [0, 0, 0];
  let lo = 0;
  while (lo < n - 2 && (frequencies[lo + 1] as number) < f) lo++;
  const a = frequencies[lo] as number;
  const b = frequencies[lo + 1] as number;
  const span = b - a;
  const t = span === 0 ? 0 : Math.max(0, Math.min(1, (f - a) / span));
  return [lo, lo + 1, t];
}

function mix(a: Complex, b: Complex, t: number): Complex {
  return complex(a.re + t * (b.re - a.re), a.im + t * (b.im - a.im));
}

export interface SParametersAt {
  readonly s: SParameters;
  /** Hz, the requested frequency. */
  readonly frequency: number;
  /** Lowest and highest frequency in the file. */
  readonly covers: readonly [number, number];
  /** True when `frequency` lies outside the file and the nearest end was used. */
  readonly clamped: boolean;
}

/**
 * The two-port S-parameters at a frequency, interpolated linearly in
 * rectangular form between samples and held at the nearest end outside the
 * measured range. Null for files with fewer than two ports; for three and four
 * ports the first two ports are used.
 */
export function sParametersAt(data: TouchstoneData, f: number): SParametersAt | null {
  if (data.ports < 2 || data.points.length === 0) return null;
  const freqs = data.points.map((p) => p.frequency);
  const [lo, hi, t] = bracket(freqs, f);
  const a = data.points[lo] as TouchstonePoint;
  const b = data.points[hi] as TouchstonePoint;
  const n = data.ports;
  const at = (i: number, j: number): Complex =>
    mix(a.s[sIndex(n, i, j)] as Complex, b.s[sIndex(n, i, j)] as Complex, t);
  const first = freqs[0] as number;
  const last = freqs[freqs.length - 1] as number;
  return {
    s: { s11: at(1, 1), s12: at(1, 2), s21: at(2, 1), s22: at(2, 2) },
    frequency: f,
    covers: [first, last],
    clamped: f < first || f > last,
  };
}

/** One reflection coefficient S(i,i) at a frequency, interpolated as above. */
export function reflectionAt(data: TouchstoneData, f: number, port = 1): Complex | null {
  if (data.points.length === 0 || port < 1 || port > data.ports) return null;
  const freqs = data.points.map((p) => p.frequency);
  const [lo, hi, t] = bracket(freqs, f);
  const k = sIndex(data.ports, port, port);
  return mix(
    (data.points[lo] as TouchstonePoint).s[k] as Complex,
    (data.points[hi] as TouchstonePoint).s[k] as Complex,
    t,
  );
}

/** The noise parameters at a frequency, or null when the file has no noise block. */
export function noiseAt(data: TouchstoneData, f: number): NoiseParameters | null {
  const n = data.noise;
  if (n.length === 0) return null;
  const [lo, hi, t] = bracket(
    n.map((p) => p.frequency),
    f,
  );
  const a = n[lo] as TouchstoneNoisePoint;
  const b = n[hi] as TouchstoneNoisePoint;
  return {
    nfMinDb: a.nfMinDb + t * (b.nfMinDb - a.nfMinDb),
    gammaOpt: mix(a.gammaOpt, b.gammaOpt, t),
    rn: a.rn + t * (b.rn - a.rn),
  };
}

/**
 * A reflection coefficient measured against `from` ohm, re-referenced to
 * `to` ohm through the impedance it represents. Exact for a one-port.
 */
export function renormalizeGamma(gamma: Complex, from: number, to: number): Complex {
  if (Math.abs(from - to) < 1e-12) return gamma;
  return zToGamma(gammaToZ(gamma, from), to);
}

/** Impedance of the port-`port` reflection coefficient at every frequency. */
export function impedanceRows(data: TouchstoneData, port = 1): { frequency: number; z: Complex }[] {
  if (port < 1 || port > data.ports) return [];
  const k = sIndex(data.ports, port, port);
  return data.points.map((p) => ({
    frequency: p.frequency,
    z: gammaToZ(p.s[k] as Complex, data.z0),
  }));
}

export interface TouchstoneWriteOptions {
  readonly format?: TouchstoneFormat;
  readonly frequencyUnit?: FrequencyUnit;
  /** 'A' writes a chain (ABCD) matrix in the order A B C D; not a Touchstone 1 keyword, the reader labels such a file A and the S-Plot refuses it. */
  readonly parameter?: TouchstoneParameter;
  /** Comment lines written at the top, without the `!`. */
  readonly comments?: readonly string[];
  /** Significant digits per number. Default 8. */
  readonly digits?: number;
}

function fmt(v: number, digits: number): string {
  if (!Number.isFinite(v)) throw new TouchstoneError(`Cannot write a non-finite value (${v})`);
  if (v === 0) return '0';
  const s = Number(v.toPrecision(digits)).toString();
  return s.includes('e') ? v.toExponential(digits - 1) : s;
}

function pair(c: Complex, format: TouchstoneFormat, digits: number): [string, string] {
  switch (format) {
    case 'RI':
      return [fmt(c.re, digits), fmt(c.im, digits)];
    case 'DB':
      // A zero parameter has no dB value; -400 dB (1e-20) keeps the file readable.
      return [fmt(Math.max(-400, 20 * Math.log10(cabs(c))), digits), fmt(cargDeg(c), digits)];
    case 'MA':
      return [fmt(cabs(c), digits), fmt(cargDeg(c), digits)];
  }
}

export interface TouchstoneWriteData {
  readonly ports: number;
  /** Reference impedance, ohm. */
  readonly z0: number;
  readonly points: readonly TouchstonePoint[];
  readonly noise?: readonly TouchstoneNoisePoint[];
}

/**
 * Write a Touchstone v1 file. Points carry the row-major matrix of
 * `TouchstonePoint`; two-port rows are written in the file's S11 S21 S12 S22
 * order, three and four ports as one line per matrix row.
 */
export function writeTouchstone(
  data: TouchstoneWriteData,
  options: TouchstoneWriteOptions = {},
): string {
  const n = data.ports;
  if (n < 1 || n > 4) throw new TouchstoneError('1 to 4 ports are supported');
  const format = options.format ?? 'MA';
  const unit = options.frequencyUnit ?? 'GHZ';
  const parameter = options.parameter ?? 'S';
  const digits = Number.isFinite(options.digits)
    ? Math.min(17, Math.max(1, Math.round(options.digits as number)))
    : 8;
  const scale = FREQ_SCALE[unit];
  const lines: string[] = [];
  for (const c of options.comments ?? []) lines.push(`! ${c}`);
  lines.push(`# ${unit} ${parameter} ${format} R ${fmt(data.z0, digits)}`);
  const chain = parameter === 'A';
  if (n === 2) {
    lines.push(
      chain ? '! f A B C D' : `! f ${[11, 21, 12, 22].map((k) => parameter + k).join(' ')}`,
    );
  }
  for (const p of data.points) {
    if (p.s.length !== n * n) {
      throw new TouchstoneError(
        `Point at ${p.frequency} Hz has ${p.s.length} values, expected ${n * n}`,
      );
    }
    const f = fmt(p.frequency / scale, Math.max(digits, 15)); // frequencies stay distinct whatever the data precision
    if (n === 1) {
      lines.push([f, ...pair(p.s[0] as Complex, format, digits)].join(' '));
    } else if (n === 2) {
      const order = chain
        ? [0, 1, 2, 3]
        : [sIndex(2, 1, 1), sIndex(2, 2, 1), sIndex(2, 1, 2), sIndex(2, 2, 2)];
      lines.push([f, ...order.flatMap((k) => pair(p.s[k] as Complex, format, digits))].join(' '));
    } else {
      for (let i = 1; i <= n; i++) {
        const cells: string[] = [];
        for (let j = 1; j <= n; j++)
          cells.push(...pair(p.s[sIndex(n, i, j)] as Complex, format, digits));
        lines.push((i === 1 ? [f, ...cells] : ['', ...cells]).join(' ').replace(/^ /, '    '));
      }
    }
  }
  if (data.noise && data.noise.length > 0) {
    if (n !== 2) throw new TouchstoneError('Only two-port files carry a noise block');
    lines.push('! f NFmin(dB) |Gopt| ang(Gopt) rn/Z0');
    for (const q of data.noise) {
      const g = pair(q.gammaOpt, 'MA', digits);
      lines.push(
        [fmt(q.frequency / scale, digits), fmt(q.nfMinDb, digits), ...g, fmt(q.rn, digits)].join(
          ' ',
        ),
      );
    }
  }
  return lines.join('\n') + '\n';
}

/** Build a two-port point from the named parameters. */
export function twoPortPoint(frequency: number, s: SParameters): TouchstonePoint {
  return { frequency, s: [s.s11, s.s12, s.s21, s.s22] };
}
