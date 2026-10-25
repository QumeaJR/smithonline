/**
 * Voltage and current stress of the parts of a ladder at its design
 * frequency, from the node voltages and currents (the analysis a transmitter
 * matching network or an antenna tuner needs: will the capacitor flash over,
 * will the inductor overheat).
 *
 * The source is a Z0 generator with available power P, the power a matched
 * load would take: peak EMF Vs = sqrt(8 Z0 P). With a good match this is the
 * power the network carries; with a bad one the network sees less of it
 * (P times 1 - |Gamma|^2 enters). The EMF drives the input impedance, and the
 * node voltages and currents are walked back towards the load through the
 * inverse of each element's ABCD matrix.
 *
 * Voltages are peak, currents RMS: the peak voltage is what a capacitor's
 * rating is against, the RMS current is what heats a winding.
 */
import type { Abcd } from './abcd.js';
import { cabs, cadd, cdiv, cmul, complex, csub, TINY, type Complex } from './complex.js';
import { elementAbcd, type Element, type LumpedElement } from './elements.js';
import type { Ladder } from './ladder.js';
import type { PartKind } from './realize/snap.js';

/** Watts from dBm. */
export function dbmToWatt(dbm: number): number {
  return 10 ** (dbm / 10) / 1000;
}

/** dBm from watts; -Infinity for zero power. */
export function wattToDbm(watt: number): number {
  return 10 * Math.log10(watt * 1000);
}

export interface PartStress {
  readonly part: PartKind;
  /** Peak voltage across the part, V. */
  readonly vPeak: number;
  /** RMS current through the part, A. */
  readonly iRms: number;
}

export interface ElementStress {
  /** Index in the ladder. */
  readonly index: number;
  /** Peak voltage across the whole branch of the element, V. */
  readonly vPeak: number;
  /** RMS current through the whole branch, A. */
  readonly iRms: number;
  /** The same per part; one entry for a plain R, L or C, up to three for an RLC block. */
  readonly parts: readonly PartStress[];
}

interface Node {
  readonly v: Complex;
  readonly i: Complex;
}

/** [V2; I2] from [V1; I1]: the inverse of the ABCD matrix applied towards the load. */
function towardsLoad(m: Abcd, v1: Complex, i1: Complex): Node {
  const det = csub(cmul(m.a, m.d), cmul(m.b, m.c));
  return {
    v: cdiv(csub(cmul(m.d, v1), cmul(m.b, i1)), det),
    i: cdiv(csub(cmul(m.a, i1), cmul(m.c, v1)), det),
  };
}

function lumpedParts(el: LumpedElement): { part: PartKind; z: (w: number) => Complex }[] {
  switch (el.kind) {
    case 'R':
      return [{ part: 'R', z: () => complex(el.value, 0) }];
    case 'L':
      return [{ part: 'L', z: (w) => complex(0, w * el.value) }];
    case 'C':
      return [{ part: 'C', z: (w) => complex(0, -1 / (w * (el.value || TINY))) }];
    case 'RLC': {
      const out: { part: PartKind; z: (w: number) => Complex }[] = [];
      if ((el.r ?? 0) > 0) out.push({ part: 'R', z: () => complex(el.r as number, 0) });
      if ((el.l ?? 0) > 0) out.push({ part: 'L', z: (w) => complex(0, w * (el.l as number)) });
      if ((el.c ?? 0) > 0)
        out.push({ part: 'C', z: (w) => complex(0, -1 / (w * (el.c as number))) });
      return out;
    }
  }
}

function isLumped(el: Element): el is LumpedElement {
  return el.kind === 'R' || el.kind === 'L' || el.kind === 'C' || el.kind === 'RLC';
}

/**
 * Stress of each lumped element (R, L, C, RLC blocks and library parts) at the ladder's
 * frequency for a source power in watts; null for lines, stubs and
 * transformers, which have no single voltage and current to rate. A
 * non-positive or non-finite power gives all zeros.
 */
export function ladderStress(ladder: Ladder, powerW: number): (ElementStress | null)[] {
  const els = ladder.elements;
  const f = ladder.frequency;
  const w = 2 * Math.PI * f;
  const power = Number.isFinite(powerW) && powerW > 0 ? powerW : 0;
  const vs = Math.sqrt(8 * ladder.z0 * power);

  // Zin looking from the source, and the matrices element by element.
  const mats = els.map((el) => elementAbcd(el, f));
  let z = ladder.load;
  const zAt: Complex[] = [z];
  for (const m of mats) {
    const num = cadd(cmul(m.a, z), m.b);
    const den = cadd(cmul(m.c, z), m.d);
    z = cdiv(num, den);
    zAt.push(z);
  }
  const zin = zAt[els.length] as Complex;
  const iSource = cdiv(complex(vs, 0), cadd(complex(ladder.z0, 0), zin));
  let node: Node = { v: cmul(iSource, zin), i: iSource };
  const nodes: Node[] = new Array<Node>(els.length + 1);
  nodes[els.length] = node;
  for (let k = els.length - 1; k >= 0; k--) {
    node = towardsLoad(mats[k] as Abcd, node.v, node.i);
    nodes[k] = node;
  }

  const sqrt2 = Math.SQRT2;
  return els.map((el, k): ElementStress | null => {
    const near = nodes[k] as Node; // load side
    const far = nodes[k + 1] as Node; // source side
    if (el.kind === 'part') {
      // A library part is one part of its type: the voltage across and the current through it.
      const shuntPart = el.orientation === 'shunt';
      const v = shuntPart ? far.v : csub(far.v, near.v);
      const i = shuntPart ? csub(far.i, near.i) : far.i;
      const vPeak = cabs(v);
      const iRms = cabs(i) / sqrt2;
      return { index: k, vPeak, iRms, parts: [{ part: el.part.type, vPeak, iRms }] };
    }
    if (!isLumped(el)) return null;
    const shunt = el.orientation === 'shunt';
    // Voltage across and current through the whole branch.
    const v = shunt ? far.v : csub(far.v, near.v);
    const i = shunt ? csub(far.i, near.i) : far.i;
    const parts = partStress(el, v, i, w, sqrt2);
    return { index: k, vPeak: cabs(v), iRms: cabs(i) / sqrt2, parts };
  });
}

/** Voltage and current of each part of a branch given the voltage across and current through the branch. */
function partStress(
  el: LumpedElement,
  v: Complex,
  i: Complex,
  w: number,
  sqrt2: number,
): PartStress[] {
  const parts = lumpedParts(el);
  if (el.kind !== 'RLC') {
    return parts.map((p) => ({ part: p.part, vPeak: cabs(v), iRms: cabs(i) / sqrt2 }));
  }
  // An RLC block: the parts share the voltage when in parallel, the current when in series.
  if (el.connection === 'parallel') {
    return parts.map((p) => ({
      part: p.part,
      vPeak: cabs(v),
      iRms: cabs(cdiv(v, p.z(w))) / sqrt2,
    }));
  }
  return parts.map((p) => ({
    part: p.part,
    vPeak: cabs(cmul(i, p.z(w))),
    iRms: cabs(i) / sqrt2,
  }));
}

/** Largest peak voltage and RMS current a part kind may see; an absent field is not checked. */
export type StressLimits = Partial<
  Record<PartKind, { readonly vPeak?: number; readonly iRms?: number }>
>;

export interface StressFlag {
  readonly voltage: boolean;
  readonly current: boolean;
}

/** Whether a part is above the limit of its kind. */
export function partExceeds(part: PartStress, limits: StressLimits): StressFlag {
  const lim = limits[part.part];
  return {
    voltage: lim?.vPeak !== undefined && lim.vPeak > 0 && part.vPeak > lim.vPeak,
    current: lim?.iRms !== undefined && lim.iRms > 0 && part.iRms > lim.iRms,
  };
}

/** Whether any part of the element is above its limit. */
export function elementExceeds(stress: ElementStress, limits: StressLimits): StressFlag {
  let voltage = false;
  let current = false;
  for (const p of stress.parts) {
    const flag = partExceeds(p, limits);
    voltage ||= flag.voltage;
    current ||= flag.current;
  }
  return { voltage, current };
}
