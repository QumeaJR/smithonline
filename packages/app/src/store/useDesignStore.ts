import type { Complex, Element } from '@smithonline/core';
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

export type GridDensity = 'coarse' | 'normal' | 'fine';

export interface ChartOptions {
  readonly zGrid: boolean;
  readonly yGrid: boolean;
  readonly density: GridDensity;
  readonly labels: boolean;
}

interface DesignState {
  design: Design;
  past: Design[];
  future: Design[];
  /** Selected datapoint index, or null. */
  selected: number | null;
  chart: ChartOptions;
  /** Short status line message, cleared by the next one. */
  message: string | null;

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
  setTwoPort: (twoPort: TwoPort | null) => void;
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
    message: null,

    init: (design) => {
      transientRun = false;
      set({ design, past: [], future: [], selected: design.elements.length });
    },
    loadDesign: (design) => {
      transientRun = false;
      record(design, false);
      set({ selected: design.elements.length });
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
    setMessage: (message) => set({ message }),

    setName: (name) => update((d) => ({ ...d, name })),
    setFrequency: (frequency) =>
      update((d) => ({
        ...d,
        frequency,
        // Lines and stubs keep their electrical length at the new design frequency.
        elements: d.elements.map((el) =>
          el.kind === 'line' || el.kind === 'openStub' || el.kind === 'shortStub'
            ? { ...el, refFrequency: frequency }
            : el,
        ),
      })),
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
    setTwoPort: (twoPort) => update((d) => ({ ...d, twoPort })),
    setShowStability: (showStability) => update((d) => ({ ...d, showStability })),
    setGainCircles: (gainCircles) => update((d) => ({ ...d, gainCircles })),
    setNoiseCircles: (noiseCircles) => update((d) => ({ ...d, noiseCircles })),
  };
});
