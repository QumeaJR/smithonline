import { formatEngineering, type Complex } from '@smithonline/core';

/** `20.00 - j12.00` style, fixed decimals. */
export function fmtComplex(z: Complex, decimals = 2): string {
  const sign = z.im < 0 ? '-' : '+';
  return `${fmtNum(z.re, decimals)} ${sign} j${fmtNum(Math.abs(z.im), decimals)}`;
}

export function fmtNum(v: number, decimals = 2): string {
  if (!Number.isFinite(v)) return v > 0 ? '∞' : v < 0 ? '-∞' : 'NaN';
  return v.toFixed(decimals);
}

export function fmtDb(v: number, decimals = 2): string {
  return Number.isFinite(v) ? `${v.toFixed(decimals)} dB` : '∞';
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

/** Datapoint label in the original's vocabulary: DP1 for the load, TP2, TP3 ... for transformed points. */
export function datapointLabel(index: number): string {
  return index === 0 ? 'DP1' : `TP${index + 1}`;
}
