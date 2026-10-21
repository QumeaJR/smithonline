/**
 * CITIfile reader (Keysight / HP "Common Instrumentation Transfer and
 * Interchange" file). Written from the public format description, see
 * docs/01-original-analysis.md section 7.
 *
 *      CITIFILE A.01.00
 *      NAME DATA
 *      VAR FREQ MAG 3
 *      DATA S[1,1] RI
 *      DATA S[2,1] RI
 *      VAR_LIST_BEGIN
 *      1000000000
 *      ...
 *      VAR_LIST_END
 *      BEGIN
 *      -0.1,0.2
 *      ...
 *      END
 *
 * A file can hold several packages, each starting with its own `CITIFILE`
 * line. Data arrays appear in declaration order, one `BEGIN ... END` block
 * each, with `RI` (real, imaginary) or `MAGANGLE` (magnitude, degrees)
 * values. `SEG_LIST_BEGIN` segments (start, stop, points) are expanded.
 */
import { complex, polarDeg, type Complex } from '../complex.js';
import type { TouchstoneData } from './touchstone.js';

export class CitiError extends Error {
  override readonly name = 'CitiError';
}

export interface CitiArray {
  /** The name as declared, for example `S[1,1]`. */
  readonly name: string;
  readonly format: 'RI' | 'MAGANGLE' | 'MAG' | 'DBANGLE';
  readonly values: readonly Complex[];
}

export interface CitiPackage {
  readonly version: string;
  readonly name: string;
  /** Independent variable name, usually FREQ. */
  readonly variable: string;
  /** Independent variable values in file order (Hz for FREQ). */
  readonly variableValues: readonly number[];
  readonly arrays: readonly CitiArray[];
  /** `#` and `COMMENT` lines. */
  readonly comments: readonly string[];
}

const FORMATS = new Set(['RI', 'MAGANGLE', 'MAG', 'DBANGLE']);

function toComplex(a: number, b: number, format: CitiArray['format']): Complex {
  switch (format) {
    case 'RI':
      return complex(a, b);
    case 'MAG':
      return complex(a, 0);
    case 'MAGANGLE':
      return polarDeg(a, b);
    case 'DBANGLE':
      return polarDeg(10 ** (a / 20), b);
  }
}

function numberOf(token: string, where: string): number {
  const v = Number(token);
  if (!Number.isFinite(v)) throw new CitiError(`Not a number: "${token}" in ${where}`);
  return v;
}

/** Parse every package of a CITIfile. */
export function readCiti(text: string): CitiPackage[] {
  const lines = text.split(/\r\n|\r|\n/);
  const packages: CitiPackage[] = [];
  let i = 0;
  const peek = (): string | undefined => lines[i]?.trim();
  while (i < lines.length) {
    const line = peek();
    if (line === undefined) break;
    if (!/^CITIFILE\b/i.test(line)) {
      i++;
      continue;
    }
    const version = line.replace(/^CITIFILE\s*/i, '').trim();
    i++;
    let name = '';
    let variable = 'FREQ';
    let declaredCount: number | null = null;
    const declared: { name: string; format: CitiArray['format'] }[] = [];
    const comments: string[] = [];
    let variableValues: number[] = [];
    const arrays: CitiArray[] = [];
    while (i < lines.length) {
      const l = peek() as string;
      if (/^CITIFILE\b/i.test(l)) break;
      i++;
      if (!l) continue;
      const upper = l.toUpperCase();
      if (l.startsWith('#') || upper.startsWith('COMMENT')) {
        comments.push(l.replace(/^(#|COMMENT)\s*/i, ''));
      } else if (/^NAME\b/.test(upper)) {
        name = l.slice(4).trim();
      } else if (/^VAR\s/.test(upper)) {
        const parts = l.split(/\s+/);
        variable = parts[1] ?? 'FREQ';
        declaredCount = parts[3] !== undefined ? numberOf(parts[3], 'VAR') : null;
      } else if (/^DATA\b/.test(upper)) {
        const parts = l.slice(4).trim().split(/\s+/);
        const fmt = (parts[1] ?? 'RI').toUpperCase();
        if (!FORMATS.has(fmt)) throw new CitiError(`Unknown data format "${parts[1]}"`);
        declared.push({ name: parts[0] ?? '', format: fmt as CitiArray['format'] });
      } else if (upper === 'VAR_LIST_BEGIN') {
        const values: number[] = [];
        while (i < lines.length && (peek() as string).toUpperCase() !== 'VAR_LIST_END') {
          const v = peek() as string;
          i++;
          if (v) values.push(numberOf(v, 'VAR_LIST'));
        }
        if (i >= lines.length) throw new CitiError('VAR_LIST_BEGIN without VAR_LIST_END');
        i++;
        variableValues = values;
      } else if (upper === 'SEG_LIST_BEGIN') {
        const values: number[] = [];
        while (i < lines.length && (peek() as string).toUpperCase() !== 'SEG_LIST_END') {
          const seg = (peek() as string).split(/\s+/);
          i++;
          if (seg[0]?.toUpperCase() === 'SEG') {
            const start = numberOf(seg[1] ?? '', 'SEG');
            const stop = numberOf(seg[2] ?? '', 'SEG');
            const points = Math.max(1, Math.round(numberOf(seg[3] ?? '', 'SEG')));
            for (let k = 0; k < points; k++) {
              values.push(points === 1 ? start : start + ((stop - start) * k) / (points - 1));
            }
          }
        }
        if (i >= lines.length) throw new CitiError('SEG_LIST_BEGIN without SEG_LIST_END');
        i++;
        variableValues = values;
      } else if (upper === 'BEGIN') {
        const decl = declared[arrays.length];
        if (!decl) throw new CitiError('More BEGIN blocks than DATA declarations');
        const values: Complex[] = [];
        while (i < lines.length && (peek() as string).toUpperCase() !== 'END') {
          const v = peek() as string;
          i++;
          if (!v) continue;
          const parts = v.split(/[\s,]+/).filter((p) => p !== '');
          const a = numberOf(parts[0] ?? '', decl.name);
          const b = parts.length > 1 ? numberOf(parts[1] as string, decl.name) : 0;
          values.push(toComplex(a, b, decl.format));
        }
        if (i >= lines.length) throw new CitiError(`BEGIN without END in ${decl.name}`);
        i++;
        arrays.push({ name: decl.name, format: decl.format, values });
      }
      // Other keywords (CONSTANT, SEG, device-specific lines) are ignored.
    }
    if (arrays.length !== declared.length) {
      throw new CitiError(
        `Package "${name}" declares ${declared.length} data arrays but holds ${arrays.length}`,
      );
    }
    const count = variableValues.length;
    // Declared data without points is a broken file; a header-only package is left to the caller.
    if (count === 0 && declared.length > 0)
      throw new CitiError(`Package "${name}" holds no points`);
    if (declaredCount !== null && declaredCount !== count) {
      throw new CitiError(`VAR declares ${declaredCount} points but the list has ${count}`);
    }
    for (const a of arrays) {
      if (a.values.length !== count) {
        throw new CitiError(`${a.name} has ${a.values.length} values for ${count} points`);
      }
    }
    packages.push({ version, name, variable, variableValues, arrays, comments });
  }
  if (packages.length === 0) throw new CitiError('Not a CITIfile: no CITIFILE header');
  return packages;
}

/** The array named `S[i,j]` (any spacing), or null. */
export function citiArray(pkg: CitiPackage, i: number, j: number): CitiArray | null {
  const re = new RegExp(`^S\\s*\\[\\s*${i}\\s*,\\s*${j}\\s*\\]$`, 'i');
  return pkg.arrays.find((a) => re.test(a.name)) ?? null;
}

/** The highest port index that appears in the package's `S[i,j]` arrays. */
export function citiPorts(pkg: CitiPackage): number {
  let n = 0;
  for (const a of pkg.arrays) {
    const m = /^S\s*\[\s*(\d+)\s*,\s*(\d+)\s*\]$/i.exec(a.name);
    if (m) n = Math.max(n, Number(m[1]), Number(m[2]));
  }
  return n;
}

/**
 * A package's `S[i,j]` arrays as Touchstone data, so the lookup helpers
 * (`sParametersAt`, `reflectionAt`, `impedanceRows`) work on CITI files too.
 * CITIfiles do not state a reference impedance; `z0` defaults to 50 ohm.
 * Arrays the package lacks are filled with zero.
 */
export function touchstoneFromCiti(pkg: CitiPackage, z0 = 50): TouchstoneData {
  const ports = citiPorts(pkg);
  if (ports === 0) throw new CitiError(`Package "${pkg.name}" holds no S[i,j] arrays`);
  if (pkg.variableValues.length === 0) throw new CitiError(`Package "${pkg.name}" holds no points`);
  const arrays: (CitiArray | null)[] = [];
  for (let i = 1; i <= ports; i++)
    for (let j = 1; j <= ports; j++) arrays.push(citiArray(pkg, i, j));
  const points = pkg.variableValues.map((frequency, k) => ({
    frequency,
    s: arrays.map((a) => a?.values[k] ?? complex(0, 0)),
  }));
  return {
    ports,
    parameter: 'S',
    format: 'RI',
    frequencyUnit: 'HZ',
    z0,
    points,
    noise: [],
    comments: pkg.comments,
  };
}
