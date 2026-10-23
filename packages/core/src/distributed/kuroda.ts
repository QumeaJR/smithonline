/**
 * Commensurate-line networks and the Kuroda identities.
 *
 * Every element has the same electrical length theta, so the network is a
 * function of Richards' variable S = j tan(theta). A shorted stub is an
 * inductor Z S, an open stub a capacitor S / Z, and a unit element (UE) a
 * line of the common length; series stubs are not ladder elements (they do
 * not exist in microstrip), which is what the identities are for: they move
 * a stub across a UE and change it into one that can be built.
 *
 * The four identities (Pozar, Microwave Engineering, table 8.7), with every
 * network written from port 1 (source) to port 2 (load):
 *   (a) UE Z1, series short stub Z2   =  shunt open stub Z1 (Z1 + Z2) / Z2, UE Z1 + Z2
 *   (b) series short stub Z2, UE Z1   =  UE Z1 + Z2, shunt open stub Z1 (Z1 + Z2) / Z2
 *   (c) shunt short stub Zp, UE Zu    =  UE n Zu, shunt short stub n Zp, transformer n,
 *       n = Zp / (Zp + Zu)
 *   (d) series open stub Zs, UE Zu    =  UE n Zu, series open stub n Zs, transformer n,
 *       n = 1 + Zs / Zu
 * (a) and (b) also run backwards, a shunt open stub becoming a series short
 * stub; (c) and (d) also hold mirrored, with the transformer 1 / n at port 1.
 * The transformer is the ladder's ideal transformer, voltage ratio n.
 */
import { cdiv, complex, type Complex } from '../complex.js';
import { cascade, IDENTITY, type Abcd } from '../abcd.js';
import { abcdToS } from '../netparams.js';

export type StubKind = 'seriesShort' | 'seriesOpen' | 'shuntOpen' | 'shuntShort';

export type CommensurateElement =
  | {
      readonly kind: 'ue' | StubKind;
      /** Characteristic impedance, ohm or normalized. */ readonly z: number;
    }
  | {
      readonly kind: 'transformer';
      /** Voltage ratio, as the ladder's transformer. */ readonly n: number;
    };

/** The ABCD matrix of one commensurate element at electrical length theta (radians). */
export function commensurateAbcd(el: CommensurateElement, theta: number): Abcd {
  const t = Math.tan(theta);
  switch (el.kind) {
    case 'ue': {
      const c = Math.cos(theta);
      const s = Math.sin(theta);
      return {
        a: complex(c),
        b: complex(0, el.z * s),
        c: complex(0, s / el.z),
        d: complex(c),
      };
    }
    case 'seriesShort':
      return { ...IDENTITY, b: complex(0, el.z * t) };
    case 'seriesOpen':
      return { ...IDENTITY, b: complex(0, -el.z / t) };
    case 'shuntOpen':
      return { ...IDENTITY, c: complex(0, t / el.z) };
    case 'shuntShort':
      return { ...IDENTITY, c: complex(0, -1 / (el.z * t)) };
    case 'transformer':
      return { a: complex(el.n), b: complex(0), c: complex(0), d: complex(1 / el.n) };
  }
}

/** The ABCD matrix of a commensurate network listed from port 1 to port 2. */
export function commensurateChainAbcd(
  elements: readonly CommensurateElement[],
  theta: number,
): Abcd {
  let m = IDENTITY;
  for (const el of elements) m = cascade(m, commensurateAbcd(el, theta));
  return m;
}

/** S11, S12, S21, S22 of a commensurate network in a z0 system at electrical length theta. */
export function commensurateS(
  elements: readonly CommensurateElement[],
  theta: number,
  z0: number,
): Complex[] {
  const m = commensurateChainAbcd(elements, theta);
  const r = complex(z0);
  return abcdToS([m.a, cdiv(m.b, r), { re: m.c.re * z0, im: m.c.im * z0 }, m.d]);
}

/** True for the stubs a UE turns into the other kind (an inductor into a capacitor and back). */
function swaps(kind: StubKind): boolean {
  return kind === 'seriesShort' || kind === 'shuntOpen';
}

/**
 * Apply the Kuroda identity that fits a UE next to a stub, given from port 1
 * to port 2. A series short or shunt open stub crosses the UE and changes
 * into the other kind ((a), (b) and their inverses); a shunt short or series
 * open stub crosses it unchanged and leaves an ideal transformer at the far
 * end ((c), (d)). The result has the same two-port at every frequency.
 * Throws when the pair is not one UE and one stub or an impedance is not positive.
 */
export function kuroda(
  first: CommensurateElement,
  second: CommensurateElement,
): CommensurateElement[] {
  const ueFirst = first.kind === 'ue';
  const ue = ueFirst ? first : second;
  const stub = ueFirst ? second : first;
  if (ue.kind !== 'ue' || stub.kind === 'ue' || stub.kind === 'transformer') {
    throw new RangeError('A Kuroda identity needs one unit element and one stub.');
  }
  const zu = ue.z;
  const zs = stub.z;
  if (!(zu > 0) || !(zs > 0) || !Number.isFinite(zu) || !Number.isFinite(zs)) {
    throw new RangeError('The impedances must be positive numbers.');
  }
  if (swaps(stub.kind)) {
    if (stub.kind === 'seriesShort') {
      // (a) and (b): the inductor becomes a shunt capacitor on the other side.
      const line: CommensurateElement = { kind: 'ue', z: zu + zs };
      const shunt: CommensurateElement = { kind: 'shuntOpen', z: (zu * (zu + zs)) / zs };
      return ueFirst ? [shunt, line] : [line, shunt];
    }
    // (a) and (b) backwards: the shunt capacitor becomes a series inductor.
    const line: CommensurateElement = { kind: 'ue', z: (zs * zu) / (zu + zs) };
    const series: CommensurateElement = { kind: 'seriesShort', z: (zu * zu) / (zu + zs) };
    return ueFirst ? [series, line] : [line, series];
  }
  // (c) and (d): the stub keeps its kind, the impedances scale by n and a transformer appears.
  const n = stub.kind === 'shuntShort' ? zs / (zs + zu) : 1 + zs / zu;
  const line: CommensurateElement = { kind: 'ue', z: n * zu };
  const moved: CommensurateElement = { kind: stub.kind, z: n * zs };
  return ueFirst
    ? [{ kind: 'transformer', n: 1 / n }, moved, line]
    : [line, moved, { kind: 'transformer', n }];
}
