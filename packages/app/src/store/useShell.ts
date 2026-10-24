import { useEffect, useRef } from 'react';
import { create } from 'zustand';

/**
 * Which segment the side column (tablet), the right column (desktop: Numbers
 * or the tool) or the phone's main sheet shows. On the phone `tool` is the
 * Tools segment: the list of tools, or the open tool's panel pushed into it.
 */
export type Pane = 'network' | 'numbers' | 'tool';

/** The detents of the phone's main sheet; it never goes below peek. */
export type Detent = 'peek' | 'half' | 'full';

const GUIDE_KEY = 'smithonline.startGuide';

/** Whether the start guide was closed in this browser; false where storage throws. */
export function readGuideClosed(): boolean {
  try {
    return localStorage.getItem(GUIDE_KEY) === 'closed';
  } catch {
    return false;
  }
}

interface ShellState {
  readonly pane: Pane;
  /** The pane before the tool opened, where closing the tool goes back to. */
  readonly paneBefore: Pane;
  /** Phone: the open tool's panel is pushed into the Tools segment (false: the list shows). */
  readonly toolPushed: boolean;
  readonly detent: Detent;
  /** The detent to go back to after a part was placed, a marker released or a preview ended. */
  readonly held: Detent | null;
  /** The start guide was closed in this browser (remembered in localStorage). */
  readonly guideClosed: boolean;

  setPane: (pane: Pane) => void;
  /** A tool opened: its segment shows, and on the phone its panel is pushed. */
  toolOpened: () => void;
  /** The tool closed: back to the pane before it. */
  toolClosed: () => void;
  /** Phone: the back chevron of a pushed tool panel; the tool and its job keep running. */
  popTool: () => void;
  pushTool: () => void;
  /** The user moved the sheet: any held detent is forgotten. */
  setDetent: (detent: Detent) => void;
  /**
   * Move the sheet to `to` for the duration of a mode (an armed part, a marker
   * drag, a preview) and remember where it was; `only` limits it to sheets at
   * one of those detents. A second hold keeps the first remembered detent.
   */
  hold: (to: Detent, only?: readonly Detent[]) => void;
  /** End the mode: the sheet goes back to the remembered detent. */
  release: () => void;
  closeGuide: () => void;
  showGuide: () => void;
}

export const useShell = create<ShellState>()((set, get) => ({
  pane: 'network',
  paneBefore: 'network',
  toolPushed: false,
  detent: 'half',
  held: null,
  guideClosed: readGuideClosed(),

  setPane: (pane) => set({ pane }),
  toolOpened: () => {
    const { pane, paneBefore } = get();
    set({ pane: 'tool', paneBefore: pane === 'tool' ? paneBefore : pane, toolPushed: true });
  },
  toolClosed: () => {
    const { pane, paneBefore } = get();
    set({ pane: pane === 'tool' ? paneBefore : pane, toolPushed: false });
  },
  popTool: () => set({ toolPushed: false }),
  pushTool: () => set({ toolPushed: true, pane: 'tool' }),
  setDetent: (detent) => set({ detent, held: null }),
  hold: (to, only) => {
    const { detent, held } = get();
    if (held !== null) {
      set({ detent: to });
      return;
    }
    if (only && !only.includes(detent)) return;
    if (detent === to) return;
    set({ held: detent, detent: to });
  },
  release: () => {
    const { held } = get();
    if (held === null) return;
    set({ detent: held, held: null });
  },
  closeGuide: () => {
    try {
      localStorage.setItem(GUIDE_KEY, 'closed');
    } catch {
      // Private mode or quota: it stays closed for this session.
    }
    set({ guideClosed: true });
  },
  showGuide: () => {
    try {
      localStorage.removeItem(GUIDE_KEY);
    } catch {
      // ignore
    }
    set({ guideClosed: false });
  },
}));

/**
 * Hold the phone's sheet at `to` while `active` (an armed part, datapoint input, a
 * previewed solution) and give it back its detent when the mode ends. Only the
 * hold this hook made is released, so two modes that overlap do not undo each other.
 */
export function useSheetHold(
  enabled: boolean,
  active: boolean,
  to: Detent,
  only?: readonly Detent[],
): void {
  const mine = useRef(false);
  const onlyRef = useRef(only);
  useEffect(() => {
    onlyRef.current = only;
  });
  useEffect(() => {
    const shell = useShell.getState();
    if (enabled && active) {
      if (mine.current) return;
      const before = shell.detent;
      shell.hold(to, onlyRef.current);
      mine.current = useShell.getState().detent !== before;
    } else if (mine.current) {
      mine.current = false;
      shell.release();
    }
  }, [enabled, active, to]);
}
