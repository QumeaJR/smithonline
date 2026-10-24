// @vitest-environment jsdom
/**
 * Adversarial: useCoarsePointer when matchMedia is missing, throws, returns a
 * legacy MediaQueryList (addListener only, Safari 13 and older WebViews), or
 * returns null; and whether a change event re-renders.
 */
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isCoarsePointer, useCoarsePointer } from '../src/lib/pointer';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function Probe() {
  const coarse = useCoarsePointer();
  return <span data-testid="p">{coarse ? 'coarse' : 'fine'}</span>;
}

describe('adv useCoarsePointer', () => {
  it('matchMedia missing: fine, no throw', () => {
    vi.stubGlobal('matchMedia', undefined);
    render(<Probe />);
    expect(screen.getByTestId('p').textContent).toBe('fine');
    expect(isCoarsePointer()).toBe(false);
  });

  it('matchMedia throwing: the component still renders as fine', () => {
    vi.stubGlobal('matchMedia', () => {
      throw new TypeError('not supported');
    });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => render(<Probe />)).not.toThrow();
    expect(screen.getByTestId('p').textContent).toBe('fine');
  });

  it('matchMedia returning null: fine, no throw', () => {
    vi.stubGlobal('matchMedia', () => null);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => render(<Probe />)).not.toThrow();
  });

  it('a legacy MediaQueryList with addListener only (Safari 13) does not crash the app', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query === '(pointer: coarse)',
      media: query,
      addListener: () => undefined,
      removeListener: () => undefined,
    }));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => render(<Probe />)).not.toThrow();
    expect(screen.getByTestId('p').textContent).toBe('coarse');
  });

  it('a change event re-renders and the listener is removed on unmount', () => {
    let matches = false;
    const listeners = new Set<() => void>();
    vi.stubGlobal('matchMedia', (query: string) => ({
      get matches() {
        return matches && query === '(pointer: coarse)';
      },
      media: query,
      addEventListener: (_: string, fn: () => void) => listeners.add(fn),
      removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
    }));
    const { unmount } = render(<Probe />);
    expect(screen.getByTestId('p').textContent).toBe('fine');
    matches = true;
    act(() => {
      for (const fn of [...listeners]) fn();
    });
    expect(screen.getByTestId('p').textContent).toBe('coarse');
    unmount();
    expect(listeners.size).toBe(0);
  });
});
