import { create } from 'zustand';

/**
 * Things that happen in the panels without a trace in the design: a search
 * that finished, a file that was exported. The guided workflows wait for them
 * (a step that advances once a Broadband result exists) and the next-step
 * suggestions start from them (docs/09 sections 3 and 4). Each event only
 * counts up; whoever waits compares the count with the one it saw before.
 */
export type TourEvent =
  /** A Broadband search finished with its list. */
  | 'broadband-result'
  /** A Tolerance (Monte Carlo) run finished. */
  | 'tolerance-result'
  /** Design centring finished its search. */
  | 'centre-result'
  /** The centred values were applied (Apply under the centring result). */
  | 'centre-applied'
  /** A live network entry in S-Plot was frozen into a snapshot. */
  | 'splot-freeze'
  /** A workflow step's own "Do it for me" button ran. */
  | 'do-it'
  /** Optimize band finished. */
  | 'optimize-result'
  /** The bill of materials was exported. */
  | 'export-bom'
  /** The Touchstone .s2p of the network was exported. */
  | 'export-s2p'
  /** A SPICE or LTspice file was exported. */
  | 'export-spice'
  /** The report was opened. */
  | 'report';

interface TourEventsState {
  readonly counts: Readonly<Partial<Record<TourEvent, number>>>;
  emit: (event: TourEvent) => void;
}

export const useTourEvents = create<TourEventsState>()((set, get) => ({
  counts: {},
  emit: (event) => set({ counts: { ...get().counts, [event]: (get().counts[event] ?? 0) + 1 } }),
}));

/** How often `event` has happened in this session. */
export function eventCount(event: TourEvent): number {
  return useTourEvents.getState().counts[event] ?? 0;
}

/** Record that `event` happened. */
export function emitTourEvent(event: TourEvent): void {
  useTourEvents.getState().emit(event);
}
