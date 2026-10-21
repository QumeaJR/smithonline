import {
  complex,
  ladderFromXmlsc,
  readXmlsc,
  sweepValues,
  type Complex,
  type Element,
  type ESeries,
  type NoiseParameters,
  type RealizeScope,
  type SParameters,
  type XmlscDesign,
} from '@smithonline/core';
import { colorByIndex, nextColor } from './colors';

/**
 * A core element plus the identity the application needs: a stable id for
 * React keys and drag and drop, and the colour it keeps wherever it is moved.
 * `locked` keeps the element at its exact value in Realize mode.
 */
export type DesignElement = Element & {
  readonly id: string;
  readonly color: string;
  readonly locked?: boolean;
};

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
    return {
      ...el,
      id: typeof partial.id === 'string' && partial.id ? partial.id : newId(),
      color: typeof partial.color === 'string' && partial.color ? partial.color : colorByIndex(i),
    };
  });
}

/** Frequency sweep settings shown in the right panel. */
export interface SweepSettings {
  readonly enabled: boolean;
  /** Hz. */
  readonly start: number;
  /** Hz. */
  readonly stop: number;
  readonly points: number;
}

/** The device the circles are drawn for: S-parameters and optional noise parameters. */
export interface TwoPort {
  readonly s: SParameters;
  readonly noise: NoiseParameters | null;
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
  /** Load impedance (DP1), ohm. */
  readonly load: Complex;
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
}

export const DEFAULT_SWEEP: SweepSettings = {
  enabled: false,
  start: 100e6,
  stop: 1e9,
  points: 91,
};

/** A fresh design: 50 ohm load at 1 GHz, nothing else. */
export function emptyDesign(): Design {
  return {
    name: 'Untitled',
    z0: 50,
    frequency: 1e9,
    load: complex(50, 0),
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
  const sweep: SweepSettings =
    s?.sweepType === 'frequency'
      ? {
          enabled: true,
          start: s.startFrequency,
          stop: s.stopFrequency,
          points: sweepValues(s.startFrequency, s.stopFrequency, s.stepFrequency).length,
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
    elements: identify(ladder.elements),
    vswrCircles: parsed.vswrList.filter((v) => v > 1),
    qContours: parsed.qList.filter((q) => q > 0),
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

/** Strip the .xmlsc extension and dashes for a display name. */
export function nameFromFile(fileName: string): string {
  return fileName.replace(/\.(xmlsc|json)$/i, '').replace(/[-_]+/g, ' ');
}
