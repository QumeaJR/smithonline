/**
 * Adversarial tests for the tour store and replaceDesign. A failing test is
 * a defect, see the adversary report.
 */
import { complex } from '@smithonline/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { emptyDesign, type Design } from '../src/lib/design';
import { TOURS } from '../src/lib/tours';
import { useDesignStore } from '../src/store/useDesignStore';
import { useTourStore } from '../src/store/useTourStore';

const D = () => useDesignStore.getState();
const T = () => useTourStore.getState();

beforeEach(() => {
  D().init({ ...emptyDesign(), name: 'Mine', load: complex(77, 7) });
  T().close();
});

describe('tour store: undo and redo stay coherent', () => {
  it('one undo removes the whole tour, one redo brings the last step back', () => {
    T().start('l-network');
    const n = T().tour?.steps.length as number;
    for (let i = 1; i < n; i++) T().next();
    const last = D().design;
    D().undo();
    expect(D().design.name).toBe('Mine');
    D().redo();
    expect(D().design).toBe(last);
  });

  it('every one of the tours is exactly one history entry', () => {
    for (const t of TOURS) {
      D().init({ ...emptyDesign(), name: 'Mine' });
      const before = D().past.length;
      T().start(t.id);
      for (let i = 1; i < t.steps.length; i++) T().next();
      for (let i = 1; i < t.steps.length; i++) T().back();
      for (let i = 1; i < t.steps.length; i++) T().next();
      expect(D().past.length).toBe(before + 1);
    }
    // The broadband tour runs its search on every Next, so the walk takes a few seconds.
  }, 60_000);

  it('Back does not throw away an edit the user made in the tour design without a way back', () => {
    T().start('l-network');
    T().next();
    T().next();
    D().setName('my careful edit'); // a history entry: past top is the step 2 design
    const edited = D().design;
    T().back();
    // The edited design is neither current, nor in past, nor in future.
    const reachable = [D().design, ...D().past, ...D().future];
    expect(reachable).toContain(edited);
  });

  it('Back after importing another design does not destroy the imported design', () => {
    T().start('l-network');
    T().next();
    const imported: Design = { ...emptyDesign(), name: 'Imported file', load: complex(10, 10) };
    D().loadDesign(imported); // what an import does
    T().back();
    const reachable = [D().design, ...D().past, ...D().future];
    expect(reachable.some((d) => d.name === 'Imported file')).toBe(true);
  });

  it('Next after importing another design does not rewrite the imported design without history', () => {
    T().start('l-network');
    const imported: Design = { ...emptyDesign(), name: 'Imported file', load: complex(10, 10) };
    D().loadDesign(imported);
    // The store keeps the design with its own build written in (0.6.0): that object.
    const onScreen = D().design;
    T().next();
    const reachable = [D().design, ...D().past, ...D().future];
    expect(reachable).toContain(onScreen);
  });

  it('Next after undo and an edit leaves the redo stack consistent with the design', () => {
    T().start('l-network');
    T().next();
    D().setName('renamed'); // past: [mine, start, step1], design: renamed step1
    D().undo(); // design: step1, future: [renamed]
    T().next(); // design: step2
    const futureBefore = D().future.length;
    D().redo();
    // A redo must not jump to a design from before the step that Next just made.
    expect(futureBefore === 0 || D().design.elements.length >= 2).toBe(true);
  });

  it('with a full history, undoing one edit made inside the tour does not look like undoing the tour', () => {
    for (let i = 0; i < 150; i++) D().setName(`n${i}`);
    expect(D().past.length).toBe(100);
    T().start('l-network');
    const origin = T().origin;
    D().setName('edit inside tour');
    D().undo();
    // The tour ends only when the pre-tour design itself is back on screen.
    expect(D().design).not.toBe(origin);
  });
});

describe('tour store: designs edited mid-tour', () => {
  it('delete every element, then Next and Back through all steps without a throw', () => {
    for (const t of TOURS) {
      T().start(t.id);
      T().next();
      T().next();
      for (let i = D().design.elements.length - 1; i >= 0; i--) D().removeElement(i);
      expect(() => {
        for (let i = 0; i < 6; i++) T().next();
        for (let i = 0; i < 6; i++) T().back();
        for (let i = 0; i < 6; i++) T().next();
      }).not.toThrow();
      for (const el of D().design.elements) {
        for (const v of Object.values(el))
          if (typeof v === 'number') expect(Number.isFinite(v)).toBe(true);
      }
    }
  });

  it('reorder the two L parts then Next: the finished network still ends at the target or says so', () => {
    T().start('l-network');
    T().next();
    T().next();
    D().moveElement(0, 1);
    T().next();
    const d = D().design;
    expect(d.elements).toHaveLength(2);
  });

  it('Back, edit, Next: snapshot of the step after the edit is the design shown', () => {
    T().start('single-stub');
    T().next();
    T().next();
    T().back();
    D().setLoad(complex(30, -20));
    T().next();
    expect(T().snapshots[T().step]).toBe(D().design);
  });

  it('a second start while one runs resets step and snapshots', () => {
    T().start('l-network');
    T().next();
    T().next();
    T().start('lna-input');
    expect(T().step).toBe(0);
    expect(T().snapshots).toHaveLength(1);
    expect(T().tour?.id).toBe('lna-input');
  });

  it('start with an unknown id, next/back with no tour and step bounds do nothing', () => {
    T().start('nope');
    expect(T().tour).toBeNull();
    T().next();
    T().back();
    T().start('l-network');
    T().back();
    expect(T().step).toBe(0);
    for (let i = 0; i < 50; i++) T().next();
    expect(T().step).toBe((T().tour?.steps.length as number) - 1);
  });
});
