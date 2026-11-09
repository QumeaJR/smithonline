import {
  evaluateLadder,
  gammaToZ,
  layoutAssumptions,
  sweepDatapoints,
  sweepFrequency,
  sweepPoints,
  sweepPointsLog,
  sweepResponse,
  type Complex,
  type Ladder as CoreLadder,
} from '@smithonline/core';
import { useMemo } from 'react';
import { sweepAnchorIndex } from './chart/sweepLabels';
import { currentFit, currentRetune, useBoardFit } from './lib/boardFit';
import { designCircles } from './lib/circles';
import { designHasDatapointSweep, startIndex, userDatapoints } from './lib/datapoints';
import type { Design } from './lib/design';
import { designSweep } from './lib/files';
import { boardComparison, expectedAfter, fittedGammas } from './lib/measuredBoard';
import {
  designBand,
  designLoadModel,
  loadAt,
  pointsLoadModel,
  sortedMeasured,
  useFitVersion,
} from './lib/measuredLoad';
import { partRangeNote, sweepRangeNote } from './lib/parts';
import {
  asBuiltWhat,
  derivedSweep,
  effectiveElements,
  packagedElements,
  realizeDesign,
  realizedSweep,
} from './lib/realize';
import { useDesignBuild } from './store/useDesignBuild';
import { useDesignStore, type View } from './store/useDesignStore';
import { usePartLibrary } from './store/usePartLibrary';

/**
 * Everything a design computes to, for the views of App: the network evaluated (ideal,
 * realized, as built), its sweeps, the response curves, the measured load and board traces and
 * the device circles. Pure memos; App's effects act on them.
 */
export function useDesignDerived(
  design: Design,
  {
    view,
    logX,
    measuredLoad,
  }: { readonly view: View; readonly logX: boolean; readonly measuredLoad: boolean },
) {
  const library = usePartLibrary((s) => s.parts);
  /** The elements as evaluated: the design's own, or with default Q when the loss model is on. */
  const elements = useMemo(() => effectiveElements(design), [design]);

  const result = useMemo(
    () =>
      evaluateLadder({
        z0: design.z0,
        frequency: design.frequency,
        load: design.load,
        elements,
      }),
    [design.z0, design.frequency, design.load, elements],
  );

  /** Frequency or datapoint sweep of the network as evaluated (with the loss model when on). */
  const sweep = useMemo(() => designSweep({ ...design, elements }), [design, elements]);
  const sweepKind = designHasDatapointSweep(design)
    ? ('datapoints' as const)
    : ('frequency' as const);
  /** The sweep point the chain starts from; a thinned sweep always labels it. */
  const sweepAnchor = useMemo(() => sweepAnchorIndex(design), [design]);
  /** The user datapoints the chain does not start from, drawn as hollow markers. */
  const userPoints = useMemo(() => {
    const slot = startIndex(design);
    return userDatapoints(design).flatMap((p, index) =>
      index === slot ? [] : [{ z: p.z, index }],
    );
  }, [design]);

  /** Realize mode: the same network with standard or stocked values. */
  // The part library is a source of Realize: a part loaded or removed realizes again.
  const realization = useMemo(
    () => realizeDesign(design, elements),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [design, elements, design.realize.series === 'library' ? library : null],
  );

  // A library part has no value outside its data: the status line names the part and its range
  // when the design frequency or the sweep reaches past it (once per change of the note).
  // One entry per element of the design, numbered as the design numbers them: with Realize on,
  // the realized element where Realize put a library part in, else the design's own.
  const rangeElements = useMemo(
    () =>
      elements.map((el, i) => {
        const realized = realization?.ladder.elements[i];
        return realized?.kind === 'part' ? realized : el;
      }),
    [elements, realization],
  );
  const f0RangeNote = useMemo(
    () => partRangeNote(rangeElements, design.frequency),
    [rangeElements, design.frequency],
  );
  const sweepNote = useMemo(() => {
    const fs = (sweep ?? []).map((p) => p.frequency).filter((f) => f > 0);
    if (fs.length === 0) return null;
    return sweepRangeNote(rangeElements, Math.min(...fs), Math.max(...fs));
  }, [rangeElements, sweep]);

  const realizedSweepPoints = useMemo(
    () => (realization ? realizedSweep(realization, design) : null),
    [realization, design],
  );

  /**
   * The network as built: the realized values (or the ideal ones) with the
   * chosen component packages resolved to their parasitics. Null while no part
   * names a package.
   */
  // The design's own board and package models (docs/09b), or this browser's defaults.
  const { table: packageTable, board } = useDesignBuild();
  const packagedLadder = useMemo((): CoreLadder | null => {
    const base = realization ? realization.ladder.elements : elements;
    const built = packagedElements(base, packageTable, board, {
      z0: design.z0,
      frequency: design.frequency,
    });
    return built
      ? { z0: design.z0, frequency: design.frequency, load: design.load, elements: built }
      : null;
  }, [realization, elements, packageTable, board, design.z0, design.frequency, design.load]);
  /** What the network as built adds ("packages", "the board" or both), for its labels. */
  const builtWhat = useMemo(
    () => asBuiltWhat(realization ? realization.ladder.elements : elements, board),
    [realization, elements, board],
  );
  /** The layout assumptions of the network as built, for the report. */
  const layoutNotes = useMemo(
    () =>
      packagedLadder
        ? layoutAssumptions(
            realization ? realization.ladder.elements : elements,
            packageTable,
            board,
            { z0: design.z0, frequency: design.frequency },
          )
        : [],
    [packagedLadder, realization, elements, packageTable, board, design.z0, design.frequency],
  );
  const packaged = useMemo(
    () => (packagedLadder ? evaluateLadder(packagedLadder) : null),
    [packagedLadder],
  );
  const packagedSweepPoints = useMemo(
    () => (packagedLadder ? derivedSweep(packagedLadder, design) : null),
    [packagedLadder, design],
  );

  /**
   * The load across frequency: the measured load of a datapoint sweep (the fitted model from six
   * points), else the fixed load.
   */
  const fits = useFitVersion();
  const loadModel = useMemo(
    () => designLoadModel({ load: design.load, z0: design.z0, sweep: design.sweep }),
    // fits: the model arrives from the fitting worker.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [design.load, design.z0, design.sweep, fits],
  );
  /** The measured points in frequency order, once each, while the load is measured. */
  const measured = useMemo(
    () => (designBand({ sweep: design.sweep }).measured ? sortedMeasured(design.sweep) : null),
    [design.sweep],
  );

  /**
   * The frequencies of the Response view, or null when the range is not usable: the sweep range,
   * or over a measured load the measured band, densely (at least 401 points) with every
   * measured frequency among them, so the model's curve runs through the measured markers.
   */
  const responseFrequencies = useMemo(() => {
    if (view !== 'response') return null;
    const { start: lo, stop: hi } = designBand({ sweep: design.sweep });
    const points = Math.min(2001, Math.max(2, Math.round(design.sweep.points)));
    if (!(lo > 0) || !(hi > lo)) return null;
    if (measured) {
      const dense = Math.min(2001, Math.max(401, points));
      const grid = logX ? sweepPointsLog(lo, hi, dense) : sweepPoints(lo, hi, dense);
      return [...new Set([...grid, ...measured.map((p) => p.frequency)])].sort((a, b) => a - b);
    }
    return logX ? sweepPointsLog(lo, hi, points) : sweepPoints(lo, hi, points);
  }, [view, logX, design.sweep, measured]);

  /** The response view sweeps the band whether or not the chart locus is enabled. */
  const response = useMemo(() => {
    if (!responseFrequencies) return null;
    return sweepResponse(
      sweepFrequency(
        {
          z0: design.z0,
          frequency: design.frequency,
          load: design.load,
          elements,
        },
        responseFrequencies,
        loadModel,
      ),
    );
  }, [responseFrequencies, design.z0, design.frequency, design.load, elements, loadModel]);
  /** The same response for the network as built with its packages. */
  const packagedResponse = useMemo(
    () =>
      responseFrequencies && packagedLadder
        ? sweepResponse(sweepFrequency(packagedLadder, responseFrequencies, loadModel))
        : null,
    [responseFrequencies, packagedLadder, loadModel],
  );
  /** The network applied to each measured point itself: the markers on the curves. */
  const measuredResponse = useMemo(
    () =>
      responseFrequencies && measured
        ? sweepResponse(
            sweepDatapoints(
              { z0: design.z0, frequency: design.frequency, load: design.load, elements },
              measured,
            ),
          )
        : null,
    [responseFrequencies, measured, design.z0, design.frequency, design.load, elements],
  );
  /** |S11| and VSWR of the load alone, before the network, when asked for. */
  const loadAloneOn = useDesignStore((s) => s.response.loadAlone ?? false);
  const loadAloneResponse = useMemo(
    () =>
      responseFrequencies && loadAloneOn
        ? sweepResponse(
            sweepFrequency(
              { z0: design.z0, frequency: design.frequency, load: design.load, elements: [] },
              responseFrequencies,
              loadModel,
            ),
          )
        : null,
    [responseFrequencies, loadAloneOn, design.z0, design.frequency, design.load, loadModel],
  );
  /** The measured load alone on the chart: its points and its model across the band. */
  const measuredTrace = useMemo(() => {
    if (!measuredLoad) return null;
    const sorted = sortedMeasured(design.sweep);
    const lo = sorted?.[0]?.frequency;
    const hi = sorted?.[sorted.length - 1]?.frequency;
    if (!sorted || lo === undefined || hi === undefined || !(hi > lo)) return null;
    const model = pointsLoadModel(design.sweep.loads ?? sorted, design.z0);
    return {
      points: sorted.map((p) => p.z),
      curve: sweepPoints(lo, hi, 601).map((f) => loadAt(model, f)),
    };
    // fits: the model arrives from the fitting worker.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [measuredLoad, design.sweep, design.z0, fits]);

  /** The measured board against the design (phase D6): measured, designed, after the retune. */
  const boardFit = useBoardFit();
  const boardTrace = useMemo(() => {
    const cmp = boardComparison(design);
    if (!cmp || cmp.points.length === 0) return null;
    const z = (g: Complex): Complex => gammaToZ(g, design.z0);
    const retune = currentRetune(design);
    const changes = retune?.suggestion?.changes ?? [];
    const fit = currentFit(design);
    const drifts = fit?.ok ? fit.fit.drifts : null;
    const after = changes.length > 0 ? expectedAfter(design, drifts ?? {}, changes) : null;
    const fitted = drifts ? fittedGammas(design, drifts) : null;
    return {
      frequencies: cmp.points.map((p) => p.frequency),
      measured: cmp.points.map((p) => z(p.measured)),
      designed: cmp.points.map((p) => z(p.designed)),
      fitted: fitted ? fitted.map(z) : null,
      after: after ? after.map(z) : null,
      designFrequency: design.frequency,
    };
    // boardFit: the retune and the fit arrive in their store.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [design, boardFit]);

  const deviceCircles = useMemo(() => designCircles(design), [design]);

  return {
    elements,
    result,
    sweep,
    sweepKind,
    sweepAnchor,
    userPoints,
    realization,
    f0RangeNote,
    sweepNote,
    realizedSweepPoints,
    packageTable,
    board,
    packagedLadder,
    builtWhat,
    layoutNotes,
    packaged,
    packagedSweepPoints,
    response,
    packagedResponse,
    measuredResponse,
    loadAloneResponse,
    measuredTrace,
    boardTrace,
    deviceCircles,
  };
}
