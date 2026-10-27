import {
  applyElement,
  elementArc,
  elementReach,
  evaluateLadder,
  layoutAssumptions,
  gammaToZ,
  sweepDatapoints,
  sweepFrequency,
  sweepPoints,
  sweepPointsLog,
  sweepResponse,
  tuneElement,
  zToGamma,
  zToY,
  type Complex,
  type Element,
  type Ladder as CoreLadder,
  type MatchSolution,
} from '@smithonline/core';
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  useCallback,
} from 'react';
import { createPortal } from 'react-dom';
import { DOUBLE_TAP_MS } from './chart/gestures';
import { SmithChart, type Finger, type Ghost } from './chart/SmithChart';
import { placement, type Placement } from './lib/placement';
import { sweepAnchorIndex } from './chart/sweepLabels';
import { nextColor } from './lib/colors';
import { elementSummary, type PaletteEntry } from './lib/elements';
import { AutoMatch } from './components/AutoMatch';
import { useCloseOnRequest } from './lib/dialogs';
import { BandOptimizer } from './components/BandOptimizer';
import type { HeaderProps, Theme } from './components/Header';
import { Ladder } from './components/Ladder';
import { Palette } from './components/Palette';
import { MonteCarloPanel } from './components/MonteCarloPanel';
import { ModeBanner } from './components/ModeBanner';
import { RealizeControls } from './components/RealizeControls';
import { BuildPanel } from './components/BuildPanel';
import { ReportDialog } from './components/ReportDialog';
import { StartGuide } from './components/StartGuide';
import { isHelpKey, isTextEditing } from './lib/helpKey';
import { appShortcut, fileShortcuts } from './lib/shortcuts';
import { pointerHints, TIPS } from './lib/tips';
import { useHelp } from './store/useHelp';
import { HelpDialog } from './components/HelpDialog';
import { SettingsDialog } from './components/SettingsDialog';
import { PartLibraryDialog } from './components/PartLibraryDialog';
import { usePartLibrary } from './store/usePartLibrary';
import {
  attachLibraryData,
  attachProblemsText,
  libraryAttachProblems,
  linkPartsNote,
  partRangeNote,
  sweepRangeNote,
} from './lib/parts';
import { dropLinkFromAddressBar, linkOpening } from './lib/share';
import { withoutData } from '@smithonline/core';
import { currentFit, currentRetune, useBoardFit } from './lib/boardFit';
import { boardComparison, expectedAfter, fittedGammas } from './lib/measuredBoard';
import { useSettings } from './store/useSettings';
import { printReport } from './lib/report';
import { buildReportParts, readReportSelection } from './lib/reportParts';
import { TourPanel } from './components/TourPanel';
import { TourOverlayHead } from './components/TourOverlayHead';
import { WorkflowDriver } from './components/WorkflowDriver';
import { NextStepChip } from './components/NextStepChip';
import { appBridge } from './lib/tourUi';
import { noteMatchAdded } from './lib/nextSteps';
import { RightPanel } from './components/RightPanel';
import { Schematic, SchematicHandle, type BuiltNetwork } from './components/Schematic';
import { readStripHeight, storeStripHeight } from './lib/strip';
import { SolutionList } from './components/SolutionList';
import { ResponseView } from './response/ResponseView';
import { SPlotView } from './splot/SPlotView';
import { useLiveNetwork } from './splot/useLiveNetwork';
import { designCircles } from './lib/circles';
import { targetOf } from './lib/design';
import { designSweep } from './lib/files';
import { designHasDatapointSweep, startIndex, userDatapoints, twinOf } from './lib/datapoints';
import {
  designBand,
  designLoadModel,
  loadAt,
  pointsLoadModel,
  useFitVersion,
  sortedMeasured,
} from './lib/measuredLoad';
import { elementName, PALETTE } from './lib/elements';
import { datapointLabel, fmtComplex, fmtDeg, fmtNum, NO_VALUE } from './lib/format';
import { PINNED_STRIP_EMPTY_H, PINNED_STRIP_H, useLayout } from './lib/layout';
import { addedMessage, lSolutions } from './lib/match';
import { toolInfo, type Tool, type ToolId } from './lib/tools';
import {
  derivedSweep,
  effectiveElements,
  packagedElements,
  asBuiltTitle,
  asBuiltWhat,
  realizeDesign,
  realizedSweep,
} from './lib/realize';
import { useDesignBuild } from './store/useDesignBuild';
import { ownBuild, startNotice } from './lib/designBuild';
import { writeAutosave } from './lib/autosave';
import { useImported } from './lib/importDialog';
import { ImportDialog } from './components/ImportDialog';
import { useDesignStore, type GridDensity, type RunOwner } from './store/useDesignStore';
import { useShell, useSheetHold, type Detent } from './store/useShell';
import { useTourStore } from './store/useTourStore';
import { Button } from './components/ui/Button';
import { Menu, type MenuEntry } from './components/ui/Menu';
import { Popover } from './components/ui/Popover';
import { StatusMessage, Toast } from './components/ui/Toast';
import { topLevel, useCoveringOverlay, useEscapeLayer } from './lib/overlay';
import { useCoarsePointer } from './lib/pointer';
import { PreviewedContext } from './lib/previewed';
import { ChartChips } from './layout/ChartChips';
import { BoardLegendEntries } from './chart/BoardLegend';
import { ErrorBanner } from './layout/ErrorBanner';
import { ChartModeBar } from './layout/ChartModeBar';
import { DesktopHeader } from './layout/DesktopHeader';
import { PhoneTopBar } from './layout/PhoneTopBar';
import { Shell } from './layout/Shell';

interface ChartMenu {
  readonly gamma: Complex;
  /** Viewport coordinates of the right-click. */
  readonly x: number;
  readonly y: number;
  /** The datapoint that was right-clicked or long pressed, if any. */
  readonly point: number | null;
  /** The other markers within 12 px of that point: the context sheet offers them in a chooser row. */
  readonly crowd: readonly number[];
}

interface Suggestions {
  readonly target: Complex;
  /** Viewport coordinates of the double-click. */
  readonly x: number;
  readonly y: number;
  readonly solutions: readonly MatchSolution[];
  /** Opened by a double tap: a third tap that follows at once does not close it. */
  readonly tap?: boolean;
}

/** How long the chrome cross-fades after a theme switch, ms: --dur-base and a frame to spare. */
const THEME_FADE_MS = 200;

const THEME_KEY = 'smithonline.theme';

/**
 * Scroll the Network segment of the phone's sheet to a ladder card when the sheet is open there:
 * a tap on a part in the pinned schematic strip. Within the sheet's body only, never the page.
 */
function revealCard(index: number): void {
  const shell = useShell.getState();
  if (shell.pane !== 'network' || shell.detent === 'peek') return;
  const body = document.querySelector<HTMLElement>('.panel-sheet-body');
  const card = body?.querySelector<HTMLElement>(
    index === 0 ? '.card.load' : `.card[data-element-index="${index - 1}"]`,
  );
  if (!body || !card) return;
  const b = body.getBoundingClientRect();
  const c = card.getBoundingClientRect();
  if (c.top >= b.top && c.bottom <= b.bottom) return;
  const top = body.scrollTop + c.top - b.top - 8;
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (typeof body.scrollTo === 'function') {
    body.scrollTo({ top, behavior: reduced ? 'auto' : 'smooth' });
  } else {
    body.scrollTop = top;
  }
}

export function App() {
  // A live network entry in the S-Plot list follows the design in every view.
  useLiveNetwork();
  const design = useDesignStore((s) => s.design);
  const chart = useDesignStore((s) => s.chart);
  const selected = useDesignStore((s) => s.selected);
  const view = useDesignStore((s) => s.view);
  const logX = useDesignStore((s) => s.response.logX);
  const touring = useTourStore((s) => s.tour !== null);
  const datapointInput = useDesignStore((s) => s.datapointInput);
  const { select, setChart, undo, redo } = useDesignStore.getState();
  const layout = useLayout();
  const phone = layout === 'phone';
  // A sheet or full-screen dialog over the phone's page while a tour runs: its head goes on top.
  const tourCovered = useCoveringOverlay(phone && touring);
  const svgRef = useRef<SVGSVGElement>(null);
  const schematicRef = useRef<SVGSVGElement>(null);
  /** Height of the schematic strip under the chart, remembered across sessions. */
  const [stripHeight, setStripHeight] = useState<number>(readStripHeight);
  const [hover, setHover] = useState<Complex | null>(null);
  /** A finger on the chart (on a marker, on empty chart, aiming): the phone's readout band shows. */
  const [finger, setFinger] = useState<Finger | null>(null);
  /**
   * The point a marker press holds, by its identity (the load, or the part behind the node):
   * the readout shows that point where it lands, and the drag's step is named after it.
   */
  const [dragId, setDragId] = useState<string | null>(null);
  /** The message serial when the finger went down: a readout left on lift waits for no newer one. */
  const fingerSerial = useRef<number | null>(null);
  const [menu, setMenu] = useState<ChartMenu | null>(null);
  const [armed, setArmed] = useState<PaletteEntry | null>(null);
  const [suggest, setSuggest] = useState<Suggestions | null>(null);
  /** The match solution under the pointer in any list, drawn as a ghost on the chart. */
  const [preview, setPreview] = useState<MatchSolution | null>(null);
  // The open tool lives in the shell store, so a guided workflow can open one (docs/09).
  const tool = useShell((s) => s.tool);
  const setToolState = useShell.getState().setTool;
  const [report, setReport] = useState(false);
  const settingsOpen = useShell((s) => s.settings !== null);
  const setSettingsOpen = (open: boolean): void => {
    if (open) useShell.getState().openSettings();
    else useShell.getState().closeSettings();
  };
  // A Try link in Help loads an example or starts a tour: the dialogs under Help close so it is visible.
  const closeDialogs = useCallback(() => {
    setReport(false);
    useShell.getState().closeSettings();
    usePartLibrary.getState().setOpen(false);
  }, []);
  const libraryOpen = usePartLibrary((s) => s.open);
  const imported = useImported((s) => s.imported);
  const library = usePartLibrary((s) => s.parts);
  const libraryReady = usePartLibrary((s) => s.ready);
  useCloseOnRequest(closeDialogs);
  const helpOpen = useHelp((s) => s.open);
  const closeHelp = useHelp((s) => s.closeHelp);
  const verticalSchematic = useSettings((s) => s.settings.schematic) === 'vertical';
  const [fitKey, setFitKey] = useState(0);
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      const t = localStorage.getItem(THEME_KEY);
      return t === 'light' || t === 'dark' ? t : 'auto';
    } catch {
      return 'auto';
    }
  });

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
  const sweepKind = designHasDatapointSweep(design) ? 'datapoints' : 'frequency';
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
  // Library parts that came without their data (a share link) take it from the part library,
  // unless the library's part of that name is another part: then the fitted circuit stays and
  // the status line says why (once per refusal). A design just opened from a link gets one
  // line on what became of its parts once the library is read.
  const reportedAttach = useRef('');
  // A link or autosave from before 0.6.0 opened at the start: its notice, now that the status
  // line and the phone's toast listen (lib/designBuild.ts openedDesign).
  useEffect(() => {
    if (!startNotice.text) return;
    const { text, error, undo, action } = startNotice;
    useDesignStore.getState().setMessage(text, {
      error: error === true,
      undo: undo === true,
      ...(action ? { action } : {}),
    });
    startNotice.text = null;
    startNotice.action = undefined;
  }, []);
  useEffect(() => {
    const parts = library.map((p) => p.part);
    const store = useDesignStore.getState();
    const problems = libraryAttachProblems(design.elements, parts);
    const key = problems.map((p) => `${p.index}:${p.part.partNumber}`).join(',');
    if (libraryReady && linkOpening.pending) {
      linkOpening.pending = false;
      const realize = useDesignStore.getState().design.realize;
      const note = linkPartsNote(design.elements, parts, {
        fromLibrary: realize.enabled && realize.series === 'library',
        missing: realization?.elements.filter((e) => e.noLibraryPart).length ?? 0,
      });
      if (note) store.setMessage(note);
    } else if (key && key !== reportedAttach.current) {
      const text = attachProblemsText(problems);
      if (text) store.setMessage(text, { error: true });
    }
    reportedAttach.current = key;
    const attached = attachLibraryData(design.elements, parts);
    if (attached) store.attachPartData(attached);
    // realization: read for the count only; the library and the elements decide when to run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [design.elements, library, libraryReady]);

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
  const shownRangeNote = useRef<string | null>(null);
  useEffect(() => {
    const note = f0RangeNote ?? sweepNote;
    if (note && note !== shownRangeNote.current) {
      useDesignStore.getState().setMessage(note, f0RangeNote ? { error: true } : undefined);
    }
    shownRangeNote.current = note;
  }, [f0RangeNote, sweepNote]);
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
  const coarse = useCoarsePointer();
  // The phone's pinned strip scrolls sideways when the ladder is long: it shows the source end
  // (the newest part, Zin and VSWR) when a part comes or goes, and the selected cell when the
  // selection moves to one out of view.
  const elementCount = design.elements.length;
  useLayoutEffect(() => {
    if (!phone || view !== 'chart') return;
    const strip = document.querySelector<HTMLElement>('.pinned-strip');
    if (strip) strip.scrollLeft = strip.scrollWidth;
  }, [phone, view, elementCount]);
  useEffect(() => {
    if (!phone || view !== 'chart' || selected === null) return;
    const strip = document.querySelector<HTMLElement>('.pinned-strip');
    const cell = strip?.querySelector(`[data-cell="${selected}"]`);
    if (!strip || !cell) return;
    const s = strip.getBoundingClientRect();
    const c = cell.getBoundingClientRect();
    if (c.left < s.left) strip.scrollLeft += c.left - s.left;
    else if (c.right > s.right) strip.scrollLeft += c.right - s.right;
  }, [phone, view, selected]);
  // The locus legend sits under the chart controls and the chart then starts below them, so it
  // never covers the disc; the toolbar wraps, so its height is measured. A mode's banner is a
  // passing state: it lies over the chart's top margin under the toolbar and never resizes it.
  const legendShown =
    view === 'chart' &&
    (realization !== null ||
      packaged !== null ||
      design.measurement !== undefined ||
      (chart.measuredLoad && sortedMeasured(design.sweep) !== null));
  const bannerShown = !phone && view === 'chart' && (armed !== null || datapointInput);
  const toolbarTall = legendShown;
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [toolbarHeight, setToolbarHeight] = useState<number | null>(null);
  const toolbarMeasured = (legendShown || bannerShown) && !phone;
  useEffect(() => {
    const el = toolbarRef.current;
    if (!toolbarMeasured || !el || typeof ResizeObserver === 'undefined') return;
    const measure = (): void => setToolbarHeight(Math.ceil(el.getBoundingClientRect().height));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [toolbarMeasured]);

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
    if (!chart.measuredLoad) return null;
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
  }, [chart.measuredLoad, design.sweep, design.z0, fits]);

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

  // Autosave the design and apply the theme.
  useEffect(() => {
    // With its build written in: the design reopens as built here, whatever the defaults then.
    // An autosave this version could not read and could not keep a copy of is not written over
    // until the user has saved it as a file (main.tsx); private mode keeps the design in memory.
    const own = ownBuild(design);
    const saved = writeAutosave(own, () => ({
      ...own,
      elements: own.elements.map((el) =>
        el.kind === 'part' ? { ...el, part: withoutData(el.part) } : el,
      ),
    }));
    // A link opened at the start or pasted in leaves the address bar once the autosave holds it.
    if (saved && linkOpening.dropWhenSaved) {
      linkOpening.dropWhenSaved = false;
      dropLinkFromAddressBar();
    }
  }, [design]);
  useEffect(() => storeStripHeight(stripHeight), [stripHeight]);
  /** The theme the effect below applied last: the first run (the start) does not cross-fade. */
  const themeApplied = useRef<Theme | null>(null);
  useEffect(() => {
    const root = document.documentElement;
    // A switch by the user cross-fades the chrome for --dur-base; the chart changes at once.
    const switching = themeApplied.current !== null && themeApplied.current !== theme;
    themeApplied.current = theme;
    if (switching) root.classList.add('theme-switching');
    const fade = switching
      ? setTimeout(() => root.classList.remove('theme-switching'), THEME_FADE_MS)
      : null;
    if (theme === 'auto') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', theme);
    // The browser chrome follows the canvas colour: each meta keeps its own scheme on auto.
    for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
      // By attribute: HTMLMetaElement.media is missing in some engines (jsdom).
      const media = meta.getAttribute('media') ?? '';
      const scheme = theme === 'auto' ? (media.includes('dark') ? 'dark' : 'light') : theme;
      meta.content = scheme === 'dark' ? '#0e1217' : '#f2f3f5';
    }
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      // ignore
    }
    return () => {
      if (fade !== null) clearTimeout(fade);
      root.classList.remove('theme-switching');
    };
  }, [theme]);

  /**
   * Open or close a tool. It shows in the right column (desktop), the side
   * column's tool segment (tablet) or the Tools segment of the phone's sheet;
   * a tool opened during a lesson ends the lesson with an Undo message. A
   * workflow goes on: its steps open the tools themselves (docs/09).
   */
  const setTool = (next: Tool): void => {
    const running = useTourStore.getState().tour;
    if (next !== null && touring && running && running.kind !== 'workflow') {
      const tour = running;
      useTourStore.getState().close();
      useDesignStore
        .getState()
        .setMessage(
          `Closed the tour${tour ? ` "${tour.title}"` : ''} to open ${toolInfo(next).label}. Undo brings your previous design back.`,
          { undo: true },
        );
    }
    setToolState(next);
    const shell = useShell.getState();
    if (next === null) shell.toolClosed();
    else {
      shell.toolOpened();
      // On the phone the tool's panel is in the sheet: a sheet at peek comes up to show it.
      // A page (Response, S-Plot) holding it at peek gives way too: the user asked for the tool.
      if (phone && shell.detent === 'peek') shell.setDetent('half');
    }
  };

  // Keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'F1' && !e.ctrlKey && !e.metaKey && !e.altKey) e.preventDefault(); // never the browser's own help
      if (isHelpKey(e)) {
        useHelp.getState().toggleHelp();
        return;
      }
      // Ctrl+S, Ctrl+O, Ctrl+E and Alt+1 to 3 are the application's own: the browser's save,
      // open and search never come up over it, also where the keys do nothing.
      const shortcut = appShortcut(e);
      if (shortcut) e.preventDefault();
      // A key held down repeats: one save, one picker, one menu per press.
      if (shortcut && e.repeat) return;
      // An open dialog, menu, popover or sheet keeps the keys to itself: undo, new, delete and
      // the file and view shortcuts do not act behind it (Escape is the overlay stack's own).
      if (useHelp.getState().open || topLevel() === 'overlay') return;
      // Only text editing keeps the browser shortcuts; a focused checkbox, radio, slider or
      // select still gets the application's undo and redo.
      if (isTextEditing(e.target as HTMLElement | null)) return;
      if (shortcut) {
        if (shortcut.kind === 'view') useDesignStore.getState().setView(shortcut.view);
        else if (shortcut.kind === 'save') fileShortcuts.current?.save();
        else if (shortcut.kind === 'open') fileShortcuts.current?.open();
        else fileShortcuts.current?.exportMenu();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        useDesignStore.getState().newDesign();
        useShell.getState().setTool(null);
        useShell.getState().toolClosed();
        setArmed(null);
      } else if (e.key === 'Delete' && selected !== null && selected > 0) {
        useDesignStore.getState().removeElement(selected - 1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected, undo, redo]);

  // The Escape stack under the overlays (docs/07-interaction-redesign.md section 2.3): an
  // armed part or datapoint input first, then the open tool panel; the tour sits below both.
  // The workflow at the bottom, in every view: the Response and S-Plot pages may not show the
  // panel that holds its own layer (QA round 3). Two tour layers end the same workflow once.
  useEscapeLayer('tour', touring, () => useTourStore.getState().end());
  useEscapeLayer('mode', armed !== null || datapointInput, () => {
    setArmed(null);
    useDesignStore.getState().setDatapointInput(false);
  });
  useEscapeLayer('panel', tool !== null, () => {
    // On a touch screen a tapped row previews: the first Escape ends the preview only (the
    // row's selection goes with it), the next one closes the tool.
    if (preview !== null && (phone || coarse)) {
      setPreview(null);
      return;
    }
    setPreview(null);
    setTool(null);
  });

  // The phone's sheet drops to peek while a part is armed or datapoints are tapped in, and
  // comes back to its detent after the place, the cancel or Done. A previewed solution drops
  // the sheet so the whole ghost shows above it: to half (just below the chart), or to peek
  // where half would still cover the ghost. Each mode holds under its own name, so they end
  // in any order (store/useShell.ts).
  const [previewTo, setPreviewTo] = useState<Detent>('half');
  useSheetHold(phone, armed !== null, 'peek', undefined, 'arm');
  useSheetHold(phone, datapointInput, 'peek', undefined, 'datapoint');
  useSheetHold(phone, preview !== null, previewTo, undefined, 'preview');

  /**
   * Dragging a datapoint: the load moves freely, any other point re-solves
   * the element that produced it for the value that lands nearest the pointer.
   */
  const onDragDatapoint = (index: number, gamma: Complex, owner: RunOwner): void => {
    const target = gammaToZ(gamma, design.z0);
    const store = useDesignStore.getState();
    // The chart owns the run: it ends when the chart goes away, whatever else happens.
    if (index === 0) {
      store.setLoad(target, owner);
      return;
    }
    const el = design.elements[index - 1];
    const before = result.datapoints[index - 1];
    if (!el || !before) return;
    if (el.kind === 'part') {
      // A library part is its measured data: nothing to tune. Said once per drag.
      if (!partDragNoted.current) {
        partDragNoted.current = true;
        store.setMessage(
          `${datapointLabel(index, userDatapoints(design).length, startIndex(design))} follows the library part ${el.part.partNumber}, whose value is its measured data and cannot be tuned; drag another point, or choose another part in the part library`,
        );
      }
      return;
    }
    const tuned = tuneElement(el, before, target, design.frequency);
    if (tuned) store.updateElement(index - 1, tuned, owner);
  };
  /** The identity of each chain point: the load, then the part behind each node. */
  const pointIds = useMemo(() => ['load', ...design.elements.map((e) => e.id)], [design.elements]);
  /** The chain index of the point a marker press holds, or null (none, or it went away). */
  const dragIndex = dragId === null ? null : pointIds.indexOf(dragId);
  const heldPoint = dragIndex !== null && dragIndex >= 0 ? dragIndex : null;
  /** A marker press holds the sheet at peek; its release ends the hold. */
  const partDragNoted = useRef(false);
  const onDragStart = (index: number): void => {
    partDragNoted.current = false;
    setDragId(pointIds[index] ?? null);
    if (phone) useShell.getState().hold('peek', undefined, 'marker');
  };
  /**
   * The press ends: a drag that moved its point is one step, named after the point and its
   * new value ("Moved TP4: Shunt L 2 to 16.8 nH", "Moved DP1 to 32.0 + j5.0 Ω").
   */
  const onDragEnd = (): void => {
    const store = useDesignStore.getState();
    const d = store.design;
    const index = dragId === null ? -1 : ['load', ...d.elements.map((e) => e.id)].indexOf(dragId);
    const name = datapointLabel(index, userDatapoints(d).length, startIndex(d));
    const el = index > 0 ? d.elements[index - 1] : undefined;
    const label =
      index === 0
        ? `Moved ${name} to ${fmtComplex(d.load, 1)} Ω`
        : el
          ? `Moved ${name}: ${elementName(el)} ${index} to ${elementSummary(el)}`
          : undefined;
    store.commit(label);
    setDragId(null);
    useShell.getState().release('marker');
  };

  /** Right-click menu: add the chosen element and tune it towards the clicked point. */
  const addAt = (
    at: ChartMenu,
    make: (z0: number, f: number) => import('@smithonline/core').Element,
  ): void => {
    const base = make(design.z0, design.frequency);
    const target = gammaToZ(at.gamma, design.z0);
    const tuned = tuneElement(base, result.zin, target, design.frequency);
    useDesignStore.getState().addElement(tuned ?? base, addedLabel(tuned ?? base));
    setMenu(null);
  };

  /**
   * Where the armed part would go for the pointer: the part tuned towards it, or "cannot
   * reach" where no positive value of a sensible size moves the point there.
   */
  const armedPlacement = useMemo((): Placement | null => {
    if (!armed || !hover) return null;
    const base = armed.make(design.z0, design.frequency);
    return placement(base, result.zin, gammaToZ(hover, design.z0), design.frequency);
  }, [armed, hover, design.z0, design.frequency, result.zin]);
  /** The element an armed palette entry would add, tuned towards the pointer. */
  const armedElement = useMemo((): Element | null => {
    if (!armed) return null;
    if (armedPlacement?.kind === 'ok') return armedPlacement.element;
    return armed.make(design.z0, design.frequency);
  }, [armed, armedPlacement, design.z0, design.frequency]);

  /** What the chart previews: the armed element's reach and landing point, or a hovered suggestion. */
  const ghost = useMemo((): Ghost | null => {
    const color = nextColor(design.elements);
    const f = design.frequency;
    if (preview) {
      const arcs: Complex[][] = [];
      let z = preview.from ?? result.zin;
      for (const el of preview.elements) {
        arcs.push(elementArc(el, z, f));
        z = applyElement(el, z, f);
      }
      return { reach: [], arcs, marker: z, label: preview.description, color };
    }
    if (armed && armedElement) {
      const base = armed.make(design.z0, f);
      const reach = elementReach(base, result.zin, f);
      if (!hover) return { reach, arcs: [], marker: null, label: '', color };
      if (armedPlacement?.kind === 'unreachable') {
        // Aimed where the part cannot go: a dashed red marker at the pointer, no locus.
        return {
          reach,
          arcs: [],
          marker: gammaToZ(hover, design.z0),
          label: `${armed.label} cannot reach`,
          color,
          unreachable: true,
        };
      }
      const marker = applyElement(armedElement, result.zin, f);
      return {
        reach,
        arcs: [elementArc(armedElement, result.zin, f)],
        marker,
        label: `${armed.label} ${elementSummary(armedElement)}`,
        color,
      };
    }
    return null;
  }, [
    armed,
    armedElement,
    armedPlacement,
    hover,
    preview,
    design.elements,
    design.frequency,
    design.z0,
    result.zin,
  ]);

  // Where a previewed ghost ends on screen decides how low the sheet goes: half covers the
  // space below the chart only, so a ghost that reaches lower (a short screen) needs peek.
  useLayoutEffect(() => {
    if (!phone || !preview) return;
    const box = svgRef.current?.querySelector('.ghost')?.getBoundingClientRect();
    const h = useShell.getState().heights;
    const covered = Boolean(box && h && box.height > 0 && box.bottom > window.innerHeight - h.half);
    setPreviewTo(covered ? 'peek' : 'half');
  }, [phone, preview, ghost]);

  /** Palette click: arm the entry; a second click adds it at its default value. */
  const closeSuggest = (): void => {
    setSuggest(null);
    setPreview(null);
  };

  /** The step a new part makes, as its message and Undo and Redo name it. */
  const addedLabel = (el: Element): string =>
    `Added ${elementName(el)} ${design.elements.length + 1}: ${elementSummary(el)}`;

  /** Add an entry at its default value and say so (Undo repeats it). */
  const addDefault = (entry: PaletteEntry): void => {
    const el = entry.make(design.z0, design.frequency);
    useDesignStore.getState().addElement(el, addedLabel(el));
    setArmed(null);
  };

  const pick = (entry: PaletteEntry): void => {
    closeSuggest();
    useDesignStore.getState().setDatapointInput(false);
    if (armed?.id === entry.id) addDefault(entry);
    else setArmed(entry);
  };

  /**
   * Click on the chart with an armed element: add it tuned to that point. Where the part
   * cannot move the point to, nothing is added, the part stays armed and the message says
   * where to aim.
   */
  const place = (gamma: Complex): void => {
    if (!armed) return;
    const base = armed.make(design.z0, design.frequency);
    const at = placement(base, result.zin, gammaToZ(gamma, design.z0), design.frequency);
    if (at.kind === 'unreachable') {
      useDesignStore
        .getState()
        .setMessage(`${armed.label} cannot reach that point; ${at.hint}`, { error: true });
      return;
    }
    useDesignStore.getState().addElement(at.element, addedLabel(at.element));
    setArmed(null);
  };

  /** Click on the chart in datapoint input mode: add a user datapoint at the design frequency. */
  const placeDatapoint = (gamma: Complex): void => {
    const point = { frequency: design.frequency, z: gammaToZ(gamma, design.z0) };
    const twin = twinOf(userDatapoints(design), point);
    if (twin >= 0) {
      useDesignStore
        .getState()
        .setMessage(`DP${twin + 1} already has these values; nothing added.`);
      return;
    }
    useDesignStore.getState().addDatapoint(point);
  };

  /** Double click: every one- or two-element network from Zin to the clicked point. */
  const suggestAt = (gamma: Complex, clientX: number, clientY: number, tap = false): void => {
    const target = gammaToZ(gamma, design.z0);
    const solutions = lSolutions(result.zin, target, design.z0, design.frequency);
    setArmed(null);
    setMenu(null);
    if (tool === 'match') setTool(null);
    setPreview(null);
    setSuggest({ target, x: clientX, y: clientY, solutions, tap });
  };

  const applySuggestion = (sol: MatchSolution): void => {
    // The same message as Auto match's Add parts: it names the step for Undo and Redo.
    useDesignStore.getState().addElements(sol.elements, addedMessage(sol));
    closeSuggest();
    noteMatchAdded('suggestion');
  };

  /** Header tool buttons: one panel at a time, a second click closes it. */
  const toggleTool = (next: Tool): void => {
    // Auto match previews on the chart, so it brings the chart with it.
    if (next === 'match' && tool !== next && view !== 'chart') {
      useDesignStore.getState().setView('chart');
    }
    closeSuggest();
    setArmed(null);
    // The open tool's button brings its segment back when another one shows; on its segment
    // a second press closes it.
    const shell = useShell.getState();
    if (next !== null && tool === next && (shell.pane !== 'tool' || (phone && !shell.toolPushed))) {
      shell.pushTool();
      return;
    }
    setTool(tool === next ? null : next);
  };

  /** A Tools row or More: open the tool, or show its panel again when it is open already. */
  const openTool = (next: Tool): void => {
    if (next === null) {
      setTool(null);
      return;
    }
    if (next === tool) {
      useShell.getState().pushTool();
      return;
    }
    toggleTool(next);
  };
  const closeTool = (): void => {
    setPreview(null);
    setTool(null);
  };
  // A guided workflow opens and closes the tools the way the header does (lib/tourUi.ts).
  const toolActions = useRef({ openTool, closeTool });
  useLayoutEffect(() => {
    toolActions.current = { openTool, closeTool };
  });
  useEffect(() => {
    const mine = {
      openTool: (id: ToolId) => toolActions.current.openTool(id),
      closeTool: () => toolActions.current.closeTool(),
    };
    appBridge.current = mine;
    return () => {
      if (appBridge.current === mine) appBridge.current = null;
    };
  }, []);

  /** File > Print: the selection last made in the report dialog, without opening it. */
  const printNow = (): void => {
    const stored = readReportSelection();
    const sel = {
      ...stored,
      chart: stored.chart && view === 'chart',
      schematic: stored.schematic && view === 'chart',
    };
    if (!sel.chart && !sel.schematic && !sel.datapoints && !sel.circles) {
      useDesignStore
        .getState()
        .setMessage('Nothing is selected to print; tick parts in Report', { error: true });
      return;
    }
    const how = printReport(
      buildReportParts({
        design,
        result,
        realization,
        packaged,
        builtWhat,
        layout: layoutNotes,
        chart: svgRef.current,
        schematic: schematicRef.current,
        sel,
      }),
      sel,
    );
    useDesignStore
      .getState()
      .setMessage(
        how === 'tab'
          ? 'Report opened in a new tab for printing'
          : 'Pop-ups are blocked here, so the print dialog opens with the report directly',
      );
  };

  /** The chart menu: remove the part behind a point, or add the next part tuned to the point. */
  const menuEntries = (m: ChartMenu): MenuEntry[] => {
    const entries: MenuEntry[] = [];
    // Empty chart: a match towards the point first, the touch screen's double-click.
    if (m.point === null) {
      entries.push({
        key: 'suggest',
        label: 'Suggest a match to here',
        description: 'One- and two-part networks from Zin to this point',
        className: 'suggest-here',
        onSelect: () => suggestAt(m.gamma, m.x, m.y),
      });
    }
    // Markers within 12 px of each other: a row per neighbour moves the menu to it.
    if (m.point !== null) {
      for (const other of m.crowd) {
        const og = chainGamma(other);
        if (!og) continue;
        entries.push({
          key: `crowd-${other}`,
          label: `${datapointLabel(other, userDatapoints(design).length, startIndex(design))} instead`,
          description: hints.crowdRow,
          className: 'crowd',
          // The menu moves to the other point and keeps the focus on its first row.
          stay: true,
          onSelect: () => setMenu({ ...m, point: other, gamma: og, crowd: crowdAfter(m, other) }),
        });
      }
    }
    const el = m.point !== null && m.point > 0 ? design.elements[m.point - 1] : undefined;
    if (m.point !== null && el) {
      const point = m.point;
      entries.push({
        key: 'remove',
        label: `Remove ${datapointLabel(point, userDatapoints(design).length, startIndex(design))}: ${elementName(el)}`,
        icon: (
          <span className="idx" style={{ background: el.color }}>
            {point}
          </span>
        ),
        destructive: true,
        className: 'remove',
        onSelect: () => useDesignStore.getState().removeElement(point - 1),
      });
    }
    if (m.point === 0) {
      entries.push({ kind: 'note', content: 'DP1 is the load; edit it in the network panel.' });
    }
    entries.push({
      kind: 'note',
      content: `Add next in chain, tuned to ${fmtComplex(gammaToZ(m.gamma, design.z0), 1)} Ω`,
    });
    for (const p of PALETTE) {
      entries.push({
        key: p.id,
        label: p.label,
        icon: (
          <svg viewBox="0 0 30 20" aria-hidden="true">
            <path d={p.icon} />
          </svg>
        ),
        onSelect: () => addAt(m, p.make),
      });
    }
    return entries;
  };

  /** The context menu's title: the point and its own impedance ("TP3, 9.2 + j50.0 Ω"). */
  const menuTitle = (m: ChartMenu): string =>
    m.point !== null
      ? `${datapointLabel(m.point, userDatapoints(design).length, startIndex(design))}, ${fmtComplex(m.point === 0 ? design.load : (result.datapoints[m.point] ?? result.zin), 1)} Ω`
      : `${fmtComplex(gammaToZ(m.gamma, design.z0), 1)} Ω`;
  /** The readout at a point in two lines: z and Z, then Y and Gamma. */
  const readoutLines = (g: Complex): readonly [string, string] => {
    const z = gammaToZ(g, design.z0);
    const y = zToY(z);
    return [
      `z = ${fmtComplex({ re: z.re / design.z0, im: z.im / design.z0 }, 3)}   Z = ${fmtComplex(z, 1)} Ω`,
      `Y = ${fmtComplex({ re: y.re * 1e3, im: y.im * 1e3 }, 2)} mS   Γ = ${fmtNum(Math.hypot(g.re, g.im), 3)} ∠ ${fmtDeg((Math.atan2(g.im, g.re) * 180) / Math.PI)}`,
    ];
  };
  /** The readout at a point on one line: z, Z, Y and Gamma. */
  const readoutAt = (g: Complex): string => readoutLines(g).join('   ');
  /** The reflection coefficient of chain datapoint `i`, where the chart draws its marker. */
  const chainGamma = (i: number): Complex | null => {
    const z = result.datapoints[i];
    if (!z) return null;
    const g = zToGamma(z, design.z0);
    return Number.isFinite(g.re) && Number.isFinite(g.im) ? g : null;
  };
  /** The chooser of a menu moved to `other`: the first point and the rest of the crowd stay in it. */
  const crowdAfter = (m: ChartMenu, other: number): number[] =>
    m.point === null ? [] : [m.point, ...m.crowd.filter((c) => c !== other)];

  /** The label of chain point `i` (DP1, TP2 ...). */
  const pointLabel = (i: number): string =>
    datapointLabel(i, userDatapoints(design).length, startIndex(design));
  /**
   * The readout's point: while a marker is held, the point itself where it lands on its
   * locus (the finger may be off it); otherwise the pointer.
   */
  const shown = heldPoint !== null ? (chainGamma(heldPoint) ?? hover) : hover;
  /** Aiming a placement with a finger: the readout follows the aimed point. */
  const aiming = finger?.aiming === true && (armed !== null || datapointInput);
  /** Where an aimed part lands (or the finger, where it cannot reach), and what it is. */
  const aimed =
    aiming && hover
      ? armed && armedPlacement
        ? armedPlacement.kind === 'ok' && ghost?.marker
          ? {
              title: `${armed.label} ${elementSummary(armedPlacement.element)}`,
              gamma: zToGamma(ghost.marker, design.z0),
            }
          : { title: `${armed.label} cannot reach`, gamma: hover }
        : { title: `DP${userDatapoints(design).length + 1}`, gamma: hover }
      : null;
  // While the pointer is over the chart the readout (z, Z, Y, Gamma) wins over the status message.
  const liveReadout = view === 'chart' && ((!armed && Boolean(shown)) || aimed !== null);
  // The hints name the gestures of the pointer in use: tap and pinch on a touch screen.
  const hints = pointerHints(coarse);
  const hoverText =
    view === 'splot'
      ? hints.splot
      : view === 'response'
        ? hints.response
        : aimed
          ? `${aimed.title}: ${readoutAt(aimed.gamma)}`
          : armed
            ? hints.armedStatus(armed.label)
            : shown
              ? heldPoint !== null
                ? `${pointLabel(heldPoint)}: ${readoutAt(shown)}`
                : readoutAt(shown)
              : hints.chart;
  /** The phone's readout band while a finger is on the chart: the picked point, then two lines. */
  const band = !phone
    ? null
    : liveReadout && shown && !finger && !coarse
      ? { title: heldPoint !== null ? pointLabel(heldPoint) : null, lines: readoutLines(shown) }
      : aimed
        ? { title: aimed.title, lines: readoutLines(aimed.gamma) }
        : finger && !finger.aiming && (shown || finger.point !== null) && !armed && !datapointInput
          ? {
              title:
                heldPoint !== null
                  ? pointLabel(heldPoint)
                  : finger.point !== null
                    ? pointLabel(finger.point)
                    : null,
              lines: shown ? readoutLines(shown) : null,
            }
          : null;
  /**
   * The finger lifted: its last readout passes as the toast, unless a message came in while the
   * finger was down (the step a drag made says more).
   */
  const onFinger = (next: Finger | null): void => {
    const store = useDesignStore.getState();
    if (next !== null && finger === null) fingerSerial.current = store.messageSerial;
    if (next === null && finger !== null && !finger.aiming && shown) {
      if (fingerSerial.current === store.messageSerial) {
        const title =
          heldPoint !== null
            ? pointLabel(heldPoint)
            : finger.point !== null
              ? pointLabel(finger.point)
              : null;
        store.setMessage(`${title ? `${title}: ` : ''}${readoutAt(shown)}`);
      }
      fingerSerial.current = null;
    }
    setFinger(next);
  };

  const zinInfo = result.info[result.info.length - 1];
  const liveText = `Zin ${fmtComplex(result.zin, 1)} Ω   VSWR ${zinInfo ? fmtNum(zinInfo.vswr, 3) : NO_VALUE}`;

  const banner = (
    <ModeBanner
      armed={armed}
      datapointInput={datapointInput}
      nextDatapoint={userDatapoints(design).length + 1}
      coarse={coarse || phone}
      onDefault={() => armed && addDefault(armed)}
      onCancel={() => setArmed(null)}
      onDone={() => useDesignStore.getState().setDatapointInput(false)}
    />
  );
  const modeOn = armed !== null || datapointInput;

  const legend = (realization || packaged || measuredTrace || boardTrace) && (
    <div className="chart-legend" role="note" aria-label="Locus legend" data-tour="chart.legend">
      {(realization || packaged) && (
        <span className="entry" title="The network with the values as typed">
          <span className="sw solid" />
          {design.losses.enabled ? 'Ideal values, with losses' : 'Ideal'}
        </span>
      )}
      {measuredTrace && (
        <span
          className="entry"
          title="The imported rows (dots) and the load model across the measured band (dashed), before any network"
        >
          <span className="sw measured" />
          Measured load
        </span>
      )}
      {boardTrace && <BoardLegendEntries trace={boardTrace} />}
      {realization && (
        <span className="entry" title="The network with standard or stocked values">
          <span className="sw dashed" />
          {realization.sourceLabel === 'library' &&
          !realization.elements.some((e) => e.ideal.kind !== 'part' && e.realized.kind === 'part')
            ? 'Realized: no library part fits, same as ideal'
            : `Realized (${realization.sourceLabel})`}
        </span>
      )}
      {packaged && (
        <span
          className="entry"
          title={
            packagedLadder
              ? asBuiltTitle(
                  realization ? realization.ladder.elements : elements,
                  packagedLadder.elements,
                  packageTable,
                  board,
                )
              : undefined
          }
        >
          <span className="sw dotted" />
          With {builtWhat ?? 'packages'}
        </span>
      )}
    </div>
  );

  const smithChart = (
    <SmithChart
      result={result}
      z0={design.z0}
      options={chart}
      selected={selected}
      sweep={sweep}
      sweepKind={sweepKind}
      realized={realization?.result ?? null}
      realizedSweep={realizedSweepPoints}
      packaged={packaged}
      packagedSweep={packagedSweepPoints}
      measuredLoad={measuredTrace}
      measuredBoard={boardTrace}
      target={targetOf(design)}
      vswrCircles={design.vswrCircles}
      qContours={design.qContours}
      deviceCircles={deviceCircles}
      arcColors={design.elements.map((e) => e.color)}
      onSelect={select}
      onHover={setHover}
      onDragDatapoint={onDragDatapoint}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      pointIds={pointIds}
      ghost={ghost}
      onPlace={armed ? place : datapointInput ? placeDatapoint : null}
      userPoints={userPoints}
      onStartDatapoint={(i) => useDesignStore.getState().setStartDatapoint(i)}
      dpCount={userDatapoints(design).length}
      startSlot={startIndex(design)}
      anchor={sweepAnchor}
      onSuggest={suggestAt}
      fitKey={fitKey}
      onContextMenu={(gamma, clientX, clientY, point, crowd) => {
        setSuggest(null);
        setPreview(null);
        setMenu({ gamma, x: clientX, y: clientY, point, crowd });
      }}
      onFinger={onFinger}
      pulsePoint={menu?.point ?? null}
      svgRef={svgRef}
    />
  );

  /** The suggestions and the chart menu: popovers on a pointer, sheets on a touch screen. */
  const chartOverlays = (
    <>
      {suggest && (
        <Popover
          anchor={{ x: suggest.x, y: suggest.y }}
          onClose={closeSuggest}
          title="Match suggestions"
          label="Match suggestions"
          className="suggest"
          closeLabel="Close suggestions"
          outsideGraceMs={suggest.tap ? DOUBLE_TAP_MS : 0}
          prefer={{ gap: 6 }}
          // With the chart pinned above, a previewed row drops the sheet low enough to show
          // the whole ghost, the tapped end point included.
          low={coarse && preview !== null}
        >
          <div className="dropdown-note">
            Networks from Zin to {fmtComplex(suggest.target, 1)} &#937;, lowest Q first.{' '}
            {hints.preview}
          </div>
          <SolutionList
            solutions={suggest.solutions}
            previewed={preview}
            empty="No one- or two-element network reaches this point from Zin. Try a point with a resistance above zero, or a line first."
            onPreview={setPreview}
            onApply={applySuggestion}
          />
        </Popover>
      )}
      {menu && (
        <Menu
          label="Chart menu"
          title={menuTitle(menu)}
          anchor={{ x: menu.x, y: menu.y }}
          className="context"
          prefer={{ gap: 2 }}
          // A popover shows the point it is for in a title row, as the sheet does in its title.
          header={
            coarse ? undefined : (
              <div className="dropdown-title" role="presentation">
                {menuTitle(menu)}
              </div>
            )
          }
          entries={menuEntries(menu)}
          onClose={() => setMenu(null)}
        />
      )}
    </>
  );

  /**
   * The network as built for the strip's Zin terminal: the realized values and the packages'
   * parasitics, when either is on; the ideal Zin and VSWR then go to its title.
   */
  const built: BuiltNetwork | null = packaged
    ? {
        result: packaged,
        asBuilt: true,
        label: realization
          ? `realized values and ${builtWhat === 'packages' ? 'the packages' : (builtWhat ?? 'the packages')}`
          : // The terminal's title reads "with the <label>": "the board" loses its article here.
            builtWhat === 'the board'
            ? 'board'
            : (builtWhat ?? 'packages'),
      }
    : realization
      ? { result: realization.result, label: 'realized values' }
      : null;
  const schematicStrip = verticalSchematic ? (
    <div className="schematic-side">
      <Schematic
        result={result}
        svgRef={schematicRef}
        realization={realization}
        built={built}
        vertical
      />
    </div>
  ) : (
    <>
      <SchematicHandle height={stripHeight} onChange={setStripHeight} />
      <div className="schematic-strip">
        <Schematic
          result={result}
          height={stripHeight}
          svgRef={schematicRef}
          realization={realization}
          built={built}
        />
      </div>
    </>
  );
  /**
   * The phone's schematic strip, pinned under the chart at 1:1 (the 84-unit drawing, 10 px text)
   * with the values the network uses and Zin and VSWR at its end; an empty ladder draws 56 high.
   */
  const pinnedStrip = (
    <Schematic
      result={result}
      height={PINNED_STRIP_H}
      svgRef={schematicRef}
      realization={realization}
      built={built}
      compactEmpty
      onPick={revealCard}
    />
  );

  /** The main area per view and layout. */
  let main: ReactNode;
  let mainClassName = '';
  let mainStyle: CSSProperties | undefined;
  if (view === 'splot') {
    main = (
      <>
        {phone && <ErrorBanner place="page" />}
        <SPlotView />
      </>
    );
    mainClassName = 'splot-main';
  } else if (view === 'response') {
    main = (
      <>
        {phone && <ErrorBanner place="page" />}
        <ResponseView
          response={response}
          packaged={packagedResponse}
          builtWhat={builtWhat}
          measured={measuredResponse}
          loadAlone={loadAloneResponse}
          designFrequency={design.frequency}
        />
      </>
    );
  } else {
    // The phone: the pinned square chart with its three chips; the schematic strip is in
    // Network. Wider: the toolbar, the chart and the schematic strip under it. The parts keep
    // their places in the list whatever the layout (a null holds the place of the other
    // layout's part), so a rotation across 700 px keeps the chart mounted with its zoom.
    if (!phone) {
      mainClassName = `${verticalSchematic ? 'v-schematic' : ''}${toolbarTall ? ' with-legend' : ''}`;
      mainStyle = {
        '--strip-h': `${verticalSchematic ? 0 : stripHeight}px`,
        ...(toolbarHeight !== null ? { '--toolbar-h': `${toolbarHeight}px` } : {}),
      } as CSSProperties;
    }
    main = (
      <>
        {phone ? null : (
          /* Rows that wrap on a narrow column: the chart controls and the legend. */
          <div className="toolbar" ref={toolbarRef}>
            <div className="toolbar-row">
              <Button
                pressed={chart.zGrid}
                title={TIPS.zGrid}
                onClick={() => setChart({ zGrid: !chart.zGrid })}
              >
                Z grid
              </Button>
              <Button
                pressed={chart.yGrid}
                title={TIPS.yGrid}
                onClick={() => setChart({ yGrid: !chart.yGrid })}
              >
                Y grid
              </Button>
              <select
                className="btn"
                value={chart.density}
                onChange={(e) => setChart({ density: e.target.value as GridDensity })}
                aria-label="Grid density"
                title={TIPS.density}
              >
                <option value="coarse">Coarse</option>
                <option value="normal">Normal</option>
                <option value="fine">Fine</option>
              </select>
              <Button
                pressed={chart.labels}
                title={TIPS.labels}
                onClick={() => setChart({ labels: !chart.labels })}
              >
                Labels
              </Button>
              <Button onClick={() => setFitKey((k) => k + 1)} title={TIPS.fit}>
                Fit
              </Button>
            </div>
            {legend}
          </div>
        )}
        {bannerShown ? (
          <ChartModeBar
            contentKey={`${armed?.id ?? ''}:${datapointInput ? userDatapoints(design).length : ''}:${coarse}`}
            svgRef={svgRef}
            toolbarRef={toolbarRef}
          >
            {banner}
          </ChartModeBar>
        ) : null}
        {smithChart}
        {phone ? (
          <ChartChips band={band} legend={legend} onFit={() => setFitKey((k) => k + 1)} />
        ) : null}
        {phone && boardTrace ? (
          <div
            className="chart-legend board-legend-phone"
            role="note"
            aria-label="Measured board legend"
          >
            <BoardLegendEntries trace={boardTrace} />
          </div>
        ) : null}
        {chartOverlays}
        {phone ? null : schematicStrip}
      </>
    );
  }

  const guide = <StartGuide onAutoMatch={() => openTool('match')} />;
  const network = (
    <>
      {phone && guide}
      {!phone && <h2>Add element</h2>}
      <Palette
        armed={armed}
        onPick={pick}
        disclosure={phone}
        empty={design.elements.length === 0}
      />
      <h2>Network, load to source</h2>
      <RealizeControls />
      <Ladder
        result={result}
        realization={realization}
        guide={phone ? null : guide}
        onAutoMatch={() => openTool('match')}
        showSpread={tool === 'montecarlo'}
      />
      <NextStepChip />
    </>
  );

  const toolPanel =
    tool === 'match' ? (
      <AutoMatch zin={result.zin} elements={elements} onPreview={setPreview} onClose={closeTool} />
    ) : tool === 'optimize' ? (
      <BandOptimizer />
    ) : tool === 'montecarlo' ? (
      <MonteCarloPanel />
    ) : tool === 'build' ? (
      <BuildPanel />
    ) : null;

  const headerProps: HeaderProps = {
    result,
    sweep,
    svgRef,
    theme,
    onTheme: setTheme,
    tool,
    onTool: toggleTool,
    realization,
    onReport: () => setReport(true),
    onPrint: printNow,
    onSettings: () => setSettingsOpen(true),
  };
  // The tool's pane is on show: its segment in a column that shows (the S-Plot view hides the
  // side column), or pushed into the phone's sheet. Otherwise a running job puts a dot on the
  // tool's header button.
  const toolShown = useShell(
    (s) => s.pane === 'tool' && (phone ? s.toolPushed && s.detent !== 'peek' : view !== 'splot'),
  );

  return (
    <Shell
      view={view}
      header={<DesktopHeader {...headerProps} toolShown={toolShown} />}
      topBar={<PhoneTopBar {...headerProps} onTool={openTool} />}
      chart={main}
      mainClassName={mainClassName}
      mainStyle={mainStyle}
      network={network}
      numbers={
        <RightPanel
          result={result}
          sweep={sweep}
          realized={realization ? { realization, sweep: realizedSweepPoints } : null}
        />
      }
      tool={
        toolPanel && (
          <PreviewedContext.Provider value={preview}>{toolPanel}</PreviewedContext.Provider>
        )
      }
      toolId={tool as ToolId | null}
      onOpenTool={(id) => openTool(id)}
      onCloseTool={closeTool}
      // In the S-Plot view the columns hide: a workflow's panel floats over the page instead.
      tour={view === 'splot' && !phone ? null : <TourPanel />}
      banner={modeOn ? banner : null}
      tourHead={touring ? <TourPanel mode="head" /> : null}
      tourBody={touring ? <TourPanel mode="narration" /> : null}
      live={liveText}
      strip={phone && view === 'chart' ? pinnedStrip : null}
      stripHeight={design.elements.length === 0 ? PINNED_STRIP_EMPTY_H : PINNED_STRIP_H}
      status={
        <footer className={liveReadout ? 'statusbar live' : 'statusbar'}>
          <span className="mono status-hover">{hoverText}</span>
          <span className="spacer" />
          {/* The message wins over the hover hint when space runs out; the tooltip holds all of it. */}
          <StatusMessage fallback="Smith Online, a clean-room rebuild inspired by Smith V4.1 by Fritz Dellsperger" />
          {/* Quiet pointer to the source; the message keeps priority when space runs out. */}
          <a
            className="muted status-source"
            href="https://github.com/QumeaJR/smithonline"
            target="_blank"
            rel="noopener noreferrer"
            title="Open source under the MIT license; the code, issues and releases are on GitHub"
          >
            Open source on GitHub
          </a>
          <a
            className="muted status-source"
            href="./licenses.txt"
            target="_blank"
            rel="noopener"
            title="The licence of Smith Online and the notices of the third-party code it includes (QuickSmith-Web, scikit-rf)"
          >
            Licences
          </a>
        </footer>
      }
    >
      {report && (
        <ReportDialog
          result={result}
          realization={realization}
          packaged={packaged}
          builtWhat={builtWhat}
          layout={layoutNotes}
          svgRef={svgRef}
          schematicRef={schematicRef}
          chartShown={view === 'chart'}
          onClose={() => setReport(false)}
        />
      )}
      {settingsOpen && (
        <SettingsDialog onClose={() => setSettingsOpen(false)} theme={theme} onTheme={setTheme} />
      )}
      {imported && (
        <ImportDialog
          key={imported.id}
          file={imported.file}
          onClose={() => useImported.setState({ imported: null })}
        />
      )}
      {libraryOpen && (
        <PartLibraryDialog
          onClose={() => {
            // Opened from Settings, Libraries: closing it goes back to Settings at Libraries.
            const back = usePartLibrary.getState().fromSettings;
            usePartLibrary.getState().setOpen(false);
            if (back) useShell.getState().openSettings('libraries');
          }}
        />
      )}
      {helpOpen && <HelpDialog onClose={closeHelp} />}
      {tourCovered &&
        createPortal(
          // The tour's head stays on top of the File sheet and full-screen dialogs (the part
          // library), which cover the bottom sheet's head; it is there only while one is open.
          <TourOverlayHead />,
          document.body,
        )}
      {view === 'splot' && !phone && touring && (
        <div className="tour-float">
          <TourPanel />
        </div>
      )}
      <WorkflowDriver />
      {(coarse || phone) && <Toast />}
    </Shell>
  );
}
