import { beforeEach, describe, expect, it } from 'vitest';
import { emptyDesign } from '../src/lib/design';
import { useDesignStore } from '../src/store/useDesignStore';

const store = useDesignStore;

beforeEach(() => {
  store.getState().init(emptyDesign());
});

describe('design store', () => {
  it('adds, updates, moves and removes elements with history', () => {
    const s = store.getState();
    s.addElement({ kind: 'L', orientation: 'series', value: 1e-9 });
    s.addElement({ kind: 'C', orientation: 'shunt', value: 1e-12 });
    expect(store.getState().design.elements.map((e) => e.kind)).toEqual(['L', 'C']);
    expect(store.getState().selected).toBe(2);

    s.moveElement(1, -1);
    expect(store.getState().design.elements.map((e) => e.kind)).toEqual(['C', 'L']);
    s.moveElement(0, -1); // no-op at the edge
    expect(store.getState().design.elements.map((e) => e.kind)).toEqual(['C', 'L']);

    s.updateElement(0, { kind: 'C', orientation: 'shunt', value: 2e-12 });
    expect(store.getState().design.elements[0]).toEqual({
      kind: 'C',
      orientation: 'shunt',
      value: 2e-12,
    });

    s.removeElement(0);
    expect(store.getState().design.elements.map((e) => e.kind)).toEqual(['L']);

    s.undo();
    expect(store.getState().design.elements).toHaveLength(2);
    s.undo();
    expect(store.getState().design.elements[0]).toMatchObject({ value: 1e-12 });
    s.redo();
    expect(store.getState().design.elements[0]).toMatchObject({ value: 2e-12 });
    expect(store.getState().future).toHaveLength(1);
  });

  it('collapses a run of transient updates into one history entry', () => {
    const s = store.getState();
    s.addElement({ kind: 'L', orientation: 'series', value: 1e-9 });
    const before = store.getState().past.length;
    for (const v of [2e-9, 3e-9, 4e-9]) {
      s.updateElement(0, { kind: 'L', orientation: 'series', value: v }, true);
    }
    s.commit();
    expect(store.getState().past.length).toBe(before + 1);
    expect(store.getState().design.elements[0]).toMatchObject({ value: 4e-9 });
    s.undo();
    expect(store.getState().design.elements[0]).toMatchObject({ value: 1e-9 });
  });

  it('a new change after undo clears the redo stack', () => {
    const s = store.getState();
    s.setZ0(75);
    s.undo();
    expect(store.getState().future).toHaveLength(1);
    s.setZ0(60);
    expect(store.getState().future).toHaveLength(0);
    expect(store.getState().design.z0).toBe(60);
  });

  it('changing the design frequency moves line reference frequencies with it', () => {
    const s = store.getState();
    s.addElement({ kind: 'line', z0: 50, length: 0.25, refFrequency: 1e9 });
    s.addElement({ kind: 'L', orientation: 'series', value: 1e-9 });
    s.setFrequency(2e9);
    expect(store.getState().design.elements[0]).toMatchObject({ refFrequency: 2e9 });
    expect(store.getState().design.elements[1]).toEqual({
      kind: 'L',
      orientation: 'series',
      value: 1e-9,
    });
  });

  it('init replaces everything without history', () => {
    const s = store.getState();
    s.setZ0(75);
    s.init({ ...emptyDesign(), name: 'Fresh' });
    expect(store.getState().past).toEqual([]);
    expect(store.getState().design.name).toBe('Fresh');
    expect(store.getState().selected).toBe(0);
  });
});
