/**
 * The design as the files Smith V4.1 writes: project (.xmlsc), Touchstone
 * CKT netlist and delimited ASCII datapoints and circles. Pure functions so
 * they are testable in Node; `export.ts` does the download.
 */
import {
  buildXmlsc,
  gmaxDb,
  loadStabilityCircle,
  sourceStabilityCircle,
  stability,
  sweepDatapoints,
  sweepFrequency,
  sweepPoints,
  writeAscii,
  writeNetlist,
  writeXmlsc,
  type AsciiCircles,
  type AsciiDatapoint,
  type AsciiDelimiter,
  type Ladder,
  type LadderResult,
  type SweepPoint,
  type XmlscGainCircleSpec,
} from '@smithonline/core';
import { hasDatapointSweep, type Design, type GainCircleType } from './design';
import { datapointLabel } from './format';

export function ladderOf(design: Design): Ladder {
  return {
    z0: design.z0,
    frequency: design.frequency,
    load: design.load,
    elements: design.elements,
  };
}

/** The sweep the design asks for: over frequency, or over the imported datapoints. */
export function designSweep(design: Design): SweepPoint[] | null {
  const { sweep } = design;
  if (!sweep.enabled) return null;
  // An empty load list is a datapoint sweep over nothing, not a frequency sweep.
  if (sweep.loads !== undefined && sweep.loads.length === 0) return null;
  if (hasDatapointSweep(sweep)) return sweepDatapoints(ladderOf(design), sweep.loads ?? []);
  const { start, stop, points } = sweep;
  if (!(start > 0) || !(stop > 0) || points < 2) return null;
  return sweepFrequency(ladderOf(design), sweepPoints(start, stop, points));
}

const XMLSC_GAIN: Readonly<Record<GainCircleType, XmlscGainCircleSpec['gainType'] | null>> = {
  available: 1,
  operating: 2,
  unilateralSource: 3,
  unilateralLoad: 3,
};

/** The design as a Smith V4.1 project file. Throws XmlscError for elements the format cannot hold. */
export function designToXmlsc(design: Design): string {
  const { sweep } = design;
  const gainCircles = design.gainCircles.flatMap((g): XmlscGainCircleSpec[] => {
    const gainType = XMLSC_GAIN[g.type];
    if (gainType === null) return [];
    const plane: 1 | 2 = g.type === 'operating' || g.type === 'unilateralLoad' ? 2 : 1;
    return [{ gainType, plane, gainDb: g.gainDb }];
  });
  const frequencySweep =
    sweep.enabled && !hasDatapointSweep(sweep) && sweep.points >= 2
      ? sweepPoints(sweep.start, sweep.stop, sweep.points)
      : undefined;
  // Stored datapoints travel with the file whichever sweep runs; the records follow the mode.
  // The format has no switched-off frequency sweep: loads with mode 'frequency' and the sweep
  // off are stored as plain datapoints and reopen as a disabled datapoint sweep (the .json
  // file and the share link keep the mode).
  const datapointSweep = sweep.loads && sweep.loads.length > 0 ? sweep.loads : undefined;
  return writeXmlsc(
    buildXmlsc(ladderOf(design), {
      ...(frequencySweep ? { frequencySweep } : {}),
      ...(datapointSweep
        ? { datapointSweep, sweepEnabled: sweep.enabled && hasDatapointSweep(sweep) }
        : {}),
      qList: design.qContours,
      vswrList: design.vswrCircles,
      twoPort: design.twoPort,
      stabilityCircles: design.showStability,
      gainCircles,
      noiseCircles: design.noiseCircles,
    }),
  );
}

/** The design as a Touchstone CKT netlist. */
export function designToNetlist(design: Design, name: string): string {
  return writeNetlist(ladderOf(design), { name });
}

/** Datapoints, sweep points and circles as delimited ASCII. */
export function designToAscii(
  design: Design,
  result: LadderResult,
  sweep: readonly SweepPoint[] | null,
  delimiter: AsciiDelimiter,
): string {
  const points: AsciiDatapoint[] = result.datapoints.map((z, i) => ({
    start: i === 0,
    label: datapointLabel(i),
    z,
    frequency: result.frequency,
  }));
  for (const [i, p] of (sweep ?? []).entries()) {
    points.push({ start: false, label: `SP${i + 1}`, z: p.zin, frequency: p.frequency });
  }
  const tp = design.twoPort;
  let circles: AsciiCircles | null = null;
  if (tp) {
    const st = stability(tp.s);
    const gmax = gmaxDb(tp.s);
    circles = {
      s: tp.s,
      noise: tp.noise,
      frequency: design.frequency,
      gain: design.gainCircles.map((g) => ({
        plane: g.type === 'operating' || g.type === 'unilateralLoad' ? 2 : 1,
        gainDb: g.gainDb,
        gmaxDb: gmax,
      })),
      noiseDb: tp.noise ? design.noiseCircles : [],
      stability: design.showStability
        ? [
            { plane: 1, stableInside: sourceStabilityCircle(tp.s).stableInside, k: st.k },
            { plane: 2, stableInside: loadStabilityCircle(tp.s).stableInside, k: st.k },
          ]
        : [],
    };
  }
  return writeAscii(points, circles, { delimiter });
}
