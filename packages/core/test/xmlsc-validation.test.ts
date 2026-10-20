/**
 * Validation suite (PLAN.md phase 1, item 9): every example project shipped
 * with Smith V4.1 is loaded, its ladder rebuilt from the CComponent records
 * and the computed node impedances compared with the stored ones.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  cabs,
  complex,
  csub,
  evaluateLadder,
  ladderFromXmlsc,
  readXmlsc,
  sweepDatapoints,
  sweepFrequency,
  sweepValues,
  type Complex,
} from '../src/index';

const FIXTURES = join(__dirname, 'fixtures', 'xmlsc');
const files = readdirSync(FIXTURES)
  .filter((f) => f.endsWith('.xmlsc'))
  .sort();

/**
 * Relative tolerance on the impedance as a whole: |computed - stored| / |stored|.
 * Example 15 stores its lossy line length rounded to four digits (2.006
 * wavelengths), so its result only agrees to about 1e-3.
 */
const TOLERANCE: Readonly<Record<string, number>> = { 'Example15.xmlsc': 1e-2 };

function relError(computed: Complex, stored: Complex): number {
  return cabs(csub(computed, stored)) / Math.max(cabs(stored), 1e-300);
}

describe('xmlsc validation against the 22 example projects', () => {
  it('finds every fixture', () => {
    expect(files).toHaveLength(22);
  });

  for (const file of files) {
    const tol = TOLERANCE[file] ?? 1e-6;

    it(`${file}: reproduces Rend/Xend of every component within ${tol}`, () => {
      const design = readXmlsc(readFileSync(join(FIXTURES, file), 'utf8'));
      const ladder = ladderFromXmlsc(design);
      const result = evaluateLadder(ladder);

      expect(result.datapoints).toHaveLength(design.components.length + 1);
      design.components.forEach((c, i) => {
        const before = result.datapoints[i] as Complex;
        const after = result.datapoints[i + 1] as Complex;
        // Rbegin/Xbegin are occasionally stored with single precision
        // (Example 9), hence the looser check on the input side.
        expect(relError(before, complex(c.rBegin, c.xBegin))).toBeLessThan(Math.max(tol, 1e-6));
        expect(relError(after, complex(c.rEnd, c.xEnd))).toBeLessThan(tol);
      });

      // The transformed datapoints repeat the same values.
      expect(ladder.storedNodes).toHaveLength(design.components.length);
      ladder.storedNodes.forEach((stored, i) => {
        expect(relError(result.datapoints[i + 1] as Complex, stored)).toBeLessThan(tol);
      });
    });
  }

  it('Example16: reproduces the frequency sweep points', () => {
    const design = readXmlsc(readFileSync(join(FIXTURES, 'Example16.xmlsc'), 'utf8'));
    const ladder = ladderFromXmlsc(design);
    expect(design.sweep?.sweepType).toBe('frequency');
    const sweep = design.sweep!;
    const frequencies = sweepValues(sweep.startFrequency, sweep.stopFrequency, sweep.stepFrequency);
    expect(frequencies).toHaveLength(design.sweepDatapoints.length);
    const points = sweepFrequency(ladder, frequencies);
    design.sweepDatapoints.forEach((sp, i) => {
      const p = points[i]!;
      expect(p.frequency).toBeCloseTo(sp.frequency, 3);
      expect(relError(p.zin, complex(sp.r, sp.x))).toBeLessThan(1e-6);
    });
  });

  it('Example17: reproduces the datapoint sweep points', () => {
    const design = readXmlsc(readFileSync(join(FIXTURES, 'Example17.xmlsc'), 'utf8'));
    const ladder = ladderFromXmlsc(design);
    expect(design.sweep?.sweepType).toBe('datapoint');
    expect(ladder.sweepLoads).toHaveLength(3);
    const points = sweepDatapoints(ladder, ladder.sweepLoads);
    expect(points).toHaveLength(design.sweepDatapoints.length);
    design.sweepDatapoints.forEach((sp, i) => {
      const p = points[i]!;
      expect(p.frequency).toBe(sp.frequency);
      expect(relError(p.zin, complex(sp.r, sp.x))).toBeLessThan(1e-6);
    });
  });

  it('Example15: the lossy line model is confirmed once the rounded length is refined', () => {
    // The file stores the length rounded to four digits (2.006 wavelengths),
    // which alone moves the result by 5.5e-3. A fit over length and alpha
    // returns alpha = 2.000 dB/m exactly and length 2.00556, with a residual
    // of 5.5e-5, so the model (dB/m on the physical length, physical length =
    // electrical length / sqrt(er)) holds and only the stored length is coarse.
    const design = readXmlsc(readFileSync(join(FIXTURES, 'Example15.xmlsc'), 'utf8'));
    const ladder = ladderFromXmlsc(design);
    const stored = complex(design.components[0]!.rEnd, design.components[0]!.xEnd);
    const withStoredLength = evaluateLadder(ladder).datapoints[1]!;
    expect(relError(withStoredLength, stored)).toBeLessThan(6e-3);
    const line = ladder.elements[0]!;
    expect(line.kind).toBe('line');
    const refined = evaluateLadder({
      ...ladder,
      elements: [{ ...line, length: 2.00556 } as typeof line, ...ladder.elements.slice(1)],
    }).datapoints[1]!;
    expect(relError(refined, stored)).toBeLessThan(1e-4);
  });
});
