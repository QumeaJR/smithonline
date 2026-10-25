import {
  complex,
  ladderFromXmlsc,
  readXmlsc,
  sweepValues,
  type Complex,
  type Element,
  type ESeries,
  type LimitArea,
  type NoiseParameters,
  type RealizeScope,
  type StressLimits,
  type SParameters,
  type SweepLoad,
  type XmlscDesign,
} from '@smithonline/core';
import { colorByIndex, nextColor } from './colors';
import { MAX_DATAPOINTS } from './datapoints';

/**
 * A core element plus the identity the application needs: a stable id for
 * React keys and drag and drop, and the colour it keeps wherever it is moved.
 * `locked` keeps the element at its exact value in Realize mode.
 */
export type DesignElement = Element & {
  readonly id: string;
  readonly color: string;
  readonly locked?: boolean;
  /** Free text kept with the element, for example the winding of an inductor. */
  readonly note?: string;
};

/** Source power and the largest voltage and current each part kind may see. */
export interface StressSettings {
  /** Available power of the Z0 source, W; 0 switches the stress columns off. */
  readonly power: number;
  /** The unit the power is shown and typed in; the value is always kept in watts. */
  readonly unit: 'W' | 'dBm';
  readonly limits: StressLimits;
}

/** Settings of the Monte Carlo tolerance analysis. */
export interface ToleranceSettings {
  readonly runs: number;
  readonly seed: number;
  readonly distribution: 'uniform' | 'normal';
  /** Tolerance of every lumped part in percent; null takes the tolerance of the active E series. */
  readonly percent: number | null;
  /** VSWR a run must stay within to pass. */
  readonly vswrLimit: number;
  /** Judge each run by its worst VSWR over the sweep range instead of the design frequency. */
  readonly overBand: boolean;
  /** Tolerance in percent per element id, replacing the default (0 keeps the element exact). */
  readonly overrides: Readonly<Record<string, number>>;
  /**
   * Correlation coefficient (0 to 1) of the parts of one kind: parts from one reel drift
   * together. Absent in older designs, which is 0 for every kind.
   */
  readonly correlation?: Partial<Readonly<Record<'L' | 'C' | 'R', number>>>;
}

/** Realize mode: snap values to a series or to the user's own stock. */
export interface RealizeSettings {
  readonly enabled: boolean;
  /** An E series, or "stock" for the pasted list. */
  readonly series: ESeries | 'stock';
  /** The stock list as typed, parsed with parseStock when used. */
  readonly stockText: string;
  readonly scope: RealizeScope;
}

/** Loss model: default Q for inductors and capacitors that have no Q of their own. */
export interface LossSettings {
  readonly enabled: boolean;
  readonly inductorQ: number;
  readonly capacitorQ: number;
}

export const DEFAULT_REALIZE: RealizeSettings = {
  enabled: false,
  series: 'E24',
  stockText: '',
  scope: 'all',
};

export const DEFAULT_LOSSES: LossSettings = {
  enabled: false,
  inductorQ: 50,
  capacitorQ: 500,
};

export function newId(): string {
  return Math.random().toString(36).slice(2, 10);
}

/** Give a core element an id and the next free colour. */
export function withIdentity(el: Element, existing: readonly DesignElement[]): DesignElement {
  return { ...el, id: newId(), color: nextColor(existing) };
}

/** Elements from a file or an old payload: keep ids and colours when present, else assign by position. */
export function identify(elements: readonly Element[]): DesignElement[] {
  return elements.map((el, i) => {
    const partial = el as Partial<DesignElement>;
    const { note: rawNote, ...rest } = el as Element & { note?: unknown };
    return {
      ...rest,
      id: typeof partial.id === 'string' && partial.id ? partial.id : newId(),
      color: typeof partial.color === 'string' && partial.color ? partial.color : colorByIndex(i),
      // A note is text only; a link or file may carry anything.
      ...(typeof rawNote === 'string' && rawNote ? { note: rawNote.slice(0, 500) } : {}),
    } as DesignElement;
  });
}

/**
 * Sweep settings shown in the right panel. Without loads the sweep runs
 * over frequency with the design load; with loads it is a datapoint sweep
 * (Smith V4.1 "sweep versus datapoints"): the network applied to each
 * imported point at its own frequency, drawn as SP markers.
 */
export interface SweepSettings {
  readonly enabled: boolean;
  /** Hz. */
  readonly start: number;
  /** Hz. */
  readonly stop: number;
  readonly points: number;
  /** Datapoint sweep: the imported points, each at its own frequency. */
  readonly loads?: readonly SweepLoad[];
  /** Where the datapoint sweep came from (file name). */
  readonly loadsName?: string;
  /** Which sweep runs while loads are present; absent means datapoints. */
  readonly mode?: 'frequency' | 'datapoints';
}

/** True when the sweep runs over imported datapoints rather than over frequency. */
export function hasDatapointSweep(sweep: SweepSettings): boolean {
  return sweep.loads !== undefined && sweep.loads.length > 0 && sweep.mode !== 'frequency';
}

/** Where the device parameters were read from. */
export interface TwoPortSource {
  readonly fileName: string;
  /** Id of the opened file instance in this session (name plus a counter); absent after a reload. */
  readonly fileId?: string;
  /** Hz, the frequency the parameters were interpolated at. */
  readonly frequency: number;
  /** Lowest and highest frequency in the file, Hz. */
  readonly covers: readonly [number, number];
  /** True when the design frequency lies outside the file and the nearest end was used. */
  readonly clamped: boolean;
}

/** The device the circles are drawn for: S-parameters and optional noise parameters. */
export interface TwoPort {
  readonly s: SParameters;
  readonly noise: NoiseParameters | null;
  /** Set when the parameters were read from a file at the design frequency. */
  readonly source?: TwoPortSource;
}

export type GainCircleType = 'available' | 'operating' | 'unilateralSource' | 'unilateralLoad';

export interface GainCircleSpec {
  readonly type: GainCircleType;
  /** Gain of the circle, dB. */
  readonly gainDb: number;
}

/** Everything that describes one design; this is what undo, autosave and share links carry. */
export interface Design {
  readonly name: string;
  /** Reference impedance, ohm. */
  readonly z0: number;
  /** Design frequency, Hz. */
  readonly frequency: number;
  /** Load impedance of the datapoint the chain starts from, ohm. */
  readonly load: Complex;
  /**
   * The user datapoints other than the start, each at its own frequency (see
   * lib/datapoints.ts). Absent for the usual single load.
   */
  readonly datapoints?: readonly SweepLoad[];
  /** Position of the start among all user datapoints (DP numbering, 0-based); 0 when absent. */
  readonly startSlot?: number;
  /** Where the network should land, ohm; null means Z0 (the chart centre). */
  readonly target: Complex | null;
  /** Elements from the load towards the source. */
  readonly elements: readonly DesignElement[];
  /** VSWR circles to draw. */
  readonly vswrCircles: readonly number[];
  /** Constant-Q contours to draw. */
  readonly qContours: readonly number[];
  readonly sweep: SweepSettings;
  readonly twoPort: TwoPort | null;
  /** Draw the input and output stability circles of the two-port. */
  readonly showStability: boolean;
  readonly gainCircles: readonly GainCircleSpec[];
  /** Noise figure circles, dB. */
  readonly noiseCircles: readonly number[];
  readonly realize: RealizeSettings;
  readonly losses: LossSettings;
  /** Limit areas on the response plots; absent in older designs. */
  readonly limits?: readonly LimitArea[];
  /** Source power and stress limits; absent in older designs. */
  readonly stress?: StressSettings;
  /** Monte Carlo settings; absent in older designs. */
  readonly tolerance?: ToleranceSettings;
}

export const DEFAULT_SWEEP: SweepSettings = {
  enabled: false,
  start: 100e6,
  stop: 1e9,
  points: 91,
};

/** The impedance the network is matched towards: the target, or Z0 when none is set. */
export function targetOf(design: Pick<Design, 'target' | 'z0'>): Complex {
  return design.target ?? defaultTarget(design.z0);
}

/** The default targets handed out so far, one object per Z0. */
const defaultTargets = new Map<number, Complex>();

/**
 * The target while none is set, Z0 itself: the same object for the same Z0,
 * so lists memoized on the target (Add parts, Broadband) keep their rows
 * across renders.
 */
function defaultTarget(z0: number): Complex {
  let t = defaultTargets.get(z0);
  if (!t) {
    t = Object.freeze(complex(z0, 0));
    // A handful of Z0 values per session; the cap only guards against a runaway caller.
    if (defaultTargets.size > 64) defaultTargets.clear();
    defaultTargets.set(z0, t);
  }
  return t;
}

/**
 * A fresh design: a load equal to Z0 at the default frequency, nothing else.
 * The defaults are 50 ohm and 1 GHz unless the settings say otherwise.
 */
export function emptyDesign(
  defaults: { readonly frequency?: number; readonly z0?: number } = {},
): Design {
  const z0 = defaults.z0 ?? 50;
  return {
    name: 'Untitled',
    z0,
    frequency: defaults.frequency ?? 1e9,
    load: complex(z0, 0),
    target: null,
    elements: [],
    vswrCircles: [],
    qContours: [],
    sweep: DEFAULT_SWEEP,
    twoPort: null,
    showStability: false,
    gainCircles: [],
    noiseCircles: [],
    realize: DEFAULT_REALIZE,
    losses: DEFAULT_LOSSES,
  };
}

const GAIN_TYPES: Readonly<Record<number, GainCircleType>> = {
  1: 'available',
  2: 'operating',
  3: 'unilateralSource',
};

/** Build a design from the records of a Smith V4.1 project file. */
export function designFromXmlsc(xml: string, name: string): Design {
  const parsed: XmlscDesign = readXmlsc(xml);
  const ladder = ladderFromXmlsc(parsed);
  const s = parsed.sweep;
  // The user datapoints other than the start, with the start's place in the numbering.
  // A file with more points than the application keeps as user datapoints (an imported
  // sweep saved by the original, for example) reopens as a datapoint sweep instead.
  const tooMany = ladder.sweepLoads.length > MAX_DATAPOINTS;
  const several = ladder.sweepLoads.length > 1 && !tooMany;
  const datapoints = several
    ? {
        datapoints: ladder.sweepLoads.filter((_, i) => i !== ladder.startIndex),
        startSlot: ladder.startIndex,
      }
    : {};
  // A sweep record with a non-finite or non-positive range is ignored rather than refused.
  const usableRange =
    s !== undefined &&
    Number.isFinite(s.startFrequency) &&
    Number.isFinite(s.stopFrequency) &&
    s.startFrequency > 0 &&
    s.stopFrequency > 0;
  const sweep: SweepSettings =
    s?.sweepType === 'frequency' && usableRange
      ? {
          enabled: true,
          start: s.startFrequency,
          stop: s.stopFrequency,
          points: Math.max(
            2,
            sweepValues(s.startFrequency, s.stopFrequency, s.stepFrequency).length,
          ),
          ...(several ? { mode: 'frequency' as const } : {}),
          // More points than the datapoint list holds: they stay with the design as sweep loads.
          ...(tooMany
            ? { mode: 'frequency' as const, loads: ladder.sweepLoads, loadsName: name }
            : {}),
        }
      : several
        ? {
            ...DEFAULT_SWEEP,
            // Several user datapoints are a datapoint sweep; the sweep record says whether it was on.
            enabled: s?.sweepType === 'datapoint',
            start: ladder.frequency / 2,
            stop: ladder.frequency * 2,
          }
        : tooMany
          ? {
              ...DEFAULT_SWEEP,
              enabled: s?.sweepType === 'datapoint',
              start: ladder.frequency / 2,
              stop: ladder.frequency * 2,
              loads: ladder.sweepLoads,
              loadsName: name,
              mode: 'datapoints' as const,
            }
          : { ...DEFAULT_SWEEP, start: ladder.frequency / 2, stop: ladder.frequency * 2 };
  // The circle records each repeat the device parameters; take the first of each.
  const sRecord = parsed.gainCircles[0]?.s ?? parsed.stabilityCircles[0]?.s ?? null;
  const nRecord = parsed.noiseCircles[0];
  const noise: NoiseParameters | null = nRecord
    ? {
        nfMinDb: nRecord.nfMinDb,
        gammaOpt: nRecord.gammaOpt,
        rn: nRecord.normalized ? nRecord.rn : nRecord.rn / ladder.z0,
      }
    : null;
  const twoPort: TwoPort | null = sRecord ? { s: sRecord, noise } : null;
  return {
    name,
    z0: ladder.z0,
    frequency: ladder.frequency,
    load: ladder.load,
    ...datapoints,
    target: null,
    elements: identify(ladder.elements),
    vswrCircles: parsed.vswrList.filter((v) => Number.isFinite(v) && v > 1),
    qContours: parsed.qList.filter((q) => Number.isFinite(q) && q > 0),
    sweep,
    twoPort,
    showStability: parsed.stabilityCircles.length > 0,
    gainCircles: parsed.gainCircles.map((g) => ({
      type:
        g.gainType === 3 && g.plane === 2
          ? 'unilateralLoad'
          : (GAIN_TYPES[g.gainType] ?? 'available'),
      gainDb: g.gainDb,
    })),
    noiseCircles: parsed.noiseCircles.map((n) => n.nfDb),
    realize: DEFAULT_REALIZE,
    losses: DEFAULT_LOSSES,
  };
}

/** Strip the file extension and dashes for a display name. */
export function nameFromFile(fileName: string): string {
  return fileName.replace(/\.[A-Za-z0-9]+$/, '').replace(/[-_]+/g, ' ');
}
