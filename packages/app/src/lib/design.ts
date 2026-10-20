import {
  complex,
  ladderFromXmlsc,
  readXmlsc,
  sweepValues,
  type Complex,
  type Element,
  type XmlscDesign,
} from '@smithonline/core';

/** Frequency sweep settings shown in the right panel. */
export interface SweepSettings {
  readonly enabled: boolean;
  /** Hz. */
  readonly start: number;
  /** Hz. */
  readonly stop: number;
  readonly points: number;
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
  readonly elements: readonly Element[];
  /** VSWR circles to draw. */
  readonly vswrCircles: readonly number[];
  /** Constant-Q contours to draw. */
  readonly qContours: readonly number[];
  readonly sweep: SweepSettings;
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
  };
}

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
  return {
    name,
    z0: ladder.z0,
    frequency: ladder.frequency,
    load: ladder.load,
    elements: ladder.elements,
    vswrCircles: parsed.vswrList.filter((v) => v > 1),
    qContours: parsed.qList.filter((q) => q > 0),
    sweep,
  };
}

/** Strip the .xmlsc extension and dashes for a display name. */
export function nameFromFile(fileName: string): string {
  return fileName.replace(/\.(xmlsc|json)$/i, '').replace(/[-_]+/g, ' ');
}
