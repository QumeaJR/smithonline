// @vitest-environment jsdom
/**
 * QA, redesign phase 4: the phone's datapoint column chooser (docs/07
 * section 4, Tables: #, Z, VSWR, RL by default, |Γ|, ∠Γ and Q chosen, stored
 * beside the chart options): the default, table order whatever the click
 * order, and the choice kept across a layout change, a new design and a
 * loaded design.
 */
import { evaluateLadder } from '@smithonline/core';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { RightPanel } from '../src/components/RightPanel';
import { emptyDesign } from '../src/lib/design';
import { ladderOf } from '../src/lib/files';
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
});
afterEach(() => {
  cleanup();
  vi.stubGlobal('innerWidth', 1024);
});

function setWidth(width: number): void {
  vi.stubGlobal('innerWidth', width);
  window.dispatchEvent(new Event('resize'));
}

function Panel() {
  const design = useDesignStore((s) => s.design);
  return <RightPanel result={evaluateLadder(ladderOf(design))} sweep={null} realized={null} />;
}

const headers = (): string[] =>
  [...document.querySelectorAll('.dp-table thead th')].map((th) => th.textContent ?? '');

describe('column chooser', () => {
  it('the store starts with no extra column and the chooser buttons unpressed', () => {
    expect(useDesignStore.getState().datapointColumns).toEqual([]);
    setWidth(390);
    render(<Panel />);
    expect(headers()).toEqual(['#', 'Z (Ω)', 'VSWR', 'RL (dB)']);
    for (const name of ['|Γ|', '∠Γ', 'Q']) {
      expect(
        screen
          .getByRole('button', { name: `Show the ${name} column` })
          .getAttribute('aria-pressed'),
      ).toBe('false');
    }
  });

  it('table order whatever the click order: Q, then ∠Γ, then |Γ|', async () => {
    setWidth(390);
    const user = userEvent.setup();
    render(<Panel />);
    await user.click(screen.getByRole('button', { name: 'Show the Q column' }));
    await user.click(screen.getByRole('button', { name: 'Show the ∠Γ column' }));
    await user.click(screen.getByRole('button', { name: 'Show the |Γ| column' }));
    expect(useDesignStore.getState().datapointColumns).toEqual(['gammaMag', 'gammaAngle', 'q']);
    expect(headers()).toEqual(['#', 'Z (Ω)', '|Γ|', '∠Γ', 'VSWR', 'RL (dB)', 'Q']);
  });

  it('the choice survives the tablet and back, a new design and a loaded design', () => {
    act(() => useDesignStore.getState().setDatapointColumns(['gammaAngle']));
    setWidth(390);
    render(<Panel />);
    expect(headers()).toEqual(['#', 'Z (Ω)', '∠Γ', 'VSWR', 'RL (dB)']);
    act(() => setWidth(768));
    expect(headers()).toEqual(['#', 'Z (Ω)', '|Γ|', '∠Γ', 'VSWR', 'RL (dB)', 'Q']);
    act(() => setWidth(390));
    expect(headers()).toEqual(['#', 'Z (Ω)', '∠Γ', 'VSWR', 'RL (dB)']);
    act(() => useDesignStore.getState().newDesign());
    act(() => useDesignStore.getState().loadDesign({ ...emptyDesign(), name: 'Loaded' }));
    expect(useDesignStore.getState().datapointColumns).toEqual(['gammaAngle']);
    expect(headers()).toEqual(['#', 'Z (Ω)', '∠Γ', 'VSWR', 'RL (dB)']);
  });
});
