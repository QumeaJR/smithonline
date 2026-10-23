/**
 * Generic SPICE netlist (.cir) of the matching network: a Z0 source with a 1 V
 * AC EMF at the input, the realized parts with a series loss resistor where a
 * Q is set, the load as a series R-L or R-C, and an AC sweep. Runs in ngspice,
 * LTspice (open it as a netlist), Qucs-S and anything else that reads SPICE 3
 * syntax. Lines and stubs are ideal T elements; their attenuation is not
 * modelled.
 *
 * Node n0 is the load, the last node is the input (the source side); a shunt
 * element sits on the node it hangs from, a series element steps to the next.
 */
import type { Ladder } from '../ladder.js';
import { SpiceError, ladderStages, loadBranch, type SpicePart } from './spice-model.js';

export interface SpiceOptions {
  /** Name in the header comment. */
  readonly name?: string;
  /** AC sweep; default 0.5 to 1.5 times the design frequency, 201 points. */
  readonly sweep?: { readonly start: number; readonly stop: number; readonly points: number };
  /** Significant digits for values. Default 6. */
  readonly digits?: number;
}

/** A SPICE number: plain or with an exponent, never a unit suffix that SPICE reads differently (M is milli). */
export function spiceNumber(v: number, digits = 6): string {
  if (!Number.isFinite(v)) throw new SpiceError(`Cannot write a non-finite value (${v})`);
  if (v === 0) return '0';
  return String(Number(v.toPrecision(digits)));
}

/** The netlist text, LF line endings, trailing newline. */
export function writeSpice(ladder: Ladder, options: SpiceOptions = {}): string {
  const d = options.digits ?? 6;
  const n = (v: number): string => spiceNumber(v, d);
  const f = ladder.frequency;
  const stages = ladderStages(ladder);
  const lines: string[] = [
    `* Smith Online matching network${options.name ? `: ${options.name}` : ''}`,
    `* Z0 ${n(ladder.z0)} ohm, design frequency ${n(f)} Hz, values as realized, loss resistors from Q`,
    '* n0 is the load side, the highest node is the input; AC 1 is the source EMF',
  ];

  let node = 0;
  const nodeName = (k: number): string => `n${k}`;
  const body: string[] = [];

  /** Parts of a branch between a and b; series chains get inner nodes, parallel ones share a and b. */
  const emitBranch = (
    parts: readonly SpicePart[],
    connection: 'series' | 'parallel',
    a: string,
    b: string,
    tag: string,
  ): void => {
    let inner = 0;
    const fresh = (): string => `m${tag}_${++inner}`;
    parts.forEach((p, j) => {
      const last = j === parts.length - 1;
      // Where this part's chain starts and ends.
      const from = connection === 'series' ? (j === 0 ? a : `m${tag}_c${j}`) : a;
      const to = connection === 'series' ? (last ? b : `m${tag}_c${j + 1}`) : b;
      if (p.loss) {
        const mid = fresh();
        body.push(`${p.name} ${from} ${mid} ${n(p.value)}`);
        body.push(`${p.loss.name} ${mid} ${to} ${n(p.loss.value)}`);
      } else {
        body.push(`${p.name} ${from} ${to} ${n(p.value)}`);
      }
    });
  };

  // The load: R in series with L or C, to ground.
  const load = loadBranch(ladder.load, f);
  emitBranch(load, 'series', nodeName(0), '0', 'load');

  for (const s of stages) {
    if (s.type === 'lumped') {
      if (s.orientation === 'series') {
        emitBranch(s.parts, s.connection, nodeName(node), nodeName(node + 1), String(s.index));
        node++;
      } else {
        emitBranch(s.parts, s.connection, nodeName(node), '0', String(s.index));
      }
      continue;
    }
    const z = n(s.z0);
    const td = n(s.delay);
    if (s.lossy)
      body.push(`* Element ${s.index}: line attenuation is not modelled by the ideal T element`);
    if (s.type === 'line') {
      body.push(`T${s.index} ${nodeName(node)} 0 ${nodeName(node + 1)} 0 Z0=${z} TD=${td}`);
      node++;
    } else if (s.type === 'shortStub') {
      body.push(`T${s.index} ${nodeName(node)} 0 0 0 Z0=${z} TD=${td}`);
    } else {
      const far = `far${s.index}`;
      body.push(`T${s.index} ${nodeName(node)} 0 ${far} 0 Z0=${z} TD=${td}`);
      body.push(`RFAR${s.index} ${far} 0 1e12`);
    }
  }

  const input = nodeName(node);
  lines.push(`VS src 0 AC 1`, `RSRC src ${input} ${n(ladder.z0)}`, ...body);
  const sw = options.sweep ?? { start: 0.5 * f, stop: 1.5 * f, points: 201 };
  lines.push(`.ac lin ${Math.max(2, Math.round(sw.points))} ${n(sw.start)} ${n(sw.stop)}`);
  lines.push('.end');
  return lines.join('\n') + '\n';
}
