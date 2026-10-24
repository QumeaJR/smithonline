// @vitest-environment jsdom
/**
 * Adversarial: keys and focus with the phase 3 overlays open in the real app.
 * A modal dialog or an open menu must keep Delete, Ctrl+Z and Ctrl+N from the
 * design behind it (the Help dialog already does).
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyDesign, identify } from '../src/lib/design';
import { useDesignStore } from '../src/store/useDesignStore';

beforeAll(() => {
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

beforeEach(() => {
  useDesignStore.getState().init({
    ...emptyDesign(),
    elements: identify([
      { kind: 'C', orientation: 'shunt', value: 4.7e-12 },
      { kind: 'L', orientation: 'series', value: 10e-9 },
    ]),
  });
  useDesignStore.getState().setMessage(null);
  useDesignStore.getState().select(1);
});
afterEach(() => cleanup());

describe('keys behind an open overlay', () => {
  it('Delete in the Settings dialog does not remove the selected part behind it', async () => {
    const { App } = await import('../src/App');
    const user = userEvent.setup();
    render(<App />);
    act(() => useDesignStore.getState().select(1));
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    const dialog = screen.getByRole('dialog');
    const button = dialog.querySelector<HTMLButtonElement>('button');
    button?.focus();
    expect(document.activeElement && dialog.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(document.activeElement as Element, { key: 'Delete' });
    expect(useDesignStore.getState().design.elements).toHaveLength(2);
  });

  it('Ctrl+N in the Settings dialog does not replace the design behind it', async () => {
    const { App } = await import('../src/App');
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    const dialog = screen.getByRole('dialog');
    dialog.querySelector<HTMLButtonElement>('button')?.focus();
    fireEvent.keyDown(document.activeElement as Element, { key: 'n', ctrlKey: true });
    expect(useDesignStore.getState().design.elements).toHaveLength(2);
    expect(screen.queryByRole('dialog')).not.toBeNull();
  });

  it('Delete on a focused item of the File menu does not remove the selected part', async () => {
    const { App } = await import('../src/App');
    const user = userEvent.setup();
    render(<App />);
    act(() => useDesignStore.getState().select(1));
    await user.click(screen.getByRole('button', { name: /^File/ }));
    const menu = screen.getByRole('menu');
    expect(menu.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(document.activeElement as Element, { key: 'Delete' });
    expect(useDesignStore.getState().design.elements).toHaveLength(2);
  });
});
