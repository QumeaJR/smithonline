// @vitest-environment jsdom
/**
 * QA: the theme-color meta rewrite in App. Expected colours are the canvas
 * tokens of docs/07-interaction-redesign.md section 3: light #f2f3f5, dark
 * #0e1217. On auto each meta keeps its own scheme; a forced theme writes that
 * scheme's colour into both.
 */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const LIGHT = '#f2f3f5';
const DARK = '#0e1217';

let App: typeof import('../src/App').App;

beforeAll(async () => {
  // uPlot reads matchMedia at import time; the app reads (pointer: coarse).
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
  App = (await import('../src/App')).App;
});

afterEach(() => {
  cleanup();
  document.head.innerHTML = '';
  document.documentElement.removeAttribute('data-theme');
  localStorage.clear();
});

function metas(): { light: HTMLMetaElement; dark: HTMLMetaElement } {
  const all = [...document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')];
  const light = all.find((m) => m.getAttribute('media')?.includes('light'));
  const dark = all.find((m) => m.getAttribute('media')?.includes('dark'));
  if (!light || !dark) throw new Error('metas missing');
  return { light, dark };
}

function installMetas(): void {
  // The two metas of index.html.
  document.head.innerHTML =
    '<meta name="theme-color" content="#f2f3f5" media="(prefers-color-scheme: light)" />' +
    '<meta name="theme-color" content="#0e1217" media="(prefers-color-scheme: dark)" />';
}

describe('theme-color metas where HTMLMetaElement.media is a property', () => {
  const proto = HTMLMetaElement.prototype;
  const had = Object.getOwnPropertyDescriptor(proto, 'media');
  beforeAll(() => {
    if (had) return;
    Object.defineProperty(proto, 'media', {
      configurable: true,
      get(this: HTMLMetaElement) {
        return this.getAttribute('media') ?? '';
      },
      set(this: HTMLMetaElement, v: string) {
        this.setAttribute('media', v);
      },
    });
  });
  afterAll(() => {
    if (!had) delete (proto as unknown as Record<string, unknown>)['media'];
  });

  it('auto (the default): each meta keeps the colour of its own scheme', () => {
    installMetas();
    localStorage.clear();
    render(<App />);
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
    expect(metas().light.content).toBe(LIGHT);
    expect(metas().dark.content).toBe(DARK);
  });

  it('the toggle cycles auto, dark, light, auto and rewrites both metas each time', async () => {
    installMetas();
    localStorage.clear();
    render(<App />);
    const user = userEvent.setup();
    // The toggle's name says the theme it is on (final QA: the state is in the name).
    const toggle = screen.getByRole('button', { name: 'Theme: follows the system' });

    await user.click(toggle);
    expect(toggle.getAttribute('aria-label')).toBe('Theme: dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(metas().light.content).toBe(DARK);
    expect(metas().dark.content).toBe(DARK);
    expect(localStorage.getItem('smithonline.theme')).toBe('dark');

    await user.click(toggle);
    expect(toggle.getAttribute('aria-label')).toBe('Theme: light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(metas().light.content).toBe(LIGHT);
    expect(metas().dark.content).toBe(LIGHT);
    expect(localStorage.getItem('smithonline.theme')).toBe('light');

    await user.click(toggle);
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
    expect(metas().light.content).toBe(LIGHT);
    expect(metas().dark.content).toBe(DARK);
    expect(localStorage.getItem('smithonline.theme')).toBe('auto');
  });

  it('a stored dark theme is applied on load', () => {
    installMetas();
    localStorage.setItem('smithonline.theme', 'dark');
    render(<App />);
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(metas().light.content).toBe(DARK);
    expect(metas().dark.content).toBe(DARK);
  });

  it('a stored value that is not a theme falls back to auto', () => {
    installMetas();
    localStorage.setItem('smithonline.theme', 'sepia');
    render(<App />);
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
    expect(metas().light.content).toBe(LIGHT);
    expect(metas().dark.content).toBe(DARK);
  });

  it('a meta without a media attribute is treated as the light one on auto', () => {
    document.head.innerHTML = '<meta name="theme-color" content="#000000" />';
    localStorage.clear();
    render(<App />);
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    expect(meta?.content).toBe(LIGHT);
  });

  it('no theme-color meta at all: the app still mounts', () => {
    document.head.innerHTML = '';
    expect(() => render(<App />)).not.toThrow();
    expect(screen.getByRole('button', { name: /^Theme: / })).toBeTruthy();
  });
});

describe('theme-color metas where HTMLMetaElement.media is not a property', () => {
  it('the app still mounts and rewrites the metas by attribute (plain jsdom)', () => {
    // jsdom does not implement HTMLMetaElement.media; the metas carry the attribute only.
    installMetas();
    expect(metas().light.media).toBeUndefined();
    localStorage.clear();
    expect(() => render(<App />)).not.toThrow();
    expect(metas().light.content).toBe(LIGHT);
    expect(metas().dark.content).toBe(DARK);
  });
});
