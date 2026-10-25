import {
  formatEngineering,
  microstripProperties,
  microstripWidthAt,
  type Element,
  type MicrostripElement,
} from '@smithonline/core';
import { useBoard } from '../store/useBoard';

export interface PaletteEntry {
  readonly id: string;
  readonly label: string;
  /** SVG path data on a 30 x 20 viewBox. */
  readonly icon: string;
  /** A sensible starting value: a reactance equal to Z0 at the design frequency, an eighth wave, and so on. */
  readonly make: (z0: number, f: number) => Element;
}

const SERIES_WIRE = 'M1 10h28';
const SHUNT_WIRE = 'M1 4h28';

export const PALETTE: readonly PaletteEntry[] = [
  {
    id: 'seriesL',
    label: 'Series L',
    icon: 'M1 10h4a3 3 0 0 1 6 0a3 3 0 0 1 6 0a3 3 0 0 1 6 0h6',
    make: (z0, f) => ({ kind: 'L', orientation: 'series', value: z0 / (2 * Math.PI * f) }),
  },
  {
    id: 'seriesC',
    label: 'Series C',
    icon: 'M1 10h11M18 10h11M12 3v14M18 3v14',
    make: (z0, f) => ({ kind: 'C', orientation: 'series', value: 1 / (2 * Math.PI * f * z0) }),
  },
  {
    id: 'seriesR',
    label: 'Series R',
    icon: 'M1 10h5l2-5 4 10 4-10 4 10 2-5h8',
    make: (z0) => ({ kind: 'R', orientation: 'series', value: z0 }),
  },
  {
    id: 'shuntL',
    label: 'Shunt L',
    icon: `${SHUNT_WIRE}M15 4v3a2.5 2.5 0 0 0 0 5a2.5 2.5 0 0 0 0 5`,
    make: (z0, f) => ({ kind: 'L', orientation: 'shunt', value: z0 / (2 * Math.PI * f) }),
  },
  {
    id: 'shuntC',
    label: 'Shunt C',
    icon: `${SHUNT_WIRE}M15 4v5M9 9h12M9 13h12M15 13v4`,
    make: (z0, f) => ({ kind: 'C', orientation: 'shunt', value: 1 / (2 * Math.PI * f * z0) }),
  },
  {
    id: 'shuntR',
    label: 'Shunt R',
    icon: `${SHUNT_WIRE}M15 4v2l-3 2 6 3-6 3 6 3-3 2`,
    make: (z0) => ({ kind: 'R', orientation: 'shunt', value: z0 }),
  },
  {
    id: 'line',
    label: 'Line',
    icon: `${SERIES_WIRE}M4 5h22v10H4z`,
    make: (z0, f) => ({ kind: 'line', z0, length: 0.125, refFrequency: f, er: 1, alphaDbPerM: 0 }),
  },
  {
    id: 'microstrip',
    label: 'Microstrip',
    icon: `${SERIES_WIRE}M4 7.5h22v5H4z`,
    make: (z0, f) => newMicrostrip(z0, f),
  },
  {
    id: 'openStub',
    label: 'Open stub',
    icon: `${SHUNT_WIRE}M15 4v3M11 7h8v10h-8z`,
    make: (z0, f) => ({ kind: 'openStub', z0, length: 0.125, refFrequency: f }),
  },
  {
    id: 'shortStub',
    label: 'Short stub',
    icon: `${SHUNT_WIRE}M15 4v3M11 7h8v10h-8zM9 17h12`,
    make: (z0, f) => ({ kind: 'shortStub', z0, length: 0.125, refFrequency: f }),
  },
  {
    id: 'transformer',
    label: 'Transformer',
    icon: 'M1 4v12M29 4v12M10 5a2 2 0 0 1 0 4a2 2 0 0 1 0 4M20 5a2 2 0 0 0 0 4a2 2 0 0 0 0 4M14 4v12M16 4v12',
    make: () => ({ kind: 'transformer', n: 2 }),
  },
  {
    id: 'seriesRLC',
    label: 'Series RLC',
    icon: 'M1 10h3l1-3 2 6 2-6 1 3h2a2 2 0 0 1 4 0a2 2 0 0 1 4 0h1M22 10h2M26 10h3M24 5v10M26 5v10',
    make: (z0, f) => ({
      kind: 'RLC',
      orientation: 'series',
      connection: 'parallel',
      r: 10 * z0,
      l: z0 / (2 * Math.PI * f),
      c: 1 / (2 * Math.PI * f * z0),
    }),
  },
  {
    id: 'shuntRLC',
    label: 'Shunt RLC',
    icon: `${SHUNT_WIRE}M8 4v12M15 4v12M22 4v12M6 16h18`,
    make: (z0, f) => ({
      kind: 'RLC',
      orientation: 'shunt',
      connection: 'series',
      r: z0 / 10,
      l: z0 / (2 * Math.PI * f),
      c: 1 / (2 * Math.PI * f * z0),
    }),
  },
];

/**
 * A microstrip on the board's stackup (Settings > Board): the width whose Z0
 * is z0 at f (twice the dielectric height when no width gives it) and an
 * eighth of the guided wavelength long.
 */
export function newMicrostrip(z0: number, f: number): MicrostripElement {
  const stackup = useBoard.getState().board.stackup;
  const width = microstripWidthAt(stackup, z0, f) ?? 2 * stackup.h;
  const beta = microstripProperties(stackup, width, f).beta;
  const length = beta > 0 ? (2 * Math.PI) / beta / 8 : 0.01;
  return { kind: 'microstrip', width, length, stackup };
}

/** The schematic name of an element, in the original's vocabulary. */
export function elementName(el: Element): string {
  switch (el.kind) {
    case 'R':
    case 'L':
    case 'C':
      return `${el.orientation === 'series' ? 'Series' : 'Shunt'} ${el.kind}`;
    case 'RLC':
      return el.orientation === 'series'
        ? `Series RLC (${el.connection})`
        : `Shunt RLC (${el.connection})`;
    case 'transformer':
      return 'Transformer';
    case 'line':
      return (el.alphaDbPerM ?? 0) > 0 ? 'Lossy line' : 'Line';
    case 'openStub':
      return 'Open stub';
    case 'shortStub':
      return 'Shorted stub';
    case 'microstrip':
      return 'Microstrip';
    case 'part':
      return `${el.orientation === 'series' ? 'Series' : 'Shunt'} ${el.part.type} part`;
  }
}

/** The one value a card edits and tunes, with its unit. Null for RLC blocks and library parts. */
export function primaryValue(el: Element): { value: number; unit: string } | null {
  switch (el.kind) {
    case 'R':
      return { value: el.value, unit: 'Ω' };
    case 'L':
      return { value: el.value, unit: 'H' };
    case 'C':
      return { value: el.value, unit: 'F' };
    case 'transformer':
      return { value: el.n, unit: '' };
    case 'line':
    case 'openStub':
    case 'shortStub':
      return { value: el.length, unit: 'λ' };
    case 'microstrip':
      return { value: el.length, unit: 'm' };
    case 'RLC':
    case 'part':
      return null;
  }
}

export function withPrimaryValue<T extends Element>(el: T, value: number): T {
  switch (el.kind) {
    case 'R':
    case 'L':
    case 'C':
      return { ...el, value };
    case 'transformer':
      return { ...el, n: value };
    case 'line':
    case 'openStub':
    case 'shortStub':
    case 'microstrip':
      return { ...el, length: value };
    case 'RLC':
    case 'part':
      return el;
  }
}

/**
 * Where a tune slider centres: the element's own primary value, or, when that
 * is 0 or not finite (a log scale cannot centre there), the palette's starting
 * value for that kind at the design Z0 and frequency, so the knob and Reset work.
 */
export function sliderCentre(el: Element, z0: number, f: number): number {
  const own = primaryValue(el)?.value;
  if (own !== undefined && own !== 0 && Number.isFinite(own)) return own;
  for (const entry of PALETTE) {
    const made = entry.make(z0, f);
    if (made.kind !== el.kind) continue;
    const v = primaryValue(made)?.value;
    if (v !== undefined && v > 0 && Number.isFinite(v)) return v;
  }
  return 1;
}

/** Short value text for the ladder card and the schematic. */
export function elementSummary(el: Element): string {
  switch (el.kind) {
    case 'RLC':
      return [
        el.r ? formatEngineering(el.r, { unit: 'Ω' }) : null,
        el.l ? formatEngineering(el.l, { unit: 'H' }) : null,
        el.c ? formatEngineering(el.c, { unit: 'F' }) : null,
      ]
        .filter(Boolean)
        .join(', ');
    case 'line':
    case 'openStub':
    case 'shortStub':
      return `${formatEngineering(el.length, { prefixes: false })} λ, ${formatEngineering(el.z0, { unit: 'Ω' })}`;
    case 'transformer':
      return `n = ${formatEngineering(el.n, { prefixes: false })}`;
    case 'microstrip':
      return `l ${formatEngineering(el.length, { unit: 'm' })}, w ${formatEngineering(el.width, { unit: 'm' })}`;
    case 'part':
      return el.part.partNumber;
    default: {
      const p = primaryValue(el);
      return p ? formatEngineering(p.value, { unit: p.unit }) : '';
    }
  }
}
