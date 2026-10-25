/**
 * Writer for Smith V4.1 project files (`.xmlsc`), byte-compatible with the
 * files the original writes: UTF-8 with BOM, one line, the element order and
 * tag names of the .NET XmlSerializer including the original's `ManualCyrcle`
 * and the mixed `S11Re` / `S12RE` / `S11re` capitalization, numbers in the
 * .NET round-trip format. `readXmlsc` followed by `writeXmlsc` reproduces
 * every example project exactly.
 *
 * Top-level record order, as seen in the examples: CDatapoint, CComponent,
 * QList, VSWRList, CSweepDatapoint, CSweepDatapointParameters,
 * CStabilityCircles, CNoiseList, CGainCirclesList. No example holds both a
 * QList and a VSWRList, or both a sweep and circles, so those two relative
 * orders are assumptions; the original's reader matches records by name, so
 * it reads either order.
 */
import type { Complex } from '../complex.js';
import type { Element } from '../elements.js';
import {
  evaluateLadder,
  sweepDatapoints as sweepOverDatapoints,
  sweepFrequency,
  type Ladder,
  type SweepLoad,
} from '../ladder.js';
import {
  gmaxDb,
  loadStabilityCircle,
  sourceStabilityCircle,
  stability,
  type NoiseParameters,
  type SParameters,
} from '../twoport.js';
import {
  XMLSC_TYPE,
  XmlscError,
  type XmlscComponent,
  type XmlscDatapoint,
  type XmlscGainCircle,
  type XmlscNoiseCircle,
  type XmlscStabilityCircle,
  type XmlscSweepParameters,
} from '../xmlsc.js';
import { formatDotNetDouble } from './dotnet-number.js';

/** What the writer needs; `XmlscDesign` from the reader satisfies it. */
export interface XmlscWriteDesign {
  readonly datapoints: readonly XmlscDatapoint[];
  readonly components: readonly XmlscComponent[];
  readonly sweepDatapoints: readonly XmlscDatapoint[];
  readonly sweep?: XmlscSweepParameters;
  /** A string is written verbatim (the original stores the typed text), a number in .NET format. */
  readonly qList: readonly (number | string)[];
  readonly vswrList: readonly (number | string)[];
  readonly stabilityCircles: readonly XmlscStabilityCircle[];
  readonly noiseCircles: readonly XmlscNoiseCircle[];
  readonly gainCircles: readonly XmlscGainCircle[];
}

const n = formatDotNetDouble;
const b = (v: boolean): string => (v ? 'true' : 'false');
const tag = (name: string, value: string): string => `<${name}>${value}</${name}>`;

function datapointXml(name: string, d: XmlscDatapoint): string {
  return tag(
    name,
    tag('StartDatapoint', d.isStart ? '1' : '0') +
      tag('IsRealDP', d.isReal ? '1' : '0') +
      tag('IndexOfDP', n(d.index)) +
      tag('Frequency', n(d.frequency)) +
      tag('R', n(d.r)) +
      tag('X', n(d.x)) +
      tag('U', '0') +
      tag('V', '0'),
  );
}

function componentXml(c: XmlscComponent): string {
  return tag(
    'CComponent',
    tag('GUID', c.guid) +
      tag('Typ', n(c.typ)) +
      tag('Value', n(c.value)) +
      tag('Xend', n(c.xEnd)) +
      tag('Rend', n(c.rEnd)) +
      tag('LineImp', n(c.lineImp)) +
      tag('Xbegin', n(c.xBegin)) +
      tag('Rbegin', n(c.rBegin)) +
      tag('Er', n(c.er)) +
      tag('Alpha', n(c.alpha)) +
      tag('Lambda', n(c.lambda)) +
      tag('RValueRLC', n(c.rRlc)) +
      tag('LValueRLC', n(c.lRlc)) +
      tag('CValueRLC', n(c.cRlc)),
  );
}

function stabilityXml(c: XmlscStabilityCircle): string {
  return tag(
    'CStabilityCircles',
    tag('Visible', b(c.visible)) +
      tag('Highlight', b(c.highlight)) +
      tag('F', n(c.frequency)) +
      tag('Typ', n(c.plane)) +
      tag('K', n(c.k)) +
      tag('Stable', n(c.stable)) +
      tag('S11Re', n(c.s.s11.re)) +
      tag('S11Im', n(c.s.s11.im)) +
      tag('S12RE', n(c.s.s12.re)) +
      tag('S12IM', n(c.s.s12.im)) +
      tag('S21RE', n(c.s.s21.re)) +
      tag('S21IM', n(c.s.s21.im)) +
      tag('S22RE', n(c.s.s22.re)) +
      tag('S22IM', n(c.s.s22.im)),
  );
}

function noiseXml(c: XmlscNoiseCircle): string {
  return tag(
    'CNoiseList',
    tag('ManualCyrcle', c.manual ? '1' : '0') +
      tag('FreqUnit', n(c.freqUnit ?? 6)) +
      tag('Visible', b(c.visible)) +
      tag('Highlight', b(c.highlight)) +
      tag('Normalized', c.normalized ? '1' : '0') +
      tag('F', n(c.frequency)) +
      tag('NF', n(c.nfDb)) +
      tag('Rnoise', n(c.rn)) +
      tag('RNFminIM', n(c.gammaOpt.im)) +
      tag('RNFminRE', n(c.gammaOpt.re)) +
      tag('NFmin', n(c.nfMinDb)),
  );
}

function gainXml(c: XmlscGainCircle): string {
  return tag(
    'CGainCirclesList',
    tag('Typ', n(c.plane)) +
      tag('ManualCyrcle', c.manual ? '1' : '0') +
      tag('GainType', n(c.gainType)) +
      tag('Visible', b(c.visible)) +
      tag('Highlight', b(c.highlight)) +
      tag('Marked', b(c.marked ?? false)) +
      tag('S22im', n(c.s.s22.im)) +
      tag('S22re', n(c.s.s22.re)) +
      tag('S21re', n(c.s.s21.re)) +
      tag('S21im', n(c.s.s21.im)) +
      tag('S12im', n(c.s.s12.im)) +
      tag('S12re', n(c.s.s12.re)) +
      tag('S11im', n(c.s.s11.im)) +
      tag('S11re', n(c.s.s11.re)) +
      tag('K', n(c.k)) +
      tag('P', n(c.gainDb)) +
      tag('Gmax', n(c.gmaxDb)) +
      tag('F', n(c.frequency)),
  );
}

function sweepXml(s: XmlscSweepParameters): string {
  return tag(
    'CSweepDatapointParameters',
    tag('Sweeptype', s.sweepType === 'datapoint' ? '1' : '2') +
      tag('StartFrequency', n(s.startFrequency)) +
      tag('StopFrequency', n(s.stopFrequency)) +
      tag('StepFrequency', n(s.stepFrequency)),
  );
}

const listItem = (v: number | string): string => (typeof v === 'string' ? v : n(v));

/** Serialize a design to the file text, including the UTF-8 byte order mark. */
export function writeXmlsc(design: XmlscWriteDesign): string {
  const body =
    design.datapoints.map((d) => datapointXml('CDatapoint', d)).join('') +
    design.components.map(componentXml).join('') +
    design.qList.map((q) => tag('QList', listItem(q))).join('') +
    design.vswrList.map((v) => tag('VSWRList', listItem(v))).join('') +
    design.sweepDatapoints.map((d) => datapointXml('CSweepDatapoint', d)).join('') +
    (design.sweep ? sweepXml(design.sweep) : '') +
    design.stabilityCircles.map(stabilityXml).join('') +
    design.noiseCircles.map(noiseXml).join('') +
    design.gainCircles.map(gainXml).join('');
  return (
    '﻿<?xml version="1.0" encoding="utf-8"?>' +
    '<CSmithChartDesign xmlns:xsd="http://www.w3.org/2001/XMLSchema" ' +
    'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
    body +
    '</CSmithChartDesign>'
  );
}

/** A random GUID in the 8-4-4-4-12 form the original writes. */
export function newGuid(): string {
  const c = globalThis.crypto as { randomUUID?: () => string } | undefined;
  if (c?.randomUUID) return c.randomUUID();
  const hex = (len: number): string =>
    Array.from({ length: len }, () => Math.floor(Math.random() * 16).toString(16)).join('');
  return `${hex(8)}-${hex(4)}-4${hex(3)}-${hex(4)}-${hex(12)}`;
}

/** The element type code and the component fields an element maps to. */
function componentOf(el: Element, before: Complex, after: Complex, guid: string): XmlscComponent {
  const base = {
    guid,
    rBegin: before.re,
    xBegin: before.im,
    rEnd: after.re,
    xEnd: after.im,
    lineImp: 0,
    er: 0,
    alpha: 0,
    lambda: 0,
    rRlc: 0,
    lRlc: 0,
    cRlc: 0,
  };
  switch (el.kind) {
    case 'C':
      return {
        ...base,
        typ: el.orientation === 'series' ? XMLSC_TYPE.seriesC : XMLSC_TYPE.shuntC,
        value: el.value,
      };
    case 'L':
      return {
        ...base,
        typ: el.orientation === 'series' ? XMLSC_TYPE.seriesL : XMLSC_TYPE.shuntL,
        value: el.value,
      };
    case 'line':
      return {
        ...base,
        typ: XMLSC_TYPE.seriesLine,
        value: el.length,
        lineImp: el.z0,
        // Lossless lines store Er = 1 in every example; the lossy one stores its real value.
        er: el.er ?? 1,
        alpha: el.alphaDbPerM ?? 0,
        lambda: el.length,
      };
    case 'openStub':
    case 'shortStub':
      return {
        ...base,
        typ: el.kind === 'openStub' ? XMLSC_TYPE.openStub : XMLSC_TYPE.shortStub,
        value: el.length,
        lineImp: el.z0,
        er: 1,
        lambda: el.length,
      };
    case 'part':
      throw new XmlscError(
        'Library parts cannot be saved as .xmlsc: Smith V4.1 has no parts from measured data. ' +
          'Use Save as .json, which keeps the part data.',
      );
    default:
      throw new XmlscError(
        `${el.kind} elements cannot be saved as .xmlsc: Smith V4.1's type code for them is not known. ` +
          'Use Save as .json for this design.',
      );
  }
}

export interface XmlscGainCircleSpec {
  /** 1 = available (input plane), 2 = operating (output plane), 3 = unilateral. */
  readonly gainType: 1 | 2 | 3;
  readonly plane: 1 | 2;
  readonly gainDb: number;
}

export interface XmlscBuildOptions {
  /** Frequency sweep points (Hz) to store as CSweepDatapoint records. */
  readonly frequencySweep?: readonly number[];
  /** Datapoint sweep: the extra user datapoints, each at its own frequency. */
  readonly datapointSweep?: readonly SweepLoad[];
  /**
   * All user datapoints in DP order (DP1 first), the chain's start included.
   * Stored as given instead of sorted by frequency; `startIndex` marks the
   * start, which takes the ladder's own frequency and load. Replaces
   * `datapointSweep` for the record list; the sweep runs over these points.
   */
  readonly userDatapoints?: readonly SweepLoad[];
  /** Index of the start in `userDatapoints`; 0 when absent or out of range. */
  readonly startIndex?: number;
  /** False stores the extra datapoints without the sweep records (sweep switched off). Default true. */
  readonly sweepEnabled?: boolean;
  readonly qList?: readonly number[];
  readonly vswrList?: readonly number[];
  /** Device parameters behind the circle records. */
  readonly twoPort?: { readonly s: SParameters; readonly noise: NoiseParameters | null } | null;
  readonly stabilityCircles?: boolean;
  readonly gainCircles?: readonly XmlscGainCircleSpec[];
  /** Noise figure circles, dB. */
  readonly noiseCircles?: readonly number[];
  readonly guid?: () => string;
}

/**
 * Build the records of a project file from a ladder, so that `writeXmlsc`
 * can store a design made in Smith Online. Datapoint indices follow the
 * original: with a datapoint sweep the user datapoints come first (in
 * frequency order), with the chain's start marked; the transformed points
 * follow. Lines keep their reference frequency as the datapoint frequency.
 */
export function buildXmlsc(ladder: Ladder, options: XmlscBuildOptions = {}): XmlscWriteDesign {
  const guid = options.guid ?? newGuid;
  const result = evaluateLadder(ladder, { arcSteps: 0 });
  const f = ladder.frequency;
  const given = options.userDatapoints;
  const wanted = Math.trunc(options.startIndex ?? 0);
  const startAt =
    given && given.length > 0 && Number.isFinite(wanted) && wanted >= 0 && wanted < given.length
      ? wanted
      : 0;
  const extra = (options.datapointSweep ?? []).filter(
    (l) => !(l.frequency === f && l.z.re === ladder.load.re && l.z.im === ladder.load.im),
  );
  const users: SweepLoad[] =
    given && given.length > 0
      ? given.map((u, i) => (i === startAt ? { frequency: f, z: ladder.load } : u))
      : [...extra, { frequency: f, z: ladder.load }].sort((a, c) => a.frequency - c.frequency);
  const datapoints: XmlscDatapoint[] = users.map((u, i) => ({
    index: i,
    isReal: true,
    isStart:
      users.length > 1
        ? given && given.length > 0
          ? i === startAt
          : u.frequency === f && u.z === ladder.load
        : true,
    frequency: u.frequency,
    r: u.z.re,
    x: u.z.im,
  }));
  // Example 13 marks a single datapoint as the start; the plain examples do not.
  if (users.length === 1 && !options.twoPort && !options.datapointSweep?.length) {
    datapoints[0] = { ...(datapoints[0] as XmlscDatapoint), isStart: false };
  }
  result.datapoints.slice(1).forEach((z, i) => {
    datapoints.push({
      index: users.length + i,
      isReal: false,
      isStart: false,
      frequency: f,
      r: z.re,
      x: z.im,
    });
  });
  const components = ladder.elements.map((el, i) =>
    componentOf(el, result.datapoints[i] as Complex, result.datapoints[i + 1] as Complex, guid()),
  );

  let sweepDatapoints: XmlscDatapoint[] = [];
  let sweep: XmlscSweepParameters | undefined;
  const fs = options.frequencySweep ? [...options.frequencySweep].sort((a, b) => a - b) : undefined;
  if (fs && fs.length > 1) {
    const pts = sweepFrequency(ladder, fs);
    sweepDatapoints = pts.map((p, i) => ({
      index: i,
      isReal: false,
      isStart: false,
      frequency: p.frequency,
      r: p.zin.re,
      x: p.zin.im,
    }));
    const start = fs[0] as number;
    const stop = fs[fs.length - 1] as number;
    sweep = {
      sweepType: 'frequency',
      startFrequency: start,
      stopFrequency: stop,
      stepFrequency: (stop - start) / (fs.length - 1),
    };
  } else if (users.length > 1 && options.sweepEnabled !== false) {
    const pts = sweepOverDatapoints(ladder, users);
    sweepDatapoints = pts.map((p, i) => ({
      index: i,
      isReal: false,
      isStart: false,
      frequency: p.frequency,
      r: p.zin.re,
      x: p.zin.im,
    }));
    const start = Math.min(...users.map((u) => u.frequency));
    const stop = Math.max(...users.map((u) => u.frequency));
    sweep = {
      sweepType: 'datapoint',
      startFrequency: start,
      stopFrequency: stop,
      stepFrequency: stop - start,
    };
  }

  const stabilityCircles: XmlscStabilityCircle[] = [];
  const noiseCircles: XmlscNoiseCircle[] = [];
  const gainCircles: XmlscGainCircle[] = [];
  const tp = options.twoPort;
  if (tp) {
    const st = stability(tp.s);
    // With S12 = 0 there is no stability circle (K is infinite); the gain
    // record still needs a number for Gmax, so a non-finite MAG is left out.
    if (options.stabilityCircles && Number.isFinite(st.k)) {
      const src = sourceStabilityCircle(tp.s);
      const load = loadStabilityCircle(tp.s);
      for (const [plane, c] of [
        [1, src],
        [2, load],
      ] as const) {
        stabilityCircles.push({
          visible: true,
          highlight: false,
          frequency: f,
          plane,
          k: st.k,
          stable: c.stableInside ? 1 : 2,
          s: tp.s,
        });
      }
    }
    const gmaxValue = gmaxDb(tp.s);
    const gmax = Number.isFinite(gmaxValue) ? gmaxValue : 0;
    for (const g of options.gainCircles ?? []) {
      gainCircles.push({
        plane: g.plane,
        manual: true,
        gainType: g.gainType,
        visible: true,
        highlight: false,
        s: tp.s,
        k: st.k,
        gainDb: g.gainDb,
        gmaxDb: gmax,
        frequency: f,
        marked: false,
      });
    }
    if (tp.noise) {
      const noise = tp.noise;
      for (const nf of options.noiseCircles ?? []) {
        noiseCircles.push({
          manual: true,
          visible: true,
          highlight: false,
          normalized: true,
          frequency: f,
          nfDb: nf,
          rn: noise.rn,
          gammaOpt: noise.gammaOpt,
          nfMinDb: noise.nfMinDb,
          freqUnit: 6,
        });
      }
    }
  }
  const out: XmlscWriteDesign = {
    datapoints,
    components,
    sweepDatapoints,
    qList: options.qList ?? [],
    vswrList: options.vswrList ?? [],
    stabilityCircles,
    noiseCircles,
    gainCircles,
  };
  return sweep ? { ...out, sweep } : out;
}
