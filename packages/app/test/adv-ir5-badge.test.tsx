// @vitest-environment jsdom
/**
 * Adversarial: a job keeps a visible sign (strip progress or header dot)
 * whenever its panel is not on show, including the S-Plot view where the
 * right column is hidden.
 */
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyDesign, identify } from '../src/lib/design';
import { useDesignStore } from '../src/store/useDesignStore';
import { useJobs } from '../src/store/useJobs';
import { useShell } from '../src/store/useShell';

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

function setWidth(width: number, height = 900): void {
  vi.stubGlobal('innerWidth', width);
  vi.stubGlobal('innerHeight', height);
  window.dispatchEvent(new Event('resize'));
}

beforeEach(() => {
  useShell.setState({
    pane: 'network',
    paneBefore: 'network',
    toolPushed: false,
    detent: 'half',
    held: null,
  });
  useJobs.setState({ jobs: {} });
  useDesignStore.getState().init({
    ...emptyDesign(),
    elements: identify([{ kind: 'C', orientation: 'shunt', value: 4.7e-12 }]),
  });
  useDesignStore.getState().setView('chart');
});
afterEach(() => {
  cleanup();
  setWidth(1024, 768);
});

describe('job sign in the S-Plot view', () => {
  for (const width of [1440, 800]) {
    it(`${width} px: Optimize band running, switch to S-Plot: a dot or a bar stays visible`, async () => {
      setWidth(width);
      const { App } = await import('../src/App');
      const user = userEvent.setup();
      const { container } = render(<App />);
      await user.click(screen.getByRole('button', { name: 'Optimize band' }));
      act(() =>
        useJobs.getState().report('optimize', { done: 1, total: 8, label: 'Restart 1 of 8' }),
      );
      act(() => useDesignStore.getState().setView('splot'));
      const visibleBar = [...container.querySelectorAll('[role="progressbar"]')].some(
        (el) => !el.closest('[hidden]'),
      );
      const dot = screen
        .getByRole('button', { name: /^Optimize band/ })
        .querySelector('.badge-dot');
      expect(visibleBar || dot !== null).toBe(true);
    });
  }
});
