import { useState, type ReactNode } from 'react';
import { useDesignStore } from '../store/useDesignStore';
import { isWorkflow, useTourStore, workflowSteps } from '../store/useTourStore';
import { useShell } from '../store/useShell';
import { useEscapeLayer } from '../lib/overlay';
import { tourSnapshot } from '../lib/tourSnapshot';
import { tourUi } from '../lib/tourUi';
import { findAnchor } from '../lib/tourAnchor';
import { useTourEvents } from '../lib/tourEvents';
import {
  doItLabel,
  missingText,
  stepText,
  type Workflow,
  type WorkflowStep,
} from '../lib/workflowKit';
import { WORKFLOWS } from '../lib/workflows';
import type { Tour } from '../lib/tours';
import type { Design } from '../lib/design';
import { IconClose } from './ui/icons';

export interface TourPanelProps {
  /**
   * Where it shows: `panel` at the top of the left column (desktop) or the
   * side column (tablet), the whole narration with Back and Next; on the phone
   * `head` is the sheet header at peek (title, step, Next or the step's own
   * button) and `narration` the text at the top of the sheet from the half
   * detent up.
   */
  readonly mode?: 'panel' | 'head' | 'narration';
  /**
   * The phone's head shown above a sheet or a full-screen dialog (App.tsx): it keeps the step's
   * buttons at every detent, and the head in the sheet keeps the Escape layer.
   */
  readonly overlay?: boolean;
}

/**
 * The step's own button: its doIt, or with the anchor missing what brings the anchor up. A
 * step whose anchor is missing for a reason of its own (its missingText: no Apply to press)
 * has none, and a doIt that does not apply to the design (its `when`) is not offered.
 */
function stepAction(
  step: WorkflowStep,
  missing: boolean,
  design: Design,
): { label: string; run: () => void } | null {
  if (missing && step.missingText) return null;
  if (missing && (step.prepare || step.place)) {
    return {
      label: 'Show me',
      run: () => {
        if (step.place) tourUi.show(step.place);
        if (step.prepare) step.prepare(tourUi);
        else step.doIt?.run(tourUi);
      },
    };
  }
  if (!step.doIt || (step.doIt.when && !step.doIt.when(design))) return null;
  const { run } = step.doIt;
  const label = doItLabel(step, design);
  // A doIt that only opens the menu the anchor is in is not offered while that menu is open
  // (the phone's File sheet): it would do nothing and crowd the step's title.
  if (step.place === 'menu' && step.anchor && /^Open the /.test(label) && findAnchor(step.anchor)) {
    return null;
  }
  return { label, run: () => run(tourUi) };
}

/** Back in the overlay head: the step before, as the narration's Back. */
function backButton(back: () => void, step: number) {
  return (
    <button className="btn" onClick={back} disabled={step === 0}>
      Back
    </button>
  );
}

/**
 * The step's text in the phone's overlay head: one line, and More opens the rest (the head
 * then grows over what is below until Less).
 */
function OverlayText({ children }: { readonly children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`tour-overlay-text${open ? ' open' : ''}`} aria-live="polite">
      <div className="tour-overlay-body">{children}</div>
      <button
        type="button"
        className="btn quiet sm"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {open ? 'Less' : 'More'}
      </button>
    </div>
  );
}

/** The running tour's narration with Back and Next: a lesson, or a workflow. */
export function TourPanel({ mode = 'panel', overlay = false }: TourPanelProps) {
  const tour = useTourStore((s) => s.tour);
  const step = useTourStore((s) => s.step);
  const missing = useTourStore((s) => s.missing);
  const seen = useTourStore((s) => s.seen);
  const entryDesign = useTourStore((s) => s.entryDesign);
  // The step's predicate holds: it is done (it waits for Next when it held on show).
  const done = useTourStore((s) => s.done);
  const heldAtEntry = useTourStore((s) => s.heldAtEntry);
  const design = useDesignStore((s) => s.design);
  // A workflow's text can quote the last run (a yield, a limit): it follows the events.
  useTourEvents((s) => s.counts);
  // The sheet's head keeps the step's buttons up to the half detent, where the narration
  // below can sit out of sight; full height shows the narration with Back and Next.
  const headButtons = useShell((s) => s.detent !== 'full') || overlay;
  // A lesson's head keeps one Next at peek only, as before.
  const atPeek = useShell((s) => s.detent === 'peek') || overlay;
  const toolOpen = useShell((s) => s.tool !== null);
  const { next, back, end: close, finish } = useTourStore.getState();
  // The tour is the bottom of the Escape stack: Escape closes it when nothing above is open,
  // and takes its start message with it. The phone's narration leaves that to its header.
  useEscapeLayer('tour', tour !== null && mode !== 'narration' && !overlay, close);

  if (!tour) return null;
  const workflow = isWorkflow(tour) ? tour : null;
  const steps = workflow ? workflowSteps(workflow) : tour.steps;
  const count = steps.length;
  const last = step === count - 1;
  const kindName = workflow ? 'Workflow' : 'Lesson';
  const closeButton = (
    <button
      type="button"
      className="btn icon sm"
      onClick={close}
      aria-label={workflow ? 'Close workflow' : 'Close tour'}
      title={
        workflow
          ? 'End the workflow; Undo then brings back the design from before it'
          : 'Close the tour'
      }
    >
      <IconClose size={13} />
    </button>
  );

  if (workflow) {
    const current = steps[step] as WorkflowStep | undefined;
    if (!current) return null;
    const following = workflow.next ? WORKFLOWS.find((w) => w.id === workflow.next) : undefined;
    const chain = last && following && following.requires !== 'd6' && following.requires !== 'd7';
    // A step done by the user may take its anchor away (a menu item, Freeze): not "missing".
    const lost = missing && current.anchor !== undefined && !done;
    // A step that is done offers no doIt any more (its effect is there); Next goes on.
    const action = done && !lost ? null : stepAction(current, lost, design);
    const snapshot = tourSnapshot(seen, entryDesign ?? undefined);
    const text = stepText(current, design, snapshot);
    const nextButton = last ? (
      chain ? (
        <button className="btn primary" onClick={() => finish(true)}>
          Next: {(following as Workflow).short}
        </button>
      ) : (
        <button className="btn primary" onClick={() => finish(false)}>
          Done
        </button>
      )
    ) : (
      <button className="btn primary" onClick={next}>
        Next
      </button>
    );
    const actionButton = action && (
      <button className="btn" onClick={action.run}>
        {action.label}
      </button>
    );
    const counter = `${kindName} · step ${step + 1} of ${count}`;

    if (mode === 'head') {
      const head = (
        <div className="tour-peek" role="group" aria-label={`Guided workflow: ${workflow.title}`}>
          <span className="tour-peek-text">
            <strong>{current.title}</strong>
            <span className="muted small">{counter}</span>
          </span>
          {overlay && backButton(back, step)}
          {headButtons && actionButton}
          {headButtons && nextButton}
          {closeButton}
        </div>
      );
      // At peek, or with a tool open in the sheet, the narration is out of view: the head carries
      // the step's text too (one line, More for the rest), as the overlay head does (D6 QA).
      if (!overlay && !atPeek && !toolOpen) return head;
      if (!overlay)
        return (
          <>
            {head}
            <OverlayText key={step}>
              {lost && <p className="tour-missing">{missingText(current)}</p>}
              <p>{text}</p>
            </OverlayText>
          </>
        );
      // Above a sheet, a dialog or a menu the narration below is out of reach: the overlay head
      // carries the step's text (one line, More for the rest) and Back as well (QA round 3).
      return (
        <>
          {head}
          <OverlayText key={step}>
            {lost && <p className="tour-missing">{missingText(current)}</p>}
            <p>{text}</p>
          </OverlayText>
        </>
      );
    }

    const narration = (
      <>
        <h3>{current.title}</h3>
        <div className="tour-text" aria-live="polite">
          {lost && <p className="tour-missing">{missingText(current)}</p>}
          <p>{text}</p>
          {done && heldAtEntry && <p className="tour-done">Done already. Next goes on.</p>}
        </div>
        <div className="tour-nav">
          <button className="btn" onClick={back} disabled={step === 0}>
            Back
          </button>
          {actionButton}
          {nextButton}
          {last && chain && (
            <button className="btn quiet" onClick={() => finish(false)}>
              Done
            </button>
          )}
        </div>
      </>
    );

    if (mode === 'narration') {
      return (
        <section
          className="tour-panel tour-sheet workflow"
          aria-label={`Guided workflow: ${workflow.title}`}
        >
          {narration}
        </section>
      );
    }
    return (
      <section className="tour-panel workflow" aria-label={`Guided workflow: ${workflow.title}`}>
        <div className="tour-head">
          <strong>{workflow.title}</strong>
          <span className="muted small">{counter}</span>
          {closeButton}
        </div>
        {narration}
      </section>
    );
  }

  // Not a workflow: a lesson.
  const current = (tour as Tour).steps[step];
  if (!current) return null;
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
    const head = (
      <div className="tour-peek" role="group" aria-label={`Guided tour: ${tour.title}`}>
        <span className="tour-peek-text">
          <strong>{tour.title}</strong>
          <span className="muted small">
            step {step + 1} of {count}: {current.title}
          </span>
        </span>
        {overlay && backButton(back, step)}
        {atPeek && nextButton}
        {closeButton}
      </div>
    );
    if (!overlay) return head;
    return (
      <>
        {head}
        <OverlayText key={step}>
          {current.narrate(design).map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </OverlayText>
      </>
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
          {kindName} · step {step + 1} of {count}
        </span>
        {closeButton}
      </div>
      {narration}
    </section>
  );
}
