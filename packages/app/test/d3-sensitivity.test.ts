/**
 * D3 in the app: the spread ranking of the design as the Tolerance panel
 * analyses it, the tolerance and band Auto match judges a solution by, the
 * ranking by yield on a reference case, the correlation setting in a
 * payload and the centring request.
 */
import { complex, lMatch, monteCarlo, sweepPoints } from '@smithonline/core';
import { describe, expect, it } from 'vitest';
import { toleranceOf } from '../src/lib/build';
import { centreRequest } from '../src/lib/centre';
import { emptyDesign, identify, type Design } from '../src/lib/design';
import { rankingExplanation, rankSolutions } from '../src/lib/matchRanking';
import {
  designSpread,
  fmtShare,
  matchYieldSetup,
  spreadSentence,
  toleranceSetup,
} from '../src/lib/sensitivity';
import { DEFAULT_TOLERANCE, monteCarloOptions } from '../src/lib/tolerance';

/** The reference case: 100 - j50 at 1 GHz, a 20 % band, VSWR 1.38. */
function referenceDesign(elements: Design['elements'] = []): Design {
  const d = emptyDesign();
  return {
    ...d,
    frequency: 1e9,
    load: complex(100, -50),
    elements,
    sweep: { enabled: true, start: 0.9e9, stop: 1.1e9, points: 11 },
    tolerance: { ...DEFAULT_TOLERANCE, vswrLimit: 1.38, overBand: true },
  };
}

const solutions = lMatch(complex(100, -50), complex(50, 0), 1e9);
const shuntL = solutions.find((s) => s.description === 'shunt L + series C');
const shuntC = solutions.find((s) => s.description === 'shunt C + series L');

describe('designSpread', () => {
  it('ranks the parts of the design and says who dominates', () => {
    const design = referenceDesign(identify(shuntL?.elements ?? []));
    const spread = designSpread(design);
    expect(spread).not.toBeNull();
    const s = spread as NonNullable<typeof spread>;
    expect(s.over).toBe('band');
    expect(s.parts).toHaveLength(2);
    expect(s.parts.reduce((a, p) => a + p.share, 0)).toBeCloseTo(1, 12);
    expect(s.ranking[0]?.share).toBeGreaterThanOrEqual(s.ranking[1]?.share ?? 0);
    expect(spreadSentence(s)).toMatch(/^(Shunt L 1|Series C 2) contributes \d+ % of the spread$/);
    // The worst frequency is a band edge, where the VSWR has a slope.
    expect([0.9e9, 1.1e9]).toContain(s.at);
    expect(s.parts.every((p) => Number.isFinite(p.vswrPerPercent) && p.vswrPerPercent !== 0)).toBe(
      true,
    );
  });

  it('works at the design frequency, where a perfect match has no VSWR slope', () => {
    const design = {
      ...referenceDesign(identify(shuntL?.elements ?? [])),
      tolerance: { ...DEFAULT_TOLERANCE },
    };
    const s = designSpread(design);
    expect(s?.over).toBe('point');
    expect(s?.matched).toBe(true);
    expect(s?.parts.reduce((a, p) => a + p.share, 0)).toBeCloseTo(1, 12);
    expect(s?.parts.every((p) => p.gammaPerPercent > 0)).toBe(true);
  });

  it('follows the Realize values and locked parts', () => {
    const els = identify(shuntL?.elements ?? []);
    const design = {
      ...referenceDesign(els.map((e, i) => (i === 0 ? { ...e, locked: true } : e))),
      realize: { enabled: true, series: 'E24' as const, stockText: '', scope: 'all' as const },
    };
    const setup = toleranceSetup(design);
    expect((setup.ladder.elements[1] as { value: number }).value).toBe(2.7e-12);
    const s = designSpread(design);
    expect(s?.parts.map((p) => p.index)).toEqual([1]);
    expect(s?.ranking[0]?.share).toBeCloseTo(1, 12);
  });

  it('is null with nothing to vary', () => {
    expect(designSpread(referenceDesign())).toBeNull();
  });

  it('formats shares', () => {
    expect(fmtShare(0.624)).toBe('62 %');
    expect(fmtShare(0.003)).toBe('below 1 %');
    expect(fmtShare(-0.2)).toBe('-20 %');
  });
});

describe('Auto match ranking', () => {
  it('judges with 5 % parts when Realize is off, the series tolerance when on, a typed one first', () => {
    const d = referenceDesign();
    expect(matchYieldSetup(d).tolerance).toBe(0.05);
    expect(matchYieldSetup(d).toleranceLabel).toContain('Realize is off');
    const e12 = { ...d, realize: { ...d.realize, enabled: true, series: 'E12' as const } };
    expect(matchYieldSetup(e12).tolerance).toBe(0.1);
    const typed = { ...e12, tolerance: { ...(d.tolerance ?? DEFAULT_TOLERANCE), percent: 2 } };
    expect(matchYieldSetup(typed).tolerance).toBe(0.02);
    expect(matchYieldSetup(d).band).toEqual(sweepPoints(0.9e9, 1.1e9, 11));
    expect(matchYieldSetup({ ...d, tolerance: DEFAULT_TOLERANCE }).band).toEqual([]);
  });

  it('ranks the reference L networks by yield, Q and VSWR', () => {
    const design = referenceDesign();
    const setup = matchYieldSetup(design);
    const ideal = [shuntL, shuntC].filter((s) => s !== undefined);
    const byYield = rankSolutions(design, [], ideal, null, setup, 'yield');
    // Over the band at VSWR 1.38 the shunt C + series L network passes nearly always, the other
    // about three times in four (checked against a full Monte Carlo below).
    expect(byYield[0]?.solution.description).toBe('shunt C + series L');
    expect(byYield[0]?.robustness.yield.yield).toBeGreaterThan(0.95);
    expect(byYield[1]?.robustness.yield.yield).toBeLessThan(0.85);
    expect(byYield[1]?.robustness.dominant?.label).toMatch(/Shunt L 1|Series C 2/);
    const full = monteCarlo(
      { z0: 50, frequency: 1e9, load: complex(100, -50), elements: shuntL?.elements ?? [] },
      { runs: 4000, tolerance: 0.05, vswrLimit: 1.38, band: sweepPoints(0.9e9, 1.1e9, 11) },
    );
    const est = byYield[1]?.robustness.yield;
    expect(full.yield).toBeGreaterThan((est?.interval.lo ?? 0) - 0.03);
    expect(full.yield).toBeLessThan((est?.interval.hi ?? 1) + 0.03);
    // By VSWR: the nominal worst VSWR over the band, lowest first.
    const byVswr = rankSolutions(design, [], ideal, null, setup, 'vswr');
    expect(byVswr[0]?.vswr).toBeLessThanOrEqual(byVswr[1]?.vswr ?? Infinity);
    // By Q: the order of the loaded Q, as before.
    const byQ = rankSolutions(design, [], ideal, null, setup, 'q');
    expect(byQ[0]?.solution.q).toBeLessThanOrEqual(byQ[1]?.solution.q ?? Infinity);
  });

  it('explains the ranking in one line', () => {
    const setup = matchYieldSetup(referenceDesign());
    expect(rankingExplanation('q', setup, false)).toBe(
      'Ranked by loaded Q, lowest (widest bandwidth) first.',
    );
    expect(rankingExplanation('yield', setup, false)).toBe(
      'Ranked by estimated yield: 200 Monte Carlo runs of the whole network with 5 % parts (Realize is off), within VSWR 1.38 over the band, 900 MHz to 1.1 GHz; ties go to the less sensitive network, then the lower Q.',
    );
    expect(rankingExplanation('vswr', setup, true)).toContain('with the snapped values');
  });
});

describe('correlation and centring settings', () => {
  it('keeps a valid correlation per kind from a payload and drops the rest', () => {
    const t = toleranceOf({ correlation: { L: 0.8, C: 2, R: -1, X: 0.5 } });
    expect(t?.correlation).toEqual({ L: 0.8 });
    expect(toleranceOf({})?.correlation).toBeUndefined();
  });

  it('passes the correlation to the analysis', () => {
    const d = referenceDesign(identify(shuntL?.elements ?? []));
    const t = { ...(d.tolerance ?? DEFAULT_TOLERANCE), correlation: { C: 0.5 } };
    expect(monteCarloOptions({ ...d, tolerance: t }).correlation).toEqual({ C: 0.5 });
    expect(monteCarloOptions(d).correlation).toBeUndefined();
  });

  it('builds the centring request from the tolerance settings, with Realize to snap to', () => {
    const d = {
      ...referenceDesign(identify(shuntL?.elements ?? [])),
      realize: { enabled: true, series: 'E24' as const, stockText: '', scope: 'all' as const },
    };
    const r = centreRequest(d);
    expect(r.options.vswrLimit).toBe(1.38);
    expect(r.options.band).toEqual(sweepPoints(0.9e9, 1.1e9, 11));
    expect(r.options.realize?.source).toEqual({ kind: 'series', series: 'E24' });
    expect((r.ladder.elements[0] as { value: number }).value).toBe(11e-9);
    expect('runs' in r.options).toBe(false);
  });
});
