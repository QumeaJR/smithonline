/**
 * Adversarial, phase 6 undo labels: store.step with a throwing or identity function, quiet
 * labels across many steps, the history limit, slider runs, user text in labels, tour swaps
 * that put the same design object in history twice.
 * Each test asserts the correct behaviour; a failure is a defect.
 */
import { complex } from '@smithonline/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { emptyDesign, identify, type Design } from '../src/lib/design';
import { useDesignStore } from '../src/store/useDesignStore';
import { useTourStore } from '../src/store/useTourStore';

const D = () => useDesignStore.getState();
/** The first part, narrowed to the inductor withParts() puts there, so `value` type-checks. */
const firstInductor = () => {
  const el = D().design.elements[0];
  if (el?.kind !== 'L') throw new Error('expected the series inductor first');
  return el;
};
const withParts = (): Design => ({
  ...emptyDesign(),
  load: complex(20, -15),
  elements: identify([
    { kind: 'L', orientation: 'series', value: 10e-9 },
    { kind: 'C', orientation: 'shunt', value: 2e-12 },
  ]),
});

beforeEach(() => {
  useTourStore.getState().close();
  D().init(withParts());
  D().setMessage(null);
});

describe('step with a throwing function', () => {
  it('does not leak its label into the next quiet step', () => {
    expect(() =>
      D().step('Optimized over 1 to 2 GHz', () => {
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(D().past.length).toBe(0);
    D().setFrequency(2e9);
    // A quiet step shows no message and Undo names it by its own label.
    expect(D().message).toBeNull();
    D().undo();
    expect(D().message).toBe('Undo: Changed f to 2 GHz');
  });

  it('a throwing step does not leak into a later addElement without label', () => {
    try {
      D().step('Ghost', () => {
        throw new Error('x');
      });
    } catch {
      /* expected */
    }
    D().addElement({ kind: 'R', orientation: 'series', value: 10 });
    expect(D().message).not.toBe('Ghost');
  });
});

describe('step with the same design', () => {
  it('records nothing, says nothing, offers no Undo', () => {
    D().setMessage('before');
    D().step('Nothing', (d) => d, { undo: true });
    expect(D().past.length).toBe(0);
    expect(D().message).toBe('before');
    expect(D().messageExtras).toBeNull();
    // and the next quiet step is not named "Nothing"
    D().setZ0(75);
    D().undo();
    expect(D().message).toBe('Undo: Changed Z0 to 75 Ω');
  });
});

describe('history under quiet labels', () => {
  it('150 typed edits: 100 kept, every Undo and Redo names its own step', () => {
    for (let i = 1; i <= 150; i++) D().setFrequency(i * 1e6);
    expect(D().past.length).toBe(100);
    for (let i = 150; i > 50; i--) {
      D().undo();
      expect(D().message).toBe(`Undo: Changed f to ${i} MHz`);
      expect(D().design.frequency).toBe((i - 1) * 1e6);
    }
    const before = D().design;
    D().undo();
    expect(D().design).toBe(before);
    for (let i = 51; i <= 150; i++) {
      D().redo();
      expect(D().message).toBe(`Redo: Changed f to ${i} MHz`);
    }
    D().redo();
    expect(D().design.frequency).toBe(150e6);
  });

  it('a slider drag is one step named Tuned; Undo and Redo repeat it', () => {
    const el = firstInductor();
    for (let i = 1; i <= 30; i++)
      D().updateElement(0, { ...el, value: 10e-9 * (1 + i / 100) }, true);
    D().commit('Tuned Series L 1 to 13 nH');
    expect(D().past.length).toBe(1);
    expect(D().message).toBe('Tuned Series L 1 to 13 nH');
    D().undo();
    expect(D().message).toBe('Undo: Tuned Series L 1 to 13 nH');
    D().redo();
    expect(D().message).toBe('Redo: Tuned Series L 1 to 13 nH');
  });

  it('a drag right after a drag without commit between is still two steps once committed', () => {
    const el = firstInductor();
    D().updateElement(0, { ...el, value: 11e-9 }, true);
    D().commit('Tuned A');
    D().updateElement(0, { ...el, value: 12e-9 }, true);
    D().commit('Tuned B');
    expect(D().past.length).toBe(2);
    D().undo();
    expect(D().message).toBe('Undo: Tuned B');
    D().undo();
    expect(D().message).toBe('Undo: Tuned A');
  });

  it('a name with quotes or 10000 characters is a label like any other', () => {
    D().setName('a "quoted" \\ name');
    D().undo();
    expect(D().message).toBe('Undo: Renamed the design to "a "quoted" \\ name"');
    // A name is cut where links and files cut it (MAX_DESIGN_NAME, 0.6.0 QA round 3).
    const long = 'x'.repeat(10000);
    D().redo();
    D().setName(long);
    D().undo();
    expect(D().message).toBe(`Undo: Renamed the design to "${long.slice(0, 200)}"`);
  });
});

describe('tour swaps and labels', () => {
  it('Back over a recorded step keeps the tour start named "Started the tour"', () => {
    useTourStore.getState().start('l-network');
    const title = useTourStore.getState().tour!.title;
    useTourStore.getState().next(); // step 2, swapped without history
    D().setFrequency(123e6); // the user edits at step 2
    useTourStore.getState().next(); // step 3 over the edit: recorded
    useTourStore.getState().back(); // back to step 2: replaced without history
    const messages: string[] = [];
    while (D().past.length > 0) {
      D().undo();
      messages.push(D().message ?? '');
    }
    // The last Undo brings the design before the tour back: it must say so.
    expect(messages[messages.length - 1]).toBe(`Undo: Started the tour "${title}"`);
  });
});
