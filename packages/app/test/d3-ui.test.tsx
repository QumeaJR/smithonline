// @vitest-environment jsdom
/**
 * D3 in the UI: the Tolerance panel shows the spread ranking, the
 * correlation fields and design centring; the ladder cards show each part's
 * share while the panel is open; Auto match lists each solution's yield and
 * dominant part and switches its ranking.
 */
import { complex, evaluateLadder, lMatch } from '@smithonline/core';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AutoMatch } from '../src/components/AutoMatch';
import { Ladder } from '../src/components/Ladder';
import { MonteCarloPanel } from '../src/components/MonteCarloPanel';
import { emptyDesign, identify, type Design } from '../src/lib/design';
import { DEFAULT_TOLERANCE } from '../src/lib/tolerance';
import { useDesignStore } from '../src/store/useDesignStore';

const noop = (): void => undefined;
const sols = lMatch(complex(100, -50), complex(50, 0), 1e9);
const shuntL = sols.find((s) => s.description === 'shunt L + series C');

function referenceDesign(elements: Design['elements']): Design {
  return {
    ...emptyDesign(),
    frequency: 1e9,
    load: complex(100, -50),
    elements,
    sweep: { enabled: true, start: 0.9e9, stop: 1.1e9, points: 11 },
    tolerance: { ...DEFAULT_TOLERANCE, vswrLimit: 1.38, overBand: true },
  };
}

beforeEach(() => {
  useDesignStore.setState({
    design: referenceDesign(identify(shuntL?.elements ?? [])),
    past: [],
    future: [],
  });
});
afterEach(cleanup);

describe('Tolerance panel', () => {
  it('shows the spread by part with the dominant part and the centring button', () => {
    render(<MonteCarloPanel />);
    expect(screen.getByText('Which part matters most')).toBeTruthy();
    expect(screen.getByText(/contributes \d+ % of the spread\./)).toBeTruthy();
    const table = document.querySelector('.mc-ranking') as HTMLTableElement;
    expect(table.querySelectorAll('tbody tr')).toHaveLength(2);
    expect(table.textContent).toContain('Shunt L 1');
    expect(table.textContent).toContain('Series C 2');
    expect(screen.getByRole('button', { name: 'Centre for yield' })).toBeTruthy();
    expect(screen.getByLabelText('Correlation of the L parts')).toBeTruthy();
  });

  it('stores a correlation typed per kind', () => {
    render(<MonteCarloPanel />);
    const box = screen.getByLabelText('Correlation of the C parts') as HTMLInputElement;
    fireEvent.change(box, { target: { value: '0.6' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(useDesignStore.getState().design.tolerance?.correlation).toEqual({ C: 0.6 });
    // Correlated: the note says a negative share offsets the others.
    expect(screen.getByText(/a negative share offsets the others/)).toBeTruthy();
  });
});

describe('ladder cards', () => {
  const result = (): ReturnType<typeof evaluateLadder> => {
    const d = useDesignStore.getState().design;
    return evaluateLadder({ z0: d.z0, frequency: d.frequency, load: d.load, elements: d.elements });
  };

  it('show each part share while the Tolerance panel is open, and not otherwise', () => {
    const { container, rerender } = render(<Ladder result={result()} realization={null} />);
    expect(container.querySelectorAll('.spread-line')).toHaveLength(0);
    rerender(<Ladder result={result()} realization={null} showSpread />);
    const lines = [...container.querySelectorAll('.spread-line')];
    expect(lines).toHaveLength(2);
    const pct = lines.map((l) => Number(/(\d+) %/.exec(l.textContent ?? '')?.[1]));
    expect((pct[0] as number) + (pct[1] as number)).toBeGreaterThanOrEqual(99);
    expect((pct[0] as number) + (pct[1] as number)).toBeLessThanOrEqual(101);
  });
});

describe('Auto match ranking', () => {
  beforeEach(() => {
    useDesignStore.setState({ design: referenceDesign([]), past: [], future: [] });
  });

  it('lists each solution with its yield and dominant part, and ranks by yield on request', () => {
    render(<AutoMatch zin={complex(100, -50)} elements={[]} onPreview={noop} onClose={noop} />);
    const notes = [...document.querySelectorAll('.solution-note')].map((n) => n.textContent ?? '');
    expect(notes.length).toBe(2);
    for (const n of notes)
      expect(n).toMatch(/yield (about \d+|≥ 99|≤ 1) %, .+ dominates \(\d+ %\)/);
    expect(
      screen.getByText(
        'Ranked by loaded Q, lowest (widest bandwidth) first. Yields: 200 runs within VSWR 1.38, set in Tolerance.',
      ),
    ).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Rank the networks by'), { target: { value: 'yield' } });
    expect(screen.getByText(/^Ranked by estimated yield: 200 Monte Carlo runs/)).toBeTruthy();
    const rows = [
      ...document.querySelectorAll('.solutions [role="menuitem"], .solutions .solution-pick'),
    ];
    expect(rows[0]?.textContent).toContain('Shunt C');
    expect(rows[0]?.textContent).toContain('yield ≥ 99 %');
  });
});
