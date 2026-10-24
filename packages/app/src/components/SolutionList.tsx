import type { MatchSolution } from '@smithonline/core';
import { useState, type ReactNode } from 'react';
import { elementName, elementSummary } from '../lib/elements';
import { fmtNum } from '../lib/format';
import { useCoarsePointer } from '../lib/pointer';
import { Button } from './ui/Button';

interface SolutionListProps {
  readonly solutions: readonly MatchSolution[];
  /** Text shown when there is nothing to list. */
  readonly empty: string;
  /** The text of each row; default the parts with their values. */
  readonly titles?: readonly string[] | undefined;
  /** The figure shown at the right of each row; default the loaded Q. */
  readonly labels?: readonly string[] | undefined;
  /** The solution previewed on the chart (hovered, or tapped on a touch screen); null when none. */
  readonly onPreview: (solution: MatchSolution | null) => void;
  readonly onApply: (solution: MatchSolution) => void;
}

/**
 * Match solutions ranked as given. On a fine pointer hovering a row previews
 * it on the chart and a click applies it. On a coarse pointer, where there is
 * no hover, a tap previews and selects the row, an Add button appears on the
 * selected row, and a second tap on the same row adds it too.
 */
export function SolutionList({
  solutions,
  empty,
  titles,
  labels,
  onPreview,
  onApply,
}: SolutionListProps) {
  const coarse = useCoarsePointer();
  const [hover, setHover] = useState<number | null>(null);
  // The tapped solution itself: a new list (another Q, another target) drops the selection.
  const [picked, setPicked] = useState<MatchSolution | null>(null);
  const selected = picked ? solutions.indexOf(picked) : -1;
  const enter = (i: number): void => {
    setHover(i);
    onPreview(solutions[i] ?? null);
  };
  const leave = (): void => {
    setHover(null);
    onPreview(null);
  };
  const title = (sol: MatchSolution, i: number): ReactNode =>
    titles?.[i] ??
    sol.elements.map((el, j) => (
      <span key={j}>
        {j > 0 ? ' + ' : ''}
        {elementName(el)} {elementSummary(el)}
      </span>
    ));
  const label = (sol: MatchSolution, i: number): string => labels?.[i] ?? `Q ${fmtNum(sol.q, 2)}`;
  /** Plain text of a row, for the Add button's name. */
  const plain = (sol: MatchSolution, i: number): string =>
    titles?.[i] ?? sol.elements.map((el) => `${elementName(el)} ${elementSummary(el)}`).join(' + ');

  if (coarse) {
    const apply = (sol: MatchSolution): void => {
      setPicked(null);
      onPreview(null);
      onApply(sol);
    };
    return (
      <div className="solutions touch" role="list">
        {solutions.length === 0 && <div className="dropdown-note">{empty}</div>}
        {solutions.map((sol, i) => (
          <div key={i} role="listitem" className={`solution-row${selected === i ? ' sel' : ''}`}>
            <button
              type="button"
              className="solution-pick"
              aria-pressed={selected === i}
              onClick={() => {
                if (selected === i) {
                  apply(sol);
                  return;
                }
                setPicked(sol);
                onPreview(sol);
              }}
            >
              <span>{title(sol, i)}</span>
              <span className="mono">{label(sol, i)}</span>
            </button>
            {selected === i && (
              <Button
                variant="primary"
                size="sm"
                className="solution-add"
                aria-label={`Add ${plain(sol, i)}`}
                onClick={() => apply(sol)}
              >
                Add
              </Button>
            )}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="solutions" role="menu" onMouseLeave={leave}>
      {solutions.length === 0 && <div className="dropdown-note">{empty}</div>}
      {solutions.map((sol, i) => (
        <button
          key={i}
          role="menuitem"
          className={hover === i ? 'hover' : ''}
          onMouseEnter={() => enter(i)}
          onFocus={() => enter(i)}
          onClick={() => {
            leave();
            onApply(sol);
          }}
        >
          <span>{title(sol, i)}</span>
          <span className="mono">{label(sol, i)}</span>
        </button>
      ))}
    </div>
  );
}
