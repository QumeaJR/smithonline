import { useCoarsePointer } from '../lib/pointer';
import { fmtPlotFrequency, rangeText, type Range } from '../lib/plotZoom';
import { pointerHints } from '../lib/tips';

/**
 * "Zoomed to 2.30 to 2.55 GHz · Reset" (docs/10 section 4.2): shown while a
 * plot is zoomed, in the Response toolbar (the shared zoom) or in the head of
 * an S-Plot graph or the measured-board plot (their own zoom).
 */
export function ZoomChip({
  range,
  onReset,
  what = 'every plot',
}: {
  readonly range: Range;
  readonly onReset: () => void;
  /** What Reset shows whole again, for its tooltip. */
  readonly what?: string;
}) {
  const coarse = useCoarsePointer();
  const reset = coarse ? 'double tap the enlarged plot' : 'double-click a plot, or 0 on it';
  return (
    <span className="zoom-chip" role="status" title={pointerHints(coarse).plotZoom}>
      <span className="zoom-chip-range">Zoomed to {rangeText(range, fmtPlotFrequency)}</span> ·{' '}
      <button
        type="button"
        className="link-button"
        onClick={onReset}
        title={`Show the whole frequency range on ${what} again (or ${reset})`}
      >
        Reset
      </button>
    </span>
  );
}
