import { useEffect } from 'react';
import { TOURS } from '../lib/tours';
import { useDesignStore } from '../store/useDesignStore';
import { useTourStore } from '../store/useTourStore';

/** The running tour's narration with Back and Next, at the top of the left column. */
export function TourPanel() {
  const tour = useTourStore((s) => s.tour);
  const step = useTourStore((s) => s.step);
  const base = useTourStore((s) => s.base);
  const design = useDesignStore((s) => s.design);
  const historyLength = useDesignStore((s) => s.past.length);
  const { next, back, close } = useTourStore.getState();

  // Undoing past the start of the tour ends it: there is nothing left to narrate.
  useEffect(() => {
    if (tour && historyLength < base) close();
  }, [tour, historyLength, base, close]);

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
        <button className="btn tiny" onClick={close} aria-label="Close tour" title="Close the tour">
          &#215;
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

interface TourMenuItemsProps {
  /** Called after a tour was started, so the caller can close its menu. */
  readonly onStart: () => void;
}

/** The tour entries of the Examples menu. */
export function TourMenuItems({ onStart }: TourMenuItemsProps) {
  const { start } = useTourStore.getState();
  return (
    <>
      <div className="dropdown-note section">Guided tours</div>
      {TOURS.map((t) => (
        <button
          key={t.id}
          role="menuitem"
          onClick={() => {
            start(t.id);
            onStart();
          }}
        >
          <strong>{t.title}</strong>
          <span>{t.blurb}</span>
        </button>
      ))}
      <div className="dropdown-note section">Smith V4.1 examples</div>
    </>
  );
}
