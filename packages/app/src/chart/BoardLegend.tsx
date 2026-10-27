import type { MeasuredBoardTrace } from './SmithChart';

/**
 * The measured board's entries of the chart legend (phase D6): measured, designed, and the
 * fitted and after-retune curves when they are drawn, in the palette the Response view uses.
 */
export function BoardLegendEntries({ trace }: { readonly trace: MeasuredBoardTrace }) {
  return (
    <>
      <span
        className="entry"
        title="The measured board: Zin as measured, a dot per measured frequency (hover for its readout), start, stop and f marked"
      >
        <span className="sw board-measured" />
        Measured board
      </span>
      <span
        className="entry"
        title="The network as built, as designed, at the measured frequencies"
      >
        <span className="sw board-designed" />
        Designed
      </span>
      {trace.fitted && (
        <span className="entry" title="The network as built with the fitted drifts">
          <span className="sw board-fitted" />
          Fitted
        </span>
      )}
      {trace.after && (
        <span
          className="entry"
          title="What the reworked board should measure after the suggested retune (the fitted drifts kept)"
        >
          <span className="sw board-after" />
          After retune
        </span>
      )}
    </>
  );
}
