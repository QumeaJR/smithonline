import type { Complex, Element, LimitArea, PackageId, TouchstoneData } from '@smithonline/core';
import { formatEngineering } from '@smithonline/core';
import { create } from 'zustand';
import {
  emptyDesign,
  withIdentity,
  type Design,
  type DesignElement,
  type GainCircleSpec,
  type LossSettings,
  type RealizeSettings,
  type StressSettings,
  type ToleranceSettings,
  type SweepSettings,
  type TwoPort,
} from '../lib/design';
import {
  MAX_DATAPOINTS,
  addDatapoint,
  removeDatapoint,
  setStartDatapoint,
  startIndex,
  updateDatapoint,
  userDatapoints,
  type UserDatapoint,
} from '../lib/datapoints';
import { twoPortFromFile } from '../lib/import';
import { DEFAULT_STRESS } from '../lib/stress';
import { DEFAULT_TOLERANCE } from '../lib/tolerance';
import { elementName, elementSummary } from '../lib/elements';
import { fmtComplex, fmtFrequency } from '../lib/format';
import { useSettings } from './useSettings';

export type GridDensity = 'coarse' | 'normal' | 'fine';

export interface ChartOptions {
  readonly zGrid: boolean;
  readonly yGrid: boolean;
  readonly density: GridDensity;
  readonly labels: boolean;
}

/** The main area shows the Smith chart, the response plots or the S-Plot of loaded files. */
export type View = 'chart' | 'response' | 'splot';

export const MAX_MARKERS = 8;

/** A button the status message carries, such as "Scale sweep". */
export interface MessageAction {
  readonly label: string;
  readonly run: () => void;
}

export interface MessageOptions {
  /** Show an Undo button with the message for UNDO_MESSAGE_MS (a removal, New, a load). */
  readonly undo?: boolean;
  /** A button that carries out what the message offers. */
  readonly action?: MessageAction;
}

/**
 * The buttons of the message on show. They belong to the message text they
 * were set with: when another message replaces it they are gone, whichever
 * path set the new one.
 */
export interface MessageExtras {
  readonly text: string;
  readonly undo: boolean;
  readonly action: MessageAction | null;
  /** Counts the messages that carried buttons, so a repeated text restarts its timer. */
  readonly serial: number;
}

/** How long a message shows its Undo button, ms. */
export const UNDO_MESSAGE_MS = 8000;

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
  /** Counts designs that replaced the whole one (open, example, new); a tour ends when it moves. */
  loads: number;
  /** Short status line message, cleared by the next one. */
  message: string | null;
  /** The Undo and action buttons of the message, while it is the one on show. */
  messageExtras: MessageExtras | null;
  /** Datapoint input mode: a click on the chart adds a user datapoint instead of selecting. */
  datapointInput: boolean;
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
  /** Like update, and a file-bound two-port device is re-read when the frequency changed. */
  updateFollowingDevice: (fn: (d: Design) => Design) => void;
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
  /** Show a status message, with an Undo button or an action when the options say so. */
  setMessage: (message: string | null, options?: MessageOptions) => void;
  setDatapointInput: (on: boolean) => void;

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
  /** Append several elements as one history entry (a match solution). */
  addElements: (els: readonly Element[]) => void;
  updateElement: (index: number, el: DesignElement, transient?: boolean) => void;
  removeElement: (index: number) => void;
  moveElement: (index: number, direction: -1 | 1) => void;
  /** Move the element at `from` so that it ends up at position `to`. */
  reorderElement: (from: number, to: number) => void;
  setSweep: (patch: Partial<SweepSettings>) => void;
  /** Add a user datapoint (DPn); refused with a message at the limit. */
  addDatapoint: (point: UserDatapoint) => void;
  /** Remove user datapoint `index` (DP numbering, 0-based); the last one stays. */
  removeDatapoint: (index: number) => void;
  /** Make user datapoint `index` the one the network starts from. */
  setStartDatapoint: (index: number) => void;
  /** Change the frequency or impedance of user datapoint `index`, the start included. */
  setDatapoint: (index: number, patch: Partial<UserDatapoint>) => void;
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
  /** Name the component package of an inductor or capacitor; null removes it. Other kinds are left alone. */
  setPackage: (index: number, pkg: PackageId | null) => void;
  /** Change the Monte Carlo settings. */
  setTolerance: (patch: Partial<ToleranceSettings>) => void;
  /** Change the source power and the stress limits. */
  setStress: (patch: Partial<StressSettings>) => void;
  /** Replace the limit areas of the response plots. */
  setLimits: (limits: readonly LimitArea[]) => void;
}

const HISTORY_LIMIT = 100;

export const useDesignStore = create<DesignState>()((set, get) => {
  let transientRun = false;
  // A status line an action prepared while changing the design; record() applies it, and any
  // other change to the design clears the previous message so nothing stale stays on screen.
  let pending: string | null | undefined;
  /** The status message each recorded design was announced with, so Undo and Redo can repeat it. */
  const labelOf = new WeakMap<Design, string>();
  const stepMessage = (verb: string, d: Design): string => {
    const label = labelOf.get(d);
    return label ? `${verb}: ${label}` : verb;
  };
  let fileCount = 0;
  let serial = 0;
  /** Buttons for the message on show (set just before), if there is one. */
  const flag = (options: MessageOptions): void => {
    const text = get().message;
    if (!text || (!options.undo && !options.action)) return;
    serial += 1;
    set({
      messageExtras: {
        text,
        undo: Boolean(options.undo),
        action: options.action ?? null,
        serial,
      },
    });
  };

  /**
   * The file a device follows: the instance its source names, or else the
   * file of that name opened last (a design from a link or an older session).
   */
  /**
   * A device read from a file follows the design frequency: whichever action moved the
   * frequency (another start datapoint, a row sent from S-Plot or the import dialog),
   * the two-port panel and the circles are re-read at the new frequency, as setFrequency does.
   */
  const deviceFollows = (d: Design): Design => {
    const source = d.twoPort?.source;
    if (!source || source.frequency === d.frequency) return d;
    const found = resolveFile(source);
    if (!found) return d;
    const fromFile = twoPortFromFile(
      found.file.data,
      d.frequency,
      found.file.fileName,
      d.z0,
      found.id,
    );
    if (!fromFile) return d;
    pending = fromFile.source?.clamped
      ? `${found.file.fileName}: the design frequency is outside the file; the two-port panel holds the nearest end`
      : null;
    return { ...d, twoPort: fromFile };
  };

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
    const message = pending !== undefined ? pending : null;
    pending = undefined;
    if (message) labelOf.set(next, message);
    if (transient && transientRun) {
      set({ design: next });
      return;
    }
    transientRun = transient;
    set({
      design: next,
      past: [...past.slice(-HISTORY_LIMIT + 1), design],
      future: [],
      message,
      messageExtras: null,
    });
  };

  const finiteZ = (c: { re: number; im: number }): boolean =>
    Number.isFinite(c.re) && Number.isFinite(c.im);
  /**
   * Finite positive frequency and Z0, finite load and sweep loads: nothing
   * else can be drawn, saved or shared. (A device read from a file is
   * checked where it is built, in `twoPortFromFile`.)
   */
  const sound = (d: Design): boolean =>
    Number.isFinite(d.frequency) &&
    d.frequency > 0 &&
    Number.isFinite(d.z0) &&
    d.z0 > 0 &&
    finiteZ(d.load) &&
    (d.sweep.loads ?? []).every((l) => Number.isFinite(l.frequency) && finiteZ(l.z));

  const update = (fn: (d: Design) => Design, transient = false): void => {
    const current = get().design;
    const next = fn(current);
    // A no-op (for example moving the first element up) leaves history alone.
    if (next === current) return;
    // A change that would leave the design unusable is refused with a word, whichever path
    // asked for it (a 0 Hz row from a measured file, a NaN through the API).
    if (!sound(next)) {
      pending = undefined;
      set({
        message:
          'Refused: the frequency and Z0 must be positive and the load and sweep loads finite.',
      });
      return;
    }
    record(next, transient);
  };

  return {
    design: emptyDesign(),
    past: [],
    future: [],
    selected: null,
    chart: { zGrid: true, yGrid: false, density: 'normal', labels: true },
    view: 'chart',
    response: { logX: false, markers: [], vswrLimit: 2 },
    loads: 0,
    message: null,
    messageExtras: null,
    datapointInput: false,
    twoPortFiles: {},

    init: (design) => {
      transientRun = false;
      set({ design, past: [], future: [], selected: design.elements.length });
    },
    loadDesign: (design) => {
      transientRun = false;
      record(design, false);
      set({ loads: get().loads + 1 });
      // The file stays in memory: undo brings the previous design and its link to the file back.
      set({ selected: design.elements.length });
    },
    replaceDesign: (design) => {
      transientRun = false;
      // The future belonged to the design being replaced.
      set({ design, selected: design.elements.length, future: [] });
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
        message: stepMessage('Undo', design),
        design: previous,
        past: past.slice(0, -1),
        future: [design, ...future],
      });
    },
    redo: () => {
      const { past, design, future } = get();
      const [next, ...rest] = future;
      if (!next) return;
      transientRun = false;
      set({
        design: next,
        past: [...past, design],
        future: rest,
        message: stepMessage('Redo', next),
      });
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
    setMessage: (message, options) => {
      set({ message, messageExtras: null });
      if (options) flag(options);
    },
    setDatapointInput: (datapointInput) => set({ datapointInput }),

    setName: (name) => update((d) => ({ ...d, name })),
    updateFollowingDevice: (fn) => update((d) => deviceFollows(fn(d))),
    setFrequency: (frequency) =>
      update((d) => {
        // The device follows the file only while the design still points at that file
        // (a hand edit removes the source; undo brings it back).
        const found = resolveFile(d.twoPort?.source);
        const fromFile = found
          ? twoPortFromFile(found.file.data, frequency, found.file.fileName, d.z0, found.id)
          : null;
        if (fromFile) {
          pending = fromFile.source?.clamped
            ? `${found?.file.fileName}: the design frequency is outside the file; the two-port panel holds the nearest end`
            : null;
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
      const { defaultFrequency, defaultZ0 } = useSettings.getState().settings;
      record(emptyDesign({ frequency: defaultFrequency, z0: defaultZ0 }), false);
      set({
        loads: get().loads + 1,
        selected: 0,
        message: 'New design. Undo brings the previous one back.',
      });
      flag({ undo: true });
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
    addElements: (els) => {
      if (els.length === 0) return;
      update((d) => {
        const elements = [...d.elements];
        for (const el of els) elements.push(withIdentity(el, elements));
        return { ...d, elements };
      });
      set({ selected: get().design.elements.length });
    },
    updateElement: (index, el, transient = false) =>
      update(
        (d) => ({ ...d, elements: d.elements.map((e, i) => (i === index ? el : e)) }),
        transient,
      ),
    removeElement: (index) => {
      const removed = get().design.elements[index];
      if (!removed) return;
      // The message names the part and rides on the step, so Undo repeats it.
      pending = `Removed ${elementName(removed)} ${index + 1}: ${elementSummary(removed)}`;
      update((d) => ({ ...d, elements: d.elements.filter((_, i) => i !== index) }));
      flag({ undo: true });
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
    addDatapoint: (point) => {
      const points = userDatapoints(get().design);
      if (points.length >= MAX_DATAPOINTS) {
        set({ message: `All ${MAX_DATAPOINTS} datapoints are used; remove one first.` });
        return;
      }
      update((d) => {
        const next = addDatapoint(d, point);
        if (next !== d) {
          pending = `Added DP${userDatapoints(next).length}: ${fmtComplex(point.z)} Ω at ${fmtFrequency(point.frequency)}`;
        }
        // A frequency sweep that is running keeps running when the second datapoint arrives.
        const firstExtra = next !== d && userDatapoints(d).length === 1;
        const keepFrequency =
          firstExtra && d.sweep.enabled && !d.sweep.loads?.length && d.sweep.mode === undefined;
        return keepFrequency ? { ...next, sweep: { ...next.sweep, mode: 'frequency' } } : next;
      });
    },
    removeDatapoint: (index) => {
      const before = get().design;
      update((d) => {
        const removed = removeDatapoint(d, index);
        if (removed === d) return d;
        const next = deviceFollows(removed);
        // A clamped device keeps its word after the removal's own.
        const note = typeof pending === 'string' && pending ? ` ${pending}` : '';
        pending = `Removed DP${index + 1}.${note}`;
        return next;
      });
      // Chain node 0 is the start whichever datapoint that is; a refused removal changes nothing.
      if (get().design !== before) {
        set({ selected: 0 });
        flag({ undo: true });
      }
    },
    setStartDatapoint: (index) => {
      const before = get().design;
      update((d) => deviceFollows(setStartDatapoint(d, index)));
      const d = get().design;
      if (d === before) return;
      // A clamped device rides along with the status line, read from the device itself.
      const src = d.twoPort?.source;
      const clamp = src?.clamped
        ? ` ${src.fileName}: the design frequency is outside the file; the two-port panel holds the nearest end`
        : '';
      set({
        selected: 0,
        message: `The network starts at DP${index + 1}; design frequency is now ${formatEngineering(d.frequency, { unit: 'Hz', digits: 4 })}.${clamp}`,
      });
    },
    setDatapoint: (index, patch) => {
      const d = get().design;
      // The start is load and frequency; every other point is stored with the list.
      if (startIndex(d) === index) {
        // One history entry whether one field or both change.
        update((cur) => {
          const withLoad = patch.z ? { ...cur, load: patch.z } : cur;
          const f = patch.frequency;
          const next =
            f === undefined || f === withLoad.frequency
              ? withLoad
              : {
                  ...withLoad,
                  frequency: f,
                  elements: withLoad.elements.map((el) =>
                    el.kind === 'line' || el.kind === 'openStub' || el.kind === 'shortStub'
                      ? { ...el, refFrequency: f }
                      : el,
                  ),
                };
          return deviceFollows(next);
        });
        return;
      }
      update((cur) => updateDatapoint(cur, index, patch));
    },
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
      set({ twoPortFiles: { ...get().twoPortFiles, [fileId]: { data, fileName } } });
      // The message rides on the recorded step, so it survives record() and is cleared by the next edit.
      pending = twoPort.source?.clamped
        ? `${fileName}: the design frequency is outside the file; the two-port panel holds the nearest end`
        : `Device filled from ${fileName}`;
      update((prev) => ({ ...prev, twoPort, showStability: true }));
    },
    setShowStability: (showStability) => update((d) => ({ ...d, showStability })),
    setGainCircles: (gainCircles) => update((d) => ({ ...d, gainCircles })),
    setNoiseCircles: (noiseCircles) => update((d) => ({ ...d, noiseCircles })),
    setRealize: (patch) => update((d) => ({ ...d, realize: { ...d.realize, ...patch } })),
    setLosses: (patch) => update((d) => ({ ...d, losses: { ...d.losses, ...patch } })),
    setTolerance: (patch) =>
      update((d) => ({ ...d, tolerance: { ...(d.tolerance ?? DEFAULT_TOLERANCE), ...patch } })),
    setStress: (patch) =>
      update((d) => ({ ...d, stress: { ...(d.stress ?? DEFAULT_STRESS), ...patch } })),
    setLimits: (limits) => update((d) => ({ ...d, limits })),
    setPackage: (index, pkg) =>
      update((d) => ({
        ...d,
        elements: d.elements.map((el, i) => {
          if (i !== index || (el.kind !== 'L' && el.kind !== 'C')) return el;
          if (pkg === null) {
            if (el.package === undefined) return el;
            const { package: _pkg, ...rest } = el;
            void _pkg;
            return rest;
          }
          return el.package === pkg ? el : { ...el, package: pkg };
        }),
      })),
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
