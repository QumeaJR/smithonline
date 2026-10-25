import type { ReactNode } from 'react';

export interface ProgressProps {
  /** Steps done so far. */
  readonly done: number;
  /** Steps in all; 0 while the job has not said yet, which shows a moving bar. */
  readonly total: number;
  /** The line under the bar: "done of total, best". */
  readonly label: ReactNode;
  /** Name of the bar for assistive technology, such as "Broadband search". */
  readonly ariaLabel: string;
  readonly className?: string | undefined;
}

/**
 * The progress of a worker job (optimizer, broadband search, Monte Carlo): a
 * 3 px bar with a label under it. Determinate once the job reports its total;
 * indeterminate while the total is still 0, the first moments of a run before
 * the first report (about 300 ms). Never a spinner over the chart.
 */
export function Progress({ done, total, label, ariaLabel, className }: ProgressProps) {
  return (
    <div className={`progress${className ? ` ${className}` : ''}`}>
      <ProgressTrack done={done} total={total} ariaLabel={ariaLabel} />
      <div className="progress-label" aria-live="polite">
        {label}
      </div>
    </div>
  );
}

/**
 * The 3 px bar alone, for a place where the label sits elsewhere (the phone sheet's header,
 * where the bar runs along the top edge and the label takes the segment row at peek).
 */
export function ProgressTrack({
  done,
  total,
  ariaLabel,
  valueText,
  className,
}: {
  readonly done: number;
  readonly total: number;
  readonly ariaLabel: string;
  /** What the bar stands for in words, when the label is not next to it. */
  readonly valueText?: string | undefined;
  readonly className?: string | undefined;
}) {
  const determinate = total > 0 && Number.isFinite(total);
  const share = determinate ? Math.min(1, Math.max(0, done / total)) : 0;
  return (
    <div
      className={`progress-track${determinate ? '' : ' indeterminate'}${className ? ` ${className}` : ''}`}
      role="progressbar"
      aria-label={ariaLabel}
      aria-valuemin={0}
      {...(determinate
        ? { 'aria-valuemax': total, 'aria-valuenow': Math.min(done, total) }
        : { 'aria-busy': true })}
      {...(valueText ? { 'aria-valuetext': valueText } : {})}
    >
      <span
        className="progress-fill"
        style={determinate ? { width: `${(share * 100).toFixed(1)}%` } : undefined}
      />
    </div>
  );
}
