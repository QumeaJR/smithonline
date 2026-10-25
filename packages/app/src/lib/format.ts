import { formatEngineering, type Complex } from '@smithonline/core';

/** `20.00 - j12.00` style, fixed decimals. */
export function fmtComplex(z: Complex, decimals = 2): string {
  const im = fmtNum(Math.abs(z.im), decimals);
  // A reactance that rounds to zero is "+ j0.00", never "- j0.00".
  const sign = z.im < 0 && Number(im) !== 0 ? '-' : '+';
  return `${fmtNum(z.re, decimals)} ${sign} j${im}`;
}

export function fmtNum(v: number, decimals = 2): string {
  if (!Number.isFinite(v)) return v > 0 ? '∞' : v < 0 ? '-∞' : 'NaN';
  const s = v.toFixed(decimals);
  // No negative zero: "-0.00" reads as a sign error.
  return /^-0(\.0+)?$/.test(s) ? s.slice(1) : s;
}

/**
 * A value as typed, to at most `digits` significant digits and without trailing zeros: a
 * limit of 1.255 reads 1.255, not 1.25 or 1.26 (a VSWR limit in the yield line).
 */
export function fmtSig(v: number, digits = 4): string {
  if (!Number.isFinite(v)) return fmtNum(v);
  return String(Number(v.toPrecision(digits)));
}

export function fmtDb(v: number, decimals = 2): string {
  return Number.isFinite(v) ? `${fmtNum(v, decimals)} dB` : '∞';
}

export function fmtDeg(v: number, decimals = 1): string {
  return `${v.toFixed(decimals)}°`;
}

export function fmtFrequency(f: number): string {
  return formatEngineering(f, { unit: 'Hz', digits: 6 });
}

export function fmtOhm(v: number): string {
  return formatEngineering(v, { unit: 'Ω', digits: 4 });
}

/**
 * Datapoint label in the original's vocabulary. Chain node 0 is the user
 * datapoint the network starts from (DP1 unless another one is the start);
 * the transformed points are numbered after the last user datapoint, so with
 * the default single datapoint they read TP2, TP3 ...
 */
export function datapointLabel(index: number, userCount = 1, startSlot = 0): string {
  return index === 0 ? `DP${startSlot + 1}` : `TP${userCount + index}`;
}

/**
 * A substrate height as boards are specified: in millimetres from 0.05 mm to 10 mm (`0.8 mm`,
 * `1.6 mm`, not `800 µm`), otherwise with an SI prefix (`1 m`, `20 µm`).
 */
export function substrateHeight(h: number): string {
  if (h >= 0.05e-3 && h <= 10e-3) return `${Number((h * 1e3).toPrecision(4))} mm`;
  return formatEngineering(h, { unit: 'm', digits: 4 });
}

/**
 * A yield of `passed` out of `runs` in percent with one decimal ("97.3 %"). It never reads
 * 100.0 % unless every run passed, nor 0.0 % when one did: a near miss shows as 99.9 % or 0.1 %.
 * A count of passed runs below zero or above the runs is no yield and says so.
 */
export function fmtYield(passed: number, runs: number): string {
  if (!(runs > 0) || !Number.isFinite(passed)) return 'no runs';
  if (passed < 0 || passed > runs) return 'not known';
  const tenths = Math.round((passed * 1000) / runs);
  const shown =
    passed < runs && tenths >= 1000 ? 999 : passed > 0 && tenths <= 0 ? 1 : Math.min(1000, tenths);
  return `${(shown / 10).toFixed(1)} %`;
}

/**
 * What a cell or readout shows where there is no value (an angle of a zero reflection, a
 * marker off the sweep): a middle dot, which the house style allows where a dash is not.
 */
export const NO_VALUE = '·';

/** "84.8 to 89.0 %": a Wilson interval of a yield. */
export function fmtInterval(i: { readonly lo: number; readonly hi: number }): string {
  return `${(i.lo * 100).toFixed(1)} to ${(i.hi * 100).toFixed(1)} %`;
}

/** "92.8 % (91.6 to 93.9 %)": a yield with its 95 % interval. */
export function fmtYieldInterval(y: {
  readonly passed: number;
  readonly runs: number;
  readonly interval: { readonly lo: number; readonly hi: number };
}): string {
  return `${fmtYield(y.passed, y.runs)} (${fmtInterval(y.interval)})`;
}
