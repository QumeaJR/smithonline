import type { MatchSolution } from '@smithonline/core';
import { useState } from 'react';
import { elementName, elementSummary } from '../lib/elements';
import { fmtNum } from '../lib/format';

interface SolutionListProps {
  readonly solutions: readonly MatchSolution[];
  /** Text shown when there is nothing to list. */
  readonly empty: string;
  /** The figure shown at the right of each row; default the loaded Q. */
  readonly labels?: readonly string[] | undefined;
  /** The solution under the pointer, previewed on the chart; null when none. */
  readonly onPreview: (solution: MatchSolution | null) => void;
  readonly onApply: (solution: MatchSolution) => void;
}

/** Match solutions ranked as given, with hover preview and click to apply. */
export function SolutionList({ solutions, empty, labels, onPreview, onApply }: SolutionListProps) {
  const [hover, setHover] = useState<number | null>(null);
  const enter = (i: number): void => {
    setHover(i);
    onPreview(solutions[i] ?? null);
  };
  const leave = (): void => {
    setHover(null);
    onPreview(null);
  };
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
          <span>
            {sol.elements.map((el, j) => (
              <span key={j}>
                {j > 0 ? ' + ' : ''}
                {elementName(el)} {elementSummary(el)}
              </span>
            ))}
          </span>
          <span className="mono">{labels?.[i] ?? `Q ${fmtNum(sol.q, 2)}`}</span>
        </button>
      ))}
    </div>
  );
}
