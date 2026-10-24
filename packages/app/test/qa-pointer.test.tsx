// @vitest-environment jsdom
/**
 * QA: the pointer kind with a window: no matchMedia (jsdom's default) means
 * fine; a coarse match means coarse; a change event re-renders; the listener
 * is removed on unmount.
 */
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isCoarsePointer, useCoarsePointer } from '../src/lib/pointer';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function Probe() {
  return <span data-testid="p">{useCoarsePointer() ? 'coarse' : 'fine'}</span>;
}

interface FakeList {
  matches: boolean;
  readonly media: string;
  readonly listeners: Set<() => void>;
  addEventListener: (type: string, fn: () => void) => void;
  removeEventListener: (type: string, fn: () => void) => void;
}

function stub(matches: boolean): FakeList {
  const list: FakeList = {
    matches,
    media: '(pointer: coarse)',
    listeners: new Set(),
    addEventListener: (type, fn) => {
      if (type === 'change') list.listeners.add(fn);
    },
    removeEventListener: (type, fn) => {
      if (type === 'change') list.listeners.delete(fn);
    },
  };
  vi.stubGlobal('matchMedia', (query: string) => {
    expect(query).toBe('(pointer: coarse)');
    return list;
  });
  return list;
}

describe('pointer kind with a window', () => {
  it('jsdom has no matchMedia: fine', () => {
    expect(typeof window.matchMedia).toBe('undefined');
    expect(isCoarsePointer()).toBe(false);
    render(<Probe />);
    expect(screen.getByTestId('p').textContent).toBe('fine');
  });

  it('a coarse match: coarse', () => {
    stub(true);
    expect(isCoarsePointer()).toBe(true);
    render(<Probe />);
    expect(screen.getByTestId('p').textContent).toBe('coarse');
  });

  it('a change of the media query re-renders, and unmount removes the listener', () => {
    const list = stub(false);
    const view = render(<Probe />);
    expect(screen.getByTestId('p').textContent).toBe('fine');
    expect(list.listeners.size).toBe(1);
    act(() => {
      list.matches = true;
      for (const fn of list.listeners) fn();
    });
    expect(screen.getByTestId('p').textContent).toBe('coarse');
    view.unmount();
    expect(list.listeners.size).toBe(0);
  });
});
