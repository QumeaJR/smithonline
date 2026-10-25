/**
 * QA, phase D4: every place that shows the network as built includes the
 * board the same way (the chart's and Response view's packagedElements, the
 * .s2p export, the S-Plot entry), and a share link or design file cannot carry
 * a microstrip whose stackup the model cannot use.
 *
 * Expected S-parameters come from a hand-built ladder of the equivalent parts
 * (the shunt capacitor with its ESL and via as a series L-C to ground, its
 * node pad as a shunt C, the trace as a microstrip element), the same
 * equivalence the user guide states in section 8.
 */
import { describe, expect, it } from 'vitest';
import {
  abcdMatrixToS,
  cabs,
  complex,
  csub,
  DEFAULT_BOARD,
  DEFAULT_PACKAGES,
  DEFAULT_STACKUP,
  ladderAbcd,
  microstripWidthAt,
  packageById,
  packagePadCapacitance,
  viaInductance,
  type BoardSettings,
  type Element,
} from '@smithonline/core';
import { emptyDesign, identify, type Design } from '../src/lib/design';
import { packagedElements } from '../src/lib/realize';
import { decodeDesign, encodeDesign } from '../src/lib/share';
import { designToS2p } from '../src/lib/simexport';
import { networkSPlotFile } from '../src/lib/splotNetwork';
import { readTouchstone } from '@smithonline/core';

const BOARD: BoardSettings = {
  ...DEFAULT_BOARD,
  enabled: true,
  stackup: DEFAULT_STACKUP,
  viaDrill: 0.3e-3,
  viasPerShunt: 1,
  traceLength: 2e-3,
  traceWidth: 0,
};

function design(): Design {
  return {
    ...emptyDesign(),
    z0: 50,
    // Not 1 GHz: packagedElements defaults its context to 50 ohm at 1 GHz, so a caller that
    // forgets to pass the design frequency would go unnoticed at 1 GHz.
    frequency: 1.5e9,
    load: complex(20, -15),
    // A sweep whose middle point is the design frequency, so every export holds it.
    sweep: { enabled: true, start: 1e9, stop: 2e9, points: 3 },
    elements: identify([
      { kind: 'C', orientation: 'shunt', value: 3e-12, package: '0402' },
      { kind: 'L', orientation: 'series', value: 5e-9 },
    ]),
  };
}

/** S11 and S21 of the hand-built equivalent ladder at f. */
function handS(f: number) {
  const p402 = packageById(DEFAULT_PACKAGES, '0402')!;
  const pad = packagePadCapacitance(p402, DEFAULT_STACKUP)!;
  const via = viaInductance(DEFAULT_STACKUP.h, 0.3e-3);
  const width = microstripWidthAt(DEFAULT_STACKUP, 50, 1.5e9)!;
  const hand: Element[] = [
    { kind: 'RLC', orientation: 'shunt', connection: 'series', l: p402.esl + via, c: 3e-12 },
    { kind: 'C', orientation: 'shunt', value: pad / 2 },
    { kind: 'microstrip', width, length: 2e-3, stackup: DEFAULT_STACKUP },
    { kind: 'L', orientation: 'series', value: 5e-9 },
  ];
  return abcdMatrixToS(ladderAbcd(hand, f), 50);
}

const close = (a: { re: number; im: number }, b: { re: number; im: number }, tol: number) =>
  cabs(csub(complex(a.re, a.im), complex(b.re, b.im))) <= tol;

describe('qa d4: the board is in every as-built view the same way', () => {
  it('the chart and Response ladder (packagedElements with the design Z0 and f) equals the hand ladder', () => {
    const d = design();
    const built = packagedElements(d.elements, DEFAULT_PACKAGES, BOARD, {
      z0: d.z0,
      frequency: d.frequency,
    });
    expect(built).not.toBeNull();
    for (const f of [1e9, 1.5e9, 2e9]) {
      const got = abcdMatrixToS(ladderAbcd(built!, f), 50);
      const want = handS(f);
      expect(close(got.s11, want.s11, 1e-12)).toBe(true);
      expect(close(got.s21, want.s21, 1e-12)).toBe(true);
    }
  });

  it('the .s2p export and the S-Plot entry hold the same S-parameters (9 and 15 digits)', () => {
    const d = design();
    const s2p = readTouchstone(designToS2p(d, null, DEFAULT_PACKAGES, BOARD), 2);
    const splot = networkSPlotFile(d, DEFAULT_PACKAGES, BOARD).data;
    for (const data of [s2p, splot]) {
      expect(data.points.map((p) => p.frequency)).toEqual([1e9, 1.5e9, 2e9]);
      for (const p of data.points) {
        const want = handS(p.frequency);
        // s[0] = S11, s[2] = S21 (row-major, port 1 at the source end).
        expect(close(p.s[0]!, want.s11, 1e-8)).toBe(true);
        expect(close(p.s[2]!, want.s21, 1e-8)).toBe(true);
      }
    }
  });

  it('with the board off the .s2p differs: the board was really in it', () => {
    const d = design();
    const on = readTouchstone(designToS2p(d, null, DEFAULT_PACKAGES, BOARD), 2).points[1]!;
    const off = readTouchstone(designToS2p(d, null, DEFAULT_PACKAGES, DEFAULT_BOARD), 2).points[1]!;
    expect(close(on.s[0]!, off.s[0]!, 1e-3)).toBe(false);
  });
});

describe('qa d4: a link cannot carry a microstrip stackup the model cannot use', () => {
  const ms = {
    kind: 'microstrip' as const,
    width: 3e-3,
    length: 10e-3,
    stackup: DEFAULT_STACKUP,
  };
  const link = (stackup: Record<string, unknown>): Design | null =>
    decodeDesign(
      encodeDesign({
        ...emptyDesign(),
        elements: identify([{ ...ms, stackup } as unknown as Element]),
      } as Design),
    );

  // share.ts: "An element with every field its kind needs, in range; a link cannot carry
  // anything else." A negative or non-numeric resistivity makes the skin depth NaN.
  it('a negative copper resistivity is refused or replaced', () => {
    const d = link({ ...DEFAULT_STACKUP, rho: -1e-8 });
    const el = d?.elements[0];
    if (d !== null) {
      expect(el?.kind === 'microstrip' && (el.stackup.rho ?? 1.7241e-8) > 0).toBe(true);
    }
  });

  it('a non-numeric resistivity is refused or replaced', () => {
    const d = link({ ...DEFAULT_STACKUP, rho: 'copper' });
    const el = d?.elements[0];
    if (d !== null) {
      expect(el?.kind === 'microstrip' && typeof (el.stackup.rho ?? 0) === 'number').toBe(true);
    }
  });

  it('a stackup name that is not a string is refused or dropped (the card renders it)', () => {
    const d = link({ ...DEFAULT_STACKUP, name: { x: 1 } });
    const el = d?.elements[0];
    if (d !== null) {
      expect(
        el?.kind === 'microstrip' && ['string', 'undefined'].includes(typeof el.stackup.name),
      ).toBe(true);
    }
  });
});
