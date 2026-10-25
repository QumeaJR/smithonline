import {
  applyElement,
  elementArc,
  elementReach,
  evaluateLadder,
  gammaToZ,
  sweepFrequency,
  sweepPoints,
  sweepPointsLog,
  sweepResponse,
  tuneElement,
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
import { SmithChart, type Ghost } from './chart/SmithChart';
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
import { StressControls } from './components/StressControls';
import { ReportDialog } from './components/ReportDialog';
import { StartGuide } from './components/StartGuide';
import { isHelpKey, isTextEditing } from './lib/helpKey';
import { TIPS } from './lib/tips';
import { useHelp } from './store/useHelp';
import { HelpDialog } from './components/HelpDialog';
import { SettingsDialog } from './components/SettingsDialog';
import { useSettings } from './store/useSettings';
import { printReport } from './lib/report';
import { buildReportParts, readReportSelection } from './lib/reportParts';
import { TourPanel } from './components/TourPanel';
import { RightPanel } from './components/RightPanel';
import { Schematic, SchematicHandle } from './components/Schematic';
import { readStripHeight, storeStripHeight } from './lib/strip';
import { SolutionList } from './components/SolutionList';
import { ResponseView } from './response/ResponseView';
import { SPlotView } from './splot/SPlotView';
import { useLiveNetwork } from './splot/useLiveNetwork';
import { designCircles } from './lib/circles';
import { targetOf } from './lib/design';
import { designSweep } from './lib/files';
import { designHasDatapointSweep, startIndex, userDatapoints, twinOf } from './lib/datapoints';
import { elementName, PALETTE } from './lib/elements';
import { datapointLabel, fmtComplex, fmtDeg, fmtNum } from './lib/format';
import { useLayout } from './lib/layout';
import { addedMessage, lSolutions } from './lib/match';
import { toolInfo, type Tool, type ToolId } from './lib/tools';
import {
  derivedSweep,
  effectiveElements,
  packagedElements,
  realizeDesign,
  realizedSweep,
} from './lib/realize';
import { usePackages } from './store/usePackages';
import { useDesignStore, type GridDensity } from './store/useDesignStore';
import { useShell, useSheetHold, type Detent } from './store/useShell';
import { useTourStore } from './store/useTourStore';
import { Button } from './components/ui/Button';
import { Menu, type MenuEntry } from './components/ui/Menu';
import { Popover } from './components/ui/Popover';
import { StatusMessage, Toast } from './components/ui/Toast';
import { topLevel, useEscapeLayer } from './lib/overlay';
import { useCoarsePointer } from './lib/pointer';
import { ChartChips } from './layout/ChartChips';
import { DesktopHeader } from './layout/DesktopHeader';
import { PhoneTopBar } from './layout/PhoneTopBar';
import { Shell } from './layout/Shell';

interface ChartMenu {
  readonly gamma: Complex;
  /** Viewport coordinates of the right-click. */
  readonly x: number;
  readonly y: number;
  /** The datapoint that was right-clicked, if any. */
  readonly point: number | null;
}

interface Suggestions {
  readonly target: Complex;
  /** Viewport coordinates of the double-click. */
  readonly x: number;
  readonly y: number;
  readonly solutions: readonly MatchSolution[];
}

const STORAGE_KEY = 'smithonline.design.v1';
const THEME_KEY = 'smithonline.theme';

/** The phone's schematic strip in the Network pane, px. */
const PHONE_STRIP_H = 64;

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
  const svgRef = useRef<SVGSVGElement>(null);
  const schematicRef = useRef<SVGSVGElement>(null);
  /** Height of the schematic strip under the chart, remembered across sessions. */
  const [stripHeight, setStripHeight] = useState<number>(readStripHeight);
  const [hover, setHover] = useState<Complex | null>(null);
  const [menu, setMenu] = useState<ChartMenu | null>(null);
  const [armed, setArmed] = useState<PaletteEntry | null>(null);
  const [suggest, setSuggest] = useState<Suggestions | null>(null);
  /** The match solution under the pointer in any list, drawn as a ghost on the chart. */
  const [preview, setPreview] = useState<MatchSolution | null>(null);
  const [tool, setToolState] = useState<Tool>(null);
  const [report, setReport] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // A Try link in Help loads an example or starts a tour: the dialogs under Help close so it is visible.
  const closeDialogs = useCallback(() => {
    setReport(false);
    setSettingsOpen(false);
  }, []);
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
  const realization = useMemo(() => realizeDesign(design, elements), [design, elements]);
  const realizedSweepPoints = useMemo(
    () => (realization ? realizedSweep(realization, design) : null),
    [realization, design],
  );

  /**
   * The network as built: the realized values (or the ideal ones) with the
   * chosen component packages resolved to their parasitics. Null while no part
   * names a package.
   */
  const packageTable = usePackages((s) => s.table);
  const packagedLadder = useMemo((): CoreLadder | null => {
    const base = realization ? realization.ladder.elements : elements;
    const built = packagedElements(base, packageTable);
    return built
      ? { z0: design.z0, frequency: design.frequency, load: design.load, elements: built }
      : null;
  }, [realization, elements, packageTable, design.z0, design.frequency, design.load]);
  const packaged = useMemo(
    () => (packagedLadder ? evaluateLadder(packagedLadder) : null),
    [packagedLadder],
  );
  const packagedSweepPoints = useMemo(
    () => (packagedLadder ? derivedSweep(packagedLadder, design) : null),
    [packagedLadder, design],
  );
  const coarse = useCoarsePointer();
  // The locus legend sits under the chart controls and the chart then starts below them, so it
  // never covers the disc; the toolbar wraps, so its height is measured. A mode's banner is a
  // passing state: it lies over the chart's top margin under the toolbar and never resizes it.
  const legendShown = view === 'chart' && (realization !== null || packaged !== null);
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

  /** The sweep frequencies of the Response view, or null when the range is not usable. */
  const responseFrequencies = useMemo(() => {
    if (view !== 'response') return null;
    const lo = Math.min(design.sweep.start, design.sweep.stop);
    const hi = Math.max(design.sweep.start, design.sweep.stop);
    const points = Math.min(2001, Math.max(2, Math.round(design.sweep.points)));
    if (!(lo > 0) || !(hi > lo)) return null;
    return logX ? sweepPointsLog(lo, hi, points) : sweepPoints(lo, hi, points);
  }, [view, logX, design.sweep]);

  /** The response view sweeps Design.sweep's range whether or not the chart locus is enabled. */
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
      ),
    );
  }, [responseFrequencies, design.z0, design.frequency, design.load, elements]);
  /** The same response for the network as built with its packages. */
  const packagedResponse = useMemo(
    () =>
      responseFrequencies && packagedLadder
        ? sweepResponse(sweepFrequency(packagedLadder, responseFrequencies))
        : null,
    [responseFrequencies, packagedLadder],
  );

  const deviceCircles = useMemo(() => designCircles(design), [design]);

  // Autosave the design and apply the theme.
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(design));
    } catch {
      // Private mode or quota: the design still lives in memory.
    }
  }, [design]);
  useEffect(() => storeStripHeight(stripHeight), [stripHeight]);
  useEffect(() => {
    const root = document.documentElement;
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
  }, [theme]);

  /**
   * Open or close a tool. It shows in the right column (desktop), the side
   * column's tool segment (tablet) or the Tools segment of the phone's sheet;
   * a tool opened during a tour ends the tour with an Undo message.
   */
  const setTool = (next: Tool): void => {
    if (next !== null && touring) {
      const tour = useTourStore.getState().tour;
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
      // An open dialog, menu, popover or sheet keeps the keys to itself: undo, new and delete
      // do not act on the design behind it (Escape is the overlay stack's own).
      if (useHelp.getState().open || topLevel() === 'overlay') return;
      // Only text editing keeps the browser shortcuts; a focused checkbox, radio, slider or
      // select still gets the application's undo and redo.
      if (isTextEditing(e.target as HTMLElement | null)) return;
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
        setToolState(null);
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
  useEscapeLayer('mode', armed !== null || datapointInput, () => {
    setArmed(null);
    useDesignStore.getState().setDatapointInput(false);
  });
  useEscapeLayer('panel', tool !== null, () => {
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
  const onDragDatapoint = (index: number, gamma: Complex): void => {
    const target = gammaToZ(gamma, design.z0);
    const store = useDesignStore.getState();
    if (index === 0) {
      store.setLoad(target, true);
      return;
    }
    const el = design.elements[index - 1];
    const before = result.datapoints[index - 1];
    if (!el || !before) return;
    const tuned = tuneElement(el, before, target, design.frequency);
    if (tuned) store.updateElement(index - 1, tuned, true);
  };
  /** A marker press holds the sheet at peek; its release ends the hold. */
  const onDragStart = (): void => {
    if (phone) useShell.getState().hold('peek', undefined, 'marker');
  };
  const onDragEnd = (): void => {
    useDesignStore.getState().commit();
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

  /** The element an armed palette entry would add, tuned towards the pointer. */
  const armedElement = useMemo((): Element | null => {
    if (!armed) return null;
    const base = armed.make(design.z0, design.frequency);
    if (!hover) return base;
    const tuned = tuneElement(base, result.zin, gammaToZ(hover, design.z0), design.frequency);
    return tuned ?? base;
  }, [armed, hover, design.z0, design.frequency, result.zin]);

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

  /** Click on the chart with an armed element: add it tuned to that point. */
  const place = (gamma: Complex): void => {
    if (!armed) return;
    const base = armed.make(design.z0, design.frequency);
    const tuned = tuneElement(base, result.zin, gammaToZ(gamma, design.z0), design.frequency);
    useDesignStore.getState().addElement(tuned ?? base, addedLabel(tuned ?? base));
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
  const suggestAt = (gamma: Complex, clientX: number, clientY: number): void => {
    const target = gammaToZ(gamma, design.z0);
    const solutions = lSolutions(result.zin, target, design.z0, design.frequency);
    setArmed(null);
    setMenu(null);
    if (tool === 'match') setTool(null);
    setPreview(null);
    setSuggest({ target, x: clientX, y: clientY, solutions });
  };

  const applySuggestion = (sol: MatchSolution): void => {
    // The same message as Auto match's Add parts: it names the step for Undo and Redo.
    useDesignStore.getState().addElements(sol.elements, addedMessage(sol));
    closeSuggest();
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
    const el = m.point !== null && m.point > 0 ? design.elements[m.point - 1] : undefined;
    if (m.point !== null && el) {
      const point = m.point;
      entries.push({
        key: 'remove',
        label: `Remove ${datapointLabel(point)}: ${elementName(el)}`,
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

  /** The readout at a point: z, Z, Y and Gamma. */
  const readoutAt = (g: Complex): string => {
    const z = gammaToZ(g, design.z0);
    const y = zToY(z);
    return `z = ${fmtComplex({ re: z.re / design.z0, im: z.im / design.z0 }, 3)}   Z = ${fmtComplex(z, 1)} Ω   Y = ${fmtComplex({ re: y.re * 1e3, im: y.im * 1e3 }, 2)} mS   Γ = ${fmtNum(Math.hypot(g.re, g.im), 3)} ∠ ${fmtDeg((Math.atan2(g.im, g.re) * 180) / Math.PI)}`;
  };

  // While the pointer is over the chart the readout (z, Z, Y, Gamma) wins over the status message.
  const liveReadout = view === 'chart' && !armed && Boolean(hover);
  const hoverText =
    view === 'splot'
      ? 'S-Plot: hover the graphs for the cursor readout, click to set a marker and select a gain table row.'
      : view === 'response'
        ? 'Hover the plots for a readout at the cursor, click to set a marker. The left panel still tunes the network.'
        : armed
          ? `${armed.label} armed: the dashed line is where it can lead. Click on the chart to place it, click the palette again for the default value, Escape to cancel.`
          : hover
            ? readoutAt(hover)
            : 'Hover for a readout. Drag a point to tune its element, right-click to add or remove, double-click a target for match suggestions. Wheel zooms, drag pans.';

  const zinInfo = result.info[result.info.length - 1];
  const liveText = `Zin ${fmtComplex(result.zin, 1)} Ω   VSWR ${zinInfo ? fmtNum(zinInfo.vswr, 3) : '–'}`;

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

  const legend = (realization || packaged) && (
    <div className="chart-legend" role="note" aria-label="Locus legend">
      <span className="entry" title="The network with the values as typed">
        <span className="sw solid" />
        {design.losses.enabled ? 'Ideal values, with losses' : 'Ideal'}
      </span>
      {realization && (
        <span className="entry" title="The network with standard or stocked values">
          <span className="sw dashed" />
          Realized ({realization.sourceLabel})
        </span>
      )}
      {packaged && (
        <span
          className="entry"
          title="The network as built: the chosen packages add their parasitics"
        >
          <span className="sw dotted" />
          With packages
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
      ghost={ghost}
      onPlace={armed ? place : datapointInput ? placeDatapoint : null}
      userPoints={userPoints}
      onStartDatapoint={(i) => useDesignStore.getState().setStartDatapoint(i)}
      dpCount={userDatapoints(design).length}
      startSlot={startIndex(design)}
      anchor={sweepAnchor}
      onSuggest={suggestAt}
      fitKey={fitKey}
      onContextMenu={(gamma, clientX, clientY, point) => {
        setSuggest(null);
        setPreview(null);
        setMenu({ gamma, x: clientX, y: clientY, point });
      }}
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
          prefer={{ gap: 6 }}
          // With the chart pinned above, a previewed row drops the sheet low enough to show
          // the whole ghost, the tapped end point included.
          low={coarse && preview !== null}
        >
          <div className="dropdown-note">
            Networks from Zin to {fmtComplex(suggest.target, 1)} &#937;, lowest Q first.{' '}
            {coarse
              ? 'Tap to preview, tap again or press Add to add.'
              : 'Hover to preview, click to add.'}
          </div>
          <SolutionList
            solutions={suggest.solutions}
            empty="No one- or two-element network reaches this point from Zin. Try a point with a resistance above zero, or a line first."
            onPreview={setPreview}
            onApply={applySuggestion}
          />
        </Popover>
      )}
      {menu && (
        <Menu
          label="Chart menu"
          title={
            menu.point !== null
              ? `${datapointLabel(menu.point)}, ${fmtComplex(menu.point === 0 ? design.load : (result.datapoints[menu.point - 1] ?? result.zin), 1)} Ω`
              : `${fmtComplex(gammaToZ(menu.gamma, design.z0), 1)} Ω`
          }
          anchor={{ x: menu.x, y: menu.y }}
          className="context"
          prefer={{ gap: 2 }}
          entries={menuEntries(menu)}
          onClose={() => setMenu(null)}
        />
      )}
    </>
  );

  const schematicStrip = verticalSchematic ? (
    <div className="schematic-side">
      <Schematic result={result} svgRef={schematicRef} vertical />
    </div>
  ) : (
    <>
      <SchematicHandle height={stripHeight} onChange={setStripHeight} />
      <div className="schematic-strip">
        <Schematic result={result} height={stripHeight} svgRef={schematicRef} />
      </div>
    </>
  );

  /** The main area per view and layout. */
  let main: ReactNode;
  let mainClassName = '';
  let mainStyle: CSSProperties | undefined;
  if (view === 'splot') {
    main = <SPlotView />;
    mainClassName = 'splot-main';
  } else if (view === 'response') {
    main = (
      <ResponseView
        response={response}
        packaged={packagedResponse}
        designFrequency={design.frequency}
      />
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
        {bannerShown ? <div className="chart-mode-bar">{banner}</div> : null}
        {smithChart}
        {phone ? (
          <ChartChips
            readout={liveReadout && hover ? readoutAt(hover) : null}
            idle={liveText}
            legend={legend}
            onFit={() => setFitKey((k) => k + 1)}
          />
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
      {phone && view === 'chart' && (
        <div className="schematic-strip phone-strip">
          <Schematic result={result} height={PHONE_STRIP_H} svgRef={schematicRef} />
        </div>
      )}
      {!phone && <h2>Add element</h2>}
      <Palette
        armed={armed}
        onPick={pick}
        disclosure={phone}
        empty={design.elements.length === 0}
      />
      <h2>Network, load to source</h2>
      <RealizeControls />
      <StressControls />
      <Ladder result={result} realization={realization} guide={phone ? null : guide} />
    </>
  );

  const toolPanel =
    tool === 'match' ? (
      <AutoMatch zin={result.zin} elements={elements} onPreview={setPreview} onClose={closeTool} />
    ) : tool === 'optimize' ? (
      <BandOptimizer />
    ) : tool === 'montecarlo' ? (
      <MonteCarloPanel />
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
      tool={toolPanel}
      toolId={tool as ToolId | null}
      onOpenTool={(id) => openTool(id)}
      onCloseTool={closeTool}
      tour={<TourPanel />}
      banner={modeOn ? banner : null}
      tourHead={touring ? <TourPanel mode="head" /> : null}
      tourBody={touring ? <TourPanel mode="narration" /> : null}
      live={liveText}
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
        </footer>
      }
    >
      {report && (
        <ReportDialog
          result={result}
          realization={realization}
          packaged={packaged}
          svgRef={svgRef}
          schematicRef={schematicRef}
          chartShown={view === 'chart'}
          onClose={() => setReport(false)}
        />
      )}
      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}
      {helpOpen && <HelpDialog onClose={closeHelp} />}
      {(coarse || phone) && <Toast />}
    </Shell>
  );
}
