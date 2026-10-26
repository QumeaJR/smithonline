// @vitest-environment jsdom
/**
 * QA round 2 fixes (0.6.0): the start (main.tsx) never loses a design. An autosave this version
 * cannot read is kept under a backup key and named in the status line with Save a copy; package
 * defaults out of range are named once; a link that is not a design says so.
 */
import { act } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

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
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  return import('../src/store/useDesignStore');
}

const UNREADABLE = JSON.stringify({
  name: 'Mine',
  z0: 50,
  frequency: 1e9,
  load: { re: 25, im: -15 },
  elements: [],
  build: { packages: [{ id: '0805', esl: 10 }] },
});

describe('the start with what an older or newer version left in this browser', () => {
  it('an autosave it cannot read is kept, named, and offered as a file; Example 5 shows', async () => {
    stubs();
    localStorage.clear();
    history.replaceState(null, '', '/');
    localStorage.setItem('smithonline.design.v1', UNREADABLE);
    const { useDesignStore } = await startApp();
    const s = useDesignStore.getState();
    expect(localStorage.getItem('smithonline.design.backup')).toBe(UNREADABLE);
    expect(s.message).toBe(
      'Your autosaved design could not be opened by this version; it is kept in this browser (smithonline.design.backup), and Save a copy saves it as a file.',
    );
    expect(s.messageError).toBe(true);
    expect(s.messageExtras?.action?.label).toBe('Save a copy');
    // The app autosaves the design on show; the backup stays.
    expect(localStorage.getItem('smithonline.design.v1')).not.toBe(UNREADABLE);
    expect(localStorage.getItem('smithonline.design.backup')).toBe(UNREADABLE);
  });

  it('0.5.0 package defaults out of range: the 0.5.0 autosave opens and the start names them', async () => {
    stubs();
    localStorage.clear();
    history.replaceState(null, '', '/');
    localStorage.setItem('smithonline.packages.v1', '[{"id":"0805","esl":10}]');
    localStorage.setItem(
      'smithonline.design.v1',
      JSON.stringify({
        name: 'Old',
        z0: 50,
        frequency: 1e9,
        load: { re: 25, im: -15 },
        elements: [],
      }),
    );
    let { useDesignStore } = await startApp();
    expect(useDesignStore.getState().design.name).toBe('Old');
    expect(useDesignStore.getState().message).toMatch(
      /^The package defaults for new designs held numbers out of range, now the built-in ones: 0805 ESL 10 H\./,
    );
    // The next start: the same design, nothing to say about the packages.
    ({ useDesignStore } = await startApp());
    expect(useDesignStore.getState().design.name).toBe('Old');
    expect(useDesignStore.getState().message ?? '').not.toMatch(/package defaults/);
    expect(localStorage.getItem('smithonline.design.backup')).toBeNull();
  });

  it('a link that is not a design says so and opens the autosave', async () => {
    stubs();
    localStorage.clear();
    history.replaceState(null, '', '/#d=bm90IGEgZGVzaWdu');
    localStorage.setItem(
      'smithonline.design.v1',
      JSON.stringify({
        name: 'Kept',
        z0: 50,
        frequency: 1e9,
        load: { re: 25, im: -15 },
        elements: [],
      }),
    );
    const { useDesignStore } = await startApp();
    expect(useDesignStore.getState().design.name).toBe('Kept');
    expect(useDesignStore.getState().message).toBe(
      'The link in the address bar is not a Smith Online design; it was not opened.',
    );
    expect(location.hash).toBe('');
  });
});
