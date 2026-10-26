// @vitest-environment jsdom
/**
 * Adversarial QA round 2 (0.6.0): the start (main.tsx) with a share link in the address bar and
 * an autosave holding the user's later edits: a reload after opening a link. Rewritten in the
 * fix round: the link now leaves the address bar once read, so the reload is modelled as two
 * starts (the original test put the link back before the reload, which no longer happens).
 */
import { act } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { complex } from '@smithonline/core';

vi.mock('uplot', () => {
  class FakePlot {
    static pxRatio = 1;
    over = document.createElement('div');
    cursor = {};
    setCursor(): void {}
    posToIdx(): number {
      return 0;
    }
    setData(): void {}
    setSize(): void {}
    redraw(): void {}
    destroy(): void {}
  }
  return { default: FakePlot };
});
vi.mock('uplot/dist/uPlot.min.css', () => ({}));

function stubs(): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
  }));
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    },
  );
}

/** A start of the application (main.tsx) in a fresh module graph, as a page load does. */
async function startApp(): Promise<typeof import('../src/store/useDesignStore')> {
  vi.resetModules();
  document.body.innerHTML = '<div id="root"></div>';
  await act(async () => {
    await import('../src/main');
  });
  return import('../src/store/useDesignStore');
}

describe('reload after opening a share link', () => {
  it('the link leaves the address bar, Undo brings the autosave back, a reload keeps the edits', async () => {
    stubs();
    localStorage.clear();
    sessionStorage.clear();
    const { emptyDesign, identify } = await import('../src/lib/design');
    const { encodeDesign } = await import('../src/lib/share');
    const { DESIGN_STORAGE_KEY } = await import('../src/lib/autosave');
    const { ownBuild } = await import('../src/lib/designBuild');
    const linked = {
      ...emptyDesign(),
      name: 'From the link',
      load: complex(25, -15),
      elements: identify([{ kind: 'C', orientation: 'shunt', value: 3.3e-12 }]),
    };
    const earlier = { ...ownBuild(emptyDesign()), name: 'Earlier work' };
    localStorage.setItem(DESIGN_STORAGE_KEY, JSON.stringify(earlier));
    history.replaceState(null, '', `/#d=${encodeDesign(ownBuild(linked))}`);

    // The page opens with the link: it shows, the address bar loses it, Undo has the autosave.
    let store = (await startApp()).useDesignStore;
    expect(store.getState().design.name).toBe('From the link');
    expect(location.hash).toBe('');
    expect(store.getState().message).toBe(
      'Opened "From the link" from the link. Undo brings back your previous design.',
    );
    act(() => store.getState().undo());
    expect(store.getState().design.name).toBe('Earlier work');
    act(() => store.getState().redo());
    // The user adds a part; the App autosaves it.
    act(() =>
      store.getState().addElement({ kind: 'L', orientation: 'series', value: 6.8e-9 }, 'Added L'),
    );
    act(() => store.getState().setName('From the link, edited'));

    // Reload: the autosave with the edits, not the link again.
    store = (await startApp()).useDesignStore;
    const saved = JSON.parse(localStorage.getItem(DESIGN_STORAGE_KEY) ?? '{}') as { name?: string };
    expect({ onScreen: store.getState().design.name, autosave: saved.name }).toEqual({
      onScreen: 'From the link, edited',
      autosave: 'From the link, edited',
    });
    expect(store.getState().design.elements).toHaveLength(2);
  });

  it('a link Share left in the address bar (no clipboard) does not replace the autosave on reload', async () => {
    stubs();
    localStorage.clear();
    sessionStorage.clear();
    const { emptyDesign } = await import('../src/lib/design');
    const { encodeDesign, rememberWrittenLink } = await import('../src/lib/share');
    const { DESIGN_STORAGE_KEY } = await import('../src/lib/autosave');
    const { ownBuild } = await import('../src/lib/designBuild');
    const shared = { ...ownBuild(emptyDesign()), name: 'As shared' };
    const hash = `#d=${encodeDesign(shared)}`;
    history.replaceState(null, '', `/${hash}`);
    rememberWrittenLink(hash);
    localStorage.setItem(
      DESIGN_STORAGE_KEY,
      JSON.stringify({ ...shared, name: 'Edited after sharing' }),
    );
    const store = (await startApp()).useDesignStore;
    expect(store.getState().design.name).toBe('Edited after sharing');
    expect(location.hash).toBe('');
  });
});
