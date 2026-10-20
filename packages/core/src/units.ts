/**
 * Engineering notation: parsing of values such as `3n9`, `2.2p`, `1k5`, `4.7 nH`
 * or `1e-9`, and formatting with SI prefixes.
 */

/** Prefix letters and their powers of ten. */
const PREFIXES: Readonly<Record<string, number>> = {
  T: 12,
  G: 9,
  M: 6,
  k: 3,
  K: 3,
  R: 0, // "1R5" is a common way to write 1.5 ohm
  r: 0,
  m: -3,
  u: -6,
  µ: -6, // micro sign
  μ: -6, // Greek small mu
  n: -9,
  p: -12,
  f: -15,
  a: -18,
};

/** Build the number from its decimal digits and a power of ten, so `2.2p` is exactly 2.2e-12. */
function build(sign: number, intPart: string, fracPart: string, exponent: number): number {
  return sign * Number(`${intPart || '0'}.${fracPart || '0'}e${exponent}`);
}

/** Prefix letters used when formatting, by power of ten. */
const FORMAT_PREFIXES: ReadonlyArray<readonly [number, string]> = [
  [12, 'T'],
  [9, 'G'],
  [6, 'M'],
  [3, 'k'],
  [0, ''],
  [-3, 'm'],
  [-6, 'µ'],
  [-9, 'n'],
  [-12, 'p'],
  [-15, 'f'],
  [-18, 'a'],
];

export interface ParsedValue {
  /** The value in SI base units. */
  readonly value: number;
  /** Trailing unit text after the prefix, for example `H` in `4.7 nH`. Empty when absent. */
  readonly unit: string;
}

const PLAIN_NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
const PATTERN = /^([+-]?)(\d*)(?:\.(\d*))?(?:\s*([A-Za-zµμ]))?(\d*)\s*([A-Za-zµμΩ°%]*)$/u;

/**
 * Parse engineering notation. Returns null when the text is not a number.
 *
 * Accepted forms: plain numbers (`0.25`, `-3`, `1e-9`), a number followed by a
 * prefix (`2.2p`, `47 n`), the prefix as decimal point (`3n9`, `1k5`, `2M2`),
 * and an optional unit after the prefix (`4.7 nH`, `50 ohm`, `3n9F`).
 * Prefixes are case sensitive (`m` milli, `M` mega), except `K` which is
 * accepted for kilo. `R` or `r` acts as a neutral decimal marker (`1R5`).
 */
export function tryParseEngineering(text: string): ParsedValue | null {
  const s = text.trim();
  if (s === '') return null;

  if (PLAIN_NUMBER.test(s)) {
    return { value: Number(s), unit: '' };
  }

  const m = PATTERN.exec(s);
  if (!m) return null;
  const sign = m[1] === '-' ? -1 : 1;
  const intPart = m[2] ?? '';
  const fracPart = m[3];
  const letter = m[4];
  const trailingDigits = m[5] ?? '';
  let unit = m[6] ?? '';
  const hasMantissa = intPart !== '' || (fracPart !== undefined && fracPart !== '');

  if (letter === undefined) {
    // Digits plus a unit but no prefix, for example "50 ohm".
    if (trailingDigits !== '' || !hasMantissa) return null;
    return { value: build(sign, intPart, fracPart ?? '', 0), unit };
  }

  let exponent = PREFIXES[letter];
  if (exponent === undefined) {
    // The letter starts a unit, for example "5H": no prefix.
    if (trailingDigits !== '' || !hasMantissa) return null;
    exponent = 0;
    unit = letter + unit;
  } else if (trailingDigits !== '') {
    // Prefix used as decimal point, "3n9". A second decimal point is an error.
    if (fracPart !== undefined || intPart === '') return null;
    return { value: build(sign, intPart, trailingDigits, exponent), unit };
  }

  if (!hasMantissa) return null;
  return { value: build(sign, intPart, fracPart ?? '', exponent), unit };
}

/** Parse engineering notation or throw a descriptive error. */
export function parseEngineering(text: string): number {
  const parsed = tryParseEngineering(text);
  if (parsed === null) {
    throw new Error(
      `Cannot parse "${text}" as a number with SI prefix (examples: 3n9, 2.2p, 1k5, 0.25)`,
    );
  }
  return parsed.value;
}

export interface FormatOptions {
  /** Unit symbol appended after the prefix, for example `H`. Default none. */
  readonly unit?: string;
  /** Significant digits, default 4. */
  readonly digits?: number;
  /** Use SI prefixes (default true). False gives a plain number such as `0.25` or `1500`. */
  readonly prefixes?: boolean;
}

export interface EngineeringParts {
  readonly mantissa: string;
  readonly prefix: string;
  readonly exponent: number;
}

/** The mantissa and prefix of a value in engineering notation. */
export function splitEngineering(value: number, digits = 4): EngineeringParts {
  if (value === 0 || !Number.isFinite(value)) {
    return { mantissa: String(value), prefix: '', exponent: 0 };
  }
  let exponent = Math.floor(Math.log10(Math.abs(value)) / 3) * 3;
  exponent = Math.min(12, Math.max(-18, exponent));
  let mantissa = Number((value / 10 ** exponent).toPrecision(digits));
  // Rounding may carry into the next decade, for example 999.99 -> 1000.
  if (Math.abs(mantissa) >= 1000 && exponent < 12) {
    exponent += 3;
    mantissa = Number((value / 10 ** exponent).toPrecision(digits));
  }
  const entry = FORMAT_PREFIXES.find(([e]) => e === exponent);
  return { mantissa: String(mantissa), prefix: entry ? entry[1] : `e${exponent}`, exponent };
}

/**
 * Format a value with an SI prefix: `formatEngineering(3.9e-9, { unit: 'H' })`
 * gives `3.9 nH`; without a unit the prefix follows the number directly, `1.5k`.
 */
export function formatEngineering(value: number, options: FormatOptions = {}): string {
  const { unit = '', digits = 4, prefixes = true } = options;
  const { mantissa, prefix } = prefixes
    ? splitEngineering(value, digits)
    : { mantissa: String(Number(value.toPrecision(digits))), prefix: '' };
  if (unit === '') return mantissa + prefix;
  return `${mantissa} ${prefix}${unit}`;
}
