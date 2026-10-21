/**
 * Delimited ASCII export of datapoints and circles in the column layout of
 * Smith V4.1 (docs/01-original-analysis.md section 5).
 *
 * Datapoints: `Start DP;Point;R[Ohm];X[Ohm];Q;Frequency[Hz]`, one line per
 * datapoint with `true` or `false` in the first column, then the sweep points.
 * Circles: one line per circle,
 *   `G1;input plane const. gain circle;gain;Gmax;s11 mag;ang;s21 mag;ang;s12 mag;ang;s22 mag;ang;freq;`
 *   `N1;NF;NFmin;Gopt mag;ang;rn;freq;`
 *   `S1;Input plane stability circle;stable outside;K;s11 mag;ang;...;freq;`
 * The delimiter is none (columns padded with spaces), a semicolon or a comma.
 */
import { cabs, cargDeg, type Complex } from '../complex.js';
import { qFactor } from '../conversions.js';
import type { NoiseParameters, SParameters } from '../twoport.js';

export type AsciiDelimiter = 'none' | 'semicolon' | 'comma';

export interface AsciiDatapoint {
  /** The user datapoint the chain starts from. */
  readonly start: boolean;
  /** DP1, TP2, ... SP1. */
  readonly label: string;
  readonly z: Complex;
  /** Hz. */
  readonly frequency: number;
}

export interface AsciiGainCircle {
  readonly plane: 1 | 2;
  readonly gainDb: number;
  readonly gmaxDb: number;
}

export interface AsciiStabilityCircle {
  readonly plane: 1 | 2;
  readonly stableInside: boolean;
  readonly k: number;
}

export interface AsciiCircles {
  readonly s: SParameters | null;
  readonly noise: NoiseParameters | null;
  /** Hz. */
  readonly frequency: number;
  readonly gain: readonly AsciiGainCircle[];
  /** Noise figure circles, dB. */
  readonly noiseDb: readonly number[];
  readonly stability: readonly AsciiStabilityCircle[];
}

export interface AsciiExportOptions {
  readonly delimiter?: AsciiDelimiter;
  /** Significant digits per number. Default 10, like the original's doubles. */
  readonly digits?: number;
}

/** A non-finite value (Q of a short, K of a unilateral device) is written as an empty cell. */
function num(v: number, digits: number): string {
  if (!Number.isFinite(v)) return '';
  return String(Number(v.toPrecision(digits)));
}

function joinRows(
  rows: readonly (readonly string[])[],
  delimiter: AsciiDelimiter,
  trailing: boolean,
): string {
  if (delimiter === 'none') {
    const widths: number[] = [];
    for (const r of rows) r.forEach((c, i) => (widths[i] = Math.max(widths[i] ?? 0, c.length)));
    return rows
      .map((r) =>
        r
          .map((c, i) => (i === r.length - 1 ? c : c.padEnd((widths[i] ?? 0) + 2)))
          .join('')
          .trimEnd(),
      )
      .join('\n');
  }
  const d = delimiter === 'comma' ? ',' : ';';
  return rows.map((r) => r.join(d) + (trailing ? d : '')).join('\n');
}

/** The datapoint table. */
export function writeAsciiDatapoints(
  points: readonly AsciiDatapoint[],
  options: AsciiExportOptions = {},
): string {
  const digits = options.digits ?? 10;
  const rows: string[][] = [['Start DP', 'Point', 'R[Ohm]', 'X[Ohm]', 'Q', 'Frequency[Hz]']];
  for (const p of points) {
    rows.push([
      p.start ? 'true' : 'false',
      p.label,
      num(p.z.re, digits),
      num(p.z.im, digits),
      num(qFactor(p.z), digits),
      num(p.frequency, digits),
    ]);
  }
  return joinRows(rows, options.delimiter ?? 'semicolon', false) + '\n';
}

function sCells(s: SParameters, digits: number): string[] {
  return [s.s11, s.s21, s.s12, s.s22].flatMap((c) => [
    num(cabs(c), digits),
    num(cargDeg(c), digits),
  ]);
}

/** One line per circle; empty string when there are no circles. */
export function writeAsciiCircles(circles: AsciiCircles, options: AsciiExportOptions = {}): string {
  const digits = options.digits ?? 10;
  const rows: string[][] = [];
  const f = num(circles.frequency, digits);
  if (circles.s) {
    circles.gain.forEach((g, i) => {
      rows.push([
        `G${i + 1}`,
        `${g.plane === 1 ? 'input' : 'output'} plane const. gain circle`,
        num(g.gainDb, digits),
        num(g.gmaxDb, digits),
        ...sCells(circles.s as SParameters, digits),
        f,
      ]);
    });
    circles.stability.forEach((c, i) => {
      rows.push([
        `S${i + 1}`,
        `${c.plane === 1 ? 'Input' : 'Output'} plane stability circle`,
        c.stableInside ? 'stable inside' : 'stable outside',
        num(c.k, digits),
        ...sCells(circles.s as SParameters, digits),
        f,
      ]);
    });
  }
  if (circles.noise) {
    const n = circles.noise;
    circles.noiseDb.forEach((nf, i) => {
      rows.push([
        `N${i + 1}`,
        num(nf, digits),
        num(n.nfMinDb, digits),
        num(cabs(n.gammaOpt), digits),
        num(cargDeg(n.gammaOpt), digits),
        num(n.rn, digits),
        f,
      ]);
    });
  }
  if (rows.length === 0) return '';
  return joinRows(rows, options.delimiter ?? 'semicolon', true) + '\n';
}

/** Datapoints followed by a blank line and the circles, as one file. */
export function writeAscii(
  points: readonly AsciiDatapoint[],
  circles: AsciiCircles | null,
  options: AsciiExportOptions = {},
): string {
  const dp = writeAsciiDatapoints(points, options);
  const c = circles ? writeAsciiCircles(circles, options) : '';
  return c ? `${dp}\n${c}` : dp;
}
