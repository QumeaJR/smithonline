/**
 * Adversarial tests, QA round 2: the negligible-part filter at extreme
 * frequencies, addElements with empty and huge lists, the tour watcher with
 * Redo after Back, hostile share links with huge load lists.
 */
import { complex, type Element } from '@smithonline/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { emptyDesign } from '../src/lib/design';
import { negligibleElement } from '../src/lib/match';
import { decodeDesign } from '../src/lib/share';
import { TOURS } from '../src/lib/tours';
import { useDesignStore } from '../src/store/useDesignStore';
import { useTourStore } from '../src/store/useTourStore';

const D = () => useDesignStore.getState();
const T = () => useTourStore.getState();

beforeEach(() => {
  T().close();
  D().init({ ...emptyDesign(), name: 'Mine', load: complex(77, 7) });
  useDesignStore.setState({ twoPortFiles: {}, message: null, loads: 0 });
});

describe('adv r2: negligible-part filter', () => {
  it('legitimate small parts at very high frequency are not filtered', () => {
    // 0.1 nH series at 60 GHz: 37.7 ohm. 10 fF shunt at 60 GHz: 265 ohm.
    expect(negligibleElement({ kind: 'L', orientation: 'series', value: 1e-10 }, 50, 60e9)).toBe(
      false,
    );
    expect(negligibleElement({ kind: 'C', orientation: 'shunt', value: 1e-14 }, 50, 60e9)).toBe(
      false,
    );
    expect(negligibleElement({ kind: 'line', z0: 50, length: 2e-3 }, 50, 60e9)).toBe(false);
  });
  it('legitimate large parts at very low frequency are not filtered', () => {
    // 1 H series at 10 Hz: 62.8 ohm; 100 uF shunt at 10 Hz: 159 ohm
    expect(negligibleElement({ kind: 'L', orientation: 'series', value: 1 }, 50, 10)).toBe(false);
    expect(negligibleElement({ kind: 'C', orientation: 'shunt', value: 1e-4 }, 50, 10)).toBe(false);
  });
  it('the filter scales with Z0', () => {
    expect(negligibleElement({ kind: 'L', orientation: 'shunt', value: 1.6e-10 }, 1, 1e9)).toBe(
      false,
    );
    expect(negligibleElement({ kind: 'R', orientation: 'series', value: 1e4 }, 1e6, 1e9)).toBe(
      false,
    );
  });
  it('f = NaN does not mark every inductor negligible', () => {
    const l: Element = { kind: 'L', orientation: 'series', value: 1e-9 };
    expect(negligibleElement(l, 50, Number.NaN)).toBe(false);
  });
});

describe('adv r2: addElements', () => {
  it('an empty list leaves history and selection alone', () => {
    D().select(null);
    const past = D().past.length;
    D().addElements([]);
    expect(D().past.length).toBe(past);
    expect(D().selected).toBeNull();
  });
  it('3000 elements in one call: one history entry, unique ids, under 2 s', () => {
    const t0 = performance.now();
    const els: Element[] = Array.from({ length: 3000 }, (_, i) => ({
      kind: 'L',
      orientation: i % 2 ? 'series' : 'shunt',
      value: 1e-9,
    }));
    const past = D().past.length;
    D().addElements(els);
    const dt = performance.now() - t0;
    expect(dt).toBeLessThan(2000);
    expect(D().past.length).toBe(past + 1);
    expect(new Set(D().design.elements.map((e) => e.id)).size).toBe(3000);
    expect(D().selected).toBe(3000);
  });
});

describe('adv r2: tour watcher with Redo after Back', () => {
  const tour = TOURS[0]!;
  it('edit at step 1, Back (recorded), Undo, Redo: step follows the design each time', () => {
    T().start(tour.id);
    T().next();
    expect(T().step).toBe(1);
    D().setLoad(complex(11, 11));
    const edited = D().design;
    T().back();
    expect(T().step).toBe(0);
    const shown0 = D().design;
    D().undo();
    expect(D().design).toBe(edited);
    expect(T().tour).not.toBeNull();
    expect(T().step).toBe(1);
    D().redo();
    expect(D().design).toBe(shown0);
    expect(T().step).toBe(0);
    T().next();
    expect(T().step).toBe(1);
    expect(T().tour).not.toBeNull();
  });
  it('edits at steps 2 and 1, Back twice, Undo and Redo through all of them: steps and designs stay paired', () => {
    T().start(tour.id);
    T().next();
    T().next();
    D().setLoad(complex(12, 12));
    T().back();
    D().setLoad(complex(13, 13));
    const e1 = D().design;
    T().back();
    expect(T().step).toBe(0);
    D().undo();
    expect(D().design).toBe(e1);
    expect(T().step).toBe(1);
    D().undo();
    const afterTwo = D().design;
    const stepTwo = T().step;
    D().undo();
    D().redo();
    expect(D().design).toBe(afterTwo);
    expect(T().step).toBe(stepTwo);
    D().redo();
    expect(D().design).toBe(e1);
    expect(T().step).toBe(1);
    D().redo();
    expect(T().step).toBe(0);
    expect(T().tour).not.toBeNull();
  });
  it('Undo to before the tour closes it; Redo afterwards leaves a closed tour', () => {
    const origin = D().design;
    T().start(tour.id);
    T().next();
    D().undo();
    expect(D().design).toBe(origin);
    expect(T().tour).toBeNull();
    D().redo();
    expect(T().tour).toBeNull();
    expect(T().step).toBe(0);
  });
  it('Back after the shown design was re-created by Undo+Redo (same object) is a plain swap, no history', () => {
    T().start(tour.id);
    T().next();
    D().setLoad(complex(14, 14));
    D().undo(); // back to the step 1 snapshot object
    expect(T().step).toBe(1);
    const past = D().past.length;
    T().back();
    expect(D().past.length).toBe(past);
    expect(T().step).toBe(0);
  });
});

describe('adv r2: hostile share links', () => {
  const enc = (o: unknown): string => Buffer.from(JSON.stringify(o), 'utf8').toString('base64url');
  it('a link with 200000 sweep loads is capped or decodes in bounded time', () => {
    const loads = Array.from({ length: 200000 }, (_, i) => ({
      frequency: i + 1,
      z: { re: 50, im: 0 },
    }));
    const t0 = performance.now();
    const d = decodeDesign(
      enc({ elements: [], load: { re: 50, im: 0 }, sweep: { enabled: true, loads } }),
    );
    const dt = performance.now() - t0;
    expect(d).not.toBeNull();
    expect(dt).toBeLessThan(3000);
    expect(d!.sweep.loads!.length).toBeLessThanOrEqual(2001);
  });
  it('datapoints beyond the limit are cut and startSlot clamped', () => {
    const datapoints = Array.from({ length: 500 }, (_, i) => ({
      frequency: i + 1,
      z: { re: 50, im: 0 },
    }));
    const d = decodeDesign(
      enc({ elements: [], load: { re: 50, im: 0 }, datapoints, startSlot: 400 }),
    )!;
    expect(d.datapoints!.length).toBe(63);
    expect(d.startSlot).toBe(63);
  });
  it('prototype keys in the sweep and twoPort do not throw or pollute', () => {
    const json =
      '{"elements":[],"load":{"re":50,"im":0},"sweep":{"__proto__":{"enabled":true},"constructor":{"prototype":{"x":1}}},"twoPort":{"__proto__":{"s":{}}}}';
    const d = decodeDesign(Buffer.from(json, 'utf8').toString('base64url'));
    expect(d).not.toBeNull();
    expect(d!.sweep.enabled).toBe(false);
    expect(({} as { x?: unknown }).x).toBeUndefined();
  });
  it('loadsName of 1e6 characters is not carried into the design unbounded', () => {
    const loadsName = 'x'.repeat(1e6);
    const d = decodeDesign(
      enc({
        elements: [],
        load: { re: 50, im: 0 },
        sweep: { loads: [{ frequency: 1, z: { re: 1, im: 0 } }], loadsName },
      }),
    )!;
    expect((d.sweep.loadsName ?? '').length).toBeLessThanOrEqual(1000);
  });
});
