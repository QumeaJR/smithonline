/**
 * QA round 1 on D7, app side, adversarial: Realize on with every value source
 * on an 8-part real frequency ladder (the snapping runs on the main thread in
 * the panel's view), and a share link carrying the ladder.
 */
import { describe, expect, it } from 'vitest';
import {
  complex,
  OPTIMIZE_FAIL,
  realFrequencyMatch,
  sweepPoints,
  worstVswr,
  type BroadbandCandidate,
  type Complex,
} from '@smithonline/core';
import { snapCandidate } from '../src/lib/broadband';
import { emptyDesign, identify, type Design } from '../src/lib/design';
import { decodeDesign, encodeDesign } from '../src/lib/share';
import { rftLabel } from '../src/lib/rft';

const TARGET: Complex = { re: 50, im: 0 };
const load = (f: number): Complex => complex(2, 2 * Math.PI * f * 200e-9);
const band = sweepPoints(100e6, 150e6, 33);

const rft = realFrequencyMatch(band, {
  load,
  z0: 50,
  parts: 8,
});
const best = rft.best!;

const candidate: BroadbandCandidate = {
  topology: { slots: [], label: rftLabel(best.elements) },
  elements: best.elements,
  worstVswr: best.worstVswr,
  count: best.elements.length,
  seeded: false,
  evaluations: 0,
};

const design = (series: Design['realize']['series'], stockText = ''): Design => ({
  ...emptyDesign(),
  frequency: 125e6,
  realize: { enabled: true, series, stockText, scope: 'all' },
});

describe('D7 app adversarial: Realize on with every source, 8 parts', () => {
  for (const [name, d] of [
    ['E6', design('E6')],
    ['E96', design('E96')],
    ['stock, empty', design('stock', '')],
    ['stock, two values', design('stock', '10nH\n10pF')],
    ['library, empty', design('library')],
  ] as const) {
    it(`${name}: the snapped VSWR is finite, the number the apply message states, and quick`, () => {
      const t0 = performance.now();
      const s = snapCandidate(d, [], candidate, load, rft.scoringFrequencies, TARGET);
      const ms = performance.now() - t0;
      console.log(
        `[snap ${name}] ${ms.toFixed(0)} ms, ideal ${best.worstVswr.toFixed(3)}, snapped ${s?.worstVswr} (${s?.sourceLabel})`,
      );
      expect(s).not.toBeNull();
      expect(Number.isNaN(s!.worstVswr)).toBe(false);
      expect(s!.worstVswr).toBeCloseTo(
        worstVswr(s!.elements, load, 50, rft.scoringFrequencies, TARGET),
        9,
      );
      // The panel's view memo runs this on the main thread on every design change.
      expect(ms).toBeLessThan(500);
    }, 120000);
  }
});

describe('D7 app adversarial: a share link carrying an 8-part RFT ladder', () => {
  it('the ladder read from the link has the worst VSWR the panel applied, to 1e-3', () => {
    const d: Design = {
      ...emptyDesign(),
      frequency: 125e6,
      elements: identify(best.elements),
    };
    const back = decodeDesign(encodeDesign(d))!;
    // QA fix: an 8-part run may answer with 7 parts when the eighth adds nothing (more parts
    // are never worse); the link carries what the run answered.
    expect(back.elements).toHaveLength(best.elements.length);
    const before = worstVswr(best.elements, load, 50, rft.scoringFrequencies, TARGET);
    const after = worstVswr(back.elements, load, 50, rft.scoringFrequencies, TARGET);
    console.log(`[share] before ${before} after ${after}`);
    expect(Math.abs(after - before) / before).toBeLessThan(1e-3);
  });
});

describe('D7 app adversarial: a short stock list', () => {
  it('the snapped row never carries the optimizer failure sentinel as a VSWR', () => {
    const d = design('stock', '10nH\n10pF');
    const s = snapCandidate(d, [], candidate, load, rft.scoringFrequencies, TARGET)!;
    // Round 1: 1000000 (OPTIMIZE_FAIL), shown as "8 parts, VSWR 1000000 (ideal 26.838)" and
    // applied as such by the row. QA fix: the snap says the stock cannot build the ladder, and
    // the panels (real frequency and search) then offer no row.
    // (After the round 1 fixes this ladder can snap to a finite VSWR; the rule is what is
    // checked: the sentinel is never a VSWR to show, it is flagged instead.)
    expect(s.unbuildable).toBe(!(s.worstVswr < OPTIMIZE_FAIL));
    if (!s.unbuildable) expect(Number.isFinite(s.worstVswr)).toBe(true);
    const e96 = snapCandidate(design('E96'), [], candidate, load, rft.scoringFrequencies, TARGET)!;
    expect(e96.unbuildable).toBe(false);
  }, 120000);
});
