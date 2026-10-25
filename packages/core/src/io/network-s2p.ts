/**
 * Touchstone .s2p of the matching network alone: port 1 at the source end,
 * port 2 at the load end, both referenced to Z0, over a list of frequencies.
 * The load impedance of the design is not part of the file, a measured or
 * simulated two-port is the network without its termination. Lumped parts
 * scale with frequency and lines through their reference frequency, as in
 * the chart.
 */
import { cadd, cdiv, cmul, complex, csub, cscale } from '../complex.js';
import { ladderAbcd } from '../elements.js';
import type { Abcd } from '../abcd.js';
import type { Ladder } from '../ladder.js';
import type { SParameters } from '../twoport.js';
import { cleanName } from './spice-model.js';
import { twoPortPoint, writeTouchstone, type TouchstoneWriteOptions } from './touchstone.js';

/** S-parameters of an ABCD two-port between two ports of reference impedance z0. */
export function abcdMatrixToS(m: Abcd, z0: number): SParameters {
  const bz = cscale(m.b, 1 / z0);
  const cz = cscale(m.c, z0);
  const delta = cadd(cadd(m.a, bz), cadd(cz, m.d));
  const det = csub(cmul(m.a, m.d), cmul(m.b, m.c));
  return {
    s11: cdiv(csub(cadd(m.a, bz), cadd(cz, m.d)), delta),
    s12: cdiv(cscale(det, 2), delta),
    s21: cdiv(complex(2), delta),
    s22: cdiv(cadd(cadd(cscale(m.a, -1), bz), csub(m.d, cz)), delta),
  };
}

/**
 * The network's S-parameters at one frequency. Every ladder element is
 * reciprocal, so det(ABCD) = 1 and S12 = S21 exactly; S12 is taken from S21
 * rather than from 2 det / Delta, because the determinant is the difference
 * of two products that grow as exp(2 alpha l) through a lossy line and loses
 * all its digits beyond about 160 dB of line loss (found by the reciprocity
 * invariant in test/invariants.test.ts, where S12 came out larger than 1).
 */
export function ladderSParameters(ladder: Ladder, f: number): SParameters {
  const s = abcdMatrixToS(ladderAbcd(ladder.elements, f), ladder.z0);
  return { ...s, s12: s.s21 };
}

export interface LadderS2pOptions extends TouchstoneWriteOptions {
  /** Design name for a comment line. */
  readonly name?: string;
}

/** The .s2p text for the given frequencies (Hz, any order is kept as given). */
export function writeLadderS2p(
  ladder: Ladder,
  frequencies: readonly number[],
  options: LadderS2pOptions = {},
): string {
  const points = frequencies.map((f) => twoPortPoint(f, ladderSParameters(ladder, f)));
  const { name, ...rest } = options;
  return writeTouchstone(
    { ports: 2, z0: ladder.z0, points },
    {
      frequencyUnit: 'MHZ',
      format: 'RI',
      digits: 9,
      comments: [
        `Smith Online matching network${name ? `: ${cleanName(name)}` : ''}`,
        'Port 1 at the source end, port 2 at the load end; the load is not included',
      ],
      ...rest,
    },
  );
}
