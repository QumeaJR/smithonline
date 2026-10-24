// @vitest-environment jsdom
/**
 * Phase 4: on the phone the datapoints table shows #, Z, VSWR and RL by
 * default, with a column chooser for |Γ|, ∠Γ and Q stored beside the chart
 * options in the store; a tablet or wider shows every column.
 */
import { evaluateLadder } from '@smithonline/core';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { RightPanel } from '../src/components/RightPanel';
import { datapointColumnsShown } from '../src/lib/datapointColumns';
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
beforeEach(() => {
  useDesignStore.getState().init(emptyDesign());
  useDesignStore.getState().setDatapointColumns([]);
});
afterEach(() => {
  cleanup();
  vi.stubGlobal('innerWidth', 1024);
});

function panel() {
  const result = evaluateLadder(ladderOf(useDesignStore.getState().design));
  return <RightPanel result={result} sweep={null} realized={null} />;
}

const headers = (): string[] =>
  [...document.querySelectorAll('.dp-table thead th')].map((th) => th.textContent ?? '');

describe('datapointColumnsShown', () => {
  it('a phone shows the chosen extras only, wider layouts all of them', () => {
    expect([...datapointColumnsShown(true, [])]).toEqual([]);
    expect([...datapointColumnsShown(true, ['q'])]).toEqual(['q']);
    expect([...datapointColumnsShown(false, [])]).toEqual(['gammaMag', 'gammaAngle', 'q']);
  });
});

describe('the datapoints table', () => {
  it('390 px: #, Z, VSWR and RL, and the chooser adds |Γ|, ∠Γ and Q in table order', async () => {
    vi.stubGlobal('innerWidth', 390);
    const user = userEvent.setup();
    render(panel());
    expect(headers()).toEqual(['#', 'Z (Ω)', 'VSWR', 'RL']);
    await user.click(screen.getByRole('button', { name: 'Show the Q column' }));
    expect(headers()).toEqual(['#', 'Z (Ω)', 'VSWR', 'RL', 'Q']);
    await user.click(screen.getByRole('button', { name: 'Show the |Γ| column' }));
    expect(headers()).toEqual(['#', 'Z (Ω)', '|Γ|', 'VSWR', 'RL', 'Q']);
    expect(useDesignStore.getState().datapointColumns).toEqual(['gammaMag', 'q']);
    const q = screen.getByRole('button', { name: 'Show the Q column' });
    expect(q.getAttribute('aria-pressed')).toBe('true');
    await user.click(q);
    expect(useDesignStore.getState().datapointColumns).toEqual(['gammaMag']);
    // Every row has as many cells as the header.
    for (const row of document.querySelectorAll('.dp-table tbody tr')) {
      expect(row.children).toHaveLength(headers().length);
    }
  });

  it('768 px and wider: every column, no chooser', () => {
    vi.stubGlobal('innerWidth', 768);
    useDesignStore.getState().setDatapointColumns(['q']);
    render(panel());
    expect(headers()).toEqual(['#', 'Z (Ω)', '|Γ|', '∠Γ', 'VSWR', 'RL', 'Q']);
    expect(screen.queryByRole('group', { name: 'More datapoint columns' })).toBeNull();
  });
});
