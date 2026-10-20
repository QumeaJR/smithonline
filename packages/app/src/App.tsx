import {
  evaluateLadder,
  gammaToZ,
  sweepFrequency,
  sweepPoints,
  tuneElement,
  zToY,
  type Complex,
} from '@smithonline/core';
import { useEffect, useMemo, useRef, useState } from 'react';
import { SmithChart } from './chart/SmithChart';
import { Header } from './components/Header';
import { Ladder } from './components/Ladder';
import { Palette } from './components/Palette';
import { RightPanel } from './components/RightPanel';
import { PALETTE } from './lib/elements';
import { fmtComplex, fmtDeg, fmtNum } from './lib/format';
import { useDesignStore, type GridDensity } from './store/useDesignStore';

interface ChartMenu {
  readonly gamma: Complex;
  readonly x: number;
  readonly y: number;
}

const STORAGE_KEY = 'smithonline.design.v1';
const THEME_KEY = 'smithonline.theme';
type Theme = 'light' | 'dark' | 'auto';

export function App() {
  const design = useDesignStore((s) => s.design);
  const chart = useDesignStore((s) => s.chart);
  const selected = useDesignStore((s) => s.selected);
  const message = useDesignStore((s) => s.message);
  const { select, setChart, undo, redo } = useDesignStore.getState();
  const svgRef = useRef<SVGSVGElement>(null);
  const chartArea = useRef<HTMLElement>(null);
  const [hover, setHover] = useState<Complex | null>(null);
  const [menu, setMenu] = useState<ChartMenu | null>(null);
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      const t = localStorage.getItem(THEME_KEY);
      return t === 'light' || t === 'dark' ? t : 'auto';
    } catch {
      return 'auto';
    }
  });

  const result = useMemo(
    () =>
      evaluateLadder({
        z0: design.z0,
        frequency: design.frequency,
        load: design.load,
        elements: design.elements,
      }),
    [design.z0, design.frequency, design.load, design.elements],
  );

  const sweep = useMemo(() => {
    if (!design.sweep.enabled) return null;
    const { start, stop, points } = design.sweep;
    if (!(start > 0) || !(stop > 0) || points < 2) return null;
    return sweepFrequency(
      { z0: design.z0, frequency: design.frequency, load: design.load, elements: design.elements },
      sweepPoints(start, stop, points),
    );
  }, [design]);

  // Autosave the design and apply the theme.
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(design));
    } catch {
      // Private mode or quota: the design still lives in memory.
    }
  }, [design]);
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
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA')
      )
        return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
      } else if (e.key === 'Delete' && selected !== null && selected > 0) {
        useDesignStore.getState().removeElement(selected - 1);
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

  const hoverText = hover
    ? (() => {
        const z = gammaToZ(hover, design.z0);
        const y = zToY(z);
        return `z = ${fmtComplex({ re: z.re / design.z0, im: z.im / design.z0 }, 3)}   Z = ${fmtComplex(z, 1)} Ω   Y = ${fmtComplex({ re: y.re * 1e3, im: y.im * 1e3 }, 2)} mS   Γ = ${fmtNum(Math.hypot(hover.re, hover.im), 3)} ∠ ${fmtDeg((Math.atan2(hover.im, hover.re) * 180) / Math.PI)}`;
      })()
    : 'Hover for a readout. Drag a point to tune its element, right-click to add the next element. Wheel zooms, drag pans, double click resets.';

  return (
    <div className="app">
      <Header result={result} svgRef={svgRef} theme={theme} onTheme={setTheme} />
      <aside className="left">
        <h2>Add element</h2>
        <Palette />
        <h2>Network, load to source</h2>
        <Ladder result={result} />
      </aside>
      <main className="chart-area" ref={chartArea}>
        <div className="toolbar">
          <button
            className={`btn ${chart.zGrid ? 'on' : ''}`}
            onClick={() => setChart({ zGrid: !chart.zGrid })}
          >
            Z grid
          </button>
          <button
            className={`btn ${chart.yGrid ? 'on' : ''}`}
            onClick={() => setChart({ yGrid: !chart.yGrid })}
          >
            Y grid
          </button>
          <select
            className="btn"
            value={chart.density}
            onChange={(e) => setChart({ density: e.target.value as GridDensity })}
            aria-label="Grid density"
          >
            <option value="coarse">Coarse</option>
            <option value="normal">Normal</option>
            <option value="fine">Fine</option>
          </select>
          <button
            className={`btn ${chart.labels ? 'on' : ''}`}
            onClick={() => setChart({ labels: !chart.labels })}
          >
            Labels
          </button>
        </div>
        <SmithChart
          result={result}
          z0={design.z0}
          options={chart}
          selected={selected}
          sweep={sweep}
          vswrCircles={design.vswrCircles}
          qContours={design.qContours}
          arcColors={design.elements.map((e) => e.color)}
          onSelect={select}
          onHover={setHover}
          onDragDatapoint={onDragDatapoint}
          onDragEnd={() => useDesignStore.getState().commit()}
          onContextMenu={(gamma, clientX, clientY) => {
            const box = chartArea.current?.getBoundingClientRect();
            setMenu({ gamma, x: clientX - (box?.left ?? 0), y: clientY - (box?.top ?? 0) });
          }}
          svgRef={svgRef}
        />
        {menu && (
          <div
            className="dropdown context"
            style={{ left: menu.x, top: menu.y }}
            role="menu"
            onPointerDown={(e) => e.stopPropagation()}
          >
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
      </main>
      <aside className="right">
        <RightPanel result={result} sweep={sweep} />
      </aside>
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
