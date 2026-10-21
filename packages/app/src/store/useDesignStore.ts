import type { Complex, Element, TouchstoneData } from '@smithonline/core';
import { create } from 'zustand';
import {
  emptyDesign,
  withIdentity,
  type Design,
  type DesignElement,
  type GainCircleSpec,
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
  /** The S-parameter file behind the two-port device, re-read when the design frequency changes. */
  twoPortFile: { readonly data: TouchstoneData; readonly fileName: string } | null;

  /** Set the initial design at startup without a history entry. */
  init: (design: Design) => void;
  /** Replace the whole design (open, example, share link). Recorded in history. */
  loadDesign: (design: Design) => void;
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
}

const HISTORY_LIMIT = 100;

export const useDesignStore = create<DesignState>()((set, get) => {
  let transientRun = false;

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
    response: { logX: false, markers: [] },
    message: null,
    twoPortFile: null,

    init: (design) => {
      transientRun = false;
      set({ design, past: [], future: [], selected: design.elements.length });
    },
    loadDesign: (design) => {
      transientRun = false;
      record(design, false);
      set({ selected: design.elements.length, twoPortFile: null });
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
      set({ design: previous, past: past.slice(0, -1), future: [design, ...future] });
    },
    redo: () => {
      const { past, design, future } = get();
      const [next, ...rest] = future;
      if (!next) return;
      transientRun = false;
      set({ design: next, past: [...past, design], future: rest });
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
        const file = get().twoPortFile;
        const fromFile = file ? twoPortFromFile(file.data, frequency, file.fileName, d.z0) : null;
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
    setZ0: (z0) => update((d) => ({ ...d, z0 })),
    setLoad: (load, transient = false) => update((d) => ({ ...d, load }), transient),
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
      set({ twoPortFile: null });
      update((d) => {
        if (!twoPort) return { ...d, twoPort: null };
        return { ...d, twoPort: { s: twoPort.s, noise: twoPort.noise } };
      });
    },
    importTwoPort: (data, fileName) => {
      const d = get().design;
      const twoPort = twoPortFromFile(data, d.frequency, fileName, d.z0);
      if (!twoPort) return;
      set({ twoPortFile: { data, fileName } });
      update((prev) => ({ ...prev, twoPort, showStability: true }));
    },
    setShowStability: (showStability) => update((d) => ({ ...d, showStability })),
    setGainCircles: (gainCircles) => update((d) => ({ ...d, gainCircles })),
    setNoiseCircles: (noiseCircles) => update((d) => ({ ...d, noiseCircles })),
  };
});
