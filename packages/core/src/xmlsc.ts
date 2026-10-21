/**
 * Reader for Smith V4.1 project files (`.xmlsc`).
 *
 * Format as documented in docs/01-original-analysis.md, section 3. The file is
 * flat XML written by the .NET XmlSerializer, so a small tag scanner is enough
 * and the reader stays free of DOM dependencies. Only the datapoints,
 * components and sweep records are interpreted here; circle records are kept
 * for a later phase.
 */
import { complex, type Complex } from './complex.js';
import type { Element } from './elements.js';
import type { Ladder, SweepLoad } from './ladder.js';

export class XmlscError extends Error {
  override readonly name = 'XmlscError';
}

export interface XmlscDatapoint {
  readonly index: number;
  /** User datapoint (DPn) when true, transformed point (TPm) when false. */
  readonly isReal: boolean;
  /** The user datapoint the chain starts from, when several exist. */
  readonly isStart: boolean;
  readonly frequency: number;
  readonly r: number;
  readonly x: number;
}

/** Element type codes verified against the example projects. */
export const XMLSC_TYPE = {
  seriesC: 2,
  shuntC: 3,
  seriesL: 4,
  shuntL: 5,
  seriesLine: 8,
  openStub: 9,
  shortStub: 30,
} as const;

export interface XmlscComponent {
  readonly guid: string;
  readonly typ: number;
  readonly value: number;
  readonly rBegin: number;
  readonly xBegin: number;
  readonly rEnd: number;
  readonly xEnd: number;
  readonly lineImp: number;
  readonly er: number;
  readonly alpha: number;
  readonly lambda: number;
  readonly rRlc: number;
  readonly lRlc: number;
  readonly cRlc: number;
}

export interface XmlscSweepParameters {
  readonly sweepType: 'datapoint' | 'frequency';
  readonly startFrequency: number;
  readonly stopFrequency: number;
  readonly stepFrequency: number;
}

/** S-parameters as stored in the circle records (which spell the tags inconsistently). */
export interface XmlscSParameters {
  readonly s11: Complex;
  readonly s12: Complex;
  readonly s21: Complex;
  readonly s22: Complex;
}

export interface XmlscStabilityCircle {
  readonly visible: boolean;
  readonly highlight: boolean;
  readonly frequency: number;
  /** 1 = input (source) plane, 2 = output (load) plane. */
  readonly plane: 1 | 2;
  readonly k: number;
  /** 1 = stable inside, 2 = stable outside. */
  readonly stable: 1 | 2;
  readonly s: XmlscSParameters;
}

export interface XmlscNoiseCircle {
  readonly manual: boolean;
  readonly visible: boolean;
  readonly highlight: boolean;
  /** rn normalized to Z0 when true, Rn in ohm when false. */
  readonly normalized: boolean;
  readonly frequency: number;
  /** Noise figure of this circle, dB. */
  readonly nfDb: number;
  readonly rn: number;
  readonly gammaOpt: Complex;
  readonly nfMinDb: number;
  /** Index into the dialog's frequency unit list; 6 (GHz) in the examples. Kept for round trips. */
  readonly freqUnit?: number;
}

export interface XmlscGainCircle {
  /** 1 = input plane, 2 = output plane. */
  readonly plane: 1 | 2;
  readonly manual: boolean;
  /** 1 = available power gain; 2 and 3 are expected to be operating and unilateral. */
  readonly gainType: number;
  readonly visible: boolean;
  readonly highlight: boolean;
  readonly s: XmlscSParameters;
  readonly k: number;
  /** Gain of this circle, dB. */
  readonly gainDb: number;
  readonly gmaxDb: number;
  readonly frequency: number;
  /** The original's "Marked" flag. Kept for round trips. */
  readonly marked?: boolean;
}

export interface XmlscDesign {
  readonly datapoints: readonly XmlscDatapoint[];
  readonly components: readonly XmlscComponent[];
  readonly sweepDatapoints: readonly XmlscDatapoint[];
  readonly sweep?: XmlscSweepParameters;
  readonly qList: readonly number[];
  readonly vswrList: readonly number[];
  /** The list entries as written (the original stores the typed text, for example `1.0`). */
  readonly qListText: readonly string[];
  readonly vswrListText: readonly string[];
  readonly stabilityCircles: readonly XmlscStabilityCircle[];
  readonly noiseCircles: readonly XmlscNoiseCircle[];
  readonly gainCircles: readonly XmlscGainCircle[];
}

function blocks(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'g');
  const out: string[] = [];
  for (const m of xml.matchAll(re)) out.push(m[1] ?? '');
  return out;
}

function text(block: string, tag: string): string | undefined {
  const m = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(block);
  return m?.[1];
}

/** The XML Schema spellings the .NET serializer uses for non-finite doubles. */
const SPECIAL: Readonly<Record<string, number>> = { INF: Infinity, '-INF': -Infinity, NaN: NaN };

function parseDouble(t: string): number {
  const s = t.trim();
  if (s in SPECIAL) return SPECIAL[s] as number;
  return s === '' ? NaN : Number(s);
}

function num(block: string, tag: string, where: string): number {
  const t = text(block, tag);
  if (t === undefined) throw new XmlscError(`Missing <${tag}> in ${where}`);
  const v = parseDouble(t);
  if (Number.isNaN(v) && t.trim() !== 'NaN')
    throw new XmlscError(`Invalid number "${t}" in <${tag}> of ${where}`);
  return v;
}

function numOr(block: string, tag: string, fallback: number): number {
  const t = text(block, tag);
  if (t === undefined) return fallback;
  const v = parseDouble(t);
  return Number.isNaN(v) ? fallback : v;
}

function datapoint(block: string, where: string): XmlscDatapoint {
  return {
    index: num(block, 'IndexOfDP', where),
    isReal: numOr(block, 'IsRealDP', 0) === 1,
    isStart: numOr(block, 'StartDatapoint', 0) === 1,
    frequency: num(block, 'Frequency', where),
    r: num(block, 'R', where),
    x: num(block, 'X', where),
  };
}

function component(block: string, i: number): XmlscComponent {
  const where = `CComponent ${i}`;
  return {
    guid: text(block, 'GUID')?.trim() ?? '',
    typ: num(block, 'Typ', where),
    value: num(block, 'Value', where),
    rBegin: num(block, 'Rbegin', where),
    xBegin: num(block, 'Xbegin', where),
    rEnd: num(block, 'Rend', where),
    xEnd: num(block, 'Xend', where),
    lineImp: numOr(block, 'LineImp', 0),
    er: numOr(block, 'Er', 0),
    alpha: numOr(block, 'Alpha', 0),
    lambda: numOr(block, 'Lambda', 0),
    rRlc: numOr(block, 'RValueRLC', 0),
    lRlc: numOr(block, 'LValueRLC', 0),
    cRlc: numOr(block, 'CValueRLC', 0),
  };
}

/** Parse the file text into its records. Unknown element codes are rejected. */
export function readXmlsc(source: string): XmlscDesign {
  const xml = source.charCodeAt(0) === 0xfeff ? source.slice(1) : source;
  if (!/<CSmithChartDesign[\s>]/.test(xml)) {
    throw new XmlscError('Not a Smith V4.1 project: missing <CSmithChartDesign> root');
  }
  const datapoints = blocks(xml, 'CDatapoint').map((b, i) => datapoint(b, `CDatapoint ${i}`));
  const components = blocks(xml, 'CComponent').map(component);
  for (const c of components) {
    if (!Object.values<number>(XMLSC_TYPE).includes(c.typ)) {
      throw new XmlscError(
        `Unsupported element type code ${c.typ} (component ${c.guid}). ` +
          'Known codes: 2 series C, 3 shunt C, 4 series L, 5 shunt L, 8 series line, ' +
          '9 open stub, 30 shorted stub.',
      );
    }
  }
  const sweepDatapoints = blocks(xml, 'CSweepDatapoint').map((b, i) =>
    datapoint(b, `CSweepDatapoint ${i}`),
  );
  const sweepBlock = blocks(xml, 'CSweepDatapointParameters')[0];
  const sweep = sweepBlock === undefined ? undefined : sweepParameters(sweepBlock);
  const qListText = blocks(xml, 'QList');
  const vswrListText = blocks(xml, 'VSWRList');
  const qList = qListText.map(Number);
  const vswrList = vswrListText.map(Number);
  const stabilityCircles = blocks(xml, 'CStabilityCircles').map(stabilityCircle);
  const noiseCircles = blocks(xml, 'CNoiseList').map(noiseCircle);
  const gainCircles = blocks(xml, 'CGainCirclesList').map(gainCircle);
  const base = {
    datapoints,
    components,
    sweepDatapoints,
    qList,
    vswrList,
    qListText,
    vswrListText,
    stabilityCircles,
    noiseCircles,
    gainCircles,
  };
  return sweep === undefined ? base : { ...base, sweep };
}

function bool(block: string, tag: string): boolean {
  return text(block, tag)?.trim().toLowerCase() === 'true';
}

function plane(block: string, where: string): 1 | 2 {
  const t = num(block, 'Typ', where);
  if (t !== 1 && t !== 2) throw new XmlscError(`Unknown plane ${t} in ${where}`);
  return t;
}

/** The circle records write the S-parameter tags with varying capitalization. */
function sParameters(block: string, where: string): XmlscSParameters {
  const part = (name: string): number => {
    for (const tag of [
      name,
      name.toUpperCase(),
      name.toLowerCase(),
      name.replace(/re$/i, 'Re').replace(/im$/i, 'Im'),
    ]) {
      const t = text(block, tag);
      if (t !== undefined) {
        const v = Number(t.trim());
        if (!Number.isFinite(v))
          throw new XmlscError(`Invalid number "${t}" in <${tag}> of ${where}`);
        return v;
      }
    }
    throw new XmlscError(`Missing <${name}> in ${where}`);
  };
  return {
    s11: complex(part('S11re'), part('S11im')),
    s12: complex(part('S12re'), part('S12im')),
    s21: complex(part('S21re'), part('S21im')),
    s22: complex(part('S22re'), part('S22im')),
  };
}

function stabilityCircle(block: string, i: number): XmlscStabilityCircle {
  const where = `CStabilityCircles ${i}`;
  const stable = num(block, 'Stable', where);
  if (stable !== 1 && stable !== 2) throw new XmlscError(`Unknown Stable ${stable} in ${where}`);
  return {
    visible: bool(block, 'Visible'),
    highlight: bool(block, 'Highlight'),
    frequency: num(block, 'F', where),
    plane: plane(block, where),
    k: num(block, 'K', where),
    stable,
    s: sParameters(block, where),
  };
}

function noiseCircle(block: string, i: number): XmlscNoiseCircle {
  const where = `CNoiseList ${i}`;
  return {
    manual: numOr(block, 'ManualCyrcle', 0) === 1,
    visible: bool(block, 'Visible'),
    highlight: bool(block, 'Highlight'),
    normalized: numOr(block, 'Normalized', 1) === 1,
    frequency: num(block, 'F', where),
    nfDb: num(block, 'NF', where),
    rn: num(block, 'Rnoise', where),
    gammaOpt: complex(num(block, 'RNFminRE', where), num(block, 'RNFminIM', where)),
    nfMinDb: num(block, 'NFmin', where),
    freqUnit: numOr(block, 'FreqUnit', 6),
  };
}

function gainCircle(block: string, i: number): XmlscGainCircle {
  const where = `CGainCirclesList ${i}`;
  return {
    plane: plane(block, where),
    manual: numOr(block, 'ManualCyrcle', 0) === 1,
    gainType: num(block, 'GainType', where),
    visible: bool(block, 'Visible'),
    highlight: bool(block, 'Highlight'),
    s: sParameters(block, where),
    k: num(block, 'K', where),
    gainDb: num(block, 'P', where),
    gmaxDb: num(block, 'Gmax', where),
    frequency: num(block, 'F', where),
    marked: bool(block, 'Marked'),
  };
}

function sweepParameters(block: string): XmlscSweepParameters {
  const where = 'CSweepDatapointParameters';
  const type = num(block, 'Sweeptype', where);
  if (type !== 1 && type !== 2) throw new XmlscError(`Unknown Sweeptype ${type}`);
  return {
    sweepType: type === 1 ? 'datapoint' : 'frequency',
    startFrequency: num(block, 'StartFrequency', where),
    stopFrequency: num(block, 'StopFrequency', where),
    stepFrequency: num(block, 'StepFrequency', where),
  };
}

/**
 * Convert one component record to a ladder element. `frequency` is the
 * datapoint frequency the element was entered at; lines and stubs keep it as
 * their reference frequency.
 */
export function componentToElement(c: XmlscComponent, frequency: number): Element {
  switch (c.typ) {
    case XMLSC_TYPE.seriesC:
      return { kind: 'C', orientation: 'series', value: c.value };
    case XMLSC_TYPE.shuntC:
      return { kind: 'C', orientation: 'shunt', value: c.value };
    case XMLSC_TYPE.seriesL:
      return { kind: 'L', orientation: 'series', value: c.value };
    case XMLSC_TYPE.shuntL:
      return { kind: 'L', orientation: 'shunt', value: c.value };
    case XMLSC_TYPE.seriesLine:
      return {
        kind: 'line',
        z0: c.lineImp,
        length: c.value,
        refFrequency: frequency,
        // The examples store Er = 1 for every lossless line and the real value
        // for the lossy one; anything below 1 is treated as air.
        er: c.er >= 1 ? c.er : 1,
        alphaDbPerM: c.alpha,
      };
    case XMLSC_TYPE.openStub:
      return { kind: 'openStub', z0: c.lineImp, length: c.value, refFrequency: frequency };
    case XMLSC_TYPE.shortStub:
      return { kind: 'shortStub', z0: c.lineImp, length: c.value, refFrequency: frequency };
    default:
      throw new XmlscError(`Unsupported element type code ${c.typ}`);
  }
}

/** The user datapoint the chain starts from. */
export function startDatapoint(design: XmlscDesign): XmlscDatapoint {
  const real = design.datapoints.filter((d) => d.isReal);
  const start = real.find((d) => d.isStart) ?? real[0] ?? design.datapoints[0];
  if (start === undefined) throw new XmlscError('Project has no datapoints');
  return start;
}

export interface XmlscLadder extends Ladder {
  /** The datapoint the chain starts from. */
  readonly start: XmlscDatapoint;
  /** Impedances the file stores for the nodes after each element. */
  readonly storedNodes: readonly Complex[];
  /** Loads for a datapoint sweep: every user datapoint at its own frequency. */
  readonly sweepLoads: readonly SweepLoad[];
}

/** Build the ladder of a design. Z0 is not stored in the file; Smith V4.1 defaults to 50 ohm. */
export function ladderFromXmlsc(design: XmlscDesign, z0 = 50): XmlscLadder {
  const start = startDatapoint(design);
  const elements = design.components.map((c) => componentToElement(c, start.frequency));
  const storedNodes = design.datapoints
    .filter((d) => !d.isReal)
    .sort((a, b) => a.index - b.index)
    .map((d) => complex(d.r, d.x));
  const sweepLoads = design.datapoints
    .filter((d) => d.isReal)
    .sort((a, b) => a.index - b.index)
    .map((d) => ({ frequency: d.frequency, z: complex(d.r, d.x) }));
  return {
    z0,
    frequency: start.frequency,
    load: complex(start.r, start.x),
    elements,
    start,
    storedNodes,
    sweepLoads,
  };
}
