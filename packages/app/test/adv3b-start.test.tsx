// @vitest-environment jsdom
/**
 * Adversarial QA round 3b (0.6.0 verification): the start (main.tsx) with 0.5.0 storage, limits
 * at their boundary, storage that refuses writes, and Share without a clipboard.
 */
import { act } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
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

async function startApp(): Promise<typeof import('../src/store/useDesignStore')> {
  vi.resetModules();
  document.body.innerHTML = '<div id="root"></div>';
  await act(async () => {
    await import('../src/main');
  });
  return import('../src/store/useDesignStore');
}

/** A 0.5.0 autosave: no build, an 0805 capacitor. */
const old050 = {
  name: 'My 0.5.0 work',
  z0: 50,
  frequency: 1e9,
  load: { re: 25, im: -15 },
  target: null,
  elements: [
    { id: 'a', kind: 'C', orientation: 'shunt', value: 3.3e-12, package: '0805' },
    { id: 'b', kind: 'L', orientation: 'series', value: 6.8e-9, package: '0805' },
  ],
  vswrCircles: [],
  qContours: [],
  sweep: { enabled: false, start: 5e8, stop: 1.5e9, points: 201 },
  twoPort: null,
  showStability: false,
  gainCircles: [],
  noiseCircles: [],
  realize: { enabled: false, series: 'E24', stockText: '', scope: 'all' },
  losses: { enabled: false, inductorQ: 50, capacitorQ: 500 },
};

afterEach(() => {
  vi.restoreAllMocks();
  history.replaceState(null, '', '/');
});

describe('0.5.0 storage at and beyond the package limits', () => {
  const cases: [string, unknown][] = [
    ['esl 10 (10 H)', 10],
    ['esl exactly 1 uH', 1e-6],
    ['esl one ulp above 1 uH', 1.0000000000000002e-6],
    ['esl 1e308', 1e308],
    ['esl -0', -0],
    ['esl 5e-324', 5e-324],
  ];
  for (const [what, esl] of cases) {
    it(`packages.v1 ${what}: the 0.5.0 autosave opens, and its link and .json reopen`, async () => {
      stubs();
      localStorage.clear();
      sessionStorage.clear();
      localStorage.setItem('smithonline.packages.v1', JSON.stringify([{ id: '0805', esl }]));
      localStorage.setItem('smithonline.design.v1', JSON.stringify(old050));
      const store = (await startApp()).useDesignStore;
      const { encodeDesign, decodeDesign, designFromJsonFile } = await import('../src/lib/share');
      const { readSavedDesign } = await import('../src/lib/autosave');
      const { ownBuild } = await import('../src/lib/designBuild');
      const d = store.getState().design;
      const file = JSON.stringify({
        app: 'Smith Online',
        version: 1,
        design: encodeDesign(ownBuild(d), { partData: true }),
      });
      expect({
        name: d.name,
        autosave: readSavedDesign()?.name ?? null,
        link: decodeDesign(encodeDesign(ownBuild(d)))?.name ?? null,
        json: 'value' in designFromJsonFile(file) ? 'ok' : 'refused',
      }).toEqual({
        name: 'My 0.5.0 work',
        autosave: 'My 0.5.0 work',
        link: 'My 0.5.0 work',
        json: 'ok',
      });
    });
  }
});

describe('Share without a clipboard, then a reload, where autosave cannot write', () => {
  // Fixed in round 3: the link opens, and it stays in the address bar while the autosave cannot
  // hold it (the reviewer expected it to leave; leaving would lose the work on the next reload).
  it('autosave paused (no room for the backup): the link Share left in the address bar opens and stays', async () => {
    stubs();
    localStorage.clear();
    sessionStorage.clear();
    // An autosave this version cannot read, and no room to copy it: autosave is paused.
    localStorage.setItem(
      'smithonline.design.v1',
      JSON.stringify({ ...old050, elements: [{ kind: 'R', orientation: 'series', value: -1 }] }),
    );
    const setItem = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
      this: Storage,
      k: string,
      v: string,
    ) {
      if (this === localStorage) throw new DOMException('full', 'QuotaExceededError');
      return setItem.call(this, k, v);
    });
    let store = (await startApp()).useDesignStore;
    expect(store.getState().message).toMatch(/autosave is paused/);
    // The user works anyway and shares; the clipboard refuses (Header.tsx share(), catch branch).
    act(() =>
      store.getState().init({ ...store.getState().design, name: 'Work done while paused' }),
    );
    act(() =>
      store.getState().addElement({ kind: 'C', orientation: 'shunt', value: 1e-12 }, 'Added C'),
    );
    const { encodeDesign, rememberWrittenLink } = await import('../src/lib/share');
    const { ownBuild } = await import('../src/lib/designBuild');
    const hash = `#d=${encodeDesign(ownBuild(store.getState().design))}`;
    history.replaceState(null, '', hash);
    rememberWrittenLink(hash);
    // Reload: the only copy of the work is the link in the address bar.
    store = (await startApp()).useDesignStore;
    expect({ name: store.getState().design.name, hash: location.hash }).toEqual({
      name: 'Work done while paused',
      hash,
    });
  });

  it('storage full (autosave write throws): the link opens, not the older autosave', async () => {
    stubs();
    localStorage.clear();
    sessionStorage.clear();
    const { emptyDesign } = await import('../src/lib/design');
    const { ownBuild } = await import('../src/lib/designBuild');
    localStorage.setItem(
      'smithonline.design.v1',
      JSON.stringify({ ...ownBuild(emptyDesign()), name: 'Older autosave' }),
    );
    const setItem = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
      this: Storage,
      k: string,
      v: string,
    ) {
      if (this === localStorage) throw new DOMException('full', 'QuotaExceededError');
      return setItem.call(this, k, v);
    });
    let store = (await startApp()).useDesignStore;
    act(() => store.getState().setName('Newer work'));
    act(() =>
      store.getState().addElement({ kind: 'C', orientation: 'shunt', value: 1e-12 }, 'Added C'),
    );
    const { encodeDesign, rememberWrittenLink } = await import('../src/lib/share');
    const hash = `#d=${encodeDesign(ownBuild(store.getState().design))}`;
    history.replaceState(null, '', hash);
    rememberWrittenLink(hash);
    store = (await startApp()).useDesignStore;
    expect(store.getState().design.name).toBe('Newer work');
  });
});

describe('a link pasted into the address bar of the running app', () => {
  it('a hash change opens the pasted link', async () => {
    stubs();
    localStorage.clear();
    sessionStorage.clear();
    const store = (await startApp()).useDesignStore;
    const { emptyDesign, identify } = await import('../src/lib/design');
    const { encodeDesign } = await import('../src/lib/share');
    const { ownBuild } = await import('../src/lib/designBuild');
    const linked = ownBuild({
      ...emptyDesign(),
      name: 'Pasted link',
      load: complex(10, 5),
      elements: identify([{ kind: 'C', orientation: 'shunt', value: 3.3e-12 }]),
    });
    await act(async () => {
      location.hash = `#d=${encodeDesign(linked)}`;
      window.dispatchEvent(new HashChangeEvent('hashchange'));
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(store.getState().design.name).toBe('Pasted link');
  });
});

describe('a link opened over the autosave', () => {
  it('the previous autosave survives closing the tab (kept as a backup)', async () => {
    stubs();
    localStorage.clear();
    sessionStorage.clear();
    const { emptyDesign, identify } = await import('../src/lib/design');
    const { encodeDesign } = await import('../src/lib/share');
    const { ownBuild } = await import('../src/lib/designBuild');
    const mine = ownBuild({
      ...emptyDesign(),
      name: 'My own work',
      elements: identify([{ kind: 'L', orientation: 'series', value: 6.8e-9 }]),
    });
    localStorage.setItem('smithonline.design.v1', JSON.stringify(mine));
    const theirs = ownBuild({ ...emptyDesign(), name: 'Colleague link' });
    history.replaceState(null, '', `/#d=${encodeDesign(theirs)}`);
    await startApp();
    // The tab is closed and opened again later (no link): where is "My own work"?
    const store = (await startApp()).useDesignStore;
    const everywhere = [
      store.getState().design.name,
      ...Object.keys(localStorage).map((k) => localStorage.getItem(k) ?? ''),
    ].join('\n');
    expect(everywhere).toContain('My own work');
  });
});

describe('the next start after the app autosaved an 11.8 m microstrip (Dimensions at 3.5 MHz)', () => {
  it('shows the user design, not the demo', async () => {
    stubs();
    localStorage.clear();
    sessionStorage.clear();
    const core = await import('@smithonline/core');
    const { emptyDesign, identify } = await import('../src/lib/design');
    const { ownBuild } = await import('../src/lib/designBuild');
    const ms = core.microstripDimensions(core.DEFAULT_STACKUP, 50, 0.25, 3.5e6)!;
    const mine = ownBuild({
      ...emptyDesign({ frequency: 3.5e6, z0: 50 }),
      name: 'HF match',
      elements: identify([
        { kind: 'microstrip', width: ms.width, length: ms.length, stackup: core.DEFAULT_STACKUP },
      ]),
    });
    localStorage.setItem('smithonline.design.v1', JSON.stringify(mine));
    const store = (await startApp()).useDesignStore;
    expect({ name: store.getState().design.name, message: store.getState().message }).toEqual({
      name: 'HF match',
      message: null,
    });
  });
});
