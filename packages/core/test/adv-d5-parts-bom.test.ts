/**
 * Adversarial QA, D5 round 1: what a part file's text and numbers do in the
 * BOM, the card values and the stress columns.
 */
import { describe, expect, it } from 'vitest';
import {
  bomCsv,
  bomRows,
  complex,
  ladderStress,
  libraryPartFromData,
  logFrequencies,
  partAt,
  partDataFromCircuit,
  readPartFile,
  realizeLadder,
  writeTouchstone,
  type Complex,
  type Ladder,
  type PartCircuit,
} from '@smithonline/core';

function fileOf(circuit: PartCircuit, comments: string[]): string {
  const data = partDataFromCircuit(circuit, 'series', logFrequencies(10e6, 10e9, 101), 50);
  const points = data.f.map((frequency, k) => {
    const o = 8 * k;
    const c = (i: number): Complex => complex(data.s[o + i] as number, data.s[o + i + 1] as number);
    return { frequency, s: [c(0), c(2), c(4), c(6)] };
  });
  return writeTouchstone(
    { ports: 2, z0: 50, points },
    { format: 'RI', frequencyUnit: 'MHZ', digits: 12, comments },
  );
}
const C10: PartCircuit = { type: 'C', c: 10e-12, esl: 0.38e-9, esr: 0.2 };

describe('BOM from a part file', () => {
  it('a manufacturer line from the file cannot become a spreadsheet formula in the BOM CSV', () => {
    const text = fileOf(C10, ['Manufacturer: =HYPERLINK("http://example.invalid","x")']);
    const part = readPartFile(text, 'GRMX.s2p').part;
    const ladder: Ladder = {
      z0: 50,
      frequency: 1e9,
      load: complex(10, 5),
      elements: [{ kind: 'part', orientation: 'shunt', part }],
    };
    const csv = bomCsv(
      bomRows(realizeLadder(ladder, { source: { kind: 'series', series: 'E24' }, scope: 'all' })),
    );
    const cells = csv.split('\n').flatMap((l) => l.split(';'));
    const formula = cells.find((c) => /^"?[=+\-@]/.test(c) && /HYPERLINK/.test(c));
    expect(formula).toBeUndefined();
  });
  it('stress of a part outside its data is not written as NaN in the BOM CSV', () => {
    const part = readPartFile(fileOf(C10, []), 'P.s2p').part;
    const ladder: Ladder = {
      z0: 50,
      frequency: 20e9,
      load: complex(10, 5),
      elements: [{ kind: 'part', orientation: 'shunt', part }],
    };
    const r = realizeLadder(ladder, { source: { kind: 'series', series: 'E24' }, scope: 'all' });
    const csv = bomCsv(bomRows(r, undefined, { elements: ladderStress(ladder, 1) }));
    expect(csv).not.toMatch(/NaN|Infinity/);
  });
});

describe('card values from noisy data', () => {
  it('a capacitor whose measured ESR is slightly negative (calibration noise) is not shown as lossless', () => {
    const data = partDataFromCircuit(
      { type: 'C', c: 10e-12, esl: 0.38e-9, esr: -0.02 },
      'series',
      logFrequencies(10e6, 10e9, 101),
    );
    const part = libraryPartFromData(data, { manufacturer: 'M', partNumber: 'HIGHQ' });
    const at = partAt(part, 1e9);
    // Q = |X| / R with R < 0: Infinity ("lossless" on the card) hides that the data is not passive here.
    expect(at?.q).not.toBe(Infinity);
  });
});
