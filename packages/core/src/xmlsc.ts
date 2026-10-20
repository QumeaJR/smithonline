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

export interface XmlscDesign {
  readonly datapoints: readonly XmlscDatapoint[];
  readonly components: readonly XmlscComponent[];
  readonly sweepDatapoints: readonly XmlscDatapoint[];
  readonly sweep?: XmlscSweepParameters;
  readonly qList: readonly number[];
  readonly vswrList: readonly number[];
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

function num(block: string, tag: string, where: string): number {
  const t = text(block, tag);
  if (t === undefined) throw new XmlscError(`Missing <${tag}> in ${where}`);
  const v = Number(t.trim());
  if (!Number.isFinite(v)) throw new XmlscError(`Invalid number "${t}" in <${tag}> of ${where}`);
  return v;
}

function numOr(block: string, tag: string, fallback: number): number {
  const t = text(block, tag);
  if (t === undefined) return fallback;
  const v = Number(t.trim());
  return Number.isFinite(v) ? v : fallback;
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
  const qList = blocks(xml, 'QList').map(Number);
  const vswrList = blocks(xml, 'VSWRList').map(Number);
  return sweep === undefined
    ? { datapoints, components, sweepDatapoints, qList, vswrList }
    : { datapoints, components, sweepDatapoints, sweep, qList, vswrList };
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
