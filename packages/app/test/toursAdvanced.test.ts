import {
  cabs,
  complex,
  evaluateLadder,
  interpolatedLoad,
  sweepPoints,
  worstVswr,
  zToGamma,
  type Complex,
} from '@smithonline/core';
import { describe, expect, it } from 'vitest';
import { ladderBandwidth } from '../src/lib/bandwidth';
import { userDatapoints } from '../src/lib/datapoints';
import { targetOf, type Design } from '../src/lib/design';
import { designLadder, effectiveElements, realizeDesign } from '../src/lib/realize';
import { TOURS, type Tour } from '../src/lib/tours';
import { quarterWaveBandwidth } from '../src/lib/toursAdvanced';

/** Every design a tour passes through, from the start design to the last step. */
function walk(tour: Tour): Design[] {
  const designs: Design[] = [tour.start()];
  for (const step of tour.steps.slice(1)) {
    designs.push(step.apply(designs[designs.length - 1] as Design));
  }
  return designs;
}

const tour = (id: string): Tour => TOURS.find((t) => t.id === id) as Tour;
const zin = (d: Design): Complex =>
  evaluateLadder(designLadder(d, effectiveElements(d)), { arcSteps: 0 }).zin;
const loadedQ = (d: Design): number =>
  evaluateLadder(designLadder(d, d.elements), { arcSteps: 0 }).loadedQ;
const band = (d: Design): number[] => sweepPoints(d.sweep.start, d.sweep.stop, d.sweep.points);
const worst = (d: Design): number =>
  worstVswr(
    d.elements,
    d.sweep.loads && d.sweep.loads.length >= 2 ? interpolatedLoad(d.sweep.loads) : d.load,
    d.z0,
    band(d),
    targetOf(d),
  );

describe('advanced tours: each lesson ends where it says', () => {
  it('band optimizer: the exact match is traded for a lower worst VSWR, then a wider band costs more', () => {
    const [exact, opt, wide] = walk(tour('band-optimizer')) as [Design, Design, Design];
    expect(cabs(zToGamma(zin(exact), exact.z0))).toBeLessThan(1e-9);
    expect(worst(opt)).toBeLessThan(worst(exact));
    // The centre is no longer exact, but close.
    expect(cabs(zToGamma(zin(opt), opt.z0))).toBeGreaterThan(1e-6);
    expect(cabs(zToGamma(zin(opt), opt.z0))).toBeLessThan(0.2);
    expect(wide.sweep.start).toBeLessThan(opt.sweep.start);
    expect(worst(wide)).toBeGreaterThan(worst(opt));
    expect(worst(wide)).toBeLessThan(worst({ ...wide, elements: exact.elements }));
  });

  it('broadband: each cap does at least as well as the one before, all beat the centre match', () => {
    const [bare, l, two, three, four] = walk(tour('broadband')) as Design[];
    expect(bare?.sweep.loads?.length).toBe(61);
    expect(l?.elements).toHaveLength(2);
    const w = [l, two, three, four].map((d) => worst(d as Design));
    expect(w[1]).toBeLessThan(w[0] as number);
    expect(w[2]).toBeLessThanOrEqual(w[1] as number);
    expect(w[3]).toBeLessThanOrEqual(w[2] as number);
    expect(four?.elements.length).toBeLessThanOrEqual(4);
    // Every candidate must still beat the Bode-Fano floor the other way round: never below it.
    expect(w[3]).toBeGreaterThan(1.4);
  });

  it('realize: E24, E96 and the stock list all produce a realization; E96 lands closer than E24', () => {
    const designs = walk(tour('realize'));
    const vswrOf = (d: Design): number => {
      const r = realizeDesign(d, effectiveElements(d));
      if (!r) throw new Error('no realization');
      const g = cabs(zToGamma(r.result.zin, d.z0));
      return (1 + g) / (1 - g);
    };
    expect(designs[0]?.realize.enabled).toBe(false);
    expect(designs[1]?.realize.series).toBe('E24');
    expect(designs[2]?.realize.series).toBe('E96');
    expect(designs[3]?.realize.series).toBe('stock');
    expect(vswrOf(designs[2] as Design)).toBeLessThan(vswrOf(designs[1] as Design));
    expect(vswrOf(designs[3] as Design)).toBeGreaterThan(1);
  });

  it('packages: losses come first, then every L and C carries the package of the step', () => {
    const [ideal, lossy, small, big] = walk(tour('packages')) as Design[];
    expect(ideal?.losses.enabled).toBe(false);
    expect(lossy?.losses.enabled).toBe(true);
    expect(small?.elements.every((el) => (el as { package?: string }).package === '0402')).toBe(
      true,
    );
    expect(big?.elements.every((el) => (el as { package?: string }).package === '0805')).toBe(true);
    // The lossy network no longer sits on the centre.
    expect(cabs(zToGamma(zin(lossy as Design), 50))).toBeGreaterThan(0.01);
  });

  it('PA output: three datapoints with the start in the middle, two sections halve the Q', () => {
    const designs = walk(tour('pa-output'));
    const start = designs[0] as Design;
    const points = userDatapoints(start);
    expect(points.map((p) => p.frequency)).toEqual([850e6, 900e6, 950e6]);
    expect(points[1]?.z).toEqual(start.load);
    const single = designs[1] as Design;
    const double = designs[3] as Design;
    expect(single.elements).toHaveLength(2);
    expect(double.elements).toHaveLength(4);
    expect(cabs(zToGamma(zin(single), 50))).toBeLessThan(1e-9);
    expect(cabs(zToGamma(zin(double), 50))).toBeLessThan(1e-9);
    expect(loadedQ(double)).toBeLessThan(0.6 * loadedQ(single));
    expect(designs[2]?.sweep.enabled).toBe(true);
    expect(designs[2]?.sweep.mode).toBe('datapoints');
  });

  it('Pi and T: three parts at the asked Q, all landing on Z0, the band narrowing with Q', () => {
    const designs = walk(tour('pi-t'));
    const [, l, pi4, pi8, t4] = designs as Design[];
    for (const d of [l, pi4, pi8, t4]) {
      expect(cabs(zToGamma(zin(d as Design), 50))).toBeLessThan(1e-6);
    }
    expect(pi4?.elements).toHaveLength(3);
    expect(t4?.elements).toHaveLength(3);
    expect(loadedQ(pi4 as Design)).toBeCloseTo(4, 2);
    expect(loadedQ(pi8 as Design)).toBeCloseTo(8, 2);
    expect(loadedQ(t4 as Design)).toBeCloseTo(4, 2);
    const span = (d: Design): number =>
      ladderBandwidth(designLadder(d, d.elements), 2)?.span ?? Infinity;
    expect(span(pi4 as Design)).toBeLessThan(span(l as Design));
    expect(span(pi8 as Design)).toBeLessThan(span(pi4 as Design));
  });

  it('quarter wave: one section and two sections land on Z0, the two sections are wider', () => {
    const designs = walk(tour('quarter-wave'));
    const one = designs[1] as Design;
    const two = designs[3] as Design;
    expect(cabs(zToGamma(zin(one), 50))).toBeLessThan(1e-9);
    expect(cabs(zToGamma(zin(two), 50))).toBeLessThan(1e-9);
    const z0s = two.elements.map((el) => (el as { z0: number }).z0);
    expect(z0s[0]).toBeCloseTo(50 * 4 ** 0.75, 6);
    expect(z0s[1]).toBeCloseTo(50 * 4 ** 0.25, 6);
    const span = (d: Design): number =>
      ladderBandwidth(designLadder(d, d.elements), 2)?.span ?? Infinity;
    expect(span(two)).toBeGreaterThan(span(one));
    // The textbook band of a single section agrees with the searched one.
    const theory = quarterWaveBandwidth(50, 200, 2) as number;
    expect(theory).toBeGreaterThan(0);
    expect(span(one) / one.frequency).toBeCloseTo(theory, 2);
    expect(designs[2]?.vswrCircles).toEqual([2]);
  });

  it('the textbook quarter-wave bandwidth has no edge when the load already meets the limit', () => {
    expect(quarterWaveBandwidth(50, 100, 2)).toBeNull();
    expect(quarterWaveBandwidth(50, 50, 2)).toBeNull();
    expect(quarterWaveBandwidth(50, 200, 1)).toBeNull();
    // A tighter limit gives a narrower band, a bigger step too.
    const tight = quarterWaveBandwidth(50, 200, 1.5) as number;
    expect(tight).toBeGreaterThan(0);
    expect(tight).toBeLessThan(quarterWaveBandwidth(50, 200, 2) as number);
    expect(quarterWaveBandwidth(50, 400, 2) as number).toBeLessThan(
      quarterWaveBandwidth(50, 200, 2) as number,
    );
  });

  it('the broadband tour load is the series R-L it claims to be', () => {
    const d = tour('broadband').start();
    for (const p of d.sweep.loads ?? []) {
      expect(p.z.re).toBe(10);
      expect(p.z.im).toBeCloseTo(2 * Math.PI * p.frequency * 50e-9, 9);
    }
    expect(d.load).toEqual(complex(10, (d.sweep.loads ?? [])[30]?.z.im ?? NaN));
  });
});
