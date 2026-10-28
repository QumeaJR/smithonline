/**
 * D7 done means (docs/08-depth-plan.md): on the reference loads the real
 * frequency ladder meets or beats the topology search for the same part
 * count. The loads: the broadband lesson's antenna (10 ohm and 50 nH, 70 to
 * 130 MHz), the sample antenna (antenna-2g4-synthetic.s1p, 2.2 to 2.7 GHz)
 * and the synthetic dipole (dipole-synthetic.s1p, 130 to 160 MHz), the two
 * files through the fitted measured-load model the app uses. The search and
 * the technique see the same band points (33, as the panel builds them for
 * every part count) and are compared on the technique grid. As in the app,
 * the technique starts also from the search best ladder of each size and
 * keeps it as a candidate (QA round 1: on its own it can miss the search
 * ladder; qa-d7-behaviour.test.ts and docs/08, D7, have both numbers).
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
  worstVswr,
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
    const freqs = sweepPoints(band[0], band[1], 33);
    const search = broadbandMatch(freqs, { load, z0: 50, maxElements: 4 });
    const ladders = search.bestBySize.map((c) => c.elements);
    for (const n of [1, 2, 3, 4]) {
      it(`${name}, ${n} part${n === 1 ? '' : 's'}`, () => {
        const rft = realFrequencyMatch(freqs, { load, z0: 50, parts: n, ladders });
        const best = rft.best!;
        const same = search.bestBySize.find((c) => c.count === n);
        expect(same).toBeDefined();
        // Like for like: the search's ladder measured on the technique's grid.
        const searched = worstVswr(same!.elements, load, 50, rft.scoringFrequencies);
        expect(best.elements.length).toBeLessThanOrEqual(n);
        expect(best.elements.every((e) => e.kind === 'L' || e.kind === 'C')).toBe(true);
        expect(best.worstVswr).toBeLessThanOrEqual(searched * (1 + MEET));
        // Parts the search would allow: inside its window, Z0 / 25 to 10 Z0 at band centre. A
        // ladder the technique built always is; the search's own ladder can lie outside (the
        // dipole's 1-part shunt C is 618 ohm at band centre), and the result then flags it.
        if (best.source !== 'ladder') expect(best.outsideWindow).toBe(0);
        // The synthesis itself loses next to nothing.
        expect(best.synthesisError).toBeLessThan(1e-6);
      }, 120000);
    }
  }
});
