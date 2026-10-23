/**
 * QA round 2 (distributed synthesis), adversary: appendDistributed across sweep and
 * datapoint states, and atDesignFrequency at far-off frequencies.
 */
import { complex, designStubFilter, ladderAbcd, transmissionS21 } from '@smithonline/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { designFromXmlsc, emptyDesign } from '../src/lib/design';
import { appendDistributed, atDesignFrequency } from '../src/lib/distributed';
import { designSweep, designToXmlsc } from '../src/lib/files';
import { decodeDesign, encodeDesign } from '../src/lib/share';
import { useDesignStore } from '../src/store/useDesignStore';

beforeEach(() => {
  useDesignStore.getState().init({ ...emptyDesign() });
});

describe('adv r2: appendDistributed across sweep and datapoint states', () => {
  const filter = () =>
    designStubFilter({ kind: 'lowpass', response: 'butterworth', order: 3, cutoff: 1e9, z0: 50 })
      .elements;

  it('sweep off, imported loads in datapoint mode: frequency sweep on, loads kept, one undo restores all', () => {
    const loads = [
      { frequency: 0.9e9, z: complex(40, 5) },
      { frequency: 1.1e9, z: complex(60, -5) },
    ];
    const d0 = {
      ...emptyDesign(),
      sweep: { ...emptyDesign().sweep, enabled: false, loads, mode: 'datapoints' as const },
    };
    useDesignStore.getState().init(d0);
    const msg = appendDistributed(atDesignFrequency(filter(), 1e9), 5e7, 3e9);
    const d = useDesignStore.getState().design;
    expect(msg).toContain('2 datapoints are kept');
    expect(d.sweep.loads).toEqual(loads);
    expect((designSweep(d) ?? []).length).toBeGreaterThanOrEqual(201);
    useDesignStore.getState().undo();
    expect(useDesignStore.getState().design.sweep).toEqual(d0.sweep);
  });

  it('sweep on in datapoint mode: elements only, the datapoint sweep stays and nothing is claimed', () => {
    const loads = [
      { frequency: 0.9e9, z: complex(40, 5) },
      { frequency: 1.1e9, z: complex(60, -5) },
    ];
    useDesignStore
      .getState()
      .init({ ...emptyDesign(), sweep: { ...emptyDesign().sweep, enabled: true, loads } });
    const msg = appendDistributed(atDesignFrequency(filter(), 1e9), 5e7, 3e9);
    expect(msg).toBe('');
    expect(designSweep(useDesignStore.getState().design)).toHaveLength(2);
    expect(useDesignStore.getState().design.elements).toHaveLength(5);
  });

  it('sweep off with a non-finite range: elements added, sweep left off, no claim', () => {
    const msg = appendDistributed(atDesignFrequency(filter(), 1e9), 1e8, Infinity);
    const d = useDesignStore.getState().design;
    expect(msg).toBe('');
    expect(d.sweep.enabled).toBe(false);
    expect(d.elements).toHaveLength(5);
  });

  it('sweep off with more points than 201 keeps them', () => {
    useDesignStore
      .getState()
      .init({ ...emptyDesign(), sweep: { ...emptyDesign().sweep, enabled: false, points: 1001 } });
    appendDistributed(atDesignFrequency(filter(), 1e9), 5e7, 3e9);
    expect(useDesignStore.getState().design.sweep.points).toBe(1001);
  });
});

describe('adv r2: atDesignFrequency far from the design frequency', () => {
  it('a 7 Hz cutoff filter in a 1 GHz design survives .xmlsc and the share link', () => {
    const f = designStubFilter({
      kind: 'lowpass',
      response: 'chebyshev',
      order: 5,
      rippleDb: 0.5,
      cutoff: 7,
      z0: 50,
    });
    appendDistributed(atDesignFrequency(f.elements, 1e9), 7 / 20, 21);
    const d = useDesignStore.getState().design;
    const loss = (x: typeof d, fr: number): number =>
      -transmissionS21(ladderAbcd(x.elements, fr), x.load, x.z0).db;
    expect(loss(d, 7)).toBeCloseTo(0.5, 6);
    const viaXmlsc = designFromXmlsc(designToXmlsc(d), 'x');
    const viaShare = decodeDesign(encodeDesign(d));
    expect(loss(viaXmlsc, 7)).toBeCloseTo(0.5, 3);
    expect(viaShare && loss(viaShare, 7)).toBeCloseTo(0.5, 3);
  });
});

// The session memory of f0 and cutoff (reset for a design at another frequency) is checked in
// the browser: renderToString reads the store's initial state, so a test here cannot see a
// design loaded after it.
