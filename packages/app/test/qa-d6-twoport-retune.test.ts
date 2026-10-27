// @vitest-environment jsdom
/**
 * QA D6: a two-port measurement (S11 with port 2 on the VNA's reference) is fitted with the
 * termination as the load, which is right for comparing with the measurement. The retune, though,
 * is about the board in use: "the part values that bring the built board as fitted back inside
 * the VSWR limit" (docs/06, Measure and retune) on the design's load. The same board measured as
 * a one-port with its load or as a two-port on 50 ohm is the same board, so the board before any
 * retune has the same worst VSWR over the band either way.
 */
import { describe, expect, it } from 'vitest';
import { boardModel, retuneFor, type MeasuredBoard } from '../src/lib/measuredBoard';
import { measureStart } from '../src/lib/workflows';
import type { Design } from '../src/lib/design';

const points = Array.from({ length: 21 }, (_, i) => ({
  frequency: 0.8e9 + 0.02e9 * i,
  z: { re: 50, im: 0 },
}));

function withMeasurement(m: MeasuredBoard): Design {
  return { ...measureStart(), measurement: m };
}

describe('QA D6 app: the retune of a board measured as a two-port', () => {
  it('the fit model takes the termination as the load (the measurement as taken)', () => {
    const d = withMeasurement({ name: 'board.s2p', points, termination: 50 });
    expect(boardModel(d).load).toEqual({ re: 50, im: 0 });
  });

  it('the retune judges the board on the design load, as for a one-port measurement', () => {
    const one = withMeasurement({ name: 'board.s1p', points });
    const two = withMeasurement({ name: 'board.s2p', points, termination: 50 });
    // The sample board on 100 - j50 ohm: the designed worst VSWR over 0.9 to 1.1 GHz is about
    // 1.59 (closedloop.test.ts); on a 50 ohm termination the L match is far off.
    const a = retuneFor(one, {});
    const b = retuneFor(two, {});
    expect(a.before.vswr).toBeLessThan(1.7);
    expect(b.before.vswr).toBeCloseTo(a.before.vswr, 9);
  });
});
