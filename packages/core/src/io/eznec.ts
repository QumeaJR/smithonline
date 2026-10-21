/**
 * EZNEC `Lastz.txt` reader: the source impedance table EZNEC writes after a
 * frequency sweep. Quoted header lines, then a quoted column header
 *
 *      "Freq MHz","Src #","R","X","SWR (50 ohms)","SWR (alt. Z0)"
 *
 * and comma-separated rows. Only the frequency, source number, R and X are
 * used; the SWR columns are recomputed from R and X when needed.
 */
import { complex, type Complex } from '../complex.js';

export class EznecError extends Error {
  override readonly name = 'EznecError';
}

export interface EznecRow {
  /** Hz. */
  readonly frequency: number;
  /** Source number, 1 for the usual single-source model. */
  readonly source: number;
  /** Feedpoint impedance, ohm. */
  readonly z: Complex;
}

export interface EznecData {
  /** Header lines with their quotes removed. */
  readonly header: readonly string[];
  readonly rows: readonly EznecRow[];
}

function cells(line: string): string[] {
  return line.split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
}

/** Parse a Lastz.txt file. */
export function readEznec(text: string): EznecData {
  const header: string[] = [];
  const rows: EznecRow[] = [];
  let columns: string[] | null = null;
  for (const raw of text.split(/\r\n|\r|\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const c = cells(line);
    if (columns === null) {
      if (c.length >= 3 && /^freq/i.test(c[0] as string)) {
        columns = c.map((h) => h.toLowerCase());
      } else {
        header.push(c.join(', '));
      }
      continue;
    }
    const fi = columns.findIndex((h) => h.startsWith('freq'));
    const si = columns.findIndex((h) => h.startsWith('src'));
    const ri = columns.findIndex((h) => h === 'r');
    const xi = columns.findIndex((h) => h === 'x');
    if (fi < 0 || ri < 0 || xi < 0) throw new EznecError('Column header lacks Freq, R or X');
    const cell = (i: number): number => {
      const t = c[i] ?? '';
      return t === '' ? NaN : Number(t);
    };
    const f = cell(fi);
    const r = cell(ri);
    const x = cell(xi);
    if (![f, r, x].every(Number.isFinite)) throw new EznecError(`Bad row: "${line}"`);
    const unit = /ghz/i.test(columns[fi] as string)
      ? 1e9
      : /khz/i.test(columns[fi] as string)
        ? 1e3
        : 1e6;
    rows.push({
      frequency: f * unit,
      source: si >= 0 ? Number(c[si]) || 1 : 1,
      z: complex(r, x),
    });
  }
  if (columns === null)
    throw new EznecError('Not an EZNEC Lastz.txt file: no "Freq MHz" column header');
  if (rows.length === 0) throw new EznecError('No data rows');
  return { header, rows };
}
