/**
 * D7 done means (docs/08-depth-plan.md): on the reference loads the real
 * frequency ladder meets or beats the topology search for the same part
 * count. The loads: the broadband lesson's antenna (10 ohm and 50 nH, 70 to
 * 130 MHz), the sample antenna (antenna-2g4-synthetic.s1p, 2.2 to 2.7 GHz)
 * and the synthetic dipole (dipole-synthetic.s1p, 130 to 160 MHz), the two
 * files through the fitted measured-load model the app uses. The search and
 * the technique see the same band points (as the panel builds them) and are
 * scored on the same dense grid. The numbers are in docs/08, D7.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  broadbandMatch,
  complex,
  impedanceRows,
  interpolatedLoad,
  readTouchstone,
  realFrequencyMatch,
  sweepPoints,
  type LoadModel,
} from '../src/index.js';

const file = (name: string) => readFileSync(join(__dirname, 'fixtures', 'sparams', name), 'utf8');
const measured = (name: string): LoadModel =>
  interpolatedLoad(impedanceRows(readTouchstone(file(name))), { z0: 50 });

const LOADS: { name: string; load: LoadModel; band: [number, number] }[] = [
  {
    name: 'broadband lesson antenna',
    load: (f: number) => complex(10, 2 * Math.PI * f * 50e-9),
    band: [70e6, 130e6],
  },
  { name: 'sample antenna', load: measured('antenna-2g4-synthetic.s1p'), band: [2.2e9, 2.7e9] },
  { name: 'synthetic dipole', load: measured('dipole-synthetic.s1p'), band: [130e6, 160e6] },
];

/** Meeting means within this relative amount: both are optimizers that stop at a tolerance. */
const MEET = 1e-6;

describe('the real frequency ladder against the topology search', () => {
  for (const { name, load, band } of LOADS) {
    for (const n of [1, 2, 3, 4]) {
      it(`${name}, ${n} part${n === 1 ? '' : 's'}`, () => {
        const freqs = sweepPoints(band[0], band[1], Math.max(21, 4 * n + 1));
        const search = broadbandMatch(freqs, { load, z0: 50, maxElements: n });
        const same = search.candidates.filter((c) => c.count === n).map((c) => c.worstVswr);
        const searched = same.length > 0 ? Math.min(...same) : Infinity;
        const rft = realFrequencyMatch(freqs, { load, z0: 50, parts: n });
        const best = rft.best!;
        expect(best.elements).toHaveLength(n);
        expect(best.elements.every((e) => e.kind === 'L' || e.kind === 'C')).toBe(true);
        expect(best.worstVswr).toBeLessThanOrEqual(searched * (1 + MEET));
        // The ladder is the optimized gain shape, up to what the synthesis and the penalty lost.
        expect(best.synthesisError).toBeLessThan(1e-6);
        expect(best.worstVswr).toBeLessThanOrEqual(best.synthesizedVswr);
      }, 120000);
    }
  }
});
