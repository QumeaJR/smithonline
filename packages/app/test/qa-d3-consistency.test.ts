/**
 * QA (D3): the yield Auto match shows for a network against the Tolerance
 * panel's yield for the same network and settings after Apply, the centred
 * values against what Realize then shows (pairs scope), the yield ranking's
 * tie-break, the band weights and the correlation of the spread ranking.
 */
import {
  bandSensitivity,
  centreDesign,
  complex,
  lMatch,
  monteCarlo,
  primaryValueOf,
  scalarSpread,
  type Element,
} from '@smithonline/core';
import { describe, expect, it } from 'vitest';
import { centreRequest } from '../src/lib/centre';
import { emptyDesign, identify, type Design } from '../src/lib/design';
import { withPrimaryValue } from '../src/lib/elements';
import { rankSolutions } from '../src/lib/matchRanking';
import {
  designSpread,
  ladderSpread,
  matchYieldSetup,
  MATCH_YIELD_RUNS,
  toleranceSetup,
} from '../src/lib/sensitivity';
import { DEFAULT_TOLERANCE, monteCarloOptions } from '../src/lib/tolerance';

const LOAD = complex(100, -50);

function design(over: Partial<Design> = {}): Design {
  return {
    ...emptyDesign(),
    frequency: 1e9,
    load: LOAD,
    tolerance: { ...DEFAULT_TOLERANCE, vswrLimit: 1.5 },
    ...over,
  };
}

/** The Tolerance panel's pass count over the first MATCH_YIELD_RUNS runs of the applied design. */
function panelPasses(d: Design): number {
  const setup = toleranceSetup(d);
  return monteCarlo(setup.ladder, { ...setup.options, runs: MATCH_YIELD_RUNS }).passed;
}

describe('qa: Auto match yield against the Tolerance panel', () => {
  it('agrees run for run when no target is set (same seed, same draws)', () => {
    const d = design();
    const ideal = lMatch(LOAD, complex(50, 0), 1e9);
    const rows = rankSolutions(d, [], ideal, null, matchYieldSetup(d), 'yield');
    for (const row of rows) {
      const applied = { ...d, elements: identify(row.solution.elements) };
      expect(panelPasses(applied)).toBe(row.robustness.yield.passed);
    }
  });

  it('agrees when a target is set', () => {
    // Matched to 25 ohm, the network presents VSWR 2 towards Z0 = 50 and 1 towards the target.
    const target = complex(25, 0);
    const d = design({ target });
    const ideal = lMatch(LOAD, target, 1e9);
    const rows = rankSolutions(d, [], ideal, null, matchYieldSetup(d), 'yield');
    const row = rows[0];
    expect(row).toBeDefined();
    const applied = { ...d, elements: identify(row?.solution.elements ?? []) };
    expect(panelPasses(applied)).toBe(row?.robustness.yield.passed);
  });

  it('uses the tolerance the Tolerance panel uses when Realize is off', () => {
    const d = design({ realize: { enabled: false, series: 'E12', stockText: '', scope: 'all' } });
    expect(matchYieldSetup(d).tolerance).toBe(monteCarloOptions(d).tolerance);
  });
});

describe('qa: yield ranking ties', () => {
  it('goes to the smaller linearized spread when the yields tie', () => {
    // At f0 with a loose limit both L networks pass every run.
    const d = design({ tolerance: { ...DEFAULT_TOLERANCE, vswrLimit: 3 } });
    const ideal = lMatch(LOAD, complex(50, 0), 1e9);
    const rows = rankSolutions(d, [], ideal, null, matchYieldSetup(d), 'yield');
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows[0]?.robustness.yield.passed).toBe(rows[1]?.robustness.yield.passed);
    expect(rows[0]?.robustness.rms).not.toBeCloseTo(rows[1]?.robustness.rms ?? 0, 6);
    expect(rows[0]?.robustness.rms).toBeLessThan(rows[1]?.robustness.rms ?? 0);
  });
});

describe('qa: centred values against Realize (pairs scope)', () => {
  it('Realize shows exactly the values centring applied', () => {
    // An L match followed by a series L-C resonator at f0: the series C of the match and the
    // series L of the resonator are adjacent, so the pairs scope treats them as a unit.
    const match = lMatch(LOAD, complex(50, 0), 1e9).find(
      (s) => s.description === 'shunt L + series C',
    );
    const lr = 20e-9;
    const cr = 1 / ((2 * Math.PI * 1e9) ** 2 * lr);
    const elements: Element[] = [
      ...(match?.elements ?? []),
      { kind: 'L', orientation: 'series', value: lr },
      { kind: 'C', orientation: 'series', value: cr },
    ];
    const d = design({
      elements: identify(elements),
      sweep: { enabled: true, start: 0.95e9, stop: 1.05e9, points: 11 },
      tolerance: { ...DEFAULT_TOLERANCE, vswrLimit: 1.6, overBand: true },
      realize: { enabled: true, series: 'E24', stockText: '', scope: 'pairs' },
    });
    const req = centreRequest(d);
    const result = centreDesign(req.ladder, req.options);
    // Apply as the Tolerance panel does: the primary value of each moved index.
    const applied: Design = {
      ...d,
      elements: d.elements.map((el, i) =>
        result.indices.includes(i)
          ? withPrimaryValue(el, primaryValueOf(result.elements[i] as Element) as number)
          : el,
      ),
    };
    const shown = toleranceSetup(applied).ladder.elements;
    result.indices.forEach((i) => {
      expect(primaryValueOf(shown[i] as Element)).toBe(
        primaryValueOf(result.elements[i] as Element),
      );
    });
  });
});

describe('qa: the spread ranking of the app', () => {
  const tee: Element[] = [
    { kind: 'C', orientation: 'series', value: 4e-12 },
    { kind: 'L', orientation: 'shunt', value: 10e-9 },
    { kind: 'C', orientation: 'series', value: 3e-12 },
  ];

  // Corrected in the D3 QA round: over the band the shares are those of the smooth band VSWR
  // (the power mean of order 32), whose derivative carries the power-mean weights; the
  // complex-Gamma shares weighted the same way ranked the phase of Gamma as well.
  it('over the band, ranks by the variance of the smooth band VSWR (power-mean weights)', () => {
    const d = design({
      load: complex(30, 25),
      elements: identify(tee),
      sweep: { enabled: true, start: 0.9e9, stop: 1.1e9, points: 11 },
      tolerance: { ...DEFAULT_TOLERANCE, overBand: true },
    });
    const setup = toleranceSetup(d);
    const spread = ladderSpread(setup);
    // The definition: judged frequencies f0 then the band without f0, the design load at f0.
    const freqs = [1e9, ...setup.band.filter((f) => f !== 1e9)];
    const refs = tee.map((_, index) => ({ index, parameter: 'value' as const }));
    const sens = bandSensitivity(tee, complex(30, 25), 50, freqs, { parameters: refs });
    const expected = scalarSpread(
      sens.smooth.dValue,
      refs,
      refs.map((ref) => ({ ref, tolerance: 0.05 })),
      tee,
      'uniform',
    );
    expect(spread?.measure).toBe('vswr');
    spread?.parts.forEach((p, i) =>
      expect(p.share).toBeCloseTo(expected.shares[i]?.share ?? NaN, 12),
    );
  });

  it('takes the reel correlation into account', () => {
    const base = design({ load: complex(30, 25), elements: identify(tee) });
    const free = designSpread(base);
    const reel = designSpread({
      ...base,
      tolerance: { ...DEFAULT_TOLERANCE, vswrLimit: 1.5, correlation: { C: 0.9 } },
    });
    expect(free).not.toBeNull();
    expect(reel?.rms).not.toBeCloseTo(free?.rms ?? 0, 6);
  });

  it('ranks the parts by share, largest first, whatever the ladder order', () => {
    const nets: Element[][] = [
      tee,
      [...tee].reverse(),
      ...lMatch(LOAD, complex(50, 0), 1e9).map((m) => [...m.elements]),
    ];
    let unsortedInput = false;
    for (const els of nets) {
      const s = designSpread(design({ load: complex(30, 25), elements: identify(els) }));
      const ranking = s?.ranking ?? [];
      for (let k = 1; k < ranking.length; k++) {
        expect(ranking[k - 1]?.share).toBeGreaterThanOrEqual(ranking[k]?.share ?? Infinity);
      }
      const parts = s?.parts ?? [];
      for (let k = 1; k < parts.length; k++) {
        if ((parts[k]?.share ?? 0) > (parts[k - 1]?.share ?? 0)) unsortedInput = true;
      }
    }
    // At least one network lists a smaller share before a larger one in ladder order.
    expect(unsortedInput).toBe(true);
  });
});

describe('qa: spread ranking at singular points', () => {
  const els: Element[] = [
    { kind: 'C', orientation: 'shunt', value: 2e-12 },
    { kind: 'L', orientation: 'series', value: 5e-9 },
  ];
  const ladder = { z0: 50, frequency: 1e9, load: complex(30, 25), elements: els };
  const options = { tolerance: 0.05 };

  it('keeps the shares when one band point is totally reflected', () => {
    // An active load (R < 0) at one band frequency: |Gamma| > 1 there, finite elsewhere.
    const band = [0.95e9, 1e9, 1.05e9];
    const load = (f: number) => (f === 1.05e9 ? complex(-10, 0) : complex(30, 25));
    const s = ladderSpread({ ladder, load, band, options });
    expect(s?.parts.reduce((t, p) => t + p.share, 0)).toBeCloseTo(1, 9);
  });

  it('keeps the other shares finite when a part is typed as 0', () => {
    const zero: Element[] = [{ kind: 'C', orientation: 'shunt', value: 0 }, ...els];
    const s = ladderSpread({
      ladder: { ...ladder, elements: zero },
      load: ladder.load,
      band: [],
      options,
    });
    expect(Number.isFinite(s?.rms ?? NaN)).toBe(true);
    expect(s?.parts.reduce((t, p) => t + p.share, 0)).toBeCloseTo(1, 9);
  });
});
