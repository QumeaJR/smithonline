import type { ReactNode } from 'react';
import { Button } from './Button';

export interface EmptyStateAction {
  readonly label: string;
  readonly onClick: () => void;
  /** Tooltip and accessible description of the action. */
  readonly title?: string | undefined;
}

export interface EmptyStateProps {
  /** What is missing, said as what to do: "Set a sweep range". */
  readonly title: string;
  /** One line on why or how. */
  readonly line: ReactNode;
  /** Up to three steps, shown as a numbered list. */
  readonly steps?: readonly ReactNode[] | undefined;
  /** One action that fixes it in place; a second one only where the spec names two. */
  readonly action?: EmptyStateAction | undefined;
  readonly secondary?: EmptyStateAction | undefined;
  readonly className?: string | undefined;
}

/**
 * An empty state (docs/07-interaction-redesign.md section 4): a title, one
 * line, up to three steps and one action, in place of the content that is
 * not there yet (the empty ladder, Response without a valid sweep, S-Plot
 * without files, Tolerance without parts, Optimize band without a band, the
 * datapoints table with only the load).
 */
export function EmptyState({ title, line, steps, action, secondary, className }: EmptyStateProps) {
  const shown = (steps ?? []).slice(0, 3);
  return (
    <div className={`empty-state${className ? ` ${className}` : ''}`} role="note">
      <strong className="empty-title">{title}</strong>
      <p className="empty-line">{line}</p>
      {shown.length > 0 && (
        <ol className="empty-steps">
          {shown.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ol>
      )}
      {(action || secondary) && (
        <div className="empty-actions">
          {action && (
            <Button size="sm" variant="primary" onClick={action.onClick} title={action.title}>
              {action.label}
            </Button>
          )}
          {secondary && (
            <Button size="sm" onClick={secondary.onClick} title={secondary.title}>
              {secondary.label}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
