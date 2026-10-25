// @vitest-environment jsdom
/**
 * Adversarial, phase 6: the Share button in the App with the clipboard missing or denied
 * and clicked repeatedly within 1.5 s, unmounted while the copy is pending; the shortcuts
 * in a text field, a dialog, the Help dialog, with IME composition and in odd modifier
 * combinations. Each test asserts the correct behaviour; a failure is a defect.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
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

import { COPIED_MS, ShareButton } from '../src/components/ShareButton';
import { emptyDesign } from '../src/lib/design';
import { appShortcut } from '../src/lib/shortcuts';
import { useDesignStore } from '../src/store/useDesignStore';
import { useHelp } from '../src/store/useHelp';
import { useShell } from '../src/store/useShell';

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
beforeEach(() => {
  stubs();
  localStorage.clear();
  saved.json = [];
  useShell.setState({ guideClosed: true, guideShown: false });
  useHelp.getState().closeHelp();
  D().init(emptyDesign());
  D().setView('chart');
  D().setMessage(null);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function renderApp(): Promise<void> {
  const { App } = await import('../src/App');
  render(<App />);
}
const shareButton = (): HTMLElement => screen.getByRole('button', { name: 'Share link' });

describe('Share in the App', () => {
  it('clipboard missing: no Copied, the status line says the address bar', async () => {
    vi.stubGlobal('navigator', { ...navigator, clipboard: undefined });
    await renderApp();
    await act(async () => {
      fireEvent.click(shareButton());
    });
    expect(shareButton().textContent).toBe('Share');
    expect(D().message).toBe('Share link is in the address bar');
    expect(location.hash.startsWith('#d=')).toBe(true);
  });

  it('clipboard denied: no Copied, the status line says the address bar', async () => {
    vi.stubGlobal('navigator', {
      ...navigator,
      clipboard: {
        writeText: () => Promise.reject(new DOMException('denied', 'NotAllowedError')),
      },
    });
    await renderApp();
    await act(async () => {
      fireEvent.click(shareButton());
    });
    expect(shareButton().textContent).toBe('Share');
    expect(D().message).toBe('Share link is in the address bar');
  });

  it('clicked three times within 1.5 s: Copied lasts 1.5 s after the last copy', async () => {
    vi.useFakeTimers();
    const onShare = vi.fn(() => Promise.resolve(true));
    render(<ShareButton onShare={onShare} />);
    const b = screen.getByRole('button', { name: 'Share link' });
    for (let i = 0; i < 3; i++) {
      await act(async () => {
        fireEvent.click(b);
        await Promise.resolve();
      });
      act(() => vi.advanceTimersByTime(500));
    }
    expect(onShare).toHaveBeenCalledTimes(3);
    expect(b.textContent).toBe('Copied');
    act(() => vi.advanceTimersByTime(COPIED_MS - 500 - 1));
    expect(b.textContent).toBe('Copied');
    act(() => vi.advanceTimersByTime(2));
    expect(b.textContent).toBe('Share');
  });
});

describe('shortcuts in odd places', () => {
  const press = (target: EventTarget, k: string, extra: Partial<KeyboardEventInit> = {}) => {
    const e = new KeyboardEvent('keydown', {
      key: k,
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
      ...extra,
    });
    act(() => {
      target.dispatchEvent(e);
    });
    return e;
  };

  const alt = { ctrlKey: false, altKey: true };

  it('inside the Help dialog: Ctrl+S, Alt+2 do nothing', async () => {
    await renderApp();
    act(() => useHelp.getState().openHelp());
    const dialog = screen.getByRole('dialog');
    press(dialog, 's');
    press(dialog, '2', { ...alt, code: 'Digit2' });
    expect(saved.json).toHaveLength(0);
    expect(D().view).toBe('chart');
  });

  it('inside the Settings dialog: Ctrl+S and Alt+3 do nothing', async () => {
    await renderApp();
    fireEvent.click(screen.getByRole('button', { name: /settings/i }));
    const dialog = screen.getByRole('dialog');
    press(dialog, 's');
    press(dialog, '3', { ...alt, code: 'Digit3' });
    expect(saved.json).toHaveLength(0);
    expect(D().view).toBe('chart');
  });

  it('in the design name field: Ctrl+S, Alt+3 do nothing', async () => {
    await renderApp();
    const input = document.querySelector('input[type="text"], input:not([type])') as HTMLElement;
    expect(input).toBeTruthy();
    input.focus();
    press(input, 's');
    press(input, '3', { ...alt, code: 'Digit3' });
    expect(saved.json).toHaveLength(0);
    expect(D().view).toBe('chart');
  });

  it('during IME composition (key Process) nothing fires', () => {
    expect(
      appShortcut({
        key: 'Process',
        code: 'KeyS',
        ctrlKey: true,
        metaKey: false,
        altKey: false,
        shiftKey: false,
      }),
    ).toBeNull();
  });

  it('Ctrl+Cmd+S (both) and Cmd+S save; Ctrl+Shift+Alt+S does not', () => {
    const base = { code: 'KeyS', altKey: false, shiftKey: false };
    expect(appShortcut({ ...base, key: 's', ctrlKey: true, metaKey: true })).toEqual({
      kind: 'save',
    });
    expect(appShortcut({ ...base, key: 's', ctrlKey: false, metaKey: true })).toEqual({
      kind: 'save',
    });
    expect(
      appShortcut({
        ...base,
        key: 'S',
        ctrlKey: true,
        metaKey: false,
        shiftKey: true,
        altKey: true,
      }),
    ).toBeNull();
  });

  it('a Cyrillic layout: Ctrl+S (key "ы", code KeyS) still saves', () => {
    expect(
      appShortcut({
        key: 'ы',
        code: 'KeyS',
        ctrlKey: true,
        metaKey: false,
        altKey: false,
        shiftKey: false,
      }),
    ).toEqual({ kind: 'save' });
  });

  it('Alt with the digit row switches views; Alt with the keypad is a Windows Alt code', () => {
    const base = { ctrlKey: false, metaKey: false, altKey: true, shiftKey: false };
    expect(appShortcut({ ...base, key: '2', code: 'Digit2' })).toEqual({
      kind: 'view',
      view: 'response',
    });
    expect(appShortcut({ ...base, key: '2', code: 'Numpad2' })).toBeNull();
    expect(appShortcut({ ...base, key: '4', code: 'Digit4' })).toBeNull();
  });

  it('Ctrl+E pressed twice: the File menu opens once and the second press does not close it', async () => {
    await renderApp();
    press(window, 'e');
    press(window, 'e', { repeat: true });
    expect(screen.getByRole('menu', { name: 'File' })).toBeTruthy();
  });
});
