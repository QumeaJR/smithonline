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
import { type Design, type GainCircleType } from './design';
import { designHasDatapointSweep, startIndex, sweepLoadsOf, userDatapoints } from './datapoints';
import { datapointLabel } from './format';

export function ladderOf(design: Design): Ladder {
  return {
    z0: design.z0,
    frequency: design.frequency,
    load: design.load,
    elements: design.elements,
  };
}

/** The sweep the design asks for: over frequency, or over the user datapoints or an imported file's points. */
export function designSweep(design: Design): SweepPoint[] | null {
  const { sweep } = design;
  if (!sweep.enabled) return null;
  // An empty load list is a datapoint sweep over nothing, not a frequency sweep.
  if (sweep.loads !== undefined && sweep.loads.length === 0) return null;
  if (designHasDatapointSweep(design)) {
    return sweepDatapoints(ladderOf(design), sweepLoadsOf(design));
  }
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
    sweep.enabled && !designHasDatapointSweep(design) && sweep.points >= 2
      ? sweepPoints(sweep.start, sweep.stop, sweep.points)
      : undefined;
  // Stored datapoints travel with the file whichever sweep runs; the records follow the mode.
  // The format has no switched-off frequency sweep: loads with mode 'frequency' and the sweep
  // off are stored as plain datapoints and reopen as a disabled datapoint sweep (the .json
  // file and the share link keep the mode).
  const datapointSweep = sweep.loads && sweep.loads.length > 0 ? sweep.loads : undefined;
  // User datapoints are stored in DP order with the start marked; the points of an
  // imported file that are not among them follow.
  const several = (design.datapoints?.length ?? 0) > 0;
  // A datapoint set larger than the list keeps its file order: the start is one of its rows.
  const startRow =
    !several && datapointSweep
      ? datapointSweep.findIndex(
          (l) =>
            l.frequency === design.frequency &&
            l.z.re === design.load.re &&
            l.z.im === design.load.im,
        )
      : -1;
  const users = several
    ? [
        ...userDatapoints(design),
        ...(datapointSweep ?? []).filter(
          (l) =>
            !userDatapoints(design).some(
              (u) => u.frequency === l.frequency && u.z.re === l.z.re && u.z.im === l.z.im,
            ),
        ),
      ]
    : startRow >= 0
      ? datapointSweep
      : undefined;
  const sweepEnabled = sweep.enabled && designHasDatapointSweep(design);
  return writeXmlsc(
    buildXmlsc(ladderOf(design), {
      ...(frequencySweep ? { frequencySweep } : {}),
      ...(users
        ? {
            userDatapoints: users,
            startIndex: several ? startIndex(design) : startRow,
            sweepEnabled,
          }
        : datapointSweep
          ? { datapointSweep, sweepEnabled }
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
  const users = userDatapoints(design);
  const slot = startIndex(design);
  const points: AsciiDatapoint[] = users.map((u, i) => ({
    start: i === slot,
    label: `DP${i + 1}`,
    z: i === slot ? (result.datapoints[0] ?? u.z) : u.z,
    frequency: u.frequency,
  }));
  result.datapoints.slice(1).forEach((z, i) => {
    points.push({
      start: false,
      label: datapointLabel(i + 1, users.length),
      z,
      frequency: result.frequency,
    });
  });
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
