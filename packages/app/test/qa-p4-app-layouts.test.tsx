// @vitest-environment jsdom
/**
 * QA, redesign phase 4: the App renders at every layout and view without a
 * console error, each layout with the structure of docs/07 section 5 and user
 * guide section 1, and a running job survives a rotation across 700 px.
 */
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyDesign, identify } from '../src/lib/design';
import { useDesignStore, type View } from '../src/store/useDesignStore';
import { useJobs } from '../src/store/useJobs';
import { useShell } from '../src/store/useShell';

beforeAll(() => {
  // jsdom has no canvas; uPlot (the Response plots) draws on one. A context that ignores
  // every call keeps the plots out of the question.
  const ctx: Record<string | symbol, unknown> = new Proxy(
    {},
    {
      get: (_t, key) =>
        key === 'measureText'
          ? () => ({ width: 0 })
          : key === 'canvas'
            ? document.createElement('canvas')
            : () => undefined,
      set: () => true,
    },
  );
  vi.stubGlobal(
    'Path2D',
    class {
      moveTo(): void {}
      lineTo(): void {}
      rect(): void {}
      arc(): void {}
      closePath(): void {}
      bezierCurveTo(): void {}
      addPath(): void {}
    },
  );
  HTMLCanvasElement.prototype.getContext = (() =>
    ctx) as unknown as HTMLCanvasElement['getContext'];
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
});

function setWidth(width: number, height = 844): void {
  vi.stubGlobal('innerWidth', width);
  vi.stubGlobal('innerHeight', height);
  window.dispatchEvent(new Event('resize'));
}

beforeEach(() => {
  localStorage.clear();
  useShell.setState({
    pane: 'network',
    paneBefore: 'network',
    toolPushed: false,
    detent: 'half',
    held: null,
    guideClosed: false,
  });
  useJobs.setState({ jobs: {} });
  useDesignStore.getState().init({
    ...emptyDesign(),
    load: { re: 20, im: -12 },
    elements: identify([
      { kind: 'C', orientation: 'shunt', value: 4.7e-12 },
      { kind: 'L', orientation: 'series', value: 10e-9 },
    ]),
  });
  useDesignStore.getState().setMessage(null);
});
afterEach(() => {
  cleanup();
  useDesignStore.getState().setView('chart');
  setWidth(1024, 768);
  vi.restoreAllMocks();
});

const CASES: readonly [number, number, string][] = [
  [375, 667, 'phone'],
  [699, 900, 'phone'],
  [700, 1024, 'tablet'],
  [1099, 800, 'tablet'],
  [1100, 800, 'desktop'],
  [1439, 900, 'desktop'],
  [1440, 900, 'wide'],
];

describe('the App at each layout and view', () => {
  for (const [w, h, layout] of CASES) {
    for (const view of ['chart', 'response', 'splot'] as View[]) {
      it(`${w} x ${h} (${layout}), ${view}: renders without a console error`, async () => {
        setWidth(w, h);
        useDesignStore.getState().setView(view);
        const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const { App } = await import('../src/App');
        const { container } = render(<App />);
        const app = container.querySelector('.app') as HTMLElement;
        expect(app.className).toContain(`layout-${layout}`);
        expect(app.className).toContain(`view-${view}`);
        expect(errors).not.toHaveBeenCalled();
      });
    }
  }
});

describe('what each layout renders (user guide section 1)', () => {
  it('phone: top bar with More, the view tabs, Undo, Redo; two chips; the pinned strip; the sheet; no header or status bar', async () => {
    setWidth(390, 844);
    const { App } = await import('../src/App');
    const { container } = render(<App />);
    const bar = container.querySelector('.phone-bar') as HTMLElement;
    expect(bar).not.toBeNull();
    expect(screen.getByRole('button', { name: 'More' })).toBeTruthy();
    expect([...bar.querySelectorAll('[role="tab"]')].map((t) => t.textContent)).toEqual([
      'Chart',
      'Response',
      'S-Plot',
    ]);
    expect(screen.getByRole('button', { name: 'Undo' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Design: / })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Chart grid' })).toBeTruthy();
    // No chip on the lower rim: Zin and VSWR are at the end of the pinned schematic strip.
    expect(container.querySelector('.readout-chip')).toBeNull();
    expect(screen.getByRole('region', { name: 'Panels' })).toBeTruthy();
    expect(container.querySelector('.desktop-header, .statusbar')).toBeNull();
    // The schematic strip is pinned between the chart and the sheet, not in Network.
    expect(container.querySelector('main .schematic')).toBeNull();
    expect(container.querySelector('.pinned-strip .schematic')).not.toBeNull();
    expect(container.querySelector('[data-pane="network"] .schematic')).toBeNull();
  });

  it('tablet: the header, the chart with its schematic strip, a side column Network | Numbers, the status bar', async () => {
    setWidth(768, 1024);
    const { App } = await import('../src/App');
    const { container } = render(<App />);
    expect(container.querySelector('.desktop-header')).not.toBeNull();
    expect(container.querySelector('main .schematic')).not.toBeNull();
    expect(container.querySelector('aside.left')).toBeNull();
    const side = container.querySelector('aside.right') as HTMLElement;
    expect(
      [...side.querySelectorAll('.tool-strip [role="tab"]')].map((t) => t.textContent),
    ).toEqual(['Network', 'Numbers']);
    expect(container.querySelector('.statusbar')).not.toBeNull();
  });

  it('desktop: header groups Data, Design tools, Settings, Help in that order; left Network, right Numbers', async () => {
    setWidth(1440, 900);
    const { App } = await import('../src/App');
    const { container } = render(<App />);
    const groups = [...container.querySelectorAll('.desktop-header [role="group"]')].map((g) =>
      g.getAttribute('aria-label'),
    );
    expect(groups).toEqual(['Design', 'History', 'Data', 'Design tools', 'Settings', 'Help']);
    expect(container.querySelector('aside.left .card.load')).not.toBeNull();
    expect(container.querySelector('aside.right .dp-table')).not.toBeNull();
  });
});

describe('a running job across a rotation over 700 px', () => {
  const workers: { terminated: boolean }[] = [];
  beforeEach(() => {
    workers.length = 0;
    vi.stubGlobal(
      'Worker',
      class {
        terminated = false;
        onmessage: unknown = null;
        onerror: unknown = null;
        constructor() {
          workers.push(this);
        }
        postMessage(): void {}
        terminate(): void {
          this.terminated = true;
        }
      },
    );
  });

  it('phone 430 x 932, Optimize band running, rotated to 932 x 430 (tablet): the worker runs on', async () => {
    setWidth(430, 932);
    const { App } = await import('../src/App');
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('tab', { name: 'Tools' }));
    await user.click(screen.getByRole('button', { name: /Optimize band/ }));
    await user.click(screen.getByRole('button', { name: 'Optimize' }));
    expect(workers).toHaveLength(1);
    act(() => setWidth(932, 430));
    expect(workers[0]?.terminated).toBe(false);
    expect(useJobs.getState().jobs.optimize).toBeDefined();
  });
});
