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

// PLAIN_NUMBER and EXPONENT_UNIT are linear: no two adjacent quantifiers share a character.
// PATTERN backtracks only over a run of blanks; MAX_LENGTH bounds that work.
const PLAIN_NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
/** Exponent notation followed by a unit, `1e-30 H`: the form formatting falls back to. */
const EXPONENT_UNIT = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+)[eE][+-]?\d+)(\s*)([A-Za-zµμΩω°%]+)$/u;
/**
 * No value a person types is longer; a longer text (a paste of something else) is refused
 * before any pattern runs. 256 leaves room for a full-precision number with its unit.
 */
const MAX_LENGTH = 256;
const PATTERN = /^([+-]?)(\d*)(?:\.(\d*))?(?:(\s*)([A-Za-zµμ])(\d*))?\s*([A-Za-zµμΩω°%]*)$/u;
/** A number and one letter after it, `2 f`, `20m`, `2e-12 f`: the letter may be prefix or unit. */
const LONE_LETTER = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)\s*([A-Za-zµμ])$/u;
/** The number at the start of a text, as typed. */
const LEADING_NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/;

/** A parse with the details a field needs to judge the unit. */
interface RawParse {
  readonly value: number;
  readonly unit: string;
  /** The prefix letter applied, empty when none. */
  readonly prefix: string;
  /** The unit is the lone letter `m` after a blank, read as the metre: `5 m`. */
  readonly loneMetre: boolean;
}

/**
 * The text as the patterns read it: compatibility forms folded (NFKC), so the ohm sign
 * U+2126 is the Greek capital omega, full-width digits are ASCII digits and a no-break
 * space is a space. Null when the text is empty or longer than MAX_LENGTH.
 */
function normalize(text: string): string | null {
  const t = text.trim();
  if (t === '' || t.length > MAX_LENGTH) return null;
  const s = t.normalize('NFKC').trim();
  return s === '' || s.length > MAX_LENGTH ? null : s;
}

/**
 * Parse engineering notation. Returns null when the text is not a number.
 *
 * Accepted forms: plain numbers (`0.25`, `-3`, `1e-9`), a number followed by a
 * prefix (`2.2p`, `47 n`), the prefix as decimal point (`3n9`, `1k5`, `2M2`),
 * and an optional unit after the prefix (`4.7 nH`, `50 ohm`, `3n9F`).
 * Prefixes are case sensitive (`m` milli, `M` mega), except `K` which is
 * accepted for kilo. `R` or `r` acts as a neutral decimal marker (`1R5`).
 *
 * Two readings keep a unit letter from turning into a prefix: a lone `m` after
 * a blank is the metre (`1.5 m` is 1.5 with the unit `m`; `1.5m` and `1.5 mm`
 * stay milli), and a lone letter after an exponent and a blank is a unit
 * (`1.6e-3 m`, `1e-12 f`); written together, `1e3k`, it is a prefix.
 */
export function tryParseEngineering(text: string): ParsedValue | null {
  const s = normalize(text);
  const parsed = s === null ? null : parseRaw(s);
  return parsed && Number.isFinite(parsed.value)
    ? { value: parsed.value, unit: parsed.unit }
    : null;
}

function raw(value: number, unit: string, prefix = '', loneMetre = false): RawParse {
  return { value, unit, prefix, loneMetre };
}

function parseRaw(s: string): RawParse | null {
  if (PLAIN_NUMBER.test(s)) return raw(Number(s), '');
  const exp = EXPONENT_UNIT.exec(s);
  if (exp) {
    const value = Number(exp[1]);
    const spaced = (exp[2] ?? '') !== '';
    const tail = exp[3] ?? '';
    // After an exponent and a blank a single letter is a unit: the exponent already gave the
    // magnitude. Written together, or before more letters, a prefix letter is a prefix
    // (`1e3k`, `1e-9 mH`).
    const prefix = spaced && tail.length === 1 ? undefined : PREFIXES[tail.charAt(0)];
    if (prefix === undefined) return raw(value, tail, '', spaced && tail === 'm');
    return raw(value * 10 ** prefix, tail.slice(1), tail.charAt(0));
  }

  const m = PATTERN.exec(s);
  if (!m) return null;
  const sign = m[1] === '-' ? -1 : 1;
  const intPart = m[2] ?? '';
  const fracPart = m[3];
  const blank = (m[4] ?? '') !== '';
  const letter = m[5];
  const trailingDigits = m[6] ?? '';
  const unit = m[7] ?? '';
  if (intPart === '' && (fracPart === undefined || fracPart === '')) return null;
  const plain = (exponent: number): number => build(sign, intPart, fracPart ?? '', exponent);

  // Digits plus a unit but no prefix, for example "50 Ω".
  if (letter === undefined) return raw(plain(0), unit);
  // "1.5 m": the metre, as SI writes it; "1.5m" and "1.5 mm" keep the milli prefix.
  if (letter === 'm' && blank && trailingDigits === '' && unit === '') {
    return raw(plain(0), 'm', '', true);
  }
  const exponent = PREFIXES[letter];
  if (exponent === undefined) {
    // The letter starts a unit, for example "5H": no prefix.
    return trailingDigits === '' ? raw(plain(0), letter + unit) : null;
  }
  if (trailingDigits !== '') {
    // Prefix used as decimal point, "3n9". A second decimal point is an error.
    if (fracPart !== undefined || intPart === '') return null;
    return raw(build(sign, intPart, trailingDigits, exponent), unit, letter);
  }
  return raw(plain(exponent), unit, letter);
}

/**
 * Why a field refused a text: not a number, a unit that is not the field's, or a text with
 * two readings (milli or mega, a prefix or the unit) that the parser will not guess between.
 */
export type FieldRefusal = 'number' | 'unit' | 'ambiguous';

export type FieldParse =
  | { readonly ok: true; readonly value: number }
  | {
      readonly ok: false;
      readonly reason: FieldRefusal;
      readonly unit: string;
      /** For an ambiguous text: the two readings, prefix first (`2 fF`, `2 F`). */
      readonly readings?: readonly [string, string];
    };

/** Spellings of a unit accepted in any letter case, as whole words. */
const LOOSE_UNITS: Readonly<Record<string, readonly string[]>> = {
  Ω: ['ohm', 'ohms', 'ω'],
  Hz: ['hz'],
};

/** Whether `typed` is the field unit `u` in any letter case, or one of its loose spellings. */
function sameUnit(typed: string, u: string): boolean {
  const lower = typed.toLowerCase();
  return LOOSE_UNITS[u]?.includes(lower) ?? u.toLowerCase() === lower;
}

function ambiguous(unit: string, prefixed: string, plain: string): FieldParse {
  return { ok: false, reason: 'ambiguous', unit, readings: [prefixed, plain] };
}

/**
 * Parse what a person typed into a field whose own unit texts are `units`: the
 * unit and any suffix shown beside the box, such as `H`, `mS` or `dB/m`; none
 * for a plain number. The field's own unit wins over a prefix reading: typed
 * verbatim after a plain number it is that unit (`20 mS` in a millisiemens field
 * is 20; `1.6e-3 m`, `0.0016 m` and `1.6 mm` in a metre field are all 1.6 mm);
 * a unit of more than one letter fits there in any letter case (`0.5 db/m`).
 * Otherwise the text is read as by tryParseEngineering and the unit must be the
 * field's own. A unit typed after a prefix letter can only be the unit, so any
 * letter case fits (`22pf`, `100nf`, `2 ma`); so does a lower-case `g` or `t`
 * before it, which is no prefix of its own (`2.4 ghz`). Without a prefix another
 * letter case fits unless the typed unit is a prefix letter itself. A lone letter
 * that is both a prefix and the field's unit (or the first letter of its suffix)
 * has two readings and is refused as ambiguous: `2 f` and `2e-12 f` in a farad
 * field (2 fF or 2 F), `2a` in an ampere field, `20m` beside `mS`, and `1.5m`
 * without a blank in a metre field (with a blank, `1.5 m`, it is the metre).
 * `ohm` and `hz` fit in any case as whole words, but `hz` not after a lower-case
 * `m` that could mean milli or mega (`2400 mhz`). A lone `m` after a blank is
 * milli in a field whose unit is not the metre (`10 m` in an ohm field is 10 mΩ).
 */
export function parseFieldValue(text: string, units: readonly string[] = []): FieldParse {
  const s = normalize(text);
  if (s === null) return { ok: false, reason: 'number', unit: '' };
  const own = units.filter((u) => u !== '');
  for (const u of own) {
    const tail = s.slice(-u.length);
    // A one-letter unit in another letter case is judged below, where a prefix is weighed.
    const exact = tail === u;
    if (!exact && !(u.length > 1 && tail.toLowerCase() === u.toLowerCase())) continue;
    const head = s.slice(0, s.length - u.length);
    const rest = head.trimEnd();
    if (!PLAIN_NUMBER.test(rest)) continue;
    const value = Number(rest);
    if (!Number.isFinite(value)) return { ok: false, reason: 'number', unit: '' };
    // "1.5m" in a metre field: 1.5 mm with the unit left out, or 1.5 m? A blank ("1.5 m")
    // or an exponent ("1.6e-3m") says the metre.
    if (exact && PREFIXES[u] !== undefined && head === rest && !/[eE]/.test(rest)) {
      return ambiguous(u, `${rest} ${u}${u}`, `${rest} ${u}`);
    }
    // "20 MS" beside mS: megasiemens or the field's mS in capitals.
    if (!exact && tail.charAt(0) !== u.charAt(0) && PREFIXES[tail.charAt(0)] !== undefined) {
      return ambiguous(tail, `${rest} ${tail}`, `${rest} ${u}`);
    }
    return { ok: true, value };
  }
  // "2 f" in a farad field: 2 fF, or 2 F with the unit in lower case?
  const lone = LONE_LETTER.exec(s);
  if (lone) {
    const num = lone[1] ?? '';
    const letter = lone[2] ?? '';
    const unit =
      PREFIXES[letter] === undefined
        ? undefined
        : own.find((u) => u.charAt(0).toLowerCase() === letter.toLowerCase());
    if (unit !== undefined) {
      const prefixed = `${num} ${letter}${unit}`;
      return ambiguous(letter, prefixed, `${num} ${unit}`);
    }
  }
  let p = parseRaw(s);
  if (p?.loneMetre && !own.includes('m')) p = raw(p.value * 1e-3, '', 'm');
  if (!p || !Number.isFinite(p.value)) return { ok: false, reason: 'number', unit: '' };
  const typed = p.unit;
  if (typed === '' || own.includes(typed)) return { ok: true, value: p.value };
  // "1e" reads as 1 with the unit "e": an unfinished exponent, not a unit.
  if (/^e$/i.test(typed)) return { ok: false, reason: 'number', unit: typed };
  const lower = typed.toLowerCase();
  const match = own.find((u) => sameUnit(typed, u));
  if (match !== undefined) {
    if (match === 'Hz' && p.prefix === 'm' && typed === lower) {
      return { ok: false, reason: 'ambiguous', unit: typed };
    }
    // After a prefix the letters can only be the unit; without one, a typed unit that starts
    // with a prefix letter of its own could be read either way.
    if (p.prefix !== '' || PREFIXES[typed.charAt(0)] === undefined) {
      return { ok: true, value: p.value };
    }
    const num = LEADING_NUMBER.exec(s)?.[0] ?? '';
    return ambiguous(typed, `${num} ${typed.charAt(0)}${match}`, `${num} ${match}`);
  }
  // "2.4 ghz": a lower-case g or t is no prefix, but its capital is, and the rest is the unit.
  const first = typed.charAt(0);
  const capital = first.toUpperCase();
  const scale = PREFIXES[capital];
  if (
    p.prefix === '' &&
    first !== capital &&
    PREFIXES[first] === undefined &&
    scale !== undefined &&
    own.some((u) => sameUnit(typed.slice(1), u))
  ) {
    return { ok: true, value: Number((p.value * 10 ** scale).toPrecision(15)) };
  }
  return { ok: false, reason: 'unit', unit: typed };
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

/**
 * The mantissa and prefix of a value in engineering notation. Outside the
 * prefix range (a mantissa below 0.01 at atto, or of 10000 and more at tera)
 * the value falls back to exponent notation without a prefix, `1e-30` or
 * `1.5e+18`, which the parser reads back.
 */
export function splitEngineering(value: number, digits = 4): EngineeringParts {
  if (value === 0 || !Number.isFinite(value)) {
    // String(-0) is "0" already; NaN and Infinity show as words.
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
  if (Math.abs(mantissa) < 0.01 || Math.abs(mantissa) >= 10000) {
    const plain = Number(value.toPrecision(digits)).toExponential();
    return { mantissa: plain, prefix: '', exponent: 0 };
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

/**
 * Whether the SI prefix of a formatted value is the unit letter in another case: `f`
 * before `F`, `a` before `A`. Shown apart from its unit, `2 f` beside `F`, such a value
 * would read back as ambiguous, so a field keeps the unit with the prefix (`2 fF`).
 */
export function prefixCollides(value: number, unit: string, digits = 4): boolean {
  if (unit.length !== 1) return false;
  const { prefix } = splitEngineering(value, digits);
  return prefix !== '' && prefix !== unit && prefix.toLowerCase() === unit.toLowerCase();
}
