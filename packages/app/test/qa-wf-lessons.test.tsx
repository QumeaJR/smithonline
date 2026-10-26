// @vitest-environment jsdom
/**
 * QA round 1 on docs/09: the ten lessons are unchanged. Each still starts
 * from Learn, walks to its last step with Next, ends with Done, and still
 * ends when a tool opens (only a workflow survives that). The tour panel says
 * "Lesson · step n of m" instead of "n of 10 tours" (section 5).
 */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

import { emptyDesign } from '../src/lib/design';
import { TOURS } from '../src/lib/tours';
import { tourUi } from '../src/lib/tourUi';
import { useDesignStore } from '../src/store/useDesignStore';
import { useHelp } from '../src/store/useHelp';
import { useShell } from '../src/store/useShell';
import { useTourStore } from '../src/store/useTourStore';

const D = () => useDesignStore.getState();
const T = () => useTourStore.getState();

async function renderApp(): Promise<void> {
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
  const { App } = await import('../src/App');
  render(<App />);
}

beforeEach(() => {
  localStorage.clear();
  useShell.setState({ guideClosed: true, guideShown: false, settings: null, tool: null });
  useHelp.getState().closeHelp();
  T().close();
  D().init({ ...emptyDesign(), name: 'Mine' });
  D().setView('chart');
  D().setMessage(null);
});
afterEach(() => {
  T().close();
  cleanup();
});

describe('the ten lessons', () => {
  it('there are ten, and Learn lists every one under Lessons', async () => {
    expect(TOURS.length).toBe(10);
    await renderApp();
    fireEvent.click(screen.getByRole('button', { name: 'Learn' }));
    const menu = screen.getByRole('menu', { name: 'Learn' });
    for (const t of TOURS) {
      expect(
        within(menu).getAllByRole('menuitem', { name: new RegExp(t.title) }).length,
      ).toBeGreaterThan(0);
    }
  });

  for (const tour of TOURS) {
    it(`${tour.id}: from Learn to Done with Next only, one Undo brings the design back`, async () => {
      await renderApp();
      const before = D().design;
      fireEvent.click(screen.getByRole('button', { name: 'Learn' }));
      // Lessons come before the Smith V4.1 examples, whose titles can repeat a lesson's.
      fireEvent.click(
        screen
          .getAllByRole('menuitem')
          .find((m) => m.textContent?.startsWith(tour.title)) as HTMLElement,
      );
      expect(T().tour?.id).toBe(tour.id);
      const panel = () => document.querySelector('.tour-panel') as HTMLElement;
      for (let i = 0; i < tour.steps.length; i++) {
        expect(panel().textContent).toContain(`Lesson · step ${i + 1} of ${tour.steps.length}`);
        expect(panel().textContent).not.toMatch(/of 10 tours/);
        expect(panel().querySelector('.tour-text')?.textContent?.trim().length).toBeGreaterThan(0);
        if (i < tour.steps.length - 1) {
          fireEvent.click(within(panel()).getByRole('button', { name: 'Next' }));
        }
      }
      fireEvent.click(within(panel()).getByRole('button', { name: 'Done' }));
      expect(T().tour).toBeNull();
      act(() => D().undo());
      expect(D().design).toBe(before);
    });

    it(`${tour.id}: still ends when a tool opens, from the header and from a workflow's openTool`, async () => {
      await renderApp();
      act(() => T().start(tour.id));
      const tools = document.querySelector(
        '[role="group"][aria-label="Design tools"]',
      ) as HTMLElement;
      fireEvent.click(within(tools).getByRole('button', { name: 'Tolerance' }));
      expect(T().tour).toBeNull();
      expect(D().message).toMatch(/^Closed the tour ".+" to open Tolerance/);
      act(() => tourUi.closeTool());
      act(() => T().start(tour.id));
      act(() => tourUi.openTool('match', 'broadband'));
      expect(T().tour).toBeNull();
    });
  }
});
