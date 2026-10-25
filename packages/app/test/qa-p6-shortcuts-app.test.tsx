// @vitest-environment jsdom
/**
 * QA, redesign phase 6: the App's keyboard handler for the file and view shortcuts in a text
 * field, with Shift, and with nothing registered (docs/06-user-guide.md section 10: "While a
 * menu, a dialog or the help is open, or a text field has the focus, these shortcuts do
 * nothing").
 */
import { act, cleanup, render, screen } from '@testing-library/react';
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
const saved = vi.hoisted(() => ({ json: [] as string[] }));
vi.mock('../src/lib/export', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  exportJson: (_data: unknown, name: string) => saved.json.push(name),
}));

import { emptyDesign } from '../src/lib/design';
import { fileShortcuts } from '../src/lib/shortcuts';
import { useDesignStore } from '../src/store/useDesignStore';
import { useHelp } from '../src/store/useHelp';
import { useShell } from '../src/store/useShell';

const D = () => useDesignStore.getState();

beforeEach(() => {
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
  localStorage.clear();
  useShell.setState({ guideClosed: true, guideShown: false });
  useHelp.getState().closeHelp();
  D().init(emptyDesign());
  D().setView('chart');
  saved.json = [];
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function renderApp(): Promise<void> {
  const { App } = await import('../src/App');
  render(<App />);
}

function press(target: EventTarget, key: string, extra: KeyboardEventInit = {}): KeyboardEvent {
  const e = new KeyboardEvent('keydown', {
    key,
    ctrlKey: true,
    bubbles: true,
    cancelable: true,
    ...extra,
  });
  act(() => {
    target.dispatchEvent(e);
  });
  return e;
}

describe('qa: shortcuts in the App', () => {
  it('in a text field Ctrl+S and Alt+2 do nothing, and the browser save stays out', async () => {
    await renderApp();
    const field = screen.getAllByRole('textbox')[0] as HTMLInputElement;
    field.focus();
    const e = press(field, 's');
    expect(e.defaultPrevented).toBe(true);
    expect(saved.json).toEqual([]);
    press(field, '2', { ctrlKey: false, altKey: true, code: 'Digit2' });
    expect(D().view).toBe('chart');
  });

  it('Ctrl+Shift+S is the browser’s, not a save', async () => {
    await renderApp();
    const e = press(window, 'S', { shiftKey: true });
    expect(e.defaultPrevented).toBe(false);
    expect(saved.json).toEqual([]);
  });

  it('Alt+3 switches the view; Cmd+3 and Ctrl+3 stay the browser tab keys', async () => {
    await renderApp();
    expect(press(window, '3', { ctrlKey: false, metaKey: true }).defaultPrevented).toBe(false);
    expect(press(window, '3').defaultPrevented).toBe(false);
    expect(D().view).toBe('chart');
    press(window, '3', { ctrlKey: false, altKey: true, code: 'Digit3' });
    expect(D().view).toBe('splot');
  });

  it('the header on screen registers the file actions; they go with it', async () => {
    await renderApp();
    expect(fileShortcuts.current).not.toBeNull();
    cleanup();
    expect(fileShortcuts.current).toBeNull();
    // With nothing registered, Ctrl+S is still kept from the browser and does nothing.
    const e = new KeyboardEvent('keydown', { key: 's', ctrlKey: true, cancelable: true });
    window.dispatchEvent(e);
    expect(saved.json).toEqual([]);
  });
});
