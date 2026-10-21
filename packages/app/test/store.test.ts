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

    const first = store.getState().design.elements[0]!;
    s.updateElement(0, { ...first, kind: 'C', orientation: 'shunt', value: 2e-12 });
    expect(store.getState().design.elements[0]).toEqual({
      kind: 'C',
      orientation: 'shunt',
      value: 2e-12,
      id: first.id,
      color: first.color,
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
    const el = store.getState().design.elements[0]!;
    for (const v of [2e-9, 3e-9, 4e-9]) {
      s.updateElement(
        0,
        { kind: 'L', orientation: 'series', value: v, id: el.id, color: el.color },
        true,
      );
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

  it('gives each element a stable id and colour that survive reordering', () => {
    const s = store.getState();
    s.addElement({ kind: 'L', orientation: 'series', value: 1e-9 });
    s.addElement({ kind: 'C', orientation: 'shunt', value: 1e-12 });
    s.addElement({ kind: 'R', orientation: 'series', value: 10 });
    const [a, b, c] = store.getState().design.elements;
    expect(new Set([a!.color, b!.color, c!.color]).size).toBe(3);
    expect(new Set([a!.id, b!.id, c!.id]).size).toBe(3);

    s.reorderElement(2, 0);
    const ids = store.getState().design.elements.map((e) => e.id);
    expect(ids).toEqual([c!.id, a!.id, b!.id]);
    expect(store.getState().design.elements[0]).toMatchObject({ kind: 'R', color: c!.color });

    s.reorderElement(0, 2);
    expect(store.getState().design.elements.map((e) => e.id)).toEqual([a!.id, b!.id, c!.id]);
    // Out-of-range or no-op moves do not touch history.
    const past = store.getState().past.length;
    s.reorderElement(1, 1);
    s.reorderElement(0, 5);
    expect(store.getState().past.length).toBe(past);
  });

  it('changing the design frequency moves line reference frequencies with it', () => {
    const s = store.getState();
    s.addElement({ kind: 'line', z0: 50, length: 0.25, refFrequency: 1e9 });
    s.addElement({ kind: 'L', orientation: 'series', value: 1e-9 });
    s.setFrequency(2e9);
    expect(store.getState().design.elements[0]).toMatchObject({ refFrequency: 2e9 });
    expect(store.getState().design.elements[1]).toMatchObject({
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

describe('realize mode', () => {
  it('toggles settings, locks and the loss model with history', () => {
    const s = store.getState();
    s.addElement({ kind: 'L', orientation: 'shunt', value: 16.03e-9 });
    s.addElement({ kind: 'C', orientation: 'series', value: 22e-12 });
    expect(store.getState().design.realize.enabled).toBe(false);
    s.setRealize({ enabled: true, series: 'E12', scope: 'L' });
    expect(store.getState().design.realize).toMatchObject({
      enabled: true,
      series: 'E12',
      scope: 'L',
    });
    s.toggleLock(1);
    expect(store.getState().design.elements[1]!.locked).toBe(true);
    expect(store.getState().design.elements[0]!.locked).toBeUndefined();
    s.toggleLock(1);
    expect('locked' in store.getState().design.elements[1]!).toBe(false);
    s.setLosses({ enabled: true, inductorQ: 40 });
    expect(store.getState().design.losses).toEqual({
      enabled: true,
      inductorQ: 40,
      capacitorQ: 500,
    });
    s.undo();
    expect(store.getState().design.losses.enabled).toBe(false);
  });
});
