import type { MatchSolution } from '@smithonline/core';
import { useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { elementName, elementSummary } from '../lib/elements';
import { fmtNum } from '../lib/format';
import { useCoarsePointer } from '../lib/pointer';
import { PreviewedContext } from '../lib/previewed';
import { Button } from './ui/Button';

interface SolutionListProps {
  readonly solutions: readonly MatchSolution[];
  /** Text shown when there is nothing to list. */
  readonly empty: string;
  /** The text of each row; default the parts with their values. */
  readonly titles?: readonly string[] | undefined;
  /** The figure shown at the right of each row; default the loaded Q. */
  readonly labels?: readonly string[] | undefined;
  /** A second, smaller line under each row's title (yield, dominant part); none by default. */
  readonly notes?: readonly string[] | undefined;
  /** The solution previewed on the chart (hovered, or tapped on a touch screen); null when none. */
  readonly onPreview: (solution: MatchSolution | null) => void;
  readonly onApply: (solution: MatchSolution) => void;
  /**
   * The solution the chart previews now, where the parent knows it. A preview
   * that ends elsewhere (an armed part, Escape, its Cancel) clears the tapped
   * row together with the ghost.
   */
  readonly previewed?: MatchSolution | null | undefined;
}

/**
 * What a solution is, independent of the object that carries it: its parts
 * with their values, its Q and where it starts. A list rebuilt with the same
 * solutions (a parent that re-renders, a new target object of the same value)
 * gives the same signatures.
 */
function solutionSignature(sol: MatchSolution): string {
  return JSON.stringify([sol.elements, sol.q, sol.from ?? null, sol.description]);
}

/** The row a tap selected: where it was and what it showed. */
interface Picked {
  readonly index: number;
  readonly signature: string;
}

/** The row of `solutions` that shows the picked solution: its own index first, else the first match. */
function pickedRow(solutions: readonly MatchSolution[], picked: Picked | null): number {
  if (!picked) return -1;
  const at = solutions[picked.index];
  if (at && solutionSignature(at) === picked.signature) return picked.index;
  return solutions.findIndex((s) => solutionSignature(s) === picked.signature);
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
  notes,
  onPreview,
  onApply,
  previewed: previewedProp,
}: SolutionListProps) {
  const fromContext = useContext(PreviewedContext);
  const previewed = previewedProp !== undefined ? previewedProp : fromContext;
  const coarse = useCoarsePointer();
  const [hover, setHover] = useState<number | null>(null);
  // The tapped row, kept by its index and what it shows: a list rebuilt with the same solutions
  // keeps it, a new list without it (another Q, another target) drops it.
  const [picked, setPicked] = useState<Picked | null>(null);
  const selected = pickedRow(solutions, picked);
  // The tapped solution left the list: the selection goes (adjusted while rendering), and so
  // does its preview on the chart (after the render, counted so each drop clears it once).
  const [drops, setDrops] = useState(0);
  if (picked !== null && selected < 0) {
    setPicked(null);
    setDrops(drops + 1);
  }
  // The chart's preview ended elsewhere: the tapped row goes with the ghost (adjusted while
  // rendering, on the change from a preview to none).
  const [seen, setSeen] = useState(previewed);
  if (previewed !== seen) {
    setSeen(previewed);
    if (previewed === null && seen !== null && seen !== undefined && picked !== null) {
      setPicked(null);
    }
  }
  const preview = useRef(onPreview);
  useEffect(() => {
    preview.current = onPreview;
  });
  useEffect(() => {
    if (drops > 0) preview.current(null);
  }, [drops]);
  // The selected row and its Add button stay in view: revealed at once, and again each time
  // the sheet around them settles (the end of its height transition), since a preview moves
  // the phone's sheet to a lower detent after the tap.
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (selected < 0) return;
    const list = listRef.current;
    const reveal = (): void =>
      list?.querySelector<HTMLElement>('.solution-row.sel')?.scrollIntoView?.({ block: 'nearest' });
    reveal();
    const sheet = list?.closest<HTMLElement>('.panel-sheet, .sheet') ?? null;
    const onSettled = (e: Event): void => {
      if (e.target === sheet) reveal();
    };
    sheet?.addEventListener('transitionend', onSettled);
    // Where no transition runs (reduced motion, a sheet that did not move), once after --dur-slow.
    const timer = setTimeout(reveal, 320);
    return () => {
      clearTimeout(timer);
      sheet?.removeEventListener('transitionend', onSettled);
    };
  }, [selected]);
  const enter = (i: number): void => {
    setHover(i);
    onPreview(solutions[i] ?? null);
  };
  const leave = (): void => {
    setHover(null);
    onPreview(null);
  };
  const title = (sol: MatchSolution, i: number): ReactNode => (
    <>
      {titles?.[i] ??
        sol.elements.map((el, j) => (
          <span key={j}>
            {j > 0 ? ' + ' : ''}
            {elementName(el)} {elementSummary(el)}
          </span>
        ))}
      {notes?.[i] ? <span className="solution-note">{notes[i]}</span> : null}
    </>
  );
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
      <div className="solutions touch" role="list" ref={listRef}>
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
                setPicked({ index: i, signature: solutionSignature(sol) });
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
