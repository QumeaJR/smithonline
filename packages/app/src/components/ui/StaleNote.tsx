import { useRef, type ReactNode } from 'react';
import { focusPanelSoon } from '../../lib/focusPanel';
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
 * to the result text. It is the panel's only Run again while it shows; the note goes
 * when the run starts, and the focus moves to the panel's first control.
 */
export function StaleNote({ children, onRun, label = 'Run again' }: StaleNoteProps) {
  const row = useRef<HTMLDivElement>(null);
  return (
    <div className="row stale-note" role="status" ref={row}>
      <span className="stale-text">{children}</span>
      <Button
        variant="quiet"
        size="sm"
        className="stale-run"
        onClick={() => {
          const panel = row.current?.closest('.tool-panel, .pushed-tool, .pane-tool') ?? null;
          onRun();
          focusPanelSoon(panel);
        }}
      >
        {label}
      </Button>
    </div>
  );
}
