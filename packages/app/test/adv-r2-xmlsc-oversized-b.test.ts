/** QA round 2 follow-up: is the re-save of an oversized .xmlsc stable after the first reorder, and is the start kept. */
import { buildXmlsc, complex, writeXmlsc, type Ladder, type SweepLoad } from '@smithonline/core';
import { describe, expect, it } from 'vitest';
import { MAX_DATAPOINTS } from '../src/lib/datapoints';
import { designFromXmlsc } from '../src/lib/design';
import { designToXmlsc } from '../src/lib/files';

const guid = (): (() => string) => {
  let n = 0;
  return () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
};
const dp = (f: number, r: number, x: number): SweepLoad => ({ frequency: f, z: complex(r, x) });
const N = MAX_DATAPOINTS + 6;
const users = Array.from({ length: N }, (_, i) => dp(1e8 * (N - i), 10 + i, i - 30));
const START = 5;
const ladder: Ladder = {
  z0: 50,
  frequency: users[START]!.frequency,
  load: users[START]!.z,
  elements: [{ kind: 'L', orientation: 'shunt', value: 8e-9 }],
};
const text = writeXmlsc(
  buildXmlsc(ladder, { userDatapoints: users, startIndex: START, guid: guid() }),
);

describe('adv r2b: oversized xmlsc re-save', () => {
  it('second and third writes are identical (stable after one reorder) and the start is kept', () => {
    const d1 = designFromXmlsc(text, 'big');
    const w1 = designToXmlsc(d1);
    const d2 = designFromXmlsc(w1, 'big');
    const w2 = designToXmlsc(d2);
    expect(d2.frequency).toBe(d1.frequency);
    expect(d2.load).toEqual(d1.load);
    expect(w2.replace(/<GUID>[^<]*<\/GUID>/g, '')).toBe(w1.replace(/<GUID>[^<]*<\/GUID>/g, ''));
  });
  it('the DP number of the start changes on re-save: observe', () => {
    const d1 = designFromXmlsc(text, 'big');
    const d2 = designFromXmlsc(designToXmlsc(d1), 'big');
    const idx1 = d1.sweep.loads!.findIndex((l) => l.frequency === d1.frequency);
    const idx2 = d2.sweep.loads!.findIndex((l) => l.frequency === d2.frequency);
    expect(idx2).toBe(idx1);
  });
});
