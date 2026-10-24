/**
 * The S-Plot view's state: the loaded S-parameter files, which one is
 * active, the selected frequency point and the axis and trace settings.
 * Markers live in the design store (`response.markers`) and are shared with
 * the Response view.
 */
import type { FrequencyUnit, TouchstoneData } from '@smithonline/core';
import { create } from 'zustand';
import { reinterpretFrequencyUnit, type ParsedSPlotFile, type SPlotKind } from '../lib/splot';

/** Curve colours handed out to new files in turn. */
export const FILE_COLORS = [
  '#1c7ed6',
  '#d6336c',
  '#2f9e44',
  '#f08c00',
  '#7048e8',
  '#0ca678',
  '#e8590c',
  '#868e96',
] as const;

export type TraceKey = 's11' | 's12' | 's21' | 's22';

export interface SPlotEntry {
  /** Instance id: file name plus a counter, so the same file can be loaded twice. */
  readonly id: string;
  readonly fileName: string;
  readonly kind: SPlotKind;
  readonly description: string;
  /** As read, with the frequency unit the file declared. */
  readonly original: TouchstoneData;
  /** The unit the file's frequency numbers are read as. */
  readonly unit: FrequencyUnit;
  /** `original` with the frequencies scaled for `unit`; what the graphs use. */
  readonly data: TouchstoneData;
  readonly color: string;
  readonly visible: boolean;
  /**
   * Set for the network of the design ("Add the network"): 'live' while it
   * follows the design, 'frozen' once the user keeps it as a snapshot.
   * Absent for files.
   */
  readonly network?: NetworkFollow;
}

export type NetworkFollow = 'live' | 'frozen';

interface SPlotState {
  files: readonly SPlotEntry[];
  /** The file the table, readout and export refer to. */
  activeId: string | null;
  /** Selected point of the active file (a gain table row), or null. */
  selected: number | null;
  /** Last frequency the pointer was over in a graph, Hz; it stays when the pointer leaves. */
  cursor: number | null;
  logX: boolean;
  traces: Readonly<Record<TraceKey, boolean>>;

  /** Add parsed files; the last one becomes active. Returns the new ids. */
  addFiles: (parsed: readonly ParsedSPlotFile[]) => string[];
  /**
   * Put the design's network in the list: it replaces the live network entry
   * when there is one (same id, colour and place), else it is added as a new
   * live entry. Either way it becomes active.
   */
  putNetwork: (parsed: ParsedSPlotFile) => { id: string; replaced: boolean };
  /** New data for the live network entry, if any; the active file and colours stay. */
  refreshNetwork: (parsed: ParsedSPlotFile) => boolean;
  /** Stop following the design: the entry keeps its data under a new name. */
  freezeNetwork: (id: string, fileName: string) => void;
  removeFile: (id: string) => void;
  setActive: (id: string) => void;
  setVisible: (id: string, visible: boolean) => void;
  setColor: (id: string, color: string) => void;
  /** Read the file's frequency numbers as another unit (Hz, kHz, MHz, GHz). */
  setUnit: (id: string, unit: FrequencyUnit) => void;
  select: (index: number | null) => void;
  setCursor: (frequency: number | null) => void;
  setLogX: (logX: boolean) => void;
  toggleTrace: (key: TraceKey) => void;
}

export const useSPlotStore = create<SPlotState>()((set, get) => {
  let counter = 0;
  const newEntry = (p: ParsedSPlotFile, network?: NetworkFollow): SPlotEntry => {
    counter += 1;
    return {
      id: `${p.fileName}#${counter}`,
      fileName: p.fileName,
      kind: p.kind,
      description: p.description,
      original: p.data,
      unit: p.data.frequencyUnit,
      data: p.data,
      color: FILE_COLORS[(counter - 1) % FILE_COLORS.length] as string,
      visible: true,
      ...(network ? { network } : {}),
    };
  };
  /** The entry with new contents; id, colour, visibility and follow state stay. */
  const withData = (e: SPlotEntry, p: ParsedSPlotFile): SPlotEntry => ({
    ...e,
    fileName: p.fileName,
    kind: p.kind,
    description: p.description,
    original: p.data,
    unit: p.data.frequencyUnit,
    data: p.data,
  });
  return {
    files: [],
    activeId: null,
    selected: null,
    cursor: null,
    logX: false,
    traces: { s11: true, s12: true, s21: true, s22: true },

    addFiles: (parsed) => {
      const added: SPlotEntry[] = parsed.map((p) => newEntry(p));
      if (added.length === 0) return [];
      set((s) => ({
        files: [...s.files, ...added],
        activeId: (added[added.length - 1] as SPlotEntry).id,
        selected: null,
      }));
      return added.map((e) => e.id);
    },
    putNetwork: (parsed) => {
      const live = get().files.find((f) => f.network === 'live');
      if (live) {
        set((s) => ({
          files: s.files.map((f) => (f.id === live.id ? withData(f, parsed) : f)),
          activeId: live.id,
          selected: s.activeId === live.id ? keptRow(s.selected, parsed) : null,
        }));
        return { id: live.id, replaced: true };
      }
      const entry = newEntry(parsed, 'live');
      set((s) => ({ files: [...s.files, entry], activeId: entry.id, selected: null }));
      return { id: entry.id, replaced: false };
    },
    refreshNetwork: (parsed) => {
      const live = get().files.find((f) => f.network === 'live');
      if (!live) return false;
      set((s) => ({
        files: s.files.map((f) => (f.id === live.id ? withData(f, parsed) : f)),
        selected: s.activeId === live.id ? keptRow(s.selected, parsed) : s.selected,
      }));
      return true;
    },
    freezeNetwork: (id, fileName) =>
      set((s) => ({
        files: s.files.map((f) =>
          f.id === id && f.network === 'live' ? { ...f, network: 'frozen' as const, fileName } : f,
        ),
      })),
    removeFile: (id) =>
      set((s) => {
        const files = s.files.filter((f) => f.id !== id);
        if (files.length === s.files.length) return {};
        const activeId =
          s.activeId === id
            ? ((files[files.length - 1] as SPlotEntry | undefined)?.id ?? null)
            : s.activeId;
        return { files, activeId, selected: s.activeId === id ? null : s.selected };
      }),
    setActive: (id) =>
      set((s) =>
        s.activeId === id || !s.files.some((f) => f.id === id)
          ? {}
          : { activeId: id, selected: null },
      ),
    setVisible: (id, visible) =>
      set((s) => ({ files: s.files.map((f) => (f.id === id ? { ...f, visible } : f)) })),
    setColor: (id, color) =>
      set((s) => ({ files: s.files.map((f) => (f.id === id ? { ...f, color } : f)) })),
    setUnit: (id, unit) =>
      set((s) => ({
        files: s.files.map((f) =>
          f.id === id ? { ...f, unit, data: reinterpretFrequencyUnit(f.original, unit) } : f,
        ),
      })),
    select: (selected) => set({ selected }),
    setCursor: (cursor) => set((s) => (s.cursor === cursor ? {} : { cursor })),
    setLogX: (logX) => set({ logX }),
    toggleTrace: (key) => set((s) => ({ traces: { ...s.traces, [key]: !s.traces[key] } })),
  };
});

/** The selected gain table row, when the new data still has it. */
function keptRow(selected: number | null, parsed: ParsedSPlotFile): number | null {
  return selected !== null && selected < parsed.data.points.length ? selected : null;
}

/** The active entry, or null. */
export function activeEntry(state: Pick<SPlotState, 'files' | 'activeId'>): SPlotEntry | null {
  return state.files.find((f) => f.id === state.activeId) ?? null;
}
