/**
 * LTspice schematic (.asc) of the matching network: a 1 V AC source with its
 * Z0 resistor at the top, the network down the middle with the input at the
 * top and the load at the bottom, shunt branches hanging to ground on the
 * right, and an .ac directive. Values are the realized ones, a loss resistor
 * sits in series with a part that has a Q.
 *
 * The format is the plain text LTspice itself writes (Version 4, SHEET, WIRE,
 * FLAG, SYMBOL with SYMATTR). Every symbol is placed unrotated (R0) so the pin
 * positions are the ones of the stock symbols (LTSPICE_PINS) and nothing
 * depends on a rotation convention; the schematic is therefore drawn
 * vertically. Wires meet at endpoints only. Each stage of the ladder has its
 * own band of the sheet, so no two nets share a coordinate by accident.
 *
 * Lines, stubs and transformers have no stock LTspice symbol with a known pin
 * geometry here; a ladder with them is refused (SpiceError): use the .cir
 * netlist, which LTspice opens as well.
 */
import type { Ladder } from '../ladder.js';
import {
  SpiceError,
  hasDistributed,
  ladderStages,
  loadBranch,
  type SpicePart,
  cleanName,
} from './spice-model.js';
import { spiceNumber } from './spice.js';

/** Pin offsets from the symbol origin of the stock LTspice symbols, unrotated: first (top) pin, second (bottom) pin. */
export const LTSPICE_PINS = {
  res: [
    [16, 16],
    [16, 96],
  ],
  ind: [
    [16, 16],
    [16, 96],
  ],
  cap: [
    [16, 0],
    [16, 64],
  ],
  voltage: [
    [0, 16],
    [0, 96],
  ],
} as const;

export type LtspiceSymbol = keyof typeof LTSPICE_PINS;

const SYMBOL_OF = { R: 'res', L: 'ind', C: 'cap' } as const;

export interface LtspiceOptions {
  readonly name?: string;
  /** AC sweep; default 0.5 to 1.5 times the design frequency, 201 points. */
  readonly sweep?: { readonly start: number; readonly stop: number; readonly points: number };
  readonly digits?: number;
}

const GAP = 32;
const COLUMN = 64;
const CHAIN_X = 320;

interface Item {
  readonly symbol: 'res' | 'ind' | 'cap';
  readonly name: string;
  readonly value: string;
}

/** The symbols of a part: the part, then its loss resistor. */
function itemsOf(p: SpicePart, n: (v: number) => string): Item[] {
  const items: Item[] = [{ symbol: SYMBOL_OF[p.kind], name: p.name, value: n(p.value) }];
  if (p.loss) items.push({ symbol: 'res', name: p.loss.name, value: n(p.loss.value) });
  return items;
}

/** The schematic text, CRLF line endings as LTspice writes them, trailing newline. */
export function writeLtspice(ladder: Ladder, options: LtspiceOptions = {}): string {
  if (hasDistributed(ladder.elements)) {
    throw new SpiceError(
      'The LTspice schematic holds R, L and C only; this network has lines or stubs. Export the SPICE netlist (.cir) instead, which LTspice opens as well.',
    );
  }
  const n = (v: number): string => spiceNumber(v, options.digits ?? 6);
  const f = ladder.frequency;
  const stages = ladderStages(ladder);

  const out: string[] = [];
  const wires: string[] = [];
  const flags: string[] = [];
  let maxX = 0;
  let maxY = 0;
  const touch = (x: number, y: number): void => {
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  };
  const wire = (x1: number, y1: number, x2: number, y2: number): void => {
    if (x1 === x2 && y1 === y2) return;
    wires.push(`WIRE ${x1} ${y1} ${x2} ${y2}`);
    touch(x1, y1);
    touch(x2, y2);
  };
  const flag = (x: number, y: number, label: string): void => {
    flags.push(`FLAG ${x} ${y} ${label}`);
    touch(x, y);
  };
  const symbols: string[] = [];
  /** Place a symbol with its first pin at (x, y); returns the y of its second pin. */
  const place = (
    symbol: LtspiceSymbol,
    name: string,
    value: string,
    x: number,
    y: number,
  ): number => {
    const [p1, p2] = LTSPICE_PINS[symbol];
    symbols.push(
      `SYMBOL ${symbol} ${x - p1[0]} ${y - p1[1]} R0`,
      `SYMATTR InstName ${name}`,
      `SYMATTR Value ${value}`,
    );
    touch(x + 16, y + (p2[1] - p1[1]));
    return y + (p2[1] - p1[1]);
  };

  /** Series chain of items from (x, y) downwards; returns the bottom y. */
  const chain = (items: readonly Item[], x: number, y: number): number => {
    let cursor = y;
    items.forEach((it, k) => {
      const bottom = place(it.symbol, it.name, it.value, x, cursor);
      if (k < items.length - 1) {
        wire(x, bottom, x, bottom + GAP);
        cursor = bottom + GAP;
      } else {
        cursor = bottom;
      }
    });
    return cursor;
  };

  /** A branch from its top at (x, y): the parts in series, or side by side between two rails. Returns the bottom y. */
  const branch = (
    parts: readonly SpicePart[],
    connection: 'series' | 'parallel',
    x: number,
    y: number,
  ): number => {
    if (connection === 'series' || parts.length === 1) {
      return chain(
        parts.flatMap((p) => itemsOf(p, n)),
        x,
        y,
      );
    }
    const bottoms = parts.map((p, j) => chain(itemsOf(p, n), x + COLUMN * j, y));
    const yBottom = Math.max(...bottoms);
    parts.forEach((_, j) => {
      const cx = x + COLUMN * j;
      wire(cx, bottoms[j] as number, cx, yBottom);
      if (j > 0) {
        wire(cx - COLUMN, y, cx, y);
        wire(cx - COLUMN, yBottom, cx, yBottom);
      }
    });
    return yBottom;
  };

  // Source: V1 on the left, its Z0 resistor on the chain, the input node below it.
  const yTop = 80;
  const vBottom = place('voltage', 'VS', 'AC 1', 96, yTop);
  flag(96, vBottom, '0');
  const rsBottom = place('res', 'RSRC', n(ladder.z0), CHAIN_X, yTop);
  wire(96, yTop, CHAIN_X, yTop);
  flag(CHAIN_X, rsBottom, 'in');

  let y = rsBottom;
  /** Columns right of the chain used by the shunt branches hanging from the current node. */
  let columns = 0;
  let shuntBottom = y;
  const flush = (): void => {
    if (columns === 0) return;
    const next = shuntBottom + GAP;
    wire(CHAIN_X, y, CHAIN_X, next);
    y = next;
    columns = 0;
  };
  for (const s of [...stages].reverse()) {
    if (s.type !== 'lumped') continue; // refused above
    if (s.orientation === 'series') {
      flush();
      wire(CHAIN_X, y, CHAIN_X, y + GAP);
      y = branch(s.parts, s.connection, CHAIN_X, y + GAP);
    } else {
      const x = CHAIN_X + COLUMN * (columns + 1);
      wire(CHAIN_X + COLUMN * columns, y, x, y);
      const bottom = branch(s.parts, s.connection, x, y);
      flag(x, bottom, '0');
      shuntBottom = Math.max(shuntBottom, bottom);
      columns += s.connection === 'parallel' ? s.parts.length : 1;
    }
  }
  flush();
  // The load below the last node.
  flag(CHAIN_X, y, 'load');
  wire(CHAIN_X, y, CHAIN_X, y + GAP);
  const loadParts = loadBranch(ladder.load, f);
  const lb = chain(
    loadParts.flatMap((p) => itemsOf(p, n)),
    CHAIN_X,
    y + GAP,
  );
  flag(CHAIN_X, lb, '0');

  const sw = options.sweep ?? { start: 0.5 * f, stop: 1.5 * f, points: 201 };
  out.push('Version 4');
  out.push(`SHEET 1 ${maxX + 640} ${maxY + 160}`);
  out.push(...wires, ...flags, ...symbols);
  const library = stages.filter((s) => s.type === 'lumped' && s.libraryPart !== undefined);
  if (library.length > 0) {
    out.push(
      `TEXT ${CHAIN_X + 96} 128 Left 2 ;Library parts as fitted equivalent circuits, not measured data: ${library
        .map((s) => `${s.index} ${s.type === 'lumped' ? cleanName(s.libraryPart ?? '') : ''}`)
        .join(', ')}`,
    );
  }
  out.push(
    `TEXT ${CHAIN_X + 96} 32 Left 2 ;SmithChart.Online matching network${options.name ? `: ${cleanName(options.name)}` : ''}`,
    `TEXT ${CHAIN_X + 96} 64 Left 2 ;Z0 ${n(ladder.z0)} ohm, ${n(f)} Hz, realized values, loss resistors from Q`,
    `TEXT ${CHAIN_X + 96} 96 Left 2 !.ac lin ${Math.max(2, Math.round(sw.points))} ${n(sw.start)} ${n(sw.stop)}`,
  );
  return out.join('\r\n') + '\r\n';
}
