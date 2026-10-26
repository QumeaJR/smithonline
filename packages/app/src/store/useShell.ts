import { useEffect, useId, useRef } from 'react';
import { create } from 'zustand';
import type { SheetHeights } from '../lib/layout';
import type { Tool } from '../lib/tools';

/** The methods of Auto match, in the order of its method control. */
export type MatchMode = 'add' | 'tune' | 'broadband' | 'transformer' | 'filter';

/** A section of the Settings dialog it can open at (docs/09b section 5). */
export type SettingsSection = 'appearance' | 'new-designs' | 'behaviour' | 'libraries' | 'data';

/** A section of the Build tool it can open at (docs/09b section 5: Edit… in the network row). */
export type BuildSection = 'realization' | 'losses' | 'packages' | 'board' | 'ratings';

/**
 * Which segment the side column (tablet), the right column (desktop: Numbers
 * or the tool) or the phone's main sheet shows. On the phone `tool` is the
 * Tools segment: the list of tools, or the open tool's panel pushed into it.
 */
export type Pane = 'network' | 'numbers' | 'tool';

/** The detents of the phone's main sheet; it never goes below peek. */
export type Detent = 'peek' | 'half' | 'full';

const RANK: Readonly<Record<Detent, number>> = { peek: 0, half: 1, full: 2 };

/**
 * A mode that holds the phone's sheet low: a previewed solution, an armed
 * part, datapoint input, a marker press, the Response or S-Plot page. The
 * owner names it; holds without an owner are told apart by their detent.
 */
export interface SheetHold {
  readonly owner: string;
  readonly to: Detent;
}

/** The lowest of the detents. */
function lowest(detents: readonly Detent[]): Detent {
  let best: Detent = 'full';
  for (const d of detents) if (RANK[d] < RANK[best]) best = d;
  return best;
}

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
  /** The open design tool, or null (docs/09 section 3.0: lifted out of App for the workflows). */
  readonly tool: Tool;
  /**
   * Auto match's method: the one its panel shows while open, and the search or designer it
   * reopens on. Add parts and Tune existing parts are not kept once the panel closes (null:
   * the panel follows the network, Tune with parts in it, else Add).
   */
  readonly matchMode: MatchMode | null;
  /** The Settings dialog is open, at a section or at its top. */
  readonly settings: { readonly section: SettingsSection | null } | null;
  /** The Build section asked for last (Edit… in the network row, a next step); the count tells two asks apart. */
  readonly buildSection: { readonly section: BuildSection; readonly serial: number } | null;
  readonly pane: Pane;
  /** The pane before the tool opened, where closing the tool goes back to. */
  readonly paneBefore: Pane;
  /** Phone: the open tool's panel is pushed into the Tools segment (false: the list shows). */
  readonly toolPushed: boolean;
  readonly detent: Detent;
  /**
   * The detent to go back to when the last hold ends (a part placed, a marker
   * released, a preview ended, the chart view back); null while nothing holds the sheet.
   */
  readonly held: Detent | null;
  /** The active holds, oldest first; the sheet sits at the lowest detent any of them asks for. */
  readonly holds: readonly SheetHold[];
  /** The phone's detents in pixels as the shell measured them last, or null before that. */
  readonly heights: SheetHeights | null;
  /** The start guide was closed in this browser (remembered in localStorage). */
  readonly guideClosed: boolean;
  /**
   * The user brought the guide back from Help: it shows on any design, not only on a new
   * one, until it is closed again.
   */
  readonly guideShown: boolean;

  /** Set the open tool as it is (App's own open and close add the panes and the sheet). */
  setTool: (tool: Tool) => void;
  setMatchMode: (mode: MatchMode | null) => void;
  /** Open the Settings dialog (at a section), or close it with null. */
  openSettings: (section?: SettingsSection | null) => void;
  closeSettings: () => void;
  /** Ask the Build tool to show a section (the caller opens the tool). */
  showBuildSection: (section: BuildSection) => void;
  setPane: (pane: Pane) => void;
  /** A tool opened: its segment shows, and on the phone its panel is pushed. */
  toolOpened: () => void;
  /** The tool closed: back to the pane before it. */
  toolClosed: () => void;
  /** Phone: the back chevron of a pushed tool panel; the tool and its job keep running. */
  popTool: () => void;
  pushTool: () => void;
  /** The user moved the sheet: every hold and the remembered detent are forgotten. */
  setDetent: (detent: Detent) => void;
  /**
   * Hold the sheet at `to` for the duration of a mode of `owner` (an armed
   * part, a marker press, a preview, a page). The first hold remembers where
   * the sheet was; the sheet sits at the lowest detent any active hold asks
   * for, and a hold never raises it. `only` limits a first hold to sheets at
   * one of those detents. A second hold of the same owner replaces its first.
   */
  hold: (to: Detent, only?: readonly Detent[], owner?: string) => void;
  /**
   * End the oldest hold of `owner` (without an owner: the oldest hold without
   * one). When the last hold ends, the sheet goes back to the remembered detent.
   */
  release: (owner?: string) => void;
  setHeights: (heights: SheetHeights) => void;
  closeGuide: () => void;
  showGuide: () => void;
}

export const useShell = create<ShellState>()((set, get) => ({
  tool: null,
  matchMode: null,
  settings: null,
  buildSection: null,
  pane: 'network',
  paneBefore: 'network',
  toolPushed: false,
  detent: 'half',
  held: null,
  holds: [],
  heights: null,
  guideClosed: readGuideClosed(),
  guideShown: false,

  setTool: (tool) => {
    // Add parts and Tune follow the network the next time Auto match opens.
    const { matchMode } = get();
    const forget = tool !== 'match' && (matchMode === 'add' || matchMode === 'tune');
    set(forget ? { tool, matchMode: null } : { tool });
  },
  setMatchMode: (matchMode) => set({ matchMode }),
  openSettings: (section = null) => set({ settings: { section } }),
  closeSettings: () => set({ settings: null }),
  showBuildSection: (section) =>
    set({ buildSection: { section, serial: (get().buildSection?.serial ?? 0) + 1 } }),
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
  setDetent: (detent) => set({ detent, held: null, holds: [] }),
  hold: (to, only, owner = '') => {
    const { detent, held } = get();
    // Holds left over from a state set from outside (tests, a reset) count only while one holds.
    const holds = held === null ? [] : get().holds;
    if (held === null) {
      if (only && !only.includes(detent)) return;
      // A hold never raises the sheet; at its detent already there is nothing to give back.
      if (RANK[to] >= RANK[detent]) return;
      set({ held: detent, holds: [{ owner, to }], detent: to });
      return;
    }
    if (only && !only.includes(held)) return;
    const same = (h: SheetHold): boolean => h.owner === owner && (owner !== '' || h.to === to);
    const next = holds.some(same)
      ? holds.map((h) => (same(h) ? { owner, to } : h))
      : [...holds, { owner, to }];
    set({ holds: next, detent: lowest([held, ...next.map((h) => h.to)]) });
  },
  release: (owner = '') => {
    const { held, holds } = get();
    if (held === null) return;
    const at = holds.findIndex((h) => h.owner === owner);
    if (at < 0) return;
    const next = holds.filter((_, i) => i !== at);
    if (next.length === 0) set({ detent: held, held: null, holds: [] });
    else set({ holds: next, detent: lowest([held, ...next.map((h) => h.to)]) });
  },
  setHeights: (heights) => {
    const h = get().heights;
    if (h && h.peek === heights.peek && h.half === heights.half && h.full === heights.full) return;
    set({ heights });
  },
  closeGuide: () => {
    try {
      localStorage.setItem(GUIDE_KEY, 'closed');
    } catch {
      // Private mode or quota: it stays closed for this session.
    }
    set({ guideClosed: true, guideShown: false });
  },
  showGuide: () => {
    try {
      localStorage.removeItem(GUIDE_KEY);
    } catch {
      // ignore
    }
    set({ guideClosed: false, guideShown: true });
  },
}));

/**
 * Hold the phone's sheet at `to` while `active` (an armed part, datapoint
 * input, a previewed solution) and end the hold when the mode ends. Each
 * hook holds under an owner of its own (`owner`, or one made for it), so
 * modes that overlap end in any order: the sheet stays at the lowest detent
 * an active mode asks for and goes back only when the last one ends.
 */
export function useSheetHold(
  enabled: boolean,
  active: boolean,
  to: Detent,
  only?: readonly Detent[],
  owner?: string,
): void {
  const made = useId();
  const key = owner ?? made;
  const onlyRef = useRef(only);
  useEffect(() => {
    onlyRef.current = only;
  });
  useEffect(() => {
    if (!(enabled && active)) return;
    useShell.getState().hold(to, onlyRef.current, key);
    return () => useShell.getState().release(key);
  }, [enabled, active, to, key]);
}
