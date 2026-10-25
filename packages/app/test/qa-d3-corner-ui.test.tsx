// @vitest-environment jsdom
/**
 * QA (D3): the worst-case corner line names the parts of the network the run
 * analysed, also after the design has changed since the run.
 */
import { complex, lMatch, monteCarlo, worstCorner } from '@smithonline/core';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { MonteCarloPanel } from '../src/components/MonteCarloPanel';
import { emptyDesign, identify, type Design } from '../src/lib/design';
import { toleranceSetup } from '../src/lib/sensitivity';
import { DEFAULT_TOLERANCE } from '../src/lib/tolerance';
import { useDesignStore } from '../src/store/useDesignStore';
import { useMonteCarlo } from '../src/store/useMonteCarlo';

afterEach(() => {
  cleanup();
  useMonteCarlo.getState().clear();
});

describe('qa: corner line after a design change', () => {
  it('keeps the names of the parts the run varied', () => {
    const sol = lMatch(complex(100, -50), complex(50, 0), 1e9).find(
      (s) => s.description === 'shunt L + series C',
    );
    const ran: Design = {
      ...emptyDesign(),
      frequency: 1e9,
      load: complex(100, -50),
      elements: identify(sol?.elements ?? []),
      tolerance: { ...DEFAULT_TOLERANCE, vswrLimit: 1.38 },
    };
    const setup = toleranceSetup(ran);
    const result = monteCarlo(setup.ladder, { ...setup.options, runs: 100 });
    const corner = worstCorner(setup.ladder, setup.options);
    useDesignStore.setState({ design: ran, past: [], future: [] });
    useMonteCarlo.getState().set(result, '', null, corner);
    // The user then removes the first part (Shunt L 1).
    useDesignStore.setState({ design: { ...ran, elements: ran.elements.slice(1) } });
    useMonteCarlo.getState().markStale(true);
    render(<MonteCarloPanel />);
    const line = document.querySelector('.mc-corner')?.textContent ?? '';
    expect(line).toContain('Shunt L 1');
    expect(line).toContain('Series C 2');
  });
});
