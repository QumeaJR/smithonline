// @vitest-environment jsdom
/**
 * QA, redesign phase 5: device-neutral wording (lib/tips.ts pointerHints,
 * docs/07 section 6 and section 4 Tooltips). With a coarse pointer no string
 * the app renders, as text, title, aria-label or placeholder, names a mouse
 * gesture: hover, click, right-click, double-click or the wheel. With a fine
 * pointer the hints name no touch gesture. Rendered at 390 px (phone) and
 * 1000 px (touch tablet) with Realize on so the lock buttons show.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_REALIZE, emptyDesign, identify } from '../src/lib/design';
import { pointerHints } from '../src/lib/tips';
import { useDesignStore } from '../src/store/useDesignStore';
import { useShell } from '../src/store/useShell';

const MOUSE_WORDS = /\b(hover\w*|click\w*|right-click\w*|double-click\w*|mouse wheel|wheel)\b/i;

function stubs(width: number, touch: boolean): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: touch && query === '(pointer: coarse)',
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
  }));
  vi.stubGlobal('innerWidth', width);
  vi.stubGlobal('innerHeight', 900);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    },
  );
}

beforeEach(() => {
  localStorage.clear();
  useShell.setState({ guideClosed: true });
  useDesignStore.getState().init({
    ...emptyDesign(),
    load: { re: 20, im: -12 },
    realize: { ...DEFAULT_REALIZE, enabled: true },
    elements: identify([
      { kind: 'C', orientation: 'shunt', value: 4.7e-12 },
      { kind: 'L', orientation: 'series', value: 10e-9 },
    ]),
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** Every string the document shows or announces: text nodes, titles, labels, placeholders. */
function strings(root: ParentNode = document.body): string[] {
  const out: string[] = [];
  const walker = document.createTreeWalker(root as Node, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = n.textContent?.trim();
    // the source of a <style> or <script> is not shown
    const tag = n.parentElement?.tagName;
    if (t && tag !== 'STYLE' && tag !== 'SCRIPT') out.push(t);
  }
  for (const el of (root as Element | Document).querySelectorAll(
    '[title], [aria-label], [placeholder]',
  )) {
    for (const a of ['title', 'aria-label', 'placeholder']) {
      const v = el.getAttribute(a);
      if (v) out.push(`${a}: ${v}`);
    }
  }
  return out;
}
const mouseWorded = (): string[] => [...new Set(strings().filter((s) => MOUSE_WORDS.test(s)))];

describe('no mouse words on a coarse pointer', () => {
  it('phone, chart view with the Network pane', async () => {
    stubs(390, true);
    const { App } = await import('../src/App');
    render(<App />);
    expect(mouseWorded()).toEqual([]);
  });

  it('touch tablet, chart view', async () => {
    stubs(1000, true);
    const { App } = await import('../src/App');
    render(<App />);
    expect(mouseWorded()).toEqual([]);
  });

  it('touch tablet, a part armed and datapoint input on', async () => {
    stubs(1000, true);
    const { App } = await import('../src/App');
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /^Series L/ }));
    expect(mouseWorded()).toEqual([]);
    useDesignStore.getState().setDatapointInput(true);
    expect(mouseWorded()).toEqual([]);
  });
});

describe('the hints of a fine pointer name no touch gesture', () => {
  it('no tap, long press, pinch or double tap in the mouse hints', () => {
    const h = pointerHints(false);
    const all = [
      h.chart,
      h.armed('Series L'),
      h.response,
      h.splot,
      h.preview,
      h.responseMarker,
      h.splotCursor,
      h.datapointSwitch,
      h.datapointInput(3),
      h.emptyLadder,
      h.startMatch,
      h.press,
    ].join(' | ');
    expect(all).not.toMatch(/\btap\b|long press|pinch|double tap/i);
  });

  it('every hint has both variants, and they differ where a gesture is named', () => {
    const m = pointerHints(false);
    const t = pointerHints(true);
    for (const k of Object.keys(m) as (keyof typeof m)[]) {
      const a = typeof m[k] === 'function' ? (m[k] as (x: never) => string)('X' as never) : m[k];
      const b = typeof t[k] === 'function' ? (t[k] as (x: never) => string)('X' as never) : t[k];
      expect(typeof a, k).toBe('string');
      expect(a, k).not.toBe(b);
    }
  });
});
