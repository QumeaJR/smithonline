// @vitest-environment jsdom
/**
 * Phase 4: the start guide replaces the "Start a match" hint that covered the
 * chart. A card at the head of the ladder, above the load card, with three
 * steps that tick off; its close button is remembered in localStorage and
 * Help brings it back.
 */
import { complex } from '@smithonline/core';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { StartGuide } from '../src/components/StartGuide';
import { emptyDesign } from '../src/lib/design';
import { startSteps } from '../src/lib/startGuide';
import { useDesignStore } from '../src/store/useDesignStore';
import { useHelp } from '../src/store/useHelp';
import { readGuideClosed, useShell } from '../src/store/useShell';
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
beforeEach(() => {
  localStorage.clear();
  useShell.setState({ guideClosed: false });
  useTourStore.getState().close();
  useHelp.getState().closeHelp();
  useDesignStore.getState().init(emptyDesign());
  useDesignStore.getState().setMessage(null);
});
afterEach(() => {
  cleanup();
  vi.stubGlobal('innerWidth', 1024);
});

const step = (key: string): HTMLElement =>
  document.querySelector<HTMLElement>(`.start-steps li[data-step="${key}"]`) as HTMLElement;

describe('startSteps', () => {
  it('a new design has nothing done', () => {
    expect(startSteps(emptyDesign())).toEqual({ load: false, target: false, match: false });
  });

  it('the load counts once it differs from Z0 + j0 or a datapoint was added', () => {
    expect(startSteps({ ...emptyDesign(), load: complex(50, -10) }).load).toBe(true);
    expect(startSteps({ ...emptyDesign(), load: complex(25, 0) }).load).toBe(true);
    // Z0 changed with the load: still the default load of that Z0.
    expect(startSteps({ ...emptyDesign({ z0: 75 }) }).load).toBe(false);
    const store = useDesignStore.getState();
    store.addDatapoint({ frequency: 2e9, z: complex(40, 5) });
    expect(startSteps(useDesignStore.getState().design).load).toBe(true);
  });

  it('the target counts once one is set, the match once the ladder has a part', () => {
    expect(startSteps({ ...emptyDesign(), target: complex(50, 0) }).target).toBe(true);
    expect(
      startSteps({
        ...emptyDesign(),
        elements: [{ kind: 'L', orientation: 'series', value: 1e-9, id: 'a', color: '#000' }],
      }).match,
    ).toBe(true);
  });
});

describe('StartGuide', () => {
  it('the steps tick off as the load, the target and a part are set', () => {
    render(<StartGuide onAutoMatch={() => undefined} />);
    expect(screen.getByRole('region', { name: 'Start guide' })).toBeTruthy();
    expect(step('load').className).toContain('open');
    expect(step('load').className).not.toContain('done');
    act(() => useDesignStore.getState().setLoad(complex(20, -12)));
    expect(step('load').className).toContain('done');
    expect(step('target').className).toContain('open');
    act(() => useDesignStore.getState().setTarget(complex(50, 10)));
    expect(step('target').className).toContain('done');
    expect(step('match').className).toContain('open');
    act(() =>
      useDesignStore.getState().addElement({ kind: 'C', orientation: 'shunt', value: 2e-12 }),
    );
    expect(step('match').className).toContain('done');
    expect(screen.getByText('3 of 3 done')).toBeTruthy();
  });

  it('each step has a button: the load and target buttons focus their fields, the third opens Auto match', async () => {
    const onAutoMatch = vi.fn();
    const user = userEvent.setup();
    render(
      <div>
        <StartGuide onAutoMatch={onAutoMatch} />
        <div className="card load">
          <input aria-label="Load resistance" />
        </div>
        <div className="card target">
          <input aria-label="Target resistance" />
        </div>
      </div>,
    );
    await user.click(screen.getByRole('button', { name: 'Go to the load fields' }));
    expect(document.activeElement).toBe(screen.getByLabelText('Load resistance'));
    await user.click(screen.getByRole('button', { name: 'Go to the target card' }));
    expect(document.activeElement).toBe(screen.getByLabelText('Target resistance'));
    await user.click(screen.getByRole('button', { name: 'Open Auto match' }));
    expect(onAutoMatch).toHaveBeenCalledOnce();
  });

  it('the close button hides it and the choice is remembered in localStorage', async () => {
    const user = userEvent.setup();
    render(<StartGuide onAutoMatch={() => undefined} />);
    await user.click(screen.getByRole('button', { name: 'Close the start guide' }));
    expect(screen.queryByRole('region', { name: 'Start guide' })).toBeNull();
    expect(localStorage.getItem('smithonline.startGuide')).toBe('closed');
    // A reload reads the choice back.
    expect(readGuideClosed()).toBe(true);
    act(() => useShell.getState().showGuide());
    expect(localStorage.getItem('smithonline.startGuide')).toBeNull();
    expect(screen.getByRole('region', { name: 'Start guide' })).toBeTruthy();
  });

  it('a storage that throws still lets the guide close for the session', async () => {
    const user = userEvent.setup();
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    render(<StartGuide onAutoMatch={() => undefined} />);
    await user.click(screen.getByRole('button', { name: 'Close the start guide' }));
    expect(screen.queryByRole('region', { name: 'Start guide' })).toBeNull();
    spy.mockRestore();
  });

  it('hides during a tour', () => {
    render(<StartGuide onAutoMatch={() => undefined} />);
    act(() => useTourStore.getState().start('l-network'));
    expect(screen.queryByRole('region', { name: 'Start guide' })).toBeNull();
  });
});

describe('start guide in the application', () => {
  it('sits at the head of the ladder above the load card, not over the chart', async () => {
    vi.stubGlobal('innerWidth', 1440);
    const { App } = await import('../src/App');
    const { container } = render(<App />);
    const guide = screen.getByRole('region', { name: 'Start guide' });
    expect(guide.nextElementSibling?.classList.contains('load')).toBe(true);
    expect(guide.closest('.ladder')).not.toBeNull();
    expect(container.querySelector('main .start-guide, main .start-hint')).toBeNull();
  });

  it('is the first Network card on the phone', async () => {
    vi.stubGlobal('innerWidth', 390);
    const { App } = await import('../src/App');
    render(<App />);
    const pane = document.querySelector('[data-pane="network"]') as HTMLElement;
    expect(pane.firstElementChild?.classList.contains('start-guide')).toBe(true);
  });

  it('Help shows "Show the start guide" once it was closed, and brings it back', async () => {
    vi.stubGlobal('innerWidth', 1440);
    const { App } = await import('../src/App');
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Close the start guide' }));
    act(() => useHelp.getState().openHelp());
    const dialog = screen.getByRole('dialog', { name: /Help/ });
    await user.click(within(dialog).getByRole('button', { name: 'Show the start guide' }));
    expect(screen.queryByRole('dialog', { name: /Help/ })).toBeNull();
    expect(screen.getByRole('region', { name: 'Start guide' })).toBeTruthy();
  });
});
