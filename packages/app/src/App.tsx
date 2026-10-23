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
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { SmithChart, type Ghost } from './chart/SmithChart';
import { nextColor } from './lib/colors';
import { elementSummary, type PaletteEntry } from './lib/elements';
import { AutoMatch } from './components/AutoMatch';
import { BandOptimizer } from './components/BandOptimizer';
import { Header, type Tool } from './components/Header';
import { Ladder } from './components/Ladder';
import { Palette } from './components/Palette';
import { MonteCarloPanel } from './components/MonteCarloPanel';
import { RealizeControls } from './components/RealizeControls';
import { StressControls } from './components/StressControls';
import { ReportDialog } from './components/ReportDialog';
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
import { designCircles } from './lib/circles';
import { targetOf } from './lib/design';
import { designSweep } from './lib/files';
import { designHasDatapointSweep, startIndex, userDatapoints } from './lib/datapoints';
import { elementName, PALETTE } from './lib/elements';
import { datapointLabel, fmtComplex, fmtDeg, fmtNum } from './lib/format';
import { lSolutions } from './lib/match';
import {
  derivedSweep,
  effectiveElements,
  packagedElements,
  realizeDesign,
  realizedSweep,
} from './lib/realize';
import { usePackages } from './store/usePackages';
import { useDesignStore, type GridDensity } from './store/useDesignStore';
import { useTourStore } from './store/useTourStore';

interface ChartMenu {
  readonly gamma: Complex;
  readonly x: number;
  readonly y: number;
  /** The datapoint that was right-clicked, if any. */
  readonly point: number | null;
}

interface Suggestions {
  readonly target: Complex;
  readonly x: number;
  readonly y: number;
  readonly solutions: readonly MatchSolution[];
}

const STORAGE_KEY = 'smithonline.design.v1';
const THEME_KEY = 'smithonline.theme';
type Theme = 'light' | 'dark' | 'auto';

export function App() {
  const design = useDesignStore((s) => s.design);
  const chart = useDesignStore((s) => s.chart);
  const selected = useDesignStore((s) => s.selected);
  const message = useDesignStore((s) => s.message);
  const view = useDesignStore((s) => s.view);
  const logX = useDesignStore((s) => s.response.logX);
  const touring = useTourStore((s) => s.tour !== null);
  const { select, setChart, undo, redo } = useDesignStore.getState();
  const svgRef = useRef<SVGSVGElement>(null);
  const schematicRef = useRef<SVGSVGElement>(null);
  const chartArea = useRef<HTMLElement>(null);
  /** Height of the schematic strip under the chart, remembered across sessions. */
  const [stripHeight, setStripHeight] = useState<number>(readStripHeight);
  const [hover, setHover] = useState<Complex | null>(null);
  const [menu, setMenu] = useState<ChartMenu | null>(null);
  const [armed, setArmed] = useState<PaletteEntry | null>(null);
  const [suggest, setSuggest] = useState<Suggestions | null>(null);
  /** The match solution under the pointer in any list, drawn as a ghost on the chart. */
  const [preview, setPreview] = useState<MatchSolution | null>(null);
  const [tool, setTool] = useState<Tool>(null);
  const [report, setReport] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
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
  const datapointInput = useDesignStore((s) => s.datapointInput);
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
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      // ignore
    }
  }, [theme]);

  // Keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (isHelpKey(e)) {
        e.preventDefault();
        useHelp.getState().toggleHelp();
        return;
      }
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
        setTool(null);
        setArmed(null);
      } else if (e.key === 'Delete' && selected !== null && selected > 0) {
        useDesignStore.getState().removeElement(selected - 1);
      } else if (e.key === 'Escape') {
        useDesignStore.getState().setDatapointInput(false);
        setArmed(null);
        setSuggest(null);
        setPreview(null);
        setTool(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected, undo, redo]);

  // Close the chart menu on any click elsewhere or Escape.
  useEffect(() => {
    if (!menu) return;
    const close = (): void => setMenu(null);
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [menu]);

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

  /** Right-click menu: add the chosen element and tune it towards the clicked point. */
  const addAt = (make: (z0: number, f: number) => import('@smithonline/core').Element): void => {
    if (!menu) return;
    const base = make(design.z0, design.frequency);
    const target = gammaToZ(menu.gamma, design.z0);
    const tuned = tuneElement(base, result.zin, target, design.frequency);
    useDesignStore.getState().addElement(tuned ?? base);
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

  /** Palette click: arm the entry; a second click adds it at its default value. */
  const closeSuggest = (): void => {
    setSuggest(null);
    setPreview(null);
  };

  const pick = (entry: PaletteEntry): void => {
    closeSuggest();
    useDesignStore.getState().setDatapointInput(false);
    if (armed?.id === entry.id) {
      useDesignStore.getState().addElement(entry.make(design.z0, design.frequency));
      setArmed(null);
    } else {
      setArmed(entry);
    }
  };

  /** Click on the chart with an armed element: add it tuned to that point. */
  const place = (gamma: Complex): void => {
    if (!armed) return;
    const base = armed.make(design.z0, design.frequency);
    const tuned = tuneElement(base, result.zin, gammaToZ(gamma, design.z0), design.frequency);
    useDesignStore.getState().addElement(tuned ?? base);
    setArmed(null);
  };

  /** Click on the chart in datapoint input mode: add a user datapoint at the design frequency. */
  const placeDatapoint = (gamma: Complex): void => {
    useDesignStore
      .getState()
      .addDatapoint({ frequency: design.frequency, z: gammaToZ(gamma, design.z0) });
  };

  /** Double click: every one- or two-element network from Zin to the clicked point. */
  const suggestAt = (gamma: Complex, clientX: number, clientY: number): void => {
    const target = gammaToZ(gamma, design.z0);
    const solutions = lSolutions(result.zin, target, design.z0, design.frequency);
    const box = chartArea.current?.getBoundingClientRect();
    setArmed(null);
    setMenu(null);
    setTool(null);
    setPreview(null);
    setSuggest({
      target,
      x: clientX - (box?.left ?? 0),
      y: clientY - (box?.top ?? 0),
      solutions,
    });
  };

  const applySuggestion = (sol: MatchSolution): void => {
    const store = useDesignStore.getState();
    store.addElements(sol.elements);
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
    setTool(tool === next ? null : next);
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
      useDesignStore.getState().setMessage('Nothing is selected to print; tick parts in Report');
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

  const hoverText =
    view === 'splot'
      ? 'S-Plot: hover the graphs for the cursor readout, click to set a marker and select a gain table row.'
      : view === 'response'
        ? 'Hover the plots for a readout at the cursor, click to set a marker. The left panel still tunes the network.'
        : armed
          ? `${armed.label} armed: the dashed line is where it can lead. Click on the chart to place it, click the palette again for the default value, Escape to cancel.`
          : hover
            ? (() => {
                const z = gammaToZ(hover, design.z0);
                const y = zToY(z);
                return `z = ${fmtComplex({ re: z.re / design.z0, im: z.im / design.z0 }, 3)}   Z = ${fmtComplex(z, 1)} Ω   Y = ${fmtComplex({ re: y.re * 1e3, im: y.im * 1e3 }, 2)} mS   Γ = ${fmtNum(Math.hypot(hover.re, hover.im), 3)} ∠ ${fmtDeg((Math.atan2(hover.im, hover.re) * 180) / Math.PI)}`;
              })()
            : 'Hover for a readout. Drag a point to tune its element, right-click to add or remove, double-click a target for match suggestions. Wheel zooms, drag pans.';

  return (
    <div className={view === 'splot' ? 'app splot-mode' : 'app'}>
      <Header
        result={result}
        sweep={sweep}
        svgRef={svgRef}
        theme={theme}
        onTheme={setTheme}
        tool={tool}
        onTool={toggleTool}
        realization={realization}
        onReport={() => setReport(true)}
        onPrint={printNow}
        onSettings={() => setSettingsOpen(true)}
      />
      <aside className="left">
        <TourPanel />
        <h2>Add element</h2>
        <Palette armed={armed} onPick={pick} />
        <h2>Network, load to source</h2>
        <RealizeControls />
        <StressControls />
        <Ladder result={result} realization={realization} />
      </aside>
      {view === 'splot' ? (
        <main className="chart-area splot-main">
          <SPlotView />
        </main>
      ) : view === 'response' ? (
        <main className="chart-area" ref={chartArea}>
          <ResponseView
            response={response}
            packaged={packagedResponse}
            designFrequency={design.frequency}
          />
          {tool === 'optimize' && <BandOptimizer onClose={() => setTool(null)} />}
          {tool === 'montecarlo' && <MonteCarloPanel onClose={() => setTool(null)} />}
        </main>
      ) : (
        <main
          className={`chart-area ${verticalSchematic ? 'v-schematic' : ''}`}
          ref={chartArea}
          style={{ '--strip-h': `${verticalSchematic ? 0 : stripHeight}px` } as CSSProperties}
        >
          {design.elements.length === 0 && !armed && !design.twoPort && !touring && (
            <div className="start-hint" role="note">
              <strong>Start a match</strong>
              <ol>
                <li>Set the load DP1 in the network panel, or Open a measured file.</li>
                <li>Set the target at the bottom of the network panel; Z0 is the default.</li>
                <li>Add parts from the palette, double-click the chart, or press Auto match.</li>
              </ol>
            </div>
          )}
          <div className="toolbar">
            <button
              className={`btn ${chart.zGrid ? 'on' : ''}`}
              title={TIPS.zGrid}
              onClick={() => setChart({ zGrid: !chart.zGrid })}
            >
              Z grid
            </button>
            <button
              className={`btn ${chart.yGrid ? 'on' : ''}`}
              title={TIPS.yGrid}
              onClick={() => setChart({ yGrid: !chart.yGrid })}
            >
              Y grid
            </button>
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
            <button
              className={`btn ${chart.labels ? 'on' : ''}`}
              title={TIPS.labels}
              onClick={() => setChart({ labels: !chart.labels })}
            >
              Labels
            </button>
            <button className="btn" onClick={() => setFitKey((k) => k + 1)} title={TIPS.fit}>
              Fit
            </button>
            {(realization || packaged) && (
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
            )}
          </div>
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
            onDragEnd={() => useDesignStore.getState().commit()}
            ghost={ghost}
            onPlace={armed ? place : datapointInput ? placeDatapoint : null}
            userPoints={userPoints}
            onStartDatapoint={(i) => useDesignStore.getState().setStartDatapoint(i)}
            dpCount={userDatapoints(design).length}
            startSlot={startIndex(design)}
            onSuggest={suggestAt}
            fitKey={fitKey}
            onContextMenu={(gamma, clientX, clientY, point) => {
              const box = chartArea.current?.getBoundingClientRect();
              setMenu({
                gamma,
                x: clientX - (box?.left ?? 0),
                y: clientY - (box?.top ?? 0),
                point,
              });
            }}
            svgRef={svgRef}
          />
          {suggest && (
            <div
              className="dropdown suggest"
              style={{ left: suggest.x, top: suggest.y }}
              onPointerDown={(e) => e.stopPropagation()}
            >
              <div className="dropdown-note">
                Networks from Zin to {fmtComplex(suggest.target, 1)} &#937;, lowest Q first. Hover
                to preview, click to add.
                <button
                  className="btn tiny"
                  style={{ float: 'right' }}
                  onClick={closeSuggest}
                  aria-label="Close suggestions"
                >
                  &#215;
                </button>
              </div>
              <SolutionList
                solutions={suggest.solutions}
                empty="No one- or two-element network reaches this point from Zin. Try a point with a resistance above zero, or a line first."
                onPreview={setPreview}
                onApply={applySuggestion}
              />
            </div>
          )}
          {tool === 'match' && (
            <AutoMatch
              zin={result.zin}
              elements={elements}
              onPreview={setPreview}
              onClose={() => {
                setPreview(null);
                setTool(null);
              }}
            />
          )}
          {tool === 'optimize' && <BandOptimizer onClose={() => setTool(null)} />}
          {tool === 'montecarlo' && <MonteCarloPanel onClose={() => setTool(null)} />}
          {menu && (
            <div
              className="dropdown context"
              style={{ left: menu.x, top: menu.y }}
              role="menu"
              onPointerDown={(e) => e.stopPropagation()}
            >
              {menu.point !== null && menu.point > 0 && design.elements[menu.point - 1] && (
                <button
                  className="remove"
                  role="menuitem"
                  onClick={() => {
                    useDesignStore.getState().removeElement(menu.point! - 1);
                    setMenu(null);
                  }}
                >
                  <span
                    className="idx"
                    style={{ background: design.elements[menu.point - 1]!.color }}
                  >
                    {menu.point}
                  </span>
                  Remove {datapointLabel(menu.point)}:{' '}
                  {elementName(design.elements[menu.point - 1]!)}
                </button>
              )}
              {menu.point === 0 && (
                <div className="dropdown-note">DP1 is the load; edit it in the network panel.</div>
              )}
              <div className="dropdown-note">
                Add next in chain, tuned to {fmtComplex(gammaToZ(menu.gamma, design.z0), 1)} &#937;
              </div>
              {PALETTE.map((p) => (
                <button key={p.id} role="menuitem" onClick={() => addAt(p.make)}>
                  <svg viewBox="0 0 30 20" aria-hidden="true">
                    <path d={p.icon} />
                  </svg>
                  {p.label}
                </button>
              ))}
            </div>
          )}
          {verticalSchematic ? (
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
          )}
        </main>
      )}
      <aside className="right">
        <RightPanel
          result={result}
          sweep={sweep}
          realized={realization ? { realization, sweep: realizedSweepPoints } : null}
        />
      </aside>
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
      <footer className="statusbar">
        <span className="mono">{hoverText}</span>
        <span className="spacer" />
        <span className="muted">
          {message ??
            'Smith Online, a clean-room rebuild inspired by Smith V4.1 by Fritz Dellsperger'}
        </span>
      </footer>
    </div>
  );
}
