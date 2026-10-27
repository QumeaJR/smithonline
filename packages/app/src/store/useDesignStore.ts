import { track, trackDynamic } from '../lib/analytics/track';
import type { Complex, Element, LimitArea, PackageId, TouchstoneData } from '@smithonline/core';
import { formatEngineering } from '@smithonline/core';
import { create } from 'zustand';
import {
  MAX_DESIGN_NAME,
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
import { hasMeasuredLoad, nearestRow } from '../lib/measuredLoad';
import { DEFAULT_STRESS } from '../lib/stress';
import { isVswrLimit, toleranceSettings } from '../lib/tolerance';
import { elementName, elementSummary } from '../lib/elements';
import { elementProblem } from '../lib/elementRule';
import { fmtComplex, fmtFrequency, fmtSig } from '../lib/format';
import { isRefusal, refusal } from '../lib/messageKind';
import {
  SCOPE_LABELS,
  designBuild,
  newDesignFromDefaults,
  ownBuild,
  registerDesignSource,
  sameBuild,
  storedBuild,
  type ResolvedBuild,
} from '../lib/designBuild';

export type GridDensity = 'coarse' | 'normal' | 'fine';

export interface ChartOptions {
  readonly zGrid: boolean;
  readonly yGrid: boolean;
  readonly density: GridDensity;
  readonly labels: boolean;
  /** Draw the imported (measured) load alone: its points and its model across the band. */
  readonly measuredLoad: boolean;
}

/**
 * The datapoint table columns a phone can add to its default #, Z, VSWR and
 * RL; wider layouts always show all of them.
 */
export type DatapointColumn = 'gammaMag' | 'gammaAngle' | 'q';

/** The main area shows the Smith chart, the response plots or the S-Plot of loaded files. */
export type View = 'chart' | 'response' | 'splot';

export const MAX_MARKERS = 8;

/** Whoever opens a run of transient changes (the chart during a drag): any object will do. */
export type RunOwner = object;
/** A transient change: true, or the owner of the run it belongs to (useRunOwner). */
export type Transient = boolean | RunOwner;

/** A button the status message carries, such as "Scale sweep". */
export interface MessageAction {
  readonly label: string;
  readonly run: () => void;
  /** Shown for UNDO_MESSAGE_MS like Undo (an undo of its own, such as a removed S-Plot entry). */
  readonly timed?: boolean;
}

export interface MessageOptions {
  /** Show an Undo button with the message for UNDO_MESSAGE_MS (a removal, New, a load). */
  readonly undo?: boolean;
  /** A button that carries out what the message offers. */
  readonly action?: MessageAction;
  /**
   * An error or refusal: it stays on the phone as a banner until dismissed, where other
   * messages pass as a toast (docs/07 section 4, Status).
   */
  readonly error?: boolean;
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
  /** Also plot |S11| and VSWR of the load alone (before the network). */
  readonly loadAlone: boolean;
  /** Marker frequencies, Hz, in the order they were set. */
  readonly markers: readonly number[];
  /**
   * The shared frequency zoom of the Response panels (docs/10 section 4.2), with the sweep it
   * was made on: a change of the sweep range, Log f or the measured load clears it.
   */
  readonly xZoom?: { readonly range: readonly [number, number]; readonly basis: string } | null;
  /** The enlarged Response panel, or null (session state, kept across a view switch). */
  readonly enlarged?: string | null;
}

interface DesignState {
  design: Design;
  past: Design[];
  future: Design[];
  /** Selected datapoint index, or null. */
  selected: number | null;
  chart: ChartOptions;
  /** The extra datapoint columns chosen on a phone, beside the chart options. */
  datapointColumns: readonly DatapointColumn[];
  view: View;
  response: ResponseOptions;
  /** Counts designs that replaced the whole one (open, example, new); a tour ends when it moves. */
  loads: number;
  /**
   * The design on show was started new (New design, or an empty design at the start), not
   * opened, loaded from an example or a share link: the start guide shows for it.
   */
  fresh: boolean;
  /** The load the design had when it was started or opened: the start guide's "Set the load" ticks once the load differs from it. */
  createdLoad: Complex;
  /** Short status line message, cleared by the next one. */
  message: string | null;
  /** The Undo and action buttons of the message, while it is the one on show. */
  messageExtras: MessageExtras | null;
  /** Counts the messages set (cleared ones too): the same text twice is two messages. */
  messageSerial: number;
  /** The message on show is an error or a refusal (MessageOptions.error, lib/messageKind.ts). */
  messageError: boolean;
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
  /**
   * Start with a design (the autosaved one, a share link, a test's). `fresh` says it is a new
   * design (default: an empty ladder); a share link or an example is not.
   */
  init: (design: Design, options?: { readonly fresh?: boolean }) => void;
  /**
   * Replace the whole design (open, example, share link). Recorded in history; a label names
   * the step for Undo and Redo ("Undo: Loaded Example 5").
   */
  loadDesign: (design: Design, label?: string) => void;
  /**
   * Swap the current design without a history entry. Guided tours use it to
   * step through a design that was recorded once when the tour started, so
   * the whole tour is one undo.
   */
  replaceDesign: (design: Design) => void;
  /**
   * Fold every step since `origin` into one, named `label`: one Undo then goes from the design
   * on show straight back to `origin` (a guided workflow that ends, docs/09). Nothing happens
   * when `origin` is the design on show. When `origin` fell out of the history (more steps
   * than it keeps), it becomes the one step before the design on show.
   */
  squashSince: (origin: Design, label: string) => void;
  /**
   * Give library parts that came without their data (a share link) the data of the part library,
   * in place, without a history entry: the design means the same, it just evaluates from the
   * measured data instead of the fitted circuit.
   */
  attachPartData: (elements: readonly DesignElement[]) => void;
  /** Apply a change to the design. Recorded in history unless `transient` (a drag); an owner object makes it transient and names whose run it is. */
  update: (fn: (d: Design) => Design, transient?: Transient) => void;
  /**
   * Apply a change as one named step: the label is the status message and Undo and Redo
   * repeat it ("Undo: Optimized over ..."). With `undo`, the message carries the inline Undo
   * (a step that replaces large content). A change that changes nothing says nothing.
   */
  step: (label: string, fn: (d: Design) => Design, options?: MessageOptions) => void;
  /**
   * Like update, and a file-bound two-port device is re-read when the frequency changed. A
   * label is the step's message (with the device's own note after it) and its Undo name.
   */
  updateFollowingDevice: (fn: (d: Design) => Design, label?: string) => void;
  /**
   * End a run of transient changes (a drag) as one step. With a label, a run that changed
   * the design is named by it: the message says it and Undo and Redo repeat it.
   */
  commit: (label?: string) => void;
  /**
   * The owner of a transient run went away (the chart unmounted mid-drag): its run ends as
   * the step it already is, so the next transient change starts a step of its own. A run
   * of another owner, or none, is left alone.
   */
  endRun: (owner: RunOwner) => void;
  undo: () => void;
  redo: () => void;
  select: (index: number | null) => void;
  setChart: (patch: Partial<ChartOptions>) => void;
  setDatapointColumns: (columns: readonly DatapointColumn[]) => void;
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
  setLoad: (load: Complex, transient?: Transient) => void;
  /** Where the network should land; null means Z0. */
  setTarget: (target: Complex | null) => void;
  /** Start over with an empty design. Recorded in history, so undo brings the old one back. */
  newDesign: () => void;
  /** Replace the values of several elements at once as one history entry (a fit result). */
  setElementValues: (elements: readonly Element[]) => void;
  /** Append a core element at the source end; it receives an id and a colour. */
  /** Append a part; a label names the step in its message and in Undo and Redo. */
  addElement: (el: Element, label?: string) => void;
  /** Append several elements as one history entry (a match solution); a label names the step. */
  addElements: (els: readonly Element[], label?: string) => void;
  updateElement: (index: number, el: DesignElement, transient?: Transient) => void;
  removeElement: (index: number) => void;
  moveElement: (index: number, direction: -1 | 1) => void;
  /** Move the element at `from` so that it ends up at position `to`. */
  reorderElement: (from: number, to: number) => void;
  /** Change the sweep; a label names the step in its message and in Undo and Redo. */
  setSweep: (patch: Partial<SweepSettings>, label?: string) => void;
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
  /** The design's VSWR limit: the usable bandwidth, Tolerance and the next steps read it. */
  setVswrLimit: (limit: number) => void;
  /** Change the source power and the stress limits. */
  setStress: (patch: Partial<StressSettings>) => void;
  /** Replace the limit areas of the response plots. */
  setLimits: (limits: readonly LimitArea[]) => void;
  /**
   * Change the design's build (the board and the package models, docs/09b) as one named step.
   * The function gets the build the design evaluates with and returns the new one; the design
   * then carries all of it. A function that changes nothing records nothing.
   */
  setBuild: (label: string, fn: (build: ResolvedBuild) => ResolvedBuild) => void;
}

const HISTORY_LIMIT = 100;

/** A value series in the words of the Realize select ("E24", "my stock", "the part library"). */
function seriesWords(series: RealizeSettings['series']): string {
  return series === 'stock' ? 'my stock' : series === 'library' ? 'the part library' : series;
}

/**
 * The design with element `index` changed by `fn`; the same design when there is no such
 * element or `fn` leaves it as it is, so a change that changes nothing records nothing.
 */
function withElement(d: Design, index: number, fn: (el: DesignElement) => DesignElement): Design {
  const el = d.elements[index];
  if (!el) return d;
  const next = fn(el);
  return next === el ? d : { ...d, elements: d.elements.map((e, i) => (i === index ? next : e)) };
}

/** The default load of a design with this Z0: Z0 + j0. */
const complexOf = (z0: number): Complex => ({ re: z0, im: 0 });

export const useDesignStore = create<DesignState>()((rawSet, get) => {
  /** Every change that sets the message counts it, so a repeated text shows again. */
  let messages = 0;
  type Patch = Partial<DesignState>;
  const set = (partial: Patch | ((s: DesignState) => Patch)): void => {
    const patch = typeof partial === 'function' ? partial(get()) : partial;
    rawSet(
      patch.message !== undefined
        ? {
            ...patch,
            messageSerial: ++messages,
            messageError: patch.messageError ?? isRefusal(patch.message),
          }
        : patch,
    );
  };
  let transientRun = false;
  /** The owner of the open transient run, or null for a run opened with plain `true`. */
  let runOwner: RunOwner | null = null;
  // A status line an action prepared while changing the design; record() applies it, and any
  // other change to the design clears the previous message so nothing stale stays on screen.
  let pending: string | null | undefined;
  /**
   * The name of a quiet step (a typed value, a switch): Undo and Redo say it ("Undo: Changed
   * f to 450 MHz") while the step itself shows no message. A pending message wins over it.
   */
  let quiet: string | undefined;
  /** Run `fn` (a store change) with the quiet name of its step. */
  const named = (label: string, fn: () => void): void => {
    quiet = label;
    try {
      fn();
    } finally {
      quiet = undefined;
    }
  };
  /** The status message each recorded design was announced with, so Undo and Redo can repeat it. */
  const labelOf = new WeakMap<Design, string>();
  /**
   * The designs started by New (or an empty start) and every design edited from one: the
   * start guide shows while the design on show is one of them, so an Undo back past New
   * hides it and a Redo brings it back (docs/07 section 4, Start guide).
   */
  const freshLine = new WeakSet<Design>();
  const startDesign = emptyDesign();
  freshLine.add(startDesign);
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
    // Said once, when the device becomes clamped: not carried into every later step's words.
    pending =
      fromFile.source?.clamped && !source.clamped
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

  const record = (next: Design, transientOrOwner: Transient): void => {
    const { design, past } = get();
    const transient = transientOrOwner !== false;
    const owner = typeof transientOrOwner === 'object' ? transientOrOwner : null;
    const message = pending !== undefined ? pending : null;
    pending = undefined;
    const label = message || quiet;
    quiet = undefined;
    if (label) labelOf.set(next, label);
    if (freshLine.has(design)) freshLine.add(next);
    const fresh = freshLine.has(next);
    // A transient change joins the open run of the same owner; another owner's run is closed
    // and this change starts a step of its own.
    if (transient && transientRun && runOwner === owner) {
      set({ design: next, fresh });
      return;
    }
    transientRun = transient;
    runOwner = transient ? owner : null;
    set({
      design: next,
      past: [...past.slice(-HISTORY_LIMIT + 1), design],
      future: [],
      message,
      messageExtras: null,
      fresh,
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

  const update = (fn: (d: Design) => Design, transient: Transient = false): void => {
    const current = get().design;
    const changed = fn(current);
    // A no-op (for example moving the first element up) leaves history alone.
    if (changed === current) return;
    // A whole new design (a workflow's start, a lesson step) gets its own build as well.
    const next = ownBuild(changed);
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
    // An element the readers (links, files, the autosave) would refuse is refused here, with
    // its reason, whichever path made it: the application never holds a design it could not
    // save and open again (lib/elementRule.ts).
    const bad = next.elements.findIndex(
      (el, i) => el !== current.elements[i] && elementProblem(el) !== null,
    );
    const badElement = next.elements[bad];
    if (badElement) {
      pending = undefined;
      set({
        message: refusal(
          `Refused: ${elementName(badElement)} ${bad + 1} ${elementProblem(badElement)}.`,
        ),
      });
      return;
    }
    record(next, transient);
  };

  return {
    design: startDesign,
    past: [],
    future: [],
    selected: null,
    chart: { zGrid: true, yGrid: false, density: 'normal', labels: true, measuredLoad: false },
    datapointColumns: [],
    view: 'chart',
    response: { logX: false, loadAlone: false, markers: [] },
    loads: 0,
    fresh: true,
    createdLoad: emptyDesign().load,
    message: null,
    messageExtras: null,
    messageSerial: 0,
    messageError: false,
    datapointInput: false,
    twoPortFiles: {},

    init: (given, options) => {
      // Every design on show and in history carries its own build (docs/09b): none follows the
      // browser's defaults for new designs, so Undo always brings back the network as built.
      const design = ownBuild(given);
      transientRun = false;
      const fresh = options?.fresh ?? design.elements.length === 0;
      if (fresh) freshLine.add(design);
      else freshLine.delete(design);
      set({
        design,
        past: [],
        future: [],
        selected: design.elements.length,
        fresh,
        createdLoad: complexOf(design.z0),
      });
    },
    loadDesign: (given, label) => {
      const design = ownBuild(given);
      transientRun = false;
      if (label) pending = label;
      record(design, false);
      // An opened file, an example or a link is not a new design, whatever came before it.
      freshLine.delete(design);
      pending = undefined;
      set({ loads: get().loads + 1, fresh: false, createdLoad: complexOf(design.z0) });
      // The file stays in memory: undo brings the previous design and its link to the file back.
      set({ selected: design.elements.length });
      // A named load replaces the whole design: its message offers Undo inline.
      if (label) flag({ undo: true });
    },
    replaceDesign: (given) => {
      const design = ownBuild(given);
      transientRun = false;
      // The step keeps its name for Undo and Redo (a tour's later steps are still its start).
      // A design already in history (a tour's Back to a step recorded earlier) keeps its own.
      const label = labelOf.get(get().design);
      if (label && !get().past.includes(design)) labelOf.set(design, label);
      if (freshLine.has(get().design)) freshLine.add(design);
      // The future belonged to the design being replaced.
      set({ design, selected: design.elements.length, future: [] });
    },
    squashSince: (origin, label) => {
      const { design, past } = get();
      if (design === origin) return;
      const at = past.lastIndexOf(origin);
      transientRun = false;
      runOwner = null;
      labelOf.set(design, label);
      // More steps than the history keeps: the origin fell out, and everything older with it.
      // It comes back as the one step before, so one Undo still brings it back.
      set({ past: at < 0 ? [origin] : past.slice(0, at + 1), future: [] });
    },
    attachPartData: (elements) => {
      const before = get().design;
      const design = { ...before, elements };
      const label = labelOf.get(before);
      if (label) labelOf.set(design, label);
      if (freshLine.has(before)) freshLine.add(design);
      set({ design });
    },
    update,
    step: (label, fn, options) => {
      const before = get().design;
      pending = label;
      try {
        update(fn);
      } finally {
        // A function that throws leaves no label behind for the next quiet step.
        pending = undefined;
        quiet = undefined;
      }
      if (options && get().design !== before) flag(options);
    },
    commit: (label) => {
      const changed = transientRun;
      transientRun = false;
      runOwner = null;
      if (label && changed) {
        labelOf.set(get().design, label);
        set({ message: label, messageExtras: null });
      }
    },
    endRun: (owner) => {
      if (transientRun && runOwner === owner) {
        transientRun = false;
        runOwner = null;
      }
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
        fresh: freshLine.has(previous),
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
        fresh: freshLine.has(next),
      });
    },
    select: (selected) => set({ selected }),
    setChart: (patch) => set((s) => ({ chart: { ...s.chart, ...patch } })),
    setDatapointColumns: (datapointColumns) => set({ datapointColumns }),
    setView: (view) => set({ view }),
    setResponse: (patch) => set((s) => ({ response: { ...s.response, ...patch } })),
    addMarker: (frequency) =>
      set((s) => {
        const { markers } = s.response;
        if (markers.includes(frequency)) return {};
        if (markers.length >= MAX_MARKERS) {
          return { message: refusal(`All ${MAX_MARKERS} markers are set; remove one first.`) };
        }
        return { response: { ...s.response, markers: [...markers, frequency] } };
      }),
    removeMarker: (index) =>
      set((s) => ({
        response: { ...s.response, markers: s.response.markers.filter((_, i) => i !== index) },
      })),
    setMessage: (message, options) => {
      set({
        message,
        messageExtras: null,
        messageError: message !== null && (options?.error ?? isRefusal(message)),
      });
      if (options) flag(options);
    },
    setDatapointInput: (datapointInput) => set({ datapointInput }),

    setName: (given) => {
      // As long as a link or a file keeps it (MAX_DESIGN_NAME).
      const name = given.slice(0, MAX_DESIGN_NAME);
      named(`Renamed the design to "${name}"`, () => update((d) => ({ ...d, name })));
    },
    updateFollowingDevice: (fn, label) =>
      named('Changed the load and frequency', () =>
        update((d) => {
          pending = undefined;
          const next = deviceFollows(fn(d));
          // The device's note (a clamped frequency) rides after the step's own words.
          if (label) {
            pending = typeof pending === 'string' && pending ? `${label}; ${pending}` : label;
          }
          return next;
        }),
      ),
    setFrequency: (frequency) =>
      named(`Changed f to ${fmtFrequency(frequency)}`, () =>
        update((d) => {
          // Over a measured load the nominal point (DP1) is the row nearest f, live.
          const row = hasMeasuredLoad(d) ? nearestRow(d.sweep.loads ?? [], frequency) : null;
          if (row) {
            pending = `Changed f to ${fmtFrequency(frequency)}; DP1 is the ${fmtFrequency(row.frequency)} row`;
          }
          // The device follows the file only while the design still points at that file
          // (a hand edit removes the source; undo brings it back).
          const found = resolveFile(d.twoPort?.source);
          const fromFile = found
            ? twoPortFromFile(found.file.data, frequency, found.file.fileName, d.z0, found.id)
            : null;
          if (fromFile) {
            const clamp = fromFile.source?.clamped
              ? `${found?.file.fileName}: the design frequency is outside the file; the two-port panel holds the nearest end`
              : null;
            pending = row ? (clamp ? `${pending}; ${clamp}` : pending) : clamp;
          }
          return {
            ...d,
            frequency,
            ...(row ? { load: { re: row.z.re, im: row.z.im } } : {}),
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
      ),
    setZ0: (z0) =>
      named(`Changed Z0 to ${fmtSig(z0)} Ω`, () =>
        update((d) => {
          const found = resolveFile(d.twoPort?.source);
          const fromFile = found
            ? twoPortFromFile(found.file.data, d.frequency, found.file.fileName, z0, found.id)
            : null;
          return { ...d, z0, twoPort: fromFile ?? d.twoPort };
        }),
      ),
    setLoad: (load, transient = false) =>
      named(`Changed the load to ${fmtComplex(load, 1)} Ω`, () =>
        update((d) => ({ ...d, load }), transient),
      ),
    setTarget: (target) =>
      named(
        target ? `Set the target to ${fmtComplex(target, 1)} Ω` : 'Set the target back to Z0',
        () => update((d) => ({ ...d, target })),
      ),
    newDesign: () => {
      transientRun = false;
      // The step's label, so Undo and Redo name it ("Undo: New design").
      pending = 'New design';
      // The defaults for new designs: f, Z0, the build, Q, series, tolerance and VSWR limit.
      const fresh = newDesignFromDefaults();
      freshLine.add(fresh);
      record(fresh, false);
      set({
        loads: get().loads + 1,
        fresh: true,
        createdLoad: fresh.load,
        selected: 0,
        message: 'New design. Undo brings the previous one back.',
      });
      flag({ undo: true });
    },
    setElementValues: (elements) =>
      named('Changed the part values', () =>
        update((d) => ({
          ...d,
          elements: d.elements.map((el, i) => {
            const next = elements[i];
            return next ? ({ ...el, ...next } as DesignElement) : el;
          }),
        })),
      ),
    addElement: (el, label) => {
      if (label) pending = label;
      update((d) => ({ ...d, elements: [...d.elements, withIdentity(el, d.elements)] }));
      pending = undefined;
      set({ selected: get().design.elements.length });
    },
    addElements: (els, label) => {
      if (els.length === 0) return;
      if (label) pending = label;
      update((d) => {
        const elements = [...d.elements];
        for (const el of els) elements.push(withIdentity(el, elements));
        return { ...d, elements };
      });
      pending = undefined;
      set({ selected: get().design.elements.length });
    },
    updateElement: (index, el, transient = false) =>
      named(`Changed ${elementName(el)} ${index + 1} to ${elementSummary(el)}`, () =>
        update(
          (d) => ({ ...d, elements: d.elements.map((e, i) => (i === index ? el : e)) }),
          transient,
        ),
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
        // The step is named for its message and for Undo and Redo.
        pending = `Moved ${elementName(moved as DesignElement)} ${from + 1} to position ${to + 1}`;
        return { ...d, elements };
      }),
    setSweep: (patch, label) => {
      // A patch with the values the sweep already has changes nothing and records nothing.
      const current = get().design.sweep;
      const sweep = current as unknown as Record<string, unknown>;
      if (Object.entries(patch).every(([k, v]) => Object.is(sweep[k], v))) return;
      // One rule for an inverted range everywhere: a start typed above the stop (or a stop
      // below the start) is swapped on commit, and the message says so.
      const merged = { ...current, ...patch };
      let applied = patch;
      let said = label;
      if (
        (patch.start !== undefined || patch.stop !== undefined) &&
        merged.stop > 0 &&
        merged.start > merged.stop
      ) {
        applied = { ...patch, start: merged.stop, stop: merged.start };
        said = `Swapped the sweep to ${fmtFrequency(merged.stop)} to ${fmtFrequency(merged.start)}`;
      }
      if (said) pending = said;
      named(
        Object.keys(patch).length === 1 && patch.enabled !== undefined
          ? `Sweep ${patch.enabled ? 'on' : 'off'}`
          : 'Changed the sweep',
        () => update((d) => ({ ...d, sweep: { ...d.sweep, ...applied } })),
      );
      pending = undefined;
    },
    addDatapoint: (point) => {
      const points = userDatapoints(get().design);
      if (points.length >= MAX_DATAPOINTS) {
        set({ message: refusal(`All ${MAX_DATAPOINTS} datapoints are used; remove one first.`) });
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
      update((d) => {
        const next = deviceFollows(setStartDatapoint(d, index));
        if (next === d) return d;
        // A clamped device rides along with the status line, read from the device itself.
        const src = next.twoPort?.source;
        const clamp = src?.clamped
          ? ` ${src.fileName}: the design frequency is outside the file; the two-port panel holds the nearest end`
          : '';
        // The message names the step, so Undo and Redo repeat it.
        pending = `The network starts at DP${index + 1}; design frequency is now ${formatEngineering(next.frequency, { unit: 'Hz', digits: 4 })}.${clamp}`;
        return next;
      });
      if (get().design !== before) set({ selected: 0 });
    },
    setDatapoint: (index, patch) =>
      named(`Changed DP${index + 1}`, () => {
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
      }),
    setVswrCircles: (vswrCircles) =>
      named('Changed the VSWR circles', () => update((d) => ({ ...d, vswrCircles }))),
    setQContours: (qContours) =>
      named('Changed the Q contours', () => update((d) => ({ ...d, qContours }))),
    setTwoPort: (twoPort) => {
      // Keeps the file in memory: undoing the edit restores the link through the source.
      if (get().design.twoPort?.source) set({ message: null });
      named(twoPort ? 'Changed the two-port device' : 'Removed the two-port device', () =>
        update((d) => {
          if (!twoPort) return { ...d, twoPort: null };
          return { ...d, twoPort: { s: twoPort.s, noise: twoPort.noise } };
        }),
      );
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
    setShowStability: (showStability) =>
      named(`${showStability ? 'Showed' : 'Hid'} the stability circles`, () =>
        update((d) => ({ ...d, showStability })),
      ),
    setGainCircles: (gainCircles) =>
      named('Changed the gain circles', () => update((d) => ({ ...d, gainCircles }))),
    setNoiseCircles: (noiseCircles) =>
      named('Changed the noise circles', () => update((d) => ({ ...d, noiseCircles }))),
    setRealize: (patch) => {
      track('build', 'realization', 'change');
      if (patch.series !== undefined) trackDynamic('realize', patch.series);
      // Each change is named for Undo; a new value series or scope says so in the status line,
      // as a stackup or package edit does; the switch and the stock text stay quiet.
      const words = [
        patch.enabled !== undefined ? `Realize ${patch.enabled ? 'on' : 'off'}` : null,
        patch.series !== undefined ? `Value series set to ${seriesWords(patch.series)}` : null,
        patch.scope !== undefined ? `Realize scope set to ${SCOPE_LABELS[patch.scope]}` : null,
        patch.stockText !== undefined ? 'Changed the stock list' : null,
      ].filter((w): w is string => w !== null);
      const label = words.join('; ') || 'Changed the Realize settings';
      const fn = (d: Design): Design => ({ ...d, realize: { ...d.realize, ...patch } });
      if (patch.series !== undefined || patch.scope !== undefined) get().step(label, fn);
      else named(label, () => update(fn));
    },
    setLosses: (patch) => {
      track('build', 'losses', 'change');
      const words = [
        patch.enabled !== undefined ? `Losses ${patch.enabled ? 'on' : 'off'}` : null,
        patch.inductorQ !== undefined
          ? `Default Q of inductors set to ${fmtSig(patch.inductorQ)}`
          : null,
        patch.capacitorQ !== undefined
          ? `Default Q of capacitors set to ${fmtSig(patch.capacitorQ)}`
          : null,
      ].filter((w): w is string => w !== null);
      const label = words.join('; ') || 'Changed the loss settings';
      const fn = (d: Design): Design => ({ ...d, losses: { ...d.losses, ...patch } });
      if (patch.inductorQ !== undefined || patch.capacitorQ !== undefined) get().step(label, fn);
      else named(label, () => update(fn));
    },
    setTolerance: (patch) =>
      named('Changed the tolerance settings', () =>
        update((d) => ({ ...d, tolerance: { ...toleranceSettings(d), ...patch } })),
      ),
    setVswrLimit: (limit) => {
      // One rule for the limit (lib/tolerance.ts isVswrLimit): the fields refuse anything else.
      if (!isVswrLimit(limit)) return;
      named(`Changed the VSWR limit to ${fmtSig(limit)}`, () =>
        update((d) =>
          toleranceSettings(d).vswrLimit === limit
            ? d
            : { ...d, tolerance: { ...toleranceSettings(d), vswrLimit: limit } },
        ),
      );
    },
    setStress: (patch) => {
      if (patch.limits !== undefined) track('build', 'ratings', 'change');
      named('Changed the power and stress limits', () =>
        update((d) => ({ ...d, stress: { ...(d.stress ?? DEFAULT_STRESS), ...patch } })),
      );
    },
    setLimits: (limits) =>
      named('Changed the limit areas', () => update((d) => ({ ...d, limits }))),
    // A Build edit says what changed in the status line, in the words Undo and Redo repeat.
    setBuild: (label, fn) =>
      get().step(label, (d) => {
        const current = designBuild(d);
        const next = fn(current);
        return sameBuild(current, next) ? d : { ...d, build: storedBuild(next) };
      }),
    setPackage: (index, pkg) => {
      const target = get().design.elements[index];
      named(
        target && pkg === null
          ? `Removed the package of ${elementName(target)} ${index + 1}`
          : target
            ? `Set the package of ${elementName(target)} ${index + 1} to ${pkg}`
            : 'Changed a package',
        () =>
          update((d) =>
            withElement(d, index, (el) => {
              if (el.kind !== 'L' && el.kind !== 'C') return el;
              if (pkg === null) {
                if (el.package === undefined) return el;
                const { package: _pkg, ...rest } = el;
                void _pkg;
                return rest;
              }
              return el.package === pkg ? el : { ...el, package: pkg };
            }),
          ),
      );
    },
    toggleLock: (index) => {
      const target = get().design.elements[index];
      named(
        target
          ? `${target.locked ? 'Unlocked' : 'Locked'} ${elementName(target)} ${index + 1}`
          : 'Changed a lock',
        () =>
          update((d) =>
            withElement(d, index, (el) => {
              if (el.locked) {
                const { locked: _locked, ...rest } = el;
                void _locked;
                return rest as DesignElement;
              }
              return { ...el, locked: true };
            }),
          ),
      );
    },
  };
});

// Modules below the store (new elements, the workflows) read the build of the design on show.
registerDesignSource(() => useDesignStore.getState().design);
