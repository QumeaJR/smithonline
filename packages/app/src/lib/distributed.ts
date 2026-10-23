/**
 * How the Transformer and Stub filter tools put their lines and stubs into
 * the design: at the design frequency like every other line, in one undo
 * step, with a sweep the Response view can show.
 */
import type { LineElement, StubElement } from '@smithonline/core';
import { withIdentity, type Design, type DesignElement } from './design';
import { sweepLoadsOf } from './datapoints';
import { fmtFrequency } from './format';
import { useDesignStore } from '../store/useDesignStore';

export type Distributed = LineElement | StubElement;

/**
 * The elements as the app keeps every line: the electrical length at the
 * design frequency, the reference frequency equal to it. The physical length
 * is the same, so `.xmlsc` (which stores lengths at the design frequency)
 * keeps them, and a later change of the design frequency treats them like
 * any other line.
 */
export function atDesignFrequency<T extends Distributed>(elements: readonly T[], f: number): T[] {
  return elements.map((el) => ({
    ...el,
    length: (el.length * f) / (el.refFrequency ?? f),
    refFrequency: f,
  }));
}

/**
 * Append the elements in one undo step. A sweep that is off is switched on
 * over the given range as a frequency sweep (datapoints, imported or typed,
 * are kept), so the Response view has the curve. A range that is not finite
 * and positive leaves the sweep alone. Returns the words for the status line.
 */
export function appendDistributed(
  elements: readonly Distributed[],
  start: number,
  stop: number,
): string {
  const store = useDesignStore.getState();
  const before = store.design;
  const usable = start > 0 && stop > start && Number.isFinite(stop);
  const setSweep = !before.sweep.enabled && usable;
  const loads = sweepLoadsOf(before).length;
  store.update((d: Design) => {
    let list: readonly DesignElement[] = d.elements;
    for (const el of elements) list = [...list, withIdentity(el, list)];
    if (!setSweep) return { ...d, elements: list };
    return {
      ...d,
      elements: list,
      sweep: {
        ...d.sweep,
        enabled: true,
        start,
        stop,
        points: Math.max(d.sweep.points, 201),
        ...(loads > 0 ? { mode: 'frequency' as const } : {}),
      },
    };
  });
  if (!setSweep) return '';
  const range = `${fmtFrequency(start)} to ${fmtFrequency(stop)}`;
  return loads > 0
    ? `; switched to a frequency sweep, ${range} (the ${loads} datapoints are kept)`
    : `; sweep set to ${range}`;
}
