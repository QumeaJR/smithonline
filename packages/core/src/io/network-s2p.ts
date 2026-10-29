/**
 * Touchstone .s2p of the matching network alone: port 1 at the source end,
 * port 2 at the load end, both referenced to Z0, over a list of frequencies.
 * The load impedance of the design is not part of the file, a measured or
 * simulated two-port is the network without its termination. Lumped parts
 * scale with frequency and lines through their reference frequency, as in
 * the chart.
 */
import { cadd, cdiv, cmul, complex, csub, cscale } from '../complex.js';
import { ladderAbcd, type Element } from '../elements.js';
import { reciprocalWithinRounding, type Abcd } from '../abcd.js';
import type { Ladder } from '../ladder.js';
import type { SParameters } from '../twoport.js';
import { cleanName } from './spice-model.js';
import { twoPortPoint, writeTouchstone, type TouchstoneWriteOptions } from './touchstone.js';

/**
 * S-parameters of an ABCD two-port between two ports of reference impedance
 * z0. S12 is S21 when the matrix is reciprocal to within its rounding (see
 * reciprocalWithinRounding), else the general 2 det / Delta.
 */
export function abcdMatrixToS(m: Abcd, z0: number): SParameters {
  const bz = cscale(m.b, 1 / z0);
  const cz = cscale(m.c, z0);
  const delta = cadd(cadd(m.a, bz), cadd(cz, m.d));
  const s21 = cdiv(complex(2), delta);
  const s12 = reciprocalWithinRounding(m.a, m.b, m.c, m.d)
    ? s21
    : cdiv(cscale(csub(cmul(m.a, m.d), cmul(m.b, m.c)), 2), delta);
  return {
    s11: cdiv(csub(cadd(m.a, bz), cadd(cz, m.d)), delta),
    s12,
    s21,
    s22: cdiv(cadd(cadd(cscale(m.a, -1), bz), csub(m.d, cz)), delta),
  };
}

/**
 * Whether each element kind is a reciprocal two-port. Every kind is today; a
 * new kind has to be entered here (the type makes it a compile error not to),
 * and ladderSParameters refuses a ladder with a kind marked false instead of
 * forcing S12 = S21 on it.
 */
const RECIPROCAL: Readonly<Record<Element['kind'], boolean>> = {
  R: true,
  L: true,
  C: true,
  RLC: true,
  transformer: true,
  line: true,
  openStub: true,
  shortStub: true,
  microstrip: true,
  // A library part's two-port uses the mean of the measured S12 and S21 (parts.ts).
  part: true,
};

/**
 * The network's S-parameters at one frequency. Every ladder element is
 * reciprocal (checked here against RECIPROCAL, so a future non-reciprocal
 * kind is refused rather than silently made reciprocal), so det(ABCD) = 1 and
 * S12 = S21 exactly; S12 is taken from S21 rather than from 2 det / Delta,
 * because the determinant is the difference of two products that grow as
 * exp(2 alpha l) through a lossy line and loses all its digits beyond about
 * 160 dB of line loss (found by the reciprocity invariant in
 * test/invariants.test.ts, where S12 came out larger than 1).
 */
export function ladderSParameters(ladder: Ladder, f: number): SParameters {
  for (const el of ladder.elements) {
    if (RECIPROCAL[el.kind] !== true) {
      throw new Error(
        `ladderSParameters assumes reciprocal elements; ${String(el.kind)} is not marked reciprocal`,
      );
    }
  }
  const s = abcdMatrixToS(ladderAbcd(ladder.elements, f), ladder.z0);
  return { ...s, s12: s.s21 };
}

export interface LadderS2pOptions extends TouchstoneWriteOptions {
  /** Design name for a comment line. */
  readonly name?: string;
  /** Further comment lines after the standard ones (what the network holds). */
  readonly notes?: readonly string[];
}

/** The .s2p text for the given frequencies (Hz, any order is kept as given). */
export function writeLadderS2p(
  ladder: Ladder,
  frequencies: readonly number[],
  options: LadderS2pOptions = {},
): string {
  const points = frequencies.map((f) => twoPortPoint(f, ladderSParameters(ladder, f)));
  const { name, notes = [], ...rest } = options;
  return writeTouchstone(
    { ports: 2, z0: ladder.z0, points },
    {
      frequencyUnit: 'MHZ',
      format: 'RI',
      digits: 9,
      comments: [
        `SmithChart.Online matching network${name ? `: ${cleanName(name)}` : ''}`,
        'Port 1 at the source end, port 2 at the load end; the load is not included',
        ...notes.map(cleanName),
      ],
      ...rest,
    },
  );
}
