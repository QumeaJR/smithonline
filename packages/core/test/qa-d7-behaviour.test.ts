/**
 * QA round 1, D7: realFrequencyMatch as a whole. The comparison table of
 * docs/08-depth-plan.md (D7) re-run cell by cell, the result against the
 * degree 1 to 8, every prototype k, the honesty of the reported synthesis
 * error and the input limits.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  broadbandMatch,
  cabs,
  cadd,
  cdiv,
  complex,
  csub,
  impedanceRows,
  interpolatedLoad,
  ladderAbcd,
  readTouchstone,
  realFrequencyMatch,
  sweepPoints,
  throughAbcd,
  type Complex,
  type Element,
  type LoadModel,
  type RftResult,
} from '../src/index.js';

const file = (name: string) => readFileSync(join(__dirname, 'fixtures', 'sparams', name), 'utf8');
const measured = (name: string): LoadModel =>
  interpolatedLoad(impedanceRows(readTouchstone(file(name))), { z0: 50 });
const lesson = (f: number): Complex => complex(10, 2 * Math.PI * f * 50e-9);

function gainAt(elements: readonly Element[], zl: Complex, r0: number, f: number): number {
  const zin = throughAbcd(ladderAbcd(elements, f), zl);
  const g = cabs(cdiv(csub(zin, complex(r0)), cadd(zin, complex(r0))));
  return 1 - g * g;
}

describe('docs/08 D7 comparison table, re-run', () => {
  // QA fix: the table now runs on 33 band points for every part count (as the panel does) and
  // has three numbers per cell: the search's best of that size, the technique on its own, and
  // the technique started also from the search's best ladders (as the panel runs it once the
  // search has run). Worst VSWR on the same dense grid, as printed in docs/08.
  const TABLE: { name: string; load: LoadModel; band: [number, number]; cells: number[][] }[] = [
    {
      name: 'broadband lesson antenna',
      load: lesson,
      band: [70e6, 130e6],
      cells: [
        [3.5414, 3.5414, 3.5414],
        [3.1643, 3.1643, 3.1643],
        [2.4306, 2.2086, 2.2086],
        [2.1354, 2.1898, 2.1354],
      ],
    },
    {
      name: 'sample antenna',
      load: measured('antenna-2g4-synthetic.s1p'),
      band: [2.2e9, 2.7e9],
      cells: [
        [2.5812, 2.5812, 2.5812],
        [2.0857, 2.0, 2.0],
        [1.5614, 1.5244, 1.5285],
        [1.5275, 1.4933, 1.4933],
      ],
    },
    {
      name: 'synthetic dipole',
      load: measured('dipole-synthetic.s1p'),
      band: [130e6, 160e6],
      cells: [
        [4.1305, 4.1428, 4.1305],
        [2.4005, 2.4005, 2.4005],
        [1.6242, 1.5729, 1.5729],
        [1.5633, 1.5616, 1.5613],
      ],
    },
  ];
  for (const { name, load, band, cells } of TABLE) {
    it(`${name}: every cell as printed (4 decimals)`, () => {
      const freqs = sweepPoints(band[0], band[1], 33);
      const s = broadbandMatch(freqs, { load, z0: 50, maxElements: 4 });
      const ladders = s.bestBySize.map((c) => c.elements);
      cells.forEach(([search, alone, seeded], i) => {
        const n = i + 1;
        const same = s.bestBySize.find((c) => c.count === n)!;
        expect(Math.abs(same.worstVswr - search!)).toBeLessThan(5e-5);
        const r = realFrequencyMatch(freqs, { load, z0: 50, parts: n });
        expect(Math.abs(r.best!.worstVswr - alone!)).toBeLessThan(5e-5);
        const t = realFrequencyMatch(freqs, { load, z0: 50, parts: n, ladders });
        expect(Math.abs(t.best!.worstVswr - seeded!)).toBeLessThan(5e-5);
        // From the search's ladders it is never worse than the search.
        expect(t.best!.worstVswr).toBeLessThanOrEqual(same.worstVswr * (1 + 1e-9));
      });
    }, 300000);
  }
});

describe('the result against the number of parts (lesson antenna, 70 to 130 MHz)', () => {
  it('more parts never give a worse ladder, 1 to 8, and the lowpass prototype always gives one', () => {
    // A degree n + 1 equalizer contains every degree n one (a part of value going to zero),
    // and the search starts from the degree n optimum with a part added (docs/08), so the
    // best worst VSWR cannot rise with n. Any real h(p) with h(0) = 0 is a lowpass ladder
    // ending in R0, so k = 0 always has a ladder.
    let last = Infinity;
    const worst: number[] = [];
    const lowpass: boolean[] = [];
    // QA fix: the same 33 band points for every n, as the app now runs every part count
    // (round 1 used max(21, 4n + 1) points, a different band sampling per n, which nothing
    // guarantees monotone across).
    const freqs = sweepPoints(70e6, 130e6, 33);
    // One 8-part run carries the runs of 7 to 1 parts it started from (result.lower), the same
    // runs as on their own; walking that chain checks every n at the cost of one run.
    const chain: RftResult[] = [];
    for (
      let r: RftResult | null = realFrequencyMatch(freqs, { load: lesson, z0: 50, parts: 8 });
      r;
      r = r.lower
    ) {
      chain.unshift(r);
    }
    expect(chain.map((r) => r.parts)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    for (const r of chain) {
      worst.push(r.best!.worstVswr);
      lowpass.push(r.solutions.some((s) => s.zerosAtDc === 0));
      // The reported synthesis error is what the cascade shows (no prefix here).
      for (const s of r.solutions) {
        let err = 0;
        r.scoringFrequencies.forEach((f, i) => {
          const t = gainAt(s.synthesized, lesson(f), 50, f);
          err = Math.max(err, Math.abs(t - (s.gain[i] as number)));
        });
        expect(Math.abs(err - s.synthesisError)).toBeLessThan(1e-12);
        expect(Math.max(...s.gain)).toBeLessThanOrEqual(1 + 1e-9);
        s.elements.forEach((e) => expect((e as { value: number }).value).toBeGreaterThan(0));
        // Polished ladders keep to the search's part window.
        expect(s.outsideWindow).toBe(0);
      }
    }
    worst.forEach((w, i) => {
      expect.soft(w, `${i + 1} parts after ${i}`).toBeLessThanOrEqual(last * (1 + 1e-6));
      last = w;
    });
    expect.soft(lowpass).toEqual([true, true, true, true, true, true, true, true]);
  }, 900000);
});

describe('every prototype k at 3 parts (lesson antenna)', () => {
  for (let k = 0; k <= 3; k++) {
    it(`k = ${k}: k parts block DC, positive values, no transformer, ends in R0`, () => {
      const r = realFrequencyMatch(sweepPoints(70e6, 130e6, 21), {
        load: lesson,
        z0: 50,
        parts: 3,
        zerosAtDc: [k],
      });
      expect(r.solutions).toHaveLength(1);
      const s = r.best!;
      expect(s.zerosAtDc).toBe(k);
      expect(s.prototype).toBe(k === 0 ? 'lowpass' : k === 3 ? 'highpass' : 'bandpass');
      for (const els of [s.synthesized, s.elements]) {
        expect(els).toHaveLength(3);
        // Series C and shunt L are the parts with a transmission zero at DC.
        const atDc = els.filter(
          (e) =>
            (e.kind === 'C' && e.orientation === 'series') ||
            (e.kind === 'L' && e.orientation === 'shunt'),
        );
        expect(atDc).toHaveLength(k);
        els.forEach((e) => {
          expect(e.kind === 'L' || e.kind === 'C').toBe(true);
          expect((e as { value: number }).value).toBeGreaterThan(0);
        });
      }
      expect(Math.abs(s.termination - 1)).toBeLessThan(1e-6);
      expect(s.synthesisError).toBeLessThan(1e-6);
      // QA fix: the result keeps to the search's part window, which can cost against an
      // unconstrained synthesized ladder; it is never outside the window.
      expect(s.outsideWindow).toBe(0);
      // shapeVswr from minGain: |Gamma| = sqrt(1 - minGain).
      const g = Math.sqrt(1 - s.minGain);
      expect(s.shapeVswr).toBeCloseTo((1 + g) / (1 - g), 9);
    }, 120000);
  }
});

describe('input limits', () => {
  const band = sweepPoints(70e6, 130e6, 21);
  it('no band, one frequency, or a source resistance that is not positive: no ladder', () => {
    expect(realFrequencyMatch([], { load: lesson, z0: 50, parts: 2 }).best).toBeNull();
    expect(realFrequencyMatch([1e8], { load: lesson, z0: 50, parts: 2 }).best).toBeNull();
    expect(
      realFrequencyMatch([NaN, -1, 0, Infinity], { load: lesson, z0: 50, parts: 2 }).best,
    ).toBeNull();
    for (const z0 of [0, -50, NaN]) {
      expect(realFrequencyMatch(band, { load: lesson, z0, parts: 1 }).best).toBeNull();
    }
  });

  it('a number of zeros at DC outside 0 to n: no ladder, no steps', () => {
    const r = realFrequencyMatch(band, { load: lesson, z0: 50, parts: 2, zerosAtDc: [5, -1, 1.5] });
    expect(r.best).toBeNull();
    expect(r.steps).toBe(0);
  });

  it('parts are held to 1 to 8, also when not a number', () => {
    const opts = { load: lesson, z0: 50, continuation: false, starts: 2, polish: false } as const;
    expect(realFrequencyMatch(band, { ...opts, parts: 0 }).parts).toBe(1);
    expect(realFrequencyMatch(band, { ...opts, parts: 2.7 }).parts).toBe(2);
    expect(realFrequencyMatch(band, { ...opts, parts: 12 }).parts).toBe(8);
    // NaN parts: expected a degree in 1 to 8 (observed parts NaN, no ladder).
    const r = realFrequencyMatch(band, { ...opts, parts: NaN });
    expect(r.parts).toBeGreaterThanOrEqual(1);
    expect(r.parts).toBeLessThanOrEqual(8);
  }, 120000);
});
