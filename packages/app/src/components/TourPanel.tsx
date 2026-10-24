import { TOURS } from '../lib/tours';
import { useDesignStore } from '../store/useDesignStore';
import { useTourStore } from '../store/useTourStore';
import { useEscapeLayer } from '../lib/overlay';
import { IconClose } from './ui/icons';

/** The running tour's narration with Back and Next, at the top of the left column. */
export function TourPanel() {
  const tour = useTourStore((s) => s.tour);
  const step = useTourStore((s) => s.step);
  // The narration quotes the VSWR limit of the bandwidth readout, so it follows it.
  useDesignStore((s) => s.response.vswrLimit);
  const design = useDesignStore((s) => s.design);
  const { next, back, close } = useTourStore.getState();
  // The tour is the bottom of the Escape stack: Escape closes it when nothing above is open.
  useEscapeLayer('tour', tour !== null, close);

  if (!tour) return null;
  const current = tour.steps[step];
  if (!current) return null;
  const last = step === tour.steps.length - 1;

  return (
    <section className="tour-panel" aria-label={`Guided tour: ${tour.title}`}>
      <div className="tour-head">
        <strong>{tour.title}</strong>
        <span className="muted small">
          step {step + 1} of {tour.steps.length}
        </span>
        <button
          type="button"
          className="btn icon sm"
          onClick={close}
          aria-label="Close tour"
          title="Close the tour"
        >
          <IconClose size={13} />
        </button>
      </div>
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
        {last ? (
          <button className="btn primary" onClick={close}>
            Done
          </button>
        ) : (
          <button className="btn primary" onClick={next}>
            Next
          </button>
        )}
        <span className="muted small">
          {TOURS.indexOf(tour) + 1} of {TOURS.length} tours
        </span>
      </div>
    </section>
  );
}
