/**
 * Adversarial tests, QA round 2: an .xmlsc with more user datapoints than
 * MAX_DATAPOINTS reopens as a datapoint sweep. Round trips of that design
 * through .xmlsc, the share link and the .json file, and the start datapoint.
 */
import { buildXmlsc, complex, writeXmlsc, type Ladder, type SweepLoad } from '@smithonline/core';
import { describe, expect, it } from 'vitest';
import { MAX_DATAPOINTS, userDatapoints } from '../src/lib/datapoints';
import { designFromXmlsc } from '../src/lib/design';
import { designSweep, designToXmlsc } from '../src/lib/files';
import { decodeDesign, encodeDesign } from '../src/lib/share';

const guid = (): (() => string) => {
  let n = 0;
  return () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
};
const dp = (f: number, r: number, x: number): SweepLoad => ({ frequency: f, z: complex(r, x) });
const ladder: Ladder = {
  z0: 50,
  frequency: 1e9,
  load: complex(20, -12),
  elements: [
    { kind: 'L', orientation: 'shunt', value: 8e-9 },
    { kind: 'C', orientation: 'series', value: 3e-12 },
  ],
};
const N = MAX_DATAPOINTS + 6;
/** N points in descending DP order so a re-sort would show. The start is DP6. */
const users = Array.from({ length: N }, (_, i) => dp(1e8 * (N - i), 10 + i, i - 30));
const START = 5;
const file = (opts: Parameters<typeof buildXmlsc>[1]): string =>
  writeXmlsc(
    buildXmlsc(
      { ...ladder, frequency: users[START]!.frequency, load: users[START]!.z },
      { userDatapoints: users, startIndex: START, guid: guid(), ...opts },
    ),
  );

describe('adv r2: oversized .xmlsc reopens as a datapoint sweep', () => {
  it('N > MAX user datapoints with a datapoint sweep: all points kept as sweep loads, start kept', () => {
    const d = designFromXmlsc(file({}), 'big');
    expect(d.datapoints).toBeUndefined();
    expect(d.sweep.loads).toHaveLength(N);
    expect(d.sweep.mode).toBe('datapoints');
    expect(d.sweep.enabled).toBe(true);
    expect(d.sweep.loadsName).toBe('big');
    expect(d.frequency).toBe(users[START]!.frequency);
    expect(d.load).toEqual(users[START]!.z);
    expect(designSweep(d)).toHaveLength(N);
  });

  it('N > MAX user datapoints with a FREQUENCY sweep record: the datapoints must survive', () => {
    const text = file({ frequencySweep: [5e8, 7.5e8, 1e9] });
    expect(text).toContain('CDatapoint');
    const d = designFromXmlsc(text, 'big');
    const kept = (d.sweep.loads?.length ?? 0) + userDatapoints(d).length;
    // Either as sweep loads or as user datapoints, but not silently dropped.
    expect(kept).toBeGreaterThanOrEqual(N);
  });

  it('xmlsc -> design -> xmlsc -> design keeps the loads, their order and the start', () => {
    const d1 = designFromXmlsc(file({}), 'big');
    const d2 = designFromXmlsc(designToXmlsc(d1), 'big');
    expect(d2.sweep.loads).toHaveLength(N);
    expect(d2.frequency).toBe(d1.frequency);
    expect(d2.load).toEqual(d1.load);
    expect(d2.sweep.enabled).toBe(true);
    expect(d2.sweep.mode).toBe('datapoints');
    // The DP order of the original file is the order of the loads.
    expect(d2.sweep.loads!.map((l) => l.frequency)).toEqual(
      d1.sweep.loads!.map((l) => l.frequency),
    );
    // Third write equals the second apart from the element GUIDs: the round trip is stable.
    const noGuid = (t: string): string => t.replace(/<GUID>[^<]*<\/GUID>/g, '');
    expect(noGuid(designToXmlsc(d2))).toBe(noGuid(designToXmlsc(d1)));
  });

  it('share link and .json round trip of the oversized design', () => {
    const d1 = designFromXmlsc(file({}), 'big');
    const d2 = decodeDesign(encodeDesign(d1));
    expect(d2).not.toBeNull();
    expect(d2!.sweep.loads).toHaveLength(N);
    expect(d2!.sweep.mode).toBe('datapoints');
    expect(d2!.sweep.loadsName).toBe('big');
    expect(d2!.datapoints).toBeUndefined();
    // .json is { design: <link payload> }
    const json = JSON.stringify({ design: encodeDesign(d1) });
    const d3 = decodeDesign((JSON.parse(json) as { design: string }).design);
    expect(d3!.sweep.loads).toHaveLength(N);
    // and back to xmlsc
    expect(designFromXmlsc(designToXmlsc(d3!), 'big').sweep.loads).toHaveLength(N);
  });

  it('boundary: exactly MAX points are user datapoints, MAX + 1 is a sweep', () => {
    const mk = (n: number): string =>
      writeXmlsc(
        buildXmlsc(ladder, {
          userDatapoints: Array.from({ length: n }, (_, i) => dp(1e8 * (i + 1), 10 + i, 0)),
          startIndex: 0,
          guid: guid(),
        }),
      );
    const at = designFromXmlsc(mk(MAX_DATAPOINTS), 'x');
    expect(userDatapoints(at)).toHaveLength(MAX_DATAPOINTS);
    expect(at.sweep.loads).toBeUndefined();
    const over = designFromXmlsc(mk(MAX_DATAPOINTS + 1), 'x');
    expect(userDatapoints(over)).toHaveLength(1);
    expect(over.sweep.loads).toHaveLength(MAX_DATAPOINTS + 1);
  });

  it('oversized with the sweep switched off reopens with the sweep off and the loads kept', () => {
    const d = designFromXmlsc(file({ sweepEnabled: false }), 'big');
    expect(d.sweep.enabled).toBe(false);
    expect(d.sweep.loads).toHaveLength(N);
    const again = designFromXmlsc(designToXmlsc(d), 'big');
    expect(again.sweep.enabled).toBe(false);
    expect(again.sweep.loads).toHaveLength(N);
  });
});
