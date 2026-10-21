/**
 * Touchstone CKT netlist writer in the layout Smith V4.1 documents
 * (docs/01-original-analysis.md section 4):
 *
 *      ! SMITH-CHART NETLIST GENERATOR VERSION 1.0             TIME=1e-12  COND=1e-0
 *      ! INPUT FILE: Example_netlist.xmlsc
 *      ! OUTPUT FILE: Example_netlist.ckt
 *      ! GLOBAL
 *      DIM FREQ=1e6 RES=1e0 IND=1e-9 CAP=1e-12 LNG=1e-3
 *      !
 *      CKT
 *      SRLC 1 0 R=33 L=22 C=18
 *      TLINP 1 2 0 Z=50 L=37.8 K=1 A=2 F=0
 *      ...
 *      DEF2P 1 4 A ! A is actual passive Network
 *      !
 *      FREQ
 *      FIXED 500
 *
 * Node 1 is the load side; series elements step to the next node, shunt
 * elements go to node 0. Units follow the DIM line: MHz, ohm, nH, pF, mm.
 */
import { physicalLength, type Element } from '../elements.js';
import type { Ladder } from '../ladder.js';

export class NetlistError extends Error {
  override readonly name = 'NetlistError';
}

export interface NetlistOptions {
  /** Base name for the INPUT FILE and OUTPUT FILE comments. Default `design`. */
  readonly name?: string;
  /** Significant digits for element values. Default 6. */
  readonly digits?: number;
}

function num(v: number, digits: number): string {
  // A non-finite value (zero design frequency, er below 1) has no place in a netlist; 0 keeps the file loadable.
  if (v === 0 || !Number.isFinite(v)) return '0';
  const s = Number(v.toPrecision(digits));
  const text = String(s);
  return /e/i.test(text) ? s.toExponential(digits - 1).replace(/\.?0+e/, 'e') : text;
}

function rlcValues(el: Extract<Element, { kind: 'RLC' }>, d: number): string {
  // A missing part is written as 0; the simulator treats R=0 as a short, so
  // the shunt series-RLC and series parallel-RLC keep their meaning only
  // when every part is given. The original always writes all three.
  return `R=${num(el.r ?? 0, d)} L=${num((el.l ?? 0) * 1e9, d)} C=${num((el.c ?? 0) * 1e12, d)}`;
}

/** The CKT statement of one element between `node` and the next, plus the node it ends on. */
function statement(el: Element, node: number, f: number, d: number): [string, number] {
  const next = node + 1;
  switch (el.kind) {
    case 'R':
      return el.orientation === 'series'
        ? [`RES ${node} ${next} R=${num(el.value, d)}`, next]
        : [`RES ${node} 0 R=${num(el.value, d)}`, node];
    case 'L':
      return el.orientation === 'series'
        ? [`IND ${node} ${next} L=${num(el.value * 1e9, d)}`, next]
        : [`IND ${node} 0 L=${num(el.value * 1e9, d)}`, node];
    case 'C':
      return el.orientation === 'series'
        ? [`CAP ${node} ${next} C=${num(el.value * 1e12, d)}`, next]
        : [`CAP ${node} 0 C=${num(el.value * 1e12, d)}`, node];
    case 'RLC': {
      const kw = el.connection === 'parallel' ? 'PRLC' : 'SRLC';
      return el.orientation === 'series'
        ? [`${kw} ${node} ${next} ${rlcValues(el, d)}`, next]
        : [`${kw} ${node} 0 ${rlcValues(el, d)}`, node];
    }
    case 'transformer':
      return [`TRF ${node} 0 ${next} 0 N=${num(el.n, d)} R1=0`, next];
    case 'line': {
      const mm = physicalLength(el, f) * 1e3;
      return [
        `TLINP ${node} ${next} 0 Z=${num(el.z0, d)} L=${num(mm, d)} K=${num(el.er ?? 1, d)} A=${num(el.alphaDbPerM ?? 0, d)} F=0`,
        next,
      ];
    }
    case 'openStub':
    case 'shortStub': {
      const line = { kind: 'line' as const, z0: el.z0, length: el.length };
      const mm =
        physicalLength(
          el.refFrequency === undefined ? line : { ...line, refFrequency: el.refFrequency },
          f,
        ) * 1e3;
      const far = el.kind === 'openStub' ? 99 : 0;
      return [`TLINP ${node} ${far} 0 Z=${num(el.z0, d)} L=${num(mm, d)} K=1 A=0 F=0`, node];
    }
  }
}

/** The netlist text, LF line endings, trailing newline. */
export function writeNetlist(ladder: Ladder, options: NetlistOptions = {}): string {
  const name = options.name ?? 'design';
  const d = options.digits ?? 6;
  const lines = [
    '! SMITH-CHART NETLIST GENERATOR VERSION 1.0             TIME=1e-12  COND=1e-0',
    `! INPUT FILE: ${name}.xmlsc`,
    `! OUTPUT FILE: ${name}.ckt`,
    '! GLOBAL',
    'DIM FREQ=1e6 RES=1e0 IND=1e-9 CAP=1e-12 LNG=1e-3',
    '!',
    'CKT',
  ];
  let node = 1;
  for (const el of ladder.elements) {
    const [text, next] = statement(el, node, ladder.frequency, d);
    lines.push(text);
    node = next;
  }
  lines.push(`DEF2P 1 ${node} A ! A is actual passive Network`, '!', 'FREQ');
  lines.push(`FIXED ${num(ladder.frequency / 1e6, d)}`);
  return lines.join('\n') + '\n';
}
