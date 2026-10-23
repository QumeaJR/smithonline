/**
 * QA round 1: lib/datapoints.ts at its limits (NaN, negative and oversized
 * start slots, out-of-range indices, the datapoint cap) and the labels.
 */
import { complex } from '@smithonline/core';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  addDatapoint,
  designHasDatapointSweep,
  MAX_DATAPOINTS,
  removeDatapoint,
  setStartDatapoint,
  startIndex,
  sweepLoadsOf,
  updateDatapoint,
  userDatapoints,
} from '../src/lib/datapoints';
import { emptyDesign, identify, type Design } from '../src/lib/design';
import { datapointLabel } from '../src/lib/format';
import { useDesignStore } from '../src/store/useDesignStore';

const dp = (frequency: number, re: number, im = 0) => ({ frequency, z: complex(re, im) });

function design(over: Partial<Design> = {}): Design {
  return { ...emptyDesign(), frequency: 100e6, load: complex(30, 15), ...over };
}

describe('startIndex', () => {
  const two = { datapoints: [dp(1, 1), dp(2, 2)] };
  it('clamps negative, oversized and fractional slots; no list is 0', () => {
    expect(startIndex({ ...two, startSlot: -3 })).toBe(0);
    expect(startIndex({ ...two, startSlot: 7 })).toBe(2);
    expect(startIndex({ ...two, startSlot: 1.9 })).toBe(1);
    expect(startIndex({ startSlot: 2 })).toBe(0);
    expect(startIndex({ datapoints: [], startSlot: 1 })).toBe(0);
  });

  it('a NaN slot is 0, not NaN', () => {
    expect(startIndex({ ...two, startSlot: NaN })).toBe(0);
    expect(userDatapoints({ ...design(), ...two, startSlot: NaN })[0]!.frequency).toBe(100e6);
  });
});

describe('pure edits return the same design when nothing applies', () => {
  const d = design({ datapoints: [dp(150e6, 60, -10), dp(120e6, 45, 5)], startSlot: 1 });

  it('remove out of range or the last one; start at the current slot or out of range; update the start', () => {
    expect(removeDatapoint(d, 3)).toBe(d);
    expect(removeDatapoint(d, -1)).toBe(d);
    const single = design();
    expect(removeDatapoint(single, 0)).toBe(single);
    expect(setStartDatapoint(d, 1)).toBe(d);
    expect(setStartDatapoint(d, 3)).toBe(d);
    expect(setStartDatapoint(d, -1)).toBe(d);
    expect(updateDatapoint(d, 1, { frequency: 1 })).toBe(d);
    expect(updateDatapoint(d, 9, { frequency: 1 })).toBe(d);
  });

  it('adding at the cap is refused and the design is returned as is', () => {
    const full = design({
      datapoints: Array.from({ length: MAX_DATAPOINTS - 1 }, (_, i) => dp(1e6 * (i + 2), 10)),
      startSlot: 0,
    });
    expect(userDatapoints(full)).toHaveLength(MAX_DATAPOINTS);
    expect(addDatapoint(full, dp(5e9, 1))).toBe(full);
    const almost = design({
      datapoints: Array.from({ length: MAX_DATAPOINTS - 2 }, (_, i) => dp(1e6 * (i + 2), 10)),
    });
    expect(userDatapoints(addDatapoint(almost, dp(5e9, 1)))).toHaveLength(MAX_DATAPOINTS);
  });

  it('updating another point with only a frequency keeps its impedance', () => {
    const next = updateDatapoint(d, 0, { frequency: 1e9 });
    expect(userDatapoints(next)[0]).toEqual(dp(1e9, 60, -10));
    expect(next.load).toEqual(complex(30, 15));
  });
});

describe('moving the start', () => {
  it('re-references lines and stubs only; lumped parts keep their identity', () => {
    const d = design({
      datapoints: [dp(150e6, 60, -10)],
      startSlot: 0,
      elements: identify([
        { kind: 'openStub', z0: 50, length: 0.1, refFrequency: 100e6 },
        { kind: 'C', orientation: 'shunt', value: 1e-12 },
      ]),
    });
    const next = setStartDatapoint(d, 1);
    expect(next.frequency).toBe(150e6);
    expect(next.load).toEqual(complex(60, -10));
    expect((next.elements[0] as { refFrequency: number }).refFrequency).toBe(150e6);
    expect(next.elements[1]).toBe(d.elements[1]);
    expect(userDatapoints(next)).toEqual([dp(100e6, 30, 15), dp(150e6, 60, -10)]);
    expect(startIndex(next)).toBe(1);
  });

  it('moving to a point at the same frequency keeps the elements array itself', () => {
    const d = design({
      datapoints: [dp(100e6, 60, -10)],
      elements: identify([{ kind: 'line', z0: 50, length: 0.1 }]),
    });
    expect(setStartDatapoint(d, 1).elements).toBe(d.elements);
  });

  it('removing a point before the start shifts the slot down; after it leaves the slot', () => {
    const d = design({ datapoints: [dp(1e6, 1), dp(2e6, 2), dp(3e6, 3)], startSlot: 2 });
    expect(startIndex(removeDatapoint(d, 0))).toBe(1);
    expect(startIndex(removeDatapoint(d, 3))).toBe(2);
    expect(startIndex(removeDatapoint(d, 2))).toBe(2);
    expect(userDatapoints(removeDatapoint(d, 2)).map((p) => p.frequency)).toEqual([1e6, 2e6, 3e6]);
    expect(removeDatapoint(d, 2).load).toEqual(complex(3, 0));
  });

  it('a design reduced to one datapoint has no datapoints and startSlot fields', () => {
    const d = design({ datapoints: [dp(1e6, 1)], startSlot: 1 });
    const one = removeDatapoint(d, 0);
    expect(one.datapoints).toBeUndefined();
    expect(one.startSlot).toBeUndefined();
    expect(one.load).toEqual(complex(30, 15));
  });
});

describe('sweep selection', () => {
  it('an empty imported list does not hide the user datapoints; one datapoint is no sweep', () => {
    const two = design({ datapoints: [dp(1e6, 1)], sweep: { ...emptyDesign().sweep, loads: [] } });
    expect(sweepLoadsOf(two)).toHaveLength(2);
    expect(sweepLoadsOf(design())).toEqual([]);
  });

  it('mode frequency switches the datapoint sweep off even with loads', () => {
    const d = design({
      datapoints: [dp(1e6, 1)],
      sweep: { ...emptyDesign().sweep, loads: [dp(1, 1), dp(2, 2)], mode: 'frequency' },
    });
    expect(sweepLoadsOf(d)).toHaveLength(2);
    expect(designHasDatapointSweep(d)).toBe(false);
    expect(designHasDatapointSweep({ ...d, sweep: { ...d.sweep, mode: 'datapoints' } })).toBe(true);
  });
});

describe('datapointLabel', () => {
  it('numbers the start by its slot and the transformed points after the last user datapoint', () => {
    expect(datapointLabel(0)).toBe('DP1');
    expect(datapointLabel(1)).toBe('TP2');
    expect(datapointLabel(0, 3, 2)).toBe('DP3');
    expect(datapointLabel(1, 3, 2)).toBe('TP4');
    expect(datapointLabel(2, 3, 0)).toBe('TP5');
  });
});

describe('store wiring', () => {
  beforeEach(() => {
    useDesignStore.getState().init(
      design({
        datapoints: [dp(150e6, 60, -10)],
        startSlot: 0,
        elements: identify([{ kind: 'line', z0: 50, length: 0.1, refFrequency: 100e6 }]),
      }),
    );
  });

  it('removeDatapoint and setStartDatapoint select chain node 0', () => {
    useDesignStore.getState().select(1);
    useDesignStore.getState().setStartDatapoint(1);
    expect(useDesignStore.getState().selected).toBe(0);
    useDesignStore.getState().select(1);
    useDesignStore.getState().removeDatapoint(1);
    expect(useDesignStore.getState().selected).toBe(0);
    expect(userDatapoints(useDesignStore.getState().design)).toHaveLength(1);
  });

  it('setDatapoint on the start changes the design frequency and re-references the line', () => {
    useDesignStore.getState().setDatapoint(0, { frequency: 200e6 });
    const d = useDesignStore.getState().design;
    expect(d.frequency).toBe(200e6);
    expect((d.elements[0] as { refFrequency: number }).refFrequency).toBe(200e6);
    useDesignStore.getState().setDatapoint(0, { z: complex(1, 2) });
    expect(useDesignStore.getState().design.load).toEqual(complex(1, 2));
    // The other datapoint is untouched.
    expect(userDatapoints(useDesignStore.getState().design)[1]).toEqual(dp(150e6, 60, -10));
  });

  it('setDatapoint out of range changes nothing', () => {
    const before = useDesignStore.getState().design;
    useDesignStore.getState().setDatapoint(5, { frequency: 1 });
    expect(useDesignStore.getState().design).toBe(before);
  });
});
