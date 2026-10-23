import { create } from 'zustand';
import type { Design } from '../lib/design';
import { TOURS, type Tour } from '../lib/tours';
import { useDesignStore } from './useDesignStore';

/**
 * The running guided tour. Starting one records the tour's start design as
 * one history entry; Next and Back then swap designs without history, so a
 * single Undo takes the whole tour back out.
 */
interface TourState {
  /** The running tour, or null. */
  readonly tour: Tour | null;
  /** Index of the step on show. */
  readonly step: number;
  /** The design after each step shown so far, for Back. */
  readonly snapshots: readonly Design[];
  /** The design before the tour; when Undo brings it back, the tour is over. */
  readonly origin: Design | null;
  /** The load count of the design store when the tour last set the design; a change ends the tour. */
  readonly loads: number;
  start: (id: string) => void;
  next: () => void;
  back: () => void;
  close: () => void;
}

/**
 * Show `next` in place of the design the tour last put on screen, without a
 * history entry. When the user has changed the design since (an edit, an
 * import), that work is not the tour's to overwrite: the swap is recorded, so
 * Undo brings it back.
 */
function swap(current: Design, shown: Design | undefined, next: Design): void {
  const designs = useDesignStore.getState();
  ownChange(() => {
    if (shown === undefined || current === shown) designs.replaceDesign(next);
    else designs.loadDesign(next);
  });
}

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

export const useTourStore = create<TourState>()((set, get) => ({
  tour: null,
  step: 0,
  snapshots: [],
  origin: null,
  loads: 0,

  start: (id) => {
    const tour = TOURS.find((t) => t.id === id);
    if (!tour) return;
    const designs = useDesignStore.getState();
    const origin = designs.design;
    const first = tour.start();
    designs.setView('chart');
    ownChange(() => designs.loadDesign(first));
    designs.setMessage(`Tour: ${tour.title}. Undo brings your previous design back.`);
    set({
      tour,
      step: 0,
      snapshots: [useDesignStore.getState().design],
      origin,
      loads: useDesignStore.getState().loads,
    });
  },

  next: () => {
    const { tour, step, snapshots } = get();
    if (!tour || step >= tour.steps.length - 1) return;
    const designs = useDesignStore.getState();
    const nextStep = tour.steps[step + 1];
    if (!nextStep) return;
    const design = nextStep.apply(designs.design);
    swap(designs.design, snapshots[step], design);
    set({
      step: step + 1,
      snapshots: [...snapshots.slice(0, step + 1), design],
      loads: useDesignStore.getState().loads,
    });
  },

  back: () => {
    const { tour, step, snapshots } = get();
    if (!tour || step <= 0) return;
    const previous = snapshots[step - 1];
    if (!previous) return;
    const current = useDesignStore.getState().design;
    swap(current, snapshots[step], previous);
    set({ step: step - 1, loads: useDesignStore.getState().loads });
  },

  close: () => set({ tour: null, step: 0, snapshots: [], origin: null, loads: 0 }),
}));

// A tour ends when something else replaces the design (open, example, new) or when Undo
// brings back the design the tour started from; there is nothing left to narrate.
useDesignStore.subscribe((state) => {
  if (touring) return;
  const { tour, loads, origin, close } = useTourStore.getState();
  if (tour && (state.loads !== loads || state.design === origin)) close();
});
