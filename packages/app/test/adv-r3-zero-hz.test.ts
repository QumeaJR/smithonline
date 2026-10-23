/** QA round 3: a Touchstone file with a DC row handed to the chart as the start datapoint. */
import { evaluateLadder, readTouchstone } from '@smithonline/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { emptyDesign, identify } from '../src/lib/design';
import { designToNetlist, designToXmlsc, ladderOf } from '../src/lib/files';
import { decodeDesign, encodeDesign } from '../src/lib/share';
import { loadSPlotText, sendLoadToChart } from '../src/lib/splotActions';
import { useDesignStore } from '../src/store/useDesignStore';
import { useSPlotStore } from '../src/store/useSPlotStore';

const s1p = '# HZ S RI R 50\n0 0.2 0\n1e9 0.1 0.3\n2e9 -0.1 0.2\n';
const entries = (): { fileName: string }[] => {
  for (const v of Object.values(useSPlotStore.getState() as unknown as Record<string, unknown>)) {
    if (Array.isArray(v) && v.length > 0 && typeof v[0] === 'object' && 'fileName' in v[0])
      return v;
  }
  return [];
};

describe('adv r3: 0 Hz rows', () => {
  beforeEach(() => {
    useDesignStore.getState().init({
      ...emptyDesign(),
      elements: identify([
        { kind: 'C', orientation: 'shunt', value: 2e-12 },
        { kind: 'L', orientation: 'series', value: 3e-9 },
      ]),
    });
  });
  it('the reader accepts a DC row', () => {
    const d = readTouchstone(s1p, 1);
    expect(d.points[0]!.frequency).toBe(0);
  });
  it('send load at the DC row: the design frequency must stay positive', () => {
    loadSPlotText('dc.s1p', s1p);
    const entry = entries().find((e) => e.fileName === 'dc.s1p');
    expect(entry).toBeDefined();
    const msg = sendLoadToChart(entry as never, 1, 0);
    const d = useDesignStore.getState().design;
    const r = evaluateLadder(ladderOf(d), { arcSteps: 0 });
    let x: string;
    try {
      x =
        designToXmlsc(d)
          .match(/<Frequency>[^<]*/g)
          ?.slice(0, 2)
          .join(' ') ?? '';
    } catch (e) {
      x = 'threw ' + (e as Error).message;
    }
    console.log(
      'send load at DC:',
      msg,
      '| frequency',
      d.frequency,
      '| zin',
      JSON.stringify(r.datapoints.map((z) => [z.re, z.im])),
      '| xmlsc',
      x,
      '| netlist',
      designToNetlist(d, 'x').match(/FIXED.*/)?.[0],
      '| link frequency',
      decodeDesign(encodeDesign(d))?.frequency,
    );
    expect(d.frequency).toBeGreaterThan(0);
  });
});
