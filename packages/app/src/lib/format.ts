import { formatEngineering, type Complex } from '@smithonline/core';

/** `20.00 - j12.00` style, fixed decimals. */
export function fmtComplex(z: Complex, decimals = 2): string {
  const sign = z.im < 0 ? '-' : '+';
  return `${fmtNum(z.re, decimals)} ${sign} j${fmtNum(Math.abs(z.im), decimals)}`;
}

export function fmtNum(v: number, decimals = 2): string {
  if (!Number.isFinite(v)) return v > 0 ? '∞' : v < 0 ? '-∞' : 'NaN';
  const s = v.toFixed(decimals);
  // No negative zero: "-0.00" reads as a sign error.
  return /^-0(\.0+)?$/.test(s) ? s.slice(1) : s;
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
