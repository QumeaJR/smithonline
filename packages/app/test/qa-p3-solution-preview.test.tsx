// @vitest-environment jsdom
/**
 * QA round on redesign phase 3: tap to preview in SolutionList on a coarse
 * pointer when the list changes under a previewed row (another topology or
 * Q in Add parts). The component drops its selection when the tapped
 * solution is no longer in the list; the preview it asked the chart to show
 * has to go with it, as it does on a fine pointer when the pointer leaves
 * the list. it.fails marks a finding.
 */
import { complex, type MatchSolution } from '@smithonline/core';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { SolutionList } from '../src/components/SolutionList';

beforeAll(() => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('coarse'),
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
  }));
});

afterEach(() => cleanup());

const solution = (value: number, q: number): MatchSolution => ({
  elements: [{ kind: 'C', orientation: 'series', value }],
  description: `Series C ${value}`,
  q,
  result: complex(50, 0),
});

describe('SolutionList on a coarse pointer: the list changes under a previewed row', () => {
  it('the tapped row keeps its selection and preview while the same solution is listed', () => {
    const onPreview = vi.fn();
    const a = solution(1e-12, 1);
    const b = solution(2e-12, 2);
    const { rerender } = render(
      <SolutionList solutions={[a, b]} empty="none" onPreview={onPreview} onApply={vi.fn()} />,
    );
    fireEvent.click(screen.getAllByRole('button', { pressed: false })[1] as HTMLElement);
    expect(onPreview).toHaveBeenLastCalledWith(b);
    // Same objects, another order: the selection follows the solution.
    rerender(
      <SolutionList solutions={[b, a]} empty="none" onPreview={onPreview} onApply={vi.fn()} />,
    );
    expect(screen.getAllByRole('button', { pressed: true })).toHaveLength(1);
    expect(screen.getByRole('button', { name: /^Add / })).toBeTruthy();
  });

  it('a new list without the tapped solution drops its chart preview too', () => {
    const onPreview = vi.fn();
    const a = solution(1e-12, 1);
    const { rerender } = render(
      <SolutionList solutions={[a]} empty="none" onPreview={onPreview} onApply={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole('button', { pressed: false }));
    expect(onPreview).toHaveBeenLastCalledWith(a);
    // Another topology: new solutions; no row is selected any more and Add is gone.
    rerender(
      <SolutionList
        solutions={[solution(3e-12, 3)]}
        empty="none"
        onPreview={onPreview}
        onApply={vi.fn()}
      />,
    );
    expect(screen.queryByRole('button', { pressed: true })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Add / })).toBeNull();
    // ...but the chart still previews the old solution unless the preview is cleared.
    expect(onPreview).toHaveBeenLastCalledWith(null);
  });
});
