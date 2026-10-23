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
  /** History length right after the start; a shorter one means the tour was undone. */
  readonly base: number;
  start: (id: string) => void;
  next: () => void;
  back: () => void;
  close: () => void;
}

export const useTourStore = create<TourState>()((set, get) => ({
  tour: null,
  step: 0,
  snapshots: [],
  base: 0,

  start: (id) => {
    const tour = TOURS.find((t) => t.id === id);
    if (!tour) return;
    const designs = useDesignStore.getState();
    const first = tour.start();
    designs.setView('chart');
    designs.loadDesign(first);
    designs.setMessage(`Tour: ${tour.title}. Undo brings your previous design back.`);
    set({
      tour,
      step: 0,
      snapshots: [useDesignStore.getState().design],
      base: useDesignStore.getState().past.length,
    });
  },

  next: () => {
    const { tour, step, snapshots } = get();
    if (!tour || step >= tour.steps.length - 1) return;
    const designs = useDesignStore.getState();
    const nextStep = tour.steps[step + 1];
    if (!nextStep) return;
    const design = nextStep.apply(designs.design);
    designs.replaceDesign(design);
    set({ step: step + 1, snapshots: [...snapshots.slice(0, step + 1), design] });
  },

  back: () => {
    const { tour, step, snapshots } = get();
    if (!tour || step <= 0) return;
    const previous = snapshots[step - 1];
    if (!previous) return;
    useDesignStore.getState().replaceDesign(previous);
    set({ step: step - 1 });
  },

  close: () => set({ tour: null, step: 0, snapshots: [], base: 0 }),
}));
