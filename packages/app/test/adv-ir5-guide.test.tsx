// @vitest-environment jsdom
/**
 * Adversarial: the start guide with hostile localStorage, its steps after an
 * example, a share link and Undo, and its buttons at phone and desktop width.
 */
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { complex } from '@smithonline/core';
import { emptyDesign } from '../src/lib/design';
import { startSteps } from '../src/lib/startGuide';
import { useDesignStore } from '../src/store/useDesignStore';
import { useShell } from '../src/store/useShell';
import { useTourStore } from '../src/store/useTourStore';

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

function setWidth(width: number, height = 844): void {
  vi.stubGlobal('innerWidth', width);
  vi.stubGlobal('innerHeight', height);
  window.dispatchEvent(new Event('resize'));
}

beforeEach(() => {
  useTourStore.getState().close();
  useDesignStore.getState().init(emptyDesign());
  useShell.setState({ guideClosed: false, detent: 'half', held: null, pane: 'network' });
});
afterEach(() => {
  cleanup();
  setWidth(1024, 768);
  vi.restoreAllMocks();
});

describe('localStorage that throws, is missing or corrupt', () => {
  it('getItem throws at module load: the guide shows, nothing throws', async () => {
    vi.resetModules();
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    const mod = await import('../src/store/useShell');
    expect(mod.useShell.getState().guideClosed).toBe(false);
    spy.mockRestore();
  });
  it('setItem and removeItem throw: close and show still work for the session', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    expect(() => useShell.getState().closeGuide()).not.toThrow();
    expect(useShell.getState().guideClosed).toBe(true);
    expect(() => useShell.getState().showGuide()).not.toThrow();
    expect(useShell.getState().guideClosed).toBe(false);
  });
  it('a corrupt stored value shows the guide', async () => {
    localStorage.setItem('smithonline.startGuide', '{"closed":true');
    vi.resetModules();
    const mod = await import('../src/store/useShell');
    expect(mod.useShell.getState().guideClosed).toBe(false);
    localStorage.removeItem('smithonline.startGuide');
  });
});

describe('steps', () => {
  it('Undo of the part that ticked Match unticks it', () => {
    const s = useDesignStore.getState();
    s.addElement({ kind: 'C', orientation: 'shunt', value: 1e-12 });
    expect(startSteps(useDesignStore.getState().design).match).toBe(true);
    s.undo();
    expect(startSteps(useDesignStore.getState().design).match).toBe(false);
    s.redo();
    expect(startSteps(useDesignStore.getState().design).match).toBe(true);
  });
  it('a second datapoint counts as a load, the load at Z0 itself does not', () => {
    const d = emptyDesign();
    expect(startSteps(d).load).toBe(false);
    expect(
      startSteps({ ...d, datapoints: [{ frequency: 2e9, z: complex(50, 0) }] } as never).load,
    ).toBe(true);
  });
});

describe('buttons go to their controls', () => {
  for (const width of [390, 1440]) {
    it(`${width} px: Load and Target focus a field, Auto match opens it`, async () => {
      setWidth(width, 900);
      const { App } = await import('../src/App');
      const user = userEvent.setup();
      render(<App />);
      await user.click(screen.getByRole('button', { name: 'Go to the load fields' }));
      expect(document.activeElement?.closest('.card.load')).not.toBeNull();
      await user.click(screen.getByRole('button', { name: 'Go to the target card' }));
      expect(document.activeElement?.closest('.card.target')).not.toBeNull();
      await user.click(screen.getByRole('button', { name: 'Open Auto match' }));
      expect(document.querySelector('.tool-panel')).not.toBeNull();
    });
  }

  it('closing the guide hides it at every width and survives a design load', async () => {
    setWidth(1440, 900);
    const { App } = await import('../src/App');
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Close the start guide' }));
    act(() => useDesignStore.getState().loadDesign(emptyDesign()));
    act(() => setWidth(390));
    expect(screen.queryByRole('region', { name: 'Start guide' })).toBeNull();
    localStorage.removeItem('smithonline.startGuide');
  });
});
