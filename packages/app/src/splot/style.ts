/** Curve colours and dashes of the S-Plot view, shared by the graphs and the two small charts. */
import type { SPlotEntry } from '../store/useSPlotStore';

export type Quantity = 's11' | 's12' | 's21' | 's22' | 'mag' | 'msg' | 'k' | 'mu';

/** With one file on screen the quantity picks the colour. */
export const QUANTITY_COLORS: Readonly<Record<Quantity, string>> = {
  s11: '#d6336c',
  s21: '#1c7ed6',
  s12: '#f08c00',
  s22: '#2f9e44',
  mag: '#1c7ed6',
  msg: '#e8590c',
  k: '#7048e8',
  mu: '#0ca678',
};

/** With several files the file picks the colour and the quantity the dash. */
const DASHES: Readonly<Record<Quantity, readonly number[] | undefined>> = {
  s11: undefined,
  s21: [6, 3],
  s12: [2, 3],
  s22: [8, 3, 2, 3],
  mag: undefined,
  msg: [6, 3],
  k: undefined,
  mu: [6, 3],
};

export interface CurveStyle {
  readonly color: string;
  readonly dash?: readonly number[];
}

export function curveStyle(q: Quantity, file: SPlotEntry, multi: boolean): CurveStyle {
  const dash = DASHES[q];
  if (multi) return { color: file.color, ...(dash ? { dash } : {}) };
  // One file: colours tell the curves apart, except where a pair shares a plot and a dash helps print.
  return { color: QUANTITY_COLORS[q] };
}

export const QUANTITY_LABELS: Readonly<Record<Quantity, string>> = {
  s11: 'S11',
  s12: 'S12',
  s21: 'S21',
  s22: 'S22',
  mag: 'MAG',
  msg: 'MSG',
  k: 'K',
  mu: 'μ',
};
