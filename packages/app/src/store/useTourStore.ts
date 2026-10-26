import { create } from 'zustand';
import type { Design } from '../lib/design';
import { TOURS, type Tour } from '../lib/tours';
import { tourUi } from '../lib/tourUi';
import { tourSnapshot, watchSnapshotStores } from '../lib/tourSnapshot';
import { useTourEvents, type TourEvent } from '../lib/tourEvents';
import {
  isShipped,
  markCompleted,
  readCompleted,
  shippedSteps,
  type Workflow,
  type WorkflowStep,
} from '../lib/workflowKit';
import { WORKFLOWS } from '../lib/workflows';
import { useDesignStore } from './useDesignStore';

/** How long a step waits after its predicate turns true before it moves on, ms. */
export const ADVANCE_DELAY_MS = 400;

export interface StartWorkflowOptions {
  /** Keep the user's design where the workflow can work on it (start guide, chip, Show me, chain). */
  readonly keep?: boolean;
  /** Start at this step id instead of the first (a tool's Show me). */
  readonly at?: string;
}

/**
 * The running guided tour: a lesson or a workflow (docs/09 section 3).
 *
 * A lesson records its start design as one history entry; Next and Back
 * then swap designs without history, so a single Undo takes the whole lesson
 * back out. A lesson ends when a tool opens (App.tsx), when another design
 * replaces this one, or when Undo brings back the design it started from.
 *
 * A workflow points at the real controls and lets the user work: their edits
 * are ordinary steps, and when the workflow ends they are folded into one, so
 * one Undo brings back the design from before it. It never ends because a
 * tool opened, the view changed or a value was edited; Escape, the close
 * button, Done or an Undo back past its start design end it.
 */
interface TourState {
  /** The running tour, or null. */
  readonly tour: Tour | Workflow | null;
  /** Index of the step on show. */
  readonly step: number;
  /** The design after each step shown so far, for Back (lessons). */
  readonly snapshots: readonly Design[];
  /** The design before the tour; when Undo brings it back, the tour is over. */
  readonly origin: Design | null;
  /** The load count of the design store when the tour last set the design; a change ends a lesson. */
  readonly loads: number;
  /** Workflows: a start design was loaded, so an Undo back to the origin ends it. */
  readonly loaded: boolean;
  /** Workflows: the event counts when the step came on show (a predicate counts from there). */
  readonly seen: Readonly<Partial<Record<TourEvent, number>>>;
  /** Workflows: the design when the step came on show. */
  readonly entryDesign: Design | null;
  /** Workflows: the step's predicate held when it came on show (it advances on a change to true). */
  readonly heldAtEntry: boolean;
  /** Workflows: the step's anchor is not on screen 300 ms after its prepare (the fallback shows). */
  readonly missing: boolean;
  /** The workflows completed in this browser. */
  readonly completed: ReadonlySet<string>;
  start: (id: string) => void;
  startWorkflow: (id: string, options?: StartWorkflowOptions) => void;
  next: () => void;
  back: () => void;
  close: () => void;
  /** Close it from its panel (Escape, the close button): its start message goes too. */
  end: () => void;
  /** The last step of a workflow: remember it as completed, end it, and start the next one. */
  finish: (chain: boolean) => void;
  setMissing: (missing: boolean) => void;
}

/** The message a tour starts with; it offers Undo, which brings the previous design back. */
const startMessage = (tour: Tour | Workflow): string =>
  tour.kind === 'workflow'
    ? `Workflow: ${tour.title}. Escape or the close button ends it; Undo then brings your previous design back.`
    : `Tour: ${tour.title}. Undo brings your previous design back.`;

/** The steps of a workflow that are on offer (the shipped ones). */
export function workflowSteps(w: Workflow): readonly WorkflowStep[] {
  return shippedSteps(w);
}

export function isWorkflow(t: Tour | Workflow | null | undefined): t is Workflow {
  return t !== null && t !== undefined && t.kind === 'workflow';
}

/**
 * Show `next` in place of the design the tour last put on screen, without a
 * history entry. When the user has changed the design since (an edit, an
 * import), that work is not the tour's to overwrite: the swap is recorded, so
 * Undo brings it back.
 */
function swap(current: Design, shown: Design | undefined, next: Design, label: string): void {
  const designs = useDesignStore.getState();
  ownChange(() => {
    if (shown === undefined || current === shown) designs.replaceDesign(next);
    else designs.loadDesign(next, label);
  });
}

/** The name of a tour step swapped in over the user's own edit, for its message and Undo. */
const stepLabel = (tour: Tour, step: number): string =>
  `Tour "${tour.title}", step ${step + 1} of ${tour.steps.length}`;

/** The step at which the user edited a design, by design identity, for Undo and Redo. */
const editedAt = new WeakMap<Design, number>();

/** True while the tour itself changes the design, so the watcher below ignores it. */
let touring = false;
function ownChange(fn: () => void): void {
  touring = true;
  try {
    fn();
  } finally {
    touring = false;
  }
}

/** True while a workflow step comes on show (its apply and prepare). */
let entering = false;

/** The pending automatic advance of a workflow step, if any. */
let advanceTimer: ReturnType<typeof setTimeout> | null = null;
function cancelAdvance(): void {
  if (advanceTimer !== null) clearTimeout(advanceTimer);
  advanceTimer = null;
}

/** Bring a workflow step on show: its design change, its place, its prepare, and what its predicate counts from. */
function enter(w: Workflow, index: number): Partial<TourState> {
  cancelAdvance();
  const step = workflowSteps(w)[index];
  // The step's own changes are not the user's doing: the watcher waits until it is on show.
  entering = true;
  try {
    if (step?.apply) {
      const designs = useDesignStore.getState();
      const next = step.apply(designs.design);
      if (next !== designs.design) designs.step(`${w.title}: ${step.title}`, () => next);
    }
    if (step?.place) tourUi.show(step.place);
    step?.prepare?.(tourUi);
  } finally {
    entering = false;
  }
  const seen = { ...useTourEvents.getState().counts };
  const entryDesign = useDesignStore.getState().design;
  const held =
    step !== undefined && typeof step.advance === 'function'
      ? step.advance(tourSnapshot(seen, entryDesign))
      : false;
  return { step: index, seen, entryDesign, heldAtEntry: held, missing: false };
}

const IDLE = {
  tour: null,
  step: 0,
  snapshots: [],
  origin: null,
  loads: 0,
  loaded: false,
  seen: {},
  entryDesign: null,
  heldAtEntry: false,
  missing: false,
} as const;

export const useTourStore = create<TourState>()((set, get) => ({
  ...IDLE,
  completed: readCompleted(),

  start: (id) => {
    const tour = TOURS.find((t) => t.id === id);
    if (!tour) return;
    if (isWorkflow(get().tour)) get().end();
    const designs = useDesignStore.getState();
    const origin = designs.design;
    const first = tour.start();
    designs.setView('chart');
    // The step is named for Undo and Redo, whichever step of the tour is on show then.
    ownChange(() => designs.loadDesign(first, `Started the tour "${tour.title}"`));
    designs.setMessage(startMessage(tour), { undo: true });
    set({
      ...IDLE,
      tour,
      snapshots: [useDesignStore.getState().design],
      origin,
      loads: useDesignStore.getState().loads,
      loaded: true,
    });
  },

  startWorkflow: (id, options = {}) => {
    const w = WORKFLOWS.find((x) => x.id === id);
    if (!w || !isShipped(w)) return;
    const running = get().tour;
    if (isWorkflow(running)) get().end();
    else if (running) get().close();
    const designs = useDesignStore.getState();
    const origin = designs.design;
    const first = w.start(origin, options.keep === true);
    if (first) {
      ownChange(() => designs.loadDesign(first, `Started the workflow "${w.title}"`));
      designs.setMessage(startMessage(w), { undo: true });
    } else {
      designs.setMessage(startMessage(w));
    }
    const steps = workflowSteps(w);
    const at = options.at
      ? Math.max(
          0,
          steps.findIndex((s) => s.id === options.at),
        )
      : 0;
    set({
      ...IDLE,
      tour: w,
      origin,
      loads: useDesignStore.getState().loads,
      loaded: first !== null,
    });
    set(enter(w, at));
  },

  next: () => {
    const { tour, step, snapshots } = get();
    if (isWorkflow(tour)) {
      if (step >= workflowSteps(tour).length - 1) return;
      set(enter(tour, step + 1));
      return;
    }
    if (!tour || step >= tour.steps.length - 1) return;
    const designs = useDesignStore.getState();
    const nextStep = tour.steps[step + 1];
    if (!nextStep) return;
    const design = nextStep.apply(designs.design);
    swap(designs.design, snapshots[step], design, stepLabel(tour, step + 1));
    set({
      step: step + 1,
      snapshots: [...snapshots.slice(0, step + 1), design],
      loads: useDesignStore.getState().loads,
    });
  },

  back: () => {
    const { tour, step, snapshots } = get();
    if (isWorkflow(tour)) {
      if (step <= 0) return;
      set(enter(tour, step - 1));
      return;
    }
    if (!tour || step <= 0) return;
    const previous = snapshots[step - 1];
    if (!previous) return;
    const current = useDesignStore.getState().design;
    swap(current, snapshots[step], previous, stepLabel(tour, step - 1));
    set({ step: step - 1, loads: useDesignStore.getState().loads });
  },

  close: () => {
    cancelAdvance();
    set({ ...IDLE });
  },

  end: () => {
    const { tour, close, origin } = get();
    const designs = useDesignStore.getState();
    if (isWorkflow(tour) && origin) {
      const changed = designs.design !== origin;
      // Everything done during the workflow becomes one step: one Undo brings the design back.
      designs.squashSince(origin, `Workflow "${tour.title}"`);
      close();
      if (changed && useDesignStore.getState().past.at(-1) === origin) {
        designs.setMessage(
          `Closed the workflow "${tour.title}". Undo brings back the design from before it.`,
          { undo: true },
        );
      } else if (designs.message === startMessage(tour)) {
        designs.setMessage(null);
      }
      return;
    }
    if (tour && designs.message === startMessage(tour)) designs.setMessage(null);
    close();
  },

  finish: (chain) => {
    const { tour } = get();
    if (!isWorkflow(tour)) {
      get().end();
      return;
    }
    markCompleted(tour.id);
    set({ completed: readCompleted() });
    const nextId = tour.next;
    const following = nextId ? WORKFLOWS.find((x) => x.id === nextId) : undefined;
    get().end();
    if (chain && following && isShipped(following)) {
      get().startWorkflow(following.id, { keep: true });
    }
  },

  setMissing: (missing) => {
    if (get().missing !== missing) set({ missing });
  },
}));

// A lesson ends when something else replaces the design (open, example, new) or when Undo
// brings back the design the lesson started from; there is nothing left to narrate. A
// workflow ends only on the Undo back past its start design.
useDesignStore.subscribe((state) => {
  if (touring) return;
  const { tour, loads, origin, close, snapshots, step, loaded } = useTourStore.getState();
  if (!tour) return;
  if (isWorkflow(tour)) {
    if (loaded && state.design === origin) close();
    return;
  }
  if (state.loads !== loads || state.design === origin) {
    close();
    return;
  }
  // Undo or Redo landed on a design the tour showed earlier, or on an edit the user made at
  // some step: follow it with the step. A new edit is remembered with the step it belongs to.
  const shown = snapshots.indexOf(state.design);
  if (shown >= 0) {
    if (shown !== step) useTourStore.setState({ step: shown });
    return;
  }
  const remembered = editedAt.get(state.design);
  if (remembered !== undefined) {
    if (remembered !== step) useTourStore.setState({ step: remembered });
    return;
  }
  editedAt.set(state.design, step);
});

/**
 * A workflow step with a predicate moves on by itself once the predicate turns true (it was
 * false when the step came on show, or turned false since), ADVANCE_DELAY_MS later so the user
 * sees the result. Every store a predicate reads is watched.
 */
function watch(): void {
  if (entering) return;
  const { tour, step, seen, heldAtEntry, entryDesign } = useTourStore.getState();
  if (!isWorkflow(tour)) return;
  const current = workflowSteps(tour)[step];
  if (!current || typeof current.advance !== 'function') return;
  const now = current.advance(tourSnapshot(seen, entryDesign ?? undefined));
  if (!now) {
    cancelAdvance();
    if (heldAtEntry) useTourStore.setState({ heldAtEntry: false });
    return;
  }
  if (heldAtEntry || advanceTimer !== null) return;
  advanceTimer = setTimeout(() => {
    advanceTimer = null;
    const s = useTourStore.getState();
    if (s.tour !== tour || s.step !== step) return;
    if (step < workflowSteps(tour).length - 1) s.next();
  }, ADVANCE_DELAY_MS);
}
watchSnapshotStores(watch);
useTourStore.subscribe((state, prev) => {
  if (state.step !== prev.step || state.tour !== prev.tour) watch();
});
