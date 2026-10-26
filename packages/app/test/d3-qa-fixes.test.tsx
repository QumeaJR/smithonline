// @vitest-environment jsdom
/**
 * D3 QA round in the app: the tolerance and correlation fields, the spread
 * table at a perfect match, the ranking sentence, the worst-case line, design
 * centring (stale results, the judging range, Apply writing only the listed
 * parts) and Auto match's yield wording.
 */
import {
  centreDesign,
  complex,
  lMatch,
  worstCorner,
  type CentreOptions,
  type Ladder,
} from '@smithonline/core';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MonteCarloPanel } from '../src/components/MonteCarloPanel';
import { CentreSection, CornerLine } from '../src/components/ToleranceDepth';
import { emptyDesign, identify, type Design } from '../src/lib/design';
import {
  fmtMatchYield,
  rankingExplanation,
  rankSolutions,
  type RankedSolution,
} from '../src/lib/matchRanking';
import {
  designSpread,
  matchYieldSetup,
  spreadSentence,
  toleranceSetup,
  type DesignSpread,
} from '../src/lib/sensitivity';
import { DEFAULT_TOLERANCE, monteCarloOptions } from '../src/lib/tolerance';
import { useDesignStore } from '../src/store/useDesignStore';
import { useMonteCarlo } from '../src/store/useMonteCarlo';

const LOAD = complex(100, -50);
const shuntL = lMatch(LOAD, complex(50, 0), 1e9).find(
  (s) => s.description === 'shunt L + series C',
);

function reference(over: Partial<Design> = {}): Design {
  return {
    ...emptyDesign(),
    frequency: 1e9,
    load: LOAD,
    elements: identify(shuntL?.elements ?? []),
    sweep: { enabled: true, start: 0.9e9, stop: 1.1e9, points: 11 },
    tolerance: { ...DEFAULT_TOLERANCE, vswrLimit: 1.38, overBand: true },
    ...over,
  };
}

/** A Web Worker that runs the centring request at once, as the real worker does. */
class CentreWorker {
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  postMessage(req: { ladder: Ladder; options: CentreOptions }): void {
    setTimeout(() => {
      const result = centreDesign(req.ladder, req.options);
      this.onmessage?.({ data: { type: 'result', result } } as MessageEvent);
    }, 0);
  }
  terminate(): void {}
}

beforeEach(() => {
  useDesignStore.setState({ design: reference(), past: [], future: [] });
});
afterEach(() => {
  cleanup();
  useMonteCarlo.getState().clear();
  vi.unstubAllGlobals();
});

describe('tolerance fields', () => {
  it('shows the default tolerance as an empty field with the series as placeholder; 0 is exact', () => {
    render(<MonteCarloPanel />);
    const box = screen.getByLabelText('Default tolerance in percent') as HTMLInputElement;
    expect(box.value).toBe('');
    expect(box.placeholder).toBe('E24: 5 %');
    fireEvent.change(box, { target: { value: '0' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(useDesignStore.getState().design.tolerance?.percent).toBe(0);
    expect(monteCarloOptions(useDesignStore.getState().design).tolerance).toBe(0);
    fireEvent.change(box, { target: { value: '' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(useDesignStore.getState().design.tolerance?.percent).toBeNull();
    // With Realize off the note says where the default comes from.
    expect(screen.getByText(/the series chosen in Realize, which is off/)).toBeTruthy();
  });

  it('refuses a correlation above 1 and names the field', () => {
    render(<MonteCarloPanel />);
    const box = screen.getByLabelText('Correlation of the C parts') as HTMLInputElement;
    fireEvent.change(box, { target: { value: '1.5' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(useDesignStore.getState().design.tolerance?.correlation).toBeUndefined();
    expect(useDesignStore.getState().message).toBe(
      'Reel correlation C: "1.5" is above the maximum 1',
    );
  });
});

describe('spread by part', () => {
  it('shows no slope at a perfect match', () => {
    useDesignStore.setState({ design: reference({ tolerance: { ...DEFAULT_TOLERANCE } }) });
    render(<MonteCarloPanel />);
    const cells = [...document.querySelectorAll('.mc-ranking tbody tr td:nth-child(3)')];
    expect(cells).toHaveLength(2);
    for (const c of cells) expect(c.textContent).toBe('0');
    expect(screen.getByText(/the shares use the mean square change of Γ/)).toBeTruthy();
  });

  it('says when the parts share the spread about equally', () => {
    const base = designSpread(reference()) as DesignSpread;
    const even: DesignSpread = {
      ...base,
      ranking: base.ranking.map((p, i) => ({ ...p, share: i === 0 ? 0.53 : 0.47 })),
    };
    expect(spreadSentence(even)).toBe('The two parts share the spread about equally');
    const uneven: DesignSpread = {
      ...base,
      ranking: base.ranking.map((p, i) => ({ ...p, share: i === 0 ? 0.7 : 0.3 })),
    };
    expect(spreadSentence(uneven)).toMatch(/contributes 70 % of the spread$/);
  });
});

describe('worst case line', () => {
  it('says when the nominal network is worse than every corner', () => {
    const ladder: Ladder = {
      z0: 50,
      frequency: 1e9,
      load: complex(50, 0),
      elements: [{ kind: 'line', z0: 100, length: 0.25 }],
    };
    const corner = worstCorner(ladder, { tolerance: 0.05, overrides: { 0: 0.05 } });
    render(<CornerLine corner={corner as NonNullable<typeof corner>} limit={2} />);
    const text = document.querySelector('.mc-corner')?.textContent ?? '';
    expect(text).toContain('Worst case: VSWR 4.000 at the nominal values');
    expect(text).toContain('so a corner is not a bound');
    expect(text).toContain('Line 1');
  });
});

describe('design centring', () => {
  it('marks "no better centre found" stale when the limit changes, with the range it judged', async () => {
    vi.stubGlobal('Worker', CentreWorker);
    const d = reference({ tolerance: { ...DEFAULT_TOLERANCE, vswrLimit: 5, overBand: true } });
    useDesignStore.setState({ design: d });
    const { rerender } = render(<CentreSection design={d} />);
    fireEvent.click(screen.getByRole('button', { name: 'Centre for yield' }));
    const found = await screen.findByText(/No better centre found/);
    expect(found.textContent).toContain('within VSWR 5 over the sweep range, 900 MHz to 1.1 GHz');
    expect(screen.queryByRole('button', { name: 'Apply' })).toBeNull();
    // The limit changes: the result is stale, under its note, and still names the old limit.
    const d2 = { ...d, tolerance: { ...(d.tolerance ?? DEFAULT_TOLERANCE), vswrLimit: 1.2 } };
    rerender(<CentreSection design={d2} />);
    expect(screen.getByText('The design has changed since this search.')).toBeTruthy();
    expect(document.querySelector('.centre-result.stale')?.textContent).toContain('within VSWR 5');
  });

  it('with Realize on, Apply writes only the parts it lists', async () => {
    vi.stubGlobal('Worker', CentreWorker);
    const d = reference({
      realize: { enabled: true, series: 'E24', stockText: '', scope: 'all' },
    });
    useDesignStore.setState({ design: d, past: [], future: [] });
    render(<CentreSection design={d} />);
    fireEvent.click(screen.getByRole('button', { name: 'Centre for yield' }));
    const apply = await screen.findByRole('button', { name: 'Apply' });
    const listed = [...document.querySelectorAll('.centre-changes li')].map(
      (li) => li.textContent ?? '',
    );
    expect(listed.length).toBeGreaterThan(0);
    expect(screen.getByText(/Nominal worst VSWR/)).toBeTruthy();
    await act(async () => {
      fireEvent.click(apply);
    });
    const after = useDesignStore.getState().design;
    after.elements.forEach((el, i) => {
      const before = d.elements[i] as (typeof d.elements)[number];
      const named = listed.some((t) =>
        t.startsWith(`${i === 0 ? 'Shunt L' : 'Series C'} ${i + 1}`),
      );
      if (!named) expect(el).toEqual(before);
    });
  });
});

describe('Auto match yield wording', () => {
  it('rounds to what 200 runs give', () => {
    expect(fmtMatchYield(200, 200)).toBe('≥ 99 %');
    expect(fmtMatchYield(199, 200)).toBe('about 99 %');
    expect(fmtMatchYield(154, 200)).toBe('about 77 %');
    expect(fmtMatchYield(1, 200)).toBe('about 1 %');
    expect(fmtMatchYield(0, 200)).toBe('≤ 1 %');
  });

  it('explains a ranking where every row ties', () => {
    const d = reference({ elements: [], tolerance: { ...DEFAULT_TOLERANCE, vswrLimit: 50 } });
    const setup = matchYieldSetup(d);
    const ideal = lMatch(LOAD, complex(50, 0), 1e9);
    const rows: RankedSolution[] = rankSolutions(d, [], ideal, null, setup, 'yield');
    expect(rankingExplanation('yield', setup, false, rows)).toContain(
      'Every network passes 200 of 200 runs, so the order comes from the spread',
    );
    const vrows = rankSolutions(d, [], ideal, null, setup, 'vswr');
    expect(rankingExplanation('vswr', setup, false, vrows)).toContain('so the order comes from Q');
  });

  it('judges the yield with the loss model the Tolerance panel applies', () => {
    const load = complex(15, -40);
    const losses = { enabled: true, inductorQ: 10, capacitorQ: 200 };
    const d = reference({
      elements: [],
      load,
      losses,
      tolerance: { ...DEFAULT_TOLERANCE, vswrLimit: 1.5 },
    });
    const ideal = lMatch(load, complex(50, 0), 1e9);
    const rows = rankSolutions(d, [], ideal, null, matchYieldSetup(d), 'yield');
    for (const row of rows) {
      const applied = { ...d, elements: identify(row.solution.elements) };
      const ladder = toleranceSetup(applied).ladder;
      // The parts carry the default Q in the network judged.
      expect(ladder.elements.every((el) => (el as { q?: number }).q !== undefined)).toBe(true);
    }
  });
});
