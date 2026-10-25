import type { ReactNode } from 'react';
import { Button } from './Button';

export interface StaleNoteProps {
  /** What went stale, one short sentence. */
  readonly children: ReactNode;
  readonly onRun: () => void;
  /** The button's text; default "Run again". */
  readonly label?: string | undefined;
}

/**
 * A result that no longer matches the design (docs/07 section 4, Progress):
 * a note row with a quiet Run again button, in place of a sentence appended
 * to the result text.
 */
export function StaleNote({ children, onRun, label = 'Run again' }: StaleNoteProps) {
  return (
    <div className="row stale-note" role="status">
      <span className="stale-text">{children}</span>
      <Button variant="quiet" size="sm" className="stale-run" onClick={onRun}>
        {label}
      </Button>
    </div>
  );
}
