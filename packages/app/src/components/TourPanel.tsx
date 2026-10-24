import { TOURS } from '../lib/tours';
import { useDesignStore } from '../store/useDesignStore';
import { useTourStore } from '../store/useTourStore';
import { useEscapeLayer } from '../lib/overlay';
import { IconClose } from './ui/icons';

export interface TourPanelProps {
  /**
   * Where it shows: `panel` at the top of the left column (desktop) or the
   * side column (tablet), the whole narration with Back and Next; on the phone
   * `head` is the sheet header at peek (title, step, Next) and `narration` the
   * text at the top of the sheet from the half detent up.
   */
  readonly mode?: 'panel' | 'head' | 'narration';
}

/** The running tour's narration with Back and Next. */
export function TourPanel({ mode = 'panel' }: TourPanelProps) {
  const tour = useTourStore((s) => s.tour);
  const step = useTourStore((s) => s.step);
  // The narration quotes the VSWR limit of the bandwidth readout, so it follows it.
  useDesignStore((s) => s.response.vswrLimit);
  const design = useDesignStore((s) => s.design);
  const { next, back, end: close } = useTourStore.getState();
  // The tour is the bottom of the Escape stack: Escape closes it when nothing above is open,
  // and takes its start message with it. The phone's narration leaves that to its header.
  useEscapeLayer('tour', tour !== null && mode !== 'narration', close);

  if (!tour) return null;
  const current = tour.steps[step];
  if (!current) return null;
  const last = step === tour.steps.length - 1;
  const closeButton = (
    <button
      type="button"
      className="btn icon sm"
      onClick={close}
      aria-label="Close tour"
      title="Close the tour"
    >
      <IconClose size={13} />
    </button>
  );
  const nextButton = last ? (
    <button className="btn primary" onClick={close}>
      Done
    </button>
  ) : (
    <button className="btn primary" onClick={next}>
      Next
    </button>
  );

  if (mode === 'head') {
    return (
      <div className="tour-peek" role="group" aria-label={`Guided tour: ${tour.title}`}>
        <span className="tour-peek-text">
          <strong>{tour.title}</strong>
          <span className="muted small">
            step {step + 1} of {tour.steps.length}: {current.title}
          </span>
        </span>
        {nextButton}
        {closeButton}
      </div>
    );
  }

  const narration = (
    <>
      <h3>{current.title}</h3>
      <div className="tour-text" aria-live="polite">
        {current.narrate(design).map((p, i) => (
          <p key={i}>{p}</p>
        ))}
      </div>
      <div className="tour-nav">
        <button className="btn" onClick={back} disabled={step === 0}>
          Back
        </button>
        {nextButton}
        <span className="muted small">
          {TOURS.indexOf(tour) + 1} of {TOURS.length} tours
        </span>
      </div>
    </>
  );

  if (mode === 'narration') {
    return (
      <section className="tour-panel tour-sheet" aria-label={`Guided tour: ${tour.title}`}>
        {narration}
      </section>
    );
  }

  return (
    <section className="tour-panel" aria-label={`Guided tour: ${tour.title}`}>
      <div className="tour-head">
        <strong>{tour.title}</strong>
        <span className="muted small">
          step {step + 1} of {tour.steps.length}
        </span>
        {closeButton}
      </div>
      {narration}
    </section>
  );
}
