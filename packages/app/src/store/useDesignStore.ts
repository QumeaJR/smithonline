import type { Complex, Element, TouchstoneData } from '@smithonline/core';
import { create } from 'zustand';
import {
  emptyDesign,
  withIdentity,
  type Design,
  type DesignElement,
  type GainCircleSpec,
  type LossSettings,
  type RealizeSettings,
  type SweepSettings,
  type TwoPort,
} from '../lib/design';
import { twoPortFromFile } from '../lib/import';

export type GridDensity = 'coarse' | 'normal' | 'fine';

export interface ChartOptions {
  readonly zGrid: boolean;
  readonly yGrid: boolean;
  readonly density: GridDensity;
  readonly labels: boolean;
}

/** The main area shows either the Smith chart or the response plots. */
export type View = 'chart' | 'response';

export const MAX_MARKERS = 8;

export interface ResponseOptions {
  /** Logarithmic frequency axis with log-spaced sweep points. */
  readonly logX: boolean;
  /** Marker frequencies, Hz, in the order they were set. */
  readonly markers: readonly number[];
  /** VSWR limit of the usable bandwidth readout and the band on the VSWR plot. */
  readonly vswrLimit: number;
}

interface DesignState {
  design: Design;
  past: Design[];
  future: Design[];
  /** Selected datapoint index, or null. */
  selected: number | null;
  chart: ChartOptions;
  view: View;
  response: ResponseOptions;
  /** Short status line message, cleared by the next one. */
  message: string | null;
  /**
   * The S-parameter files opened in this session, by instance id (name plus a
   * counter, so a re-opened file does not replace the data an undone device
   * still points at). The design's twoPort.source.fileId names the one its
   * device follows on f and Z0 changes.
   */
  twoPortFiles: Readonly<
    Record<string, { readonly data: TouchstoneData; readonly fileName: string }>
  >;

  /** Set the initial design at startup without a history entry. */
  init: (design: Design) => void;
  /** Replace the whole design (open, example, share link). Recorded in history. */
  loadDesign: (design: Design) => void;
  /**
   * Swap the current design without a history entry. Guided tours use it to
   * step through a design that was recorded once when the tour started, so
   * the whole tour is one undo.
   */
  replaceDesign: (design: Design) => void;
  /** Apply a change to the design. Recorded in history unless `transient` (slider drags). */
  update: (fn: (d: Design) => Design, transient?: boolean) => void;
  /** Close a run of transient updates so the next one starts a new history entry. */
  commit: () => void;
  undo: () => void;
  redo: () => void;
  select: (index: number | null) => void;
  setChart: (patch: Partial<ChartOptions>) => void;
  setView: (view: View) => void;
  setResponse: (patch: Partial<ResponseOptions>) => void;
  /** Add a marker at a frequency; refused with a message once the limit is reached. */
  addMarker: (frequency: number) => void;
  removeMarker: (index: number) => void;
  setMessage: (message: string | null) => void;

  setName: (name: string) => void;
  setFrequency: (frequency: number) => void;
  setZ0: (z0: number) => void;
  setLoad: (load: Complex, transient?: boolean) => void;
  /** Where the network should land; null means Z0. */
  setTarget: (target: Complex | null) => void;
  /** Start over with an empty design. Recorded in history, so undo brings the old one back. */
  newDesign: () => void;
  /** Replace the values of several elements at once as one history entry (a fit result). */
  setElementValues: (elements: readonly Element[]) => void;
  /** Append a core element at the source end; it receives an id and a colour. */
  addElement: (el: Element) => void;
  updateElement: (index: number, el: DesignElement, transient?: boolean) => void;
  removeElement: (index: number) => void;
  moveElement: (index: number, direction: -1 | 1) => void;
  /** Move the element at `from` so that it ends up at position `to`. */
  reorderElement: (from: number, to: number) => void;
  setSweep: (patch: Partial<SweepSettings>) => void;
  setVswrCircles: (values: readonly number[]) => void;
  setQContours: (values: readonly number[]) => void;
  /** Set the device by hand; detaches any file it was read from. */
  setTwoPort: (twoPort: TwoPort | null) => void;
  /** Read the device from a file at the design frequency and keep the file for later re-reads. */
  importTwoPort: (data: TouchstoneData, fileName: string) => void;
  setShowStability: (show: boolean) => void;
  setGainCircles: (circles: readonly GainCircleSpec[]) => void;
  setNoiseCircles: (values: readonly number[]) => void;
  setRealize: (patch: Partial<RealizeSettings>) => void;
  setLosses: (patch: Partial<LossSettings>) => void;
  /** Keep an element exact in Realize mode, or release it. */
  toggleLock: (index: number) => void;
}

const HISTORY_LIMIT = 100;

export const useDesignStore = create<DesignState>()((set, get) => {
  let transientRun = false;
  let fileCount = 0;

  /**
   * The file a device follows: the instance its source names, or else the
   * file of that name opened last (a design from a link or an older session).
   */
  const resolveFile = (
    source: { readonly fileName: string; readonly fileId?: string } | undefined,
  ): { id: string; file: { data: TouchstoneData; fileName: string } } | null => {
    if (!source) return null;
    const files = get().twoPortFiles;
    // Own property only: a link may carry any string as the id.
    const own =
      source.fileId !== undefined && Object.hasOwn(files, source.fileId)
        ? files[source.fileId]
        : undefined;
    if (own && source.fileId !== undefined) return { id: source.fileId, file: own };
    const byName = Object.entries(files).filter(([, f]) => f.fileName === source.fileName);
    const last = byName[byName.length - 1];
    return last ? { id: last[0], file: last[1] } : null;
  };

  const record = (next: Design, transient: boolean): void => {
    const { design, past } = get();
    if (transient && transientRun) {
      set({ design: next });
      return;
    }
    transientRun = transient;
    set({
      design: next,
      past: [...past.slice(-HISTORY_LIMIT + 1), design],
      future: [],
    });
  };

  const update = (fn: (d: Design) => Design, transient = false): void => {
    const current = get().design;
    const next = fn(current);
    // A no-op (for example moving the first element up) leaves history alone.
    if (next !== current) record(next, transient);
  };

  return {
    design: emptyDesign(),
    past: [],
    future: [],
    selected: null,
    chart: { zGrid: true, yGrid: false, density: 'normal', labels: true },
    view: 'chart',
    response: { logX: false, markers: [], vswrLimit: 2 },
    message: null,
    twoPortFiles: {},

    init: (design) => {
      transientRun = false;
      set({ design, past: [], future: [], selected: design.elements.length });
    },
    loadDesign: (design) => {
      transientRun = false;
      record(design, false);
      // The file stays in memory: undo brings the previous design and its link to the file back.
      set({ selected: design.elements.length });
    },
    replaceDesign: (design) => {
      transientRun = false;
      set({ design, selected: design.elements.length });
    },
    update,
    commit: () => {
      transientRun = false;
    },
    undo: () => {
      const { past, design, future } = get();
      const previous = past[past.length - 1];
      if (!previous) return;
      transientRun = false;
      set({
        design: previous,
        past: past.slice(0, -1),
        future: [design, ...future],
        message: null,
      });
    },
    redo: () => {
      const { past, design, future } = get();
      const [next, ...rest] = future;
      if (!next) return;
      transientRun = false;
      set({ design: next, past: [...past, design], future: rest, message: null });
    },
    select: (selected) => set({ selected }),
    setChart: (patch) => set((s) => ({ chart: { ...s.chart, ...patch } })),
    setView: (view) => set({ view }),
    setResponse: (patch) => set((s) => ({ response: { ...s.response, ...patch } })),
    addMarker: (frequency) =>
      set((s) => {
        const { markers } = s.response;
        if (markers.includes(frequency)) return {};
        if (markers.length >= MAX_MARKERS) {
          return { message: `All ${MAX_MARKERS} markers are set; remove one first.` };
        }
        return { response: { ...s.response, markers: [...markers, frequency] } };
      }),
    removeMarker: (index) =>
      set((s) => ({
        response: { ...s.response, markers: s.response.markers.filter((_, i) => i !== index) },
      })),
    setMessage: (message) => set({ message }),

    setName: (name) => update((d) => ({ ...d, name })),
    setFrequency: (frequency) =>
      update((d) => {
        // The device follows the file only while the design still points at that file
        // (a hand edit removes the source; undo brings it back).
        const found = resolveFile(d.twoPort?.source);
        const fromFile = found
          ? twoPortFromFile(found.file.data, frequency, found.file.fileName, d.z0, found.id)
          : null;
        if (fromFile) {
          set({
            message: fromFile.source?.clamped
              ? `${found?.file.fileName}: the design frequency is outside the file; the two-port panel holds the nearest end`
              : null,
          });
        }
        return {
          ...d,
          frequency,
          // Lines and stubs keep their electrical length at the new design frequency.
          elements: d.elements.map((el) =>
            el.kind === 'line' || el.kind === 'openStub' || el.kind === 'shortStub'
              ? { ...el, refFrequency: frequency }
              : el,
          ),
          // A device read from a file follows the frequency.
          twoPort: fromFile ?? d.twoPort,
        };
      }),
    setZ0: (z0) =>
      update((d) => {
        const found = resolveFile(d.twoPort?.source);
        const fromFile = found
          ? twoPortFromFile(found.file.data, d.frequency, found.file.fileName, z0, found.id)
          : null;
        return { ...d, z0, twoPort: fromFile ?? d.twoPort };
      }),
    setLoad: (load, transient = false) => update((d) => ({ ...d, load }), transient),
    setTarget: (target) => update((d) => ({ ...d, target })),
    newDesign: () => {
      transientRun = false;
      record(emptyDesign(), false);
      set({
        selected: 0,
        message: 'New design. Undo brings the previous one back.',
      });
    },
    setElementValues: (elements) =>
      update((d) => ({
        ...d,
        elements: d.elements.map((el, i) => {
          const next = elements[i];
          return next ? ({ ...el, ...next } as DesignElement) : el;
        }),
      })),
    addElement: (el) => {
      update((d) => ({ ...d, elements: [...d.elements, withIdentity(el, d.elements)] }));
      set({ selected: get().design.elements.length });
    },
    updateElement: (index, el, transient = false) =>
      update(
        (d) => ({ ...d, elements: d.elements.map((e, i) => (i === index ? el : e)) }),
        transient,
      ),
    removeElement: (index) => {
      update((d) => ({ ...d, elements: d.elements.filter((_, i) => i !== index) }));
      const n = get().design.elements.length;
      set((s) => ({ selected: s.selected !== null && s.selected > n ? n : s.selected }));
    },
    moveElement: (index, direction) => get().reorderElement(index, index + direction),
    reorderElement: (from, to) =>
      update((d) => {
        const n = d.elements.length;
        if (from === to || from < 0 || from >= n || to < 0 || to >= n) return d;
        const elements = [...d.elements];
        const [moved] = elements.splice(from, 1);
        elements.splice(to, 0, moved as DesignElement);
        return { ...d, elements };
      }),
    setSweep: (patch) => update((d) => ({ ...d, sweep: { ...d.sweep, ...patch } })),
    setVswrCircles: (vswrCircles) => update((d) => ({ ...d, vswrCircles })),
    setQContours: (qContours) => update((d) => ({ ...d, qContours })),
    setTwoPort: (twoPort) => {
      // Keeps the file in memory: undoing the edit restores the link through the source.
      if (get().design.twoPort?.source) set({ message: null });
      update((d) => {
        if (!twoPort) return { ...d, twoPort: null };
        return { ...d, twoPort: { s: twoPort.s, noise: twoPort.noise } };
      });
    },
    importTwoPort: (data, fileName) => {
      const d = get().design;
      fileCount += 1;
      const fileId = `${fileName}#${fileCount}`;
      const twoPort = twoPortFromFile(data, d.frequency, fileName, d.z0, fileId);
      if (!twoPort) return;
      set({
        twoPortFiles: { ...get().twoPortFiles, [fileId]: { data, fileName } },
        message: twoPort.source?.clamped
          ? `${fileName}: the design frequency is outside the file; the two-port panel holds the nearest end`
          : `Device filled from ${fileName}`,
      });
      update((prev) => ({ ...prev, twoPort, showStability: true }));
    },
    setShowStability: (showStability) => update((d) => ({ ...d, showStability })),
    setGainCircles: (gainCircles) => update((d) => ({ ...d, gainCircles })),
    setNoiseCircles: (noiseCircles) => update((d) => ({ ...d, noiseCircles })),
    setRealize: (patch) => update((d) => ({ ...d, realize: { ...d.realize, ...patch } })),
    setLosses: (patch) => update((d) => ({ ...d, losses: { ...d.losses, ...patch } })),
    toggleLock: (index) =>
      update((d) => ({
        ...d,
        elements: d.elements.map((el, i) => {
          if (i !== index) return el;
          if (el.locked) {
            const { locked: _locked, ...rest } = el;
            void _locked;
            return rest as DesignElement;
          }
          return { ...el, locked: true };
        }),
      })),
  };
});
