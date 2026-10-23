import { solenoidTurns, toroidTurns, TOROID_CORES } from '@smithonline/core';
import { describe, expect, it } from 'vitest';
import { parseCores, solenoidNote, toroidNote } from '../src/lib/winding';
import { emptyDesign, identify } from '../src/lib/design';
import { decodeDesign, encodeDesign } from '../src/lib/share';
import { useDesignStore } from '../src/store/useDesignStore';

describe('winding notes', () => {
  it('describe an air-core coil with its turns, size and wire', () => {
    const r = solenoidTurns({ inductance: 1e-6, diameter: 0.01, pitch: 0.0012, leads: 0.04 })!;
    const text = solenoidNote(r, 0.01, 0.0012);
    expect(text).toContain(`${r.turns} turns`);
    expect(text).toContain('10 mm mean diameter');
    expect(text).toContain('pitch 1.2 mm');
    expect(text).toContain('Wheeler');
    expect(solenoidNote(r, 0.01, null)).not.toContain('pitch');
  });

  it('describe a toroid with its core and turns', () => {
    const r = toroidTurns({ inductance: 1e-6, al: 4.9, turnLength: 0.0147, leads: 0.04 })!;
    const text = toroidNote('T50-2', r);
    expect(text).toContain('Toroid T50-2: 14 turns');
    expect(text).toMatch(/wire \d/);
    expect(toroidNote('X', { ...r, wireLength: null })).not.toContain('wire');
  });

  it('say a single turn in the singular', () => {
    const r = solenoidTurns({ inductance: 1e-12, diameter: 0.05, length: 0.05 })!;
    expect(solenoidNote(r, 0.05, null)).toContain('1 turn on');
  });
});

describe('core table storage', () => {
  it('falls back to the built-in table for anything unusable', () => {
    expect(parseCores(null)).toEqual([...TOROID_CORES]);
    expect(parseCores('not json')).toEqual([...TOROID_CORES]);
    expect(parseCores('[]')).toEqual([...TOROID_CORES]);
    expect(parseCores('[{"name":"x"}]')).toEqual([...TOROID_CORES]);
  });

  it('keeps valid rows and drops bad ones', () => {
    const rows = [
      { name: 'Mine', al: 25, od: 20, id: 10, height: 8 },
      { name: 'Bad', al: -1, od: 20, id: 10, height: 8 },
      { name: 'Inverted', al: 5, od: 10, id: 20, height: 8 },
      { name: ' ', al: 5, od: 20, id: 10, height: 8 },
    ];
    expect(parseCores(JSON.stringify(rows))).toEqual([rows[0]]);
  });
});

describe('inductor note in the design', () => {
  it('is kept with the element and cleared by removing it', () => {
    const store = useDesignStore.getState();
    store.init(emptyDesign());
    store.addElement({ kind: 'L', orientation: 'series', value: 1e-6 });
    const el = useDesignStore.getState().design.elements[0]!;
    store.updateElement(0, { ...el, note: 'Air core: 9 turns' });
    expect(useDesignStore.getState().design.elements[0]?.note).toBe('Air core: 9 turns');
    useDesignStore.getState().undo();
    expect(useDesignStore.getState().design.elements[0]?.note).toBeUndefined();
  });
});

describe('notes from a link', () => {
  it('survive a share link, and a note that is not text is dropped', () => {
    const d = {
      ...emptyDesign(),
      elements: identify([
        { kind: 'L', orientation: 'series', value: 1e-6, note: 'Toroid T50-2: 14 turns' } as never,
      ]),
    };
    expect(decodeDesign(encodeDesign(d))?.elements[0]?.note).toBe('Toroid T50-2: 14 turns');
    const bad = identify([
      { kind: 'L', orientation: 'series', value: 1e-6, note: { x: 1 } } as never,
    ]);
    expect(bad[0]?.note).toBeUndefined();
    const long = identify([
      { kind: 'L', orientation: 'series', value: 1e-6, note: 'x'.repeat(2000) } as never,
    ]);
    expect(long[0]?.note).toHaveLength(500);
  });
});
