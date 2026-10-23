import type { SweepLoad } from '@smithonline/core';
import type { Design } from './design';

/**
 * The user datapoints DP1..DPn of a design. The chain starts from one of
 * them (Smith V4.1 "datapoint from which network is starting"); that one
 * lives in `design.load` and `design.frequency`, where everything else in
 * the application reads it, and the rest are kept in `design.datapoints`.
 * `startSlot` says where the start sits in the DP numbering. Reading the
 * list always takes the start from load and frequency, so a change made
 * there cannot leave a stale copy behind.
 */
export type UserDatapoint = SweepLoad;

type Points = Pick<Design, 'load' | 'frequency' | 'datapoints' | 'startSlot'>;

/** Largest number of user datapoints a design keeps (the demo limit of the original was 5). */
export const MAX_DATAPOINTS = 64;

/** Position of the start in the numbering, clamped into range. */
export function startIndex(d: Pick<Design, 'datapoints' | 'startSlot'>): number {
  const others = d.datapoints?.length ?? 0;
  const slot = Math.trunc(d.startSlot ?? 0);
  return Number.isFinite(slot) ? Math.min(Math.max(slot, 0), others) : 0;
}

/** All user datapoints in DP order, the start included. */
export function userDatapoints(d: Points): UserDatapoint[] {
  const others = d.datapoints ?? [];
  const slot = startIndex(d);
  return [...others.slice(0, slot), { frequency: d.frequency, z: d.load }, ...others.slice(slot)];
}

/** Lines and stubs keep their electrical length at a new start frequency, as setFrequency does. */
function atFrequency(d: Design, frequency: number): Design['elements'] {
  return d.elements.map((el) =>
    el.kind === 'line' || el.kind === 'openStub' || el.kind === 'shortStub'
      ? { ...el, refFrequency: frequency }
      : el,
  );
}

/** The design with `all` as its datapoints and `start` as the chain start. */
function fromList(d: Design, all: readonly UserDatapoint[], start: number): Design {
  const at = all[start];
  if (!at) return d;
  const others = all.filter((_, i) => i !== start);
  const { datapoints: _datapoints, startSlot: _startSlot, ...rest } = d;
  void _datapoints;
  void _startSlot;
  return {
    ...rest,
    load: at.z,
    frequency: at.frequency,
    elements: at.frequency === d.frequency ? d.elements : atFrequency(d, at.frequency),
    ...(others.length > 0 ? { datapoints: others, startSlot: start } : {}),
  };
}

/** Append a datapoint; it becomes DPn. Refused (design returned unchanged) at the limit. */
export function addDatapoint(d: Design, point: UserDatapoint): Design {
  const all = userDatapoints(d);
  if (all.length >= MAX_DATAPOINTS) return d;
  return fromList(d, [...all, point], startIndex(d));
}

/** Make datapoint `index` the one the chain starts from. */
export function setStartDatapoint(d: Design, index: number): Design {
  const all = userDatapoints(d);
  if (index < 0 || index >= all.length || index === startIndex(d)) return d;
  return fromList(d, all, index);
}

/**
 * Remove datapoint `index`. The last remaining datapoint cannot be removed.
 * Removing the start hands the chain to the datapoint that takes its place.
 */
export function removeDatapoint(d: Design, index: number): Design {
  const all = userDatapoints(d);
  if (all.length < 2 || index < 0 || index >= all.length) return d;
  const start = startIndex(d);
  const rest = all.filter((_, i) => i !== index);
  const nextStart =
    index === start ? Math.min(index, rest.length - 1) : index < start ? start - 1 : start;
  return fromList(d, rest, nextStart);
}

/** Change the frequency or impedance of a datapoint other than the start (the start is load and frequency). */
export function updateDatapoint(d: Design, index: number, patch: Partial<UserDatapoint>): Design {
  const all = userDatapoints(d);
  const start = startIndex(d);
  if (index < 0 || index >= all.length || index === start) return d;
  const next = all.map((p, i) => (i === index ? { ...p, ...patch } : p));
  return fromList(d, next, start);
}

/**
 * The loads a datapoint sweep runs over: the points of an imported file when
 * the design holds some, otherwise the user datapoints when there are two or more.
 */
export function sweepLoadsOf(d: Points & Pick<Design, 'sweep'>): readonly UserDatapoint[] {
  if (d.sweep.loads && d.sweep.loads.length > 0) return d.sweep.loads;
  const all = userDatapoints(d);
  return all.length > 1 ? all : [];
}

/** True when the sweep runs over datapoints rather than over frequency. */
export function designHasDatapointSweep(d: Points & Pick<Design, 'sweep'>): boolean {
  return sweepLoadsOf(d).length > 0 && d.sweep.mode !== 'frequency';
}
