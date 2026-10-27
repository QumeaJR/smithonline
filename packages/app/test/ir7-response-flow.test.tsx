// @vitest-environment jsdom
/**
 * iPhone pass after 0.2.0: on the phone the Response readout table (Cursor,
 * the markers, f, |S21|, |S11|, VSWR, R, X, phase, group delay) was drawn
 * over the next plot card: the page of plots shrank to the screen while its
 * 180 px rows overflowed it, and the table followed the shrunk box. It is now
 * a flow element under the last plot, the page scrolls for it, and nothing in
 * index.css positions it over a plot. jsdom has no layout, so the test reads
 * the DOM order and the rules that make the flow.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyDesign, identify } from '../src/lib/design';
import { useDesignStore } from '../src/store/useDesignStore';
import { useShell } from '../src/store/useShell';

const css = readFileSync(resolve(__dirname, '../src/index.css'), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
);

/** The declarations of every rule whose selector list contains `selector` exactly. */
function rule(selector: string): string {
  const out: string[] = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = m[1]!.split(',').map((s) => s.trim().replace(/\s+/g, ' '));
    if (selectors.includes(selector)) out.push(m[2]!);
  }
  return out.join(';').replace(/\s+/g, ' ');
}

beforeAll(() => {
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
  useShell.setState({ pane: 'network', detent: 'half', held: null, guideClosed: true });
  const d = emptyDesign();
  useDesignStore.getState().init({
    ...d,
    load: { re: 20, im: -12 },
    elements: identify([{ kind: 'C', orientation: 'shunt', value: 4.7e-12 }]),
    sweep: { ...d.sweep, enabled: true, start: 0.5e9, stop: 2e9, points: 51 },
  });
});
afterEach(() => {
  cleanup();
  useDesignStore.getState().setView('chart');
  setWidth(1024, 768);
});

describe('the Response readout on the phone', () => {
  it('is a flow element under the last plot card, not inside or over the plots', async () => {
    setWidth(375, 812);
    const { App } = await import('../src/App');
    const { container } = render(<App />);
    act(() => useDesignStore.getState().setView('response'));
    const page = container.querySelector('main.phone-page') as HTMLElement;
    const response = page.querySelector('.response') as HTMLElement;
    const plots = response.querySelector(':scope > .plots') as HTMLElement;
    const table = response.querySelector(':scope > .readout-table') as HTMLElement;
    expect(plots.querySelectorAll('.panel')).toHaveLength(4);
    expect(table).not.toBeNull();
    // After the plots in the same column, never one of the plot cards' children.
    expect(plots.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(table.closest('.panel')).toBeNull();
    // Each plot's touch readout row stays inside its own card.
    for (const panel of plots.querySelectorAll('.panel')) {
      const row = panel.querySelector('.plot-readout');
      if (row) expect(row.closest('.panel')).toBe(panel);
    }
  });

  it('the page takes the height of its plots and table: the plots keep their rows in the flow', () => {
    expect(rule('.layout-phone .response')).toMatch(/height: auto/);
    const plots = rule('.layout-phone .response .plots');
    expect(plots).toMatch(/flex: none/);
    // 280 px since the docs/10 QA round: a plotting area of about 160 px under the 44 px head.
    expect(plots).toMatch(/grid-template-rows: repeat\(4, 280px\)/);
    // The page scrolls under the top bar.
    expect(rule('.layout-phone .chart-area.phone-page')).toMatch(/overflow-y: auto/);
  });

  it('nothing positions the readout table or a plot readout over a plot', () => {
    for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selectors = m[1]!;
      if (!/readout-table|plot-readout/.test(selectors)) continue;
      expect(m[2], selectors.trim()).not.toMatch(/position:\s*(absolute|fixed)/);
    }
  });
});
