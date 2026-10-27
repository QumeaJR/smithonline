import { LineSwatch } from './LineSwatch';
import type { MeasuredBoardTrace } from './SmithChart';

/** The measured board's curve styles, as the chart and the Response view draw them (index.css). */
const BOARD_STYLE = {
  measured: { color: 'var(--board-measured)', width: 1.8 },
  designed: { color: 'var(--board-designed)', width: 1.6, dash: [8, 4] },
  fitted: { color: 'var(--board-fitted)', width: 1.2 },
  after: { color: 'var(--board-after)', width: 1.8, dash: [6, 2, 1, 2] },
} as const;

/**
 * The measured board's entries of the chart legend (phase D6): measured, designed, and the
 * fitted and after-retune curves when they are drawn, each swatch drawn with the curve's own
 * stroke (designed a long dash, after retune a dash-dot), unlike Realized (short dashes).
 */
export function BoardLegendEntries({ trace }: { readonly trace: MeasuredBoardTrace }) {
  return (
    <>
      <span
        className="entry"
        title="The measured board: Zin as measured, a dot per measured frequency (hover or tap for its readout), start, stop and f marked"
      >
        <LineSwatch {...BOARD_STYLE.measured} dot />
        Measured board
      </span>
      <span
        className="entry"
        title="The network as built, as designed, at the measured frequencies (long dashes)"
      >
        <LineSwatch {...BOARD_STYLE.designed} />
        Designed
      </span>
      {trace.fitted && (
        <span className="entry" title="The network as built with the fitted drifts (thin)">
          <LineSwatch {...BOARD_STYLE.fitted} />
          Fitted
        </span>
      )}
      {trace.after && (
        <span
          className="entry"
          title="What the reworked board should measure after the suggested retune, the fitted drifts kept (dash-dot)"
        >
          <LineSwatch {...BOARD_STYLE.after} />
          After retune
        </span>
      )}
    </>
  );
}
