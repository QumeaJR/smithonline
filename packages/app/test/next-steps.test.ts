/**
 * Contextual next steps (docs/09 section 4): one suggestion at a time, on
 * the message and the chip; withdrawn by any other change to the design; not
 * offered on an opened file or a share link before the first edit, nor while
 * a guided tour runs; off with the chip's close button, back with its Undo.
 */
import { complex } from '@smithonline/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const memory = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => memory.get(k) ?? null,
  setItem: (k: string, v: string) => void memory.set(k, v),
  removeItem: (k: string) => void memory.delete(k),
  clear: () => memory.clear(),
});

const { emptyDesign } = await import('../src/lib/design');
const {
  noteBoardOn,
  noteCentred,
  noteEmptyLibrary,
  noteMatchAdded,
  noteMeasuredLoad,
  noteToleranceResult,
  suggest,
  turnOffNextSteps,
  useNextStep,
} = await import('../src/lib/nextSteps');
const { useDesignStore } = await import('../src/store/useDesignStore');
const { useSettings } = await import('../src/store/useSettings');
const { useTourStore } = await import('../src/store/useTourStore');
const { DEFAULT_SETTINGS } = await import('../src/lib/settings');
const { emitTourEvent } = await import('../src/lib/tourEvents');

const D = () => useDesignStore.getState();
const suggestion = () => useNextStep.getState().suggestion;
const matchAtF = (): void => {
  // 100 - j50 at 1 GHz matched by shunt L + series C (the L of yield.test.ts).
  D().addElements(
    [
      { kind: 'L', orientation: 'shunt', value: 11.5346728762e-9 },
      { kind: 'C', orientation: 'series', value: 2.5989893374e-12 },
    ],
    'Added Shunt L + Series C',
  );
};

beforeEach(() => {
  memory.clear();
  useSettings.setState({ settings: DEFAULT_SETTINGS });
  useTourStore.getState().close();
  // A new design: suggestions are on for it.
  D().init({ ...emptyDesign({ frequency: 1e9 }), load: complex(100, -50) }, { fresh: true });
  D().setMessage(null);
  useNextStep.setState({ suggestion: null });
});

describe('next-step rules', () => {
  it('a match at f without a sweep range: Check the band, which sets 0.5 to 2 f', () => {
    matchAtF();
    noteMatchAdded('add');
    expect(suggestion()?.label).toBe('Check the band');
    // On the message too, which keeps its own text.
    expect(D().message).toBe('Added Shunt L + Series C');
    expect(D().messageExtras?.action?.label).toBe('Check the band');
    suggestion()?.run();
    expect(D().design.sweep).toMatchObject({ enabled: true, start: 0.5e9, stop: 2e9 });
    expect(D().view).toBe('response');
  });

  it('a match with a sweep range: Check tolerance, with Show me into the robust workflow', () => {
    D().setSweep({ enabled: true, start: 0.9e9, stop: 1.1e9 });
    matchAtF();
    noteMatchAdded('add');
    expect(suggestion()?.label).toBe('Check tolerance');
    expect(suggestion()?.workflow).toEqual({ id: 'robust', at: 'open' });
  });

  it('Use all rows: Match over the band; a low yield: Centre for yield, after a centring with a dominant part: a tighter part; a high yield: nothing', () => {
    noteMeasuredLoad();
    expect(suggestion()?.label).toBe('Match over the band');
    noteToleranceResult(0.46, { label: 'Shunt L 1', share: 0.6 });
    expect(suggestion()?.label).toBe('Centre for yield');
    emitTourEvent('centre-result');
    noteToleranceResult(0.8, { label: 'Shunt L 1', share: 0.6 });
    expect(suggestion()?.label).toBe('Set Shunt L 1 to 2 %');
    // QA round on docs/09: no tighter part at a yield of 90 % or more, whatever its share.
    noteToleranceResult(0.95, { label: 'Shunt C 2', share: 0.9 });
    // Nothing new to suggest: the last one stays until the design changes.
    expect(suggestion()?.label).toBe('Set Shunt L 1 to 2 %');
  });

  it('centring with Realize off: Realize to standard values; an empty library: Load part files', () => {
    matchAtF();
    noteCentred();
    expect(suggestion()?.label).toBe('Realize to standard values');
    noteEmptyLibrary();
    expect(suggestion()?.label).toBe('Load part files');
  });

  it('the board on without Realize offers nothing', () => {
    noteBoardOn();
    expect(suggestion()).toBeNull();
  });
});

describe('one at a time, withdrawn, and off', () => {
  it('a new suggestion replaces the one before; any other change withdraws it', () => {
    noteMeasuredLoad();
    noteToleranceResult(0.5, null);
    expect(suggestion()?.id).toBe('centre');
    D().setLoad(complex(80, -40));
    expect(suggestion()).toBeNull();
  });

  it('not on an opened file or share link before the first edit', () => {
    D().loadDesign({ ...emptyDesign(), name: 'opened' }, 'Opened a.json');
    noteMeasuredLoad();
    expect(suggestion()).toBeNull();
    D().setLoad(complex(30, 5));
    noteMeasuredLoad();
    expect(suggestion()?.label).toBe('Match over the band');
  });

  it('a share link (init, not fresh) waits for the first edit too', () => {
    D().init({ ...emptyDesign(), load: complex(30, 5) }, { fresh: false });
    noteMeasuredLoad();
    expect(suggestion()).toBeNull();
  });

  it('never while a guided tour runs', () => {
    useTourStore.getState().start('l-network');
    noteMeasuredLoad();
    expect(suggestion()).toBeNull();
    useTourStore.getState().end();
  });

  it('the chip close turns them off with an Undo; the setting brings them back', () => {
    noteMeasuredLoad();
    turnOffNextSteps();
    expect(suggestion()).toBeNull();
    expect(useSettings.getState().settings.suggestNextSteps).toBe(false);
    suggest({ id: 'x', label: 'X', text: 'x', run: () => undefined });
    expect(suggestion()).toBeNull();
    expect(D().messageExtras?.action?.label).toBe('Undo');
    D().messageExtras?.action?.run();
    expect(useSettings.getState().settings.suggestNextSteps).toBe(true);
    noteMeasuredLoad();
    expect(suggestion()?.label).toBe('Match over the band');
  });
});
