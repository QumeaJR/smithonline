// @vitest-environment jsdom
/**
 * Adversarial QA round 2 (0.6.0) in the app: an accepted build whose network as built is NaN,
 * and the autosave the App writes in a browser whose 0.5.0 package table is out of range.
 */
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { complex, DEFAULT_BOARD, type BoardSettings } from '@smithonline/core';

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

import { emptyDesign, identify, type Design } from '../src/lib/design';
import { DESIGN_STORAGE_KEY, readSavedDesign } from '../src/lib/autosave';
import { openedDesign } from '../src/lib/designBuild';
import { useDesignStore } from '../src/store/useDesignStore';
import { usePackages, loadPackageTable } from '../src/store/usePackages';
import { useBoard } from '../src/store/useBoard';
import { useShell } from '../src/store/useShell';
import { useHelp } from '../src/store/useHelp';

const D = () => useDesignStore.getState();

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
  vi.stubGlobal('innerWidth', 1440);
  vi.stubGlobal('innerHeight', 900);
}

function packaged(): Design {
  const base = emptyDesign({ frequency: 10e9 });
  return {
    ...base,
    name: 'adv2 app',
    load: complex(25, -15),
    elements: identify([
      { kind: 'C', orientation: 'shunt', value: 0.3e-12, package: '0402' },
      { kind: 'L', orientation: 'series', value: 0.68e-9, package: '0402' },
    ]),
  };
}

beforeEach(() => {
  stubs();
  localStorage.clear();
  useBoard.getState().reset();
  usePackages.getState().reset();
  useShell.setState({
    detent: 'half',
    held: null,
    holds: [],
    guideClosed: true,
    guideShown: false,
  });
  useHelp.getState().closeHelp();
  D().init(emptyDesign());
  D().setView('chart');
  D().setMessage(null);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function renderApp(): Promise<HTMLElement> {
  const { App } = await import('../src/App');
  return render(<App />).container;
}
function nanInDom(c: HTMLElement): string[] {
  const hits: string[] = [];
  const m = /.{0,40}NaN.{0,20}/.exec(c.textContent ?? '');
  if (m) hits.push(`text: ${m[0]}`);
  c.querySelectorAll('*').forEach((el) => {
    for (const a of Array.from(el.attributes))
      if (/NaN/.test(a.value)) hits.push(`${el.tagName}[${a.name}]`);
  });
  return [...new Set(hits)];
}

describe('the app with a build whose network as built is NaN', () => {
  it('h 10 um, trace 1 m x 1 um at 10 GHz, Board on: no NaN on screen', async () => {
    const board: BoardSettings = {
      ...DEFAULT_BOARD,
      enabled: true,
      stackup: { h: 10e-6, er: 3.66, tanD: 0.002, fRef: 1e9, t: 35e-6, roughness: 3e-6 },
      traceLength: 1,
      traceWidth: 1e-6,
    };
    D().init({ ...packaged(), build: { board, packages: [] } });
    const c = await renderApp();
    await act(async () => {});
    expect(c.querySelector('.app-error')).toBeNull();
    expect(nanInDom(c)).toEqual([]);
  });
});

describe('the app in a browser whose 0.5.0 package table holds ESL 10 H on 0805', () => {
  it('the autosave the App writes is readable on the next start', async () => {
    localStorage.setItem('smithonline.packages.v1', JSON.stringify([{ id: '0805', esl: 10 }]));
    usePackages.setState({ table: loadPackageTable() });
    // A 0.5.0 autosave, opened at the start (main.tsx).
    localStorage.setItem(DESIGN_STORAGE_KEY, JSON.stringify(packaged()));
    const first = readSavedDesign();
    expect(first?.name).toBe('adv2 app');
    D().init(openedDesign(first!).design);
    await renderApp();
    await act(async () => {});
    // The App's autosave effect has written the design; the next start reads it.
    const second = readSavedDesign();
    expect(second?.name, 'the next start finds no design and shows Example 5').toBe('adv2 app');
  });
});
