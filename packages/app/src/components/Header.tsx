import { formatEngineering, XmlscError, type AsciiDelimiter } from '@smithonline/core';
import { useEffect, useRef, useState, type RefObject } from 'react';
import type { LadderResult, Realization, SweepPoint } from '@smithonline/core';
import { designHasDatapointSweep } from '../lib/datapoints';
import { designFromXmlsc, nameFromFile, type Design } from '../lib/design';
import { elementName } from '../lib/elements';
import { EXAMPLES } from '../lib/examples';
import { exportBom, exportCsv, exportJson, exportSvg, exportText } from '../lib/export';
import { designToAscii, designToNetlist, designToXmlsc } from '../lib/files';
import { importKind, OPEN_ACCEPT, readImportFile, type ImportedFile } from '../lib/import';
import { decodeDesign, encodeDesign, shareUrl } from '../lib/share';
import { useDesignStore } from '../store/useDesignStore';
import { ImportDialog } from './ImportDialog';
import { ValueInput } from './ValueInput';

/** The design tool panels the header opens over the chart. */
export type Tool = 'match' | 'optimize' | null;

interface HeaderProps {
  readonly result: LadderResult;
  readonly sweep: readonly SweepPoint[] | null;
  readonly svgRef: RefObject<SVGSVGElement | null>;
  readonly theme: 'light' | 'dark' | 'auto';
  readonly onTheme: (theme: 'light' | 'dark' | 'auto') => void;
  readonly tool: Tool;
  readonly onTool: (tool: Tool) => void;
  /** The realized network when Realize mode is on; enables the BOM export. */
  readonly realization: Realization | null;
  /** Opens the report dialog: chart, schematic and tables as one SVG or a print page. */
  readonly onReport: () => void;
}

const DELIMITERS: readonly { readonly id: AsciiDelimiter; readonly label: string }[] = [
  { id: 'semicolon', label: 'semicolon' },
  { id: 'comma', label: 'comma' },
  { id: 'none', label: 'spaces' },
];

type Menu = 'file' | 'examples' | null;

export function Header({
  result,
  sweep,
  svgRef,
  theme,
  onTheme,
  tool,
  onTool,
  realization,
  onReport,
}: HeaderProps) {
  const design = useDesignStore((s) => s.design);
  const view = useDesignStore((s) => s.view);
  const setView = useDesignStore((s) => s.setView);
  const canUndo = useDesignStore((s) => s.past.length > 0);
  const canRedo = useDesignStore((s) => s.future.length > 0);
  const {
    undo,
    redo,
    setName,
    setFrequency,
    setZ0,
    loadDesign,
    newDesign,
    setMessage,
    importTwoPort,
  } = useDesignStore.getState();
  const fileInput = useRef<HTMLInputElement>(null);
  const [menu, setMenu] = useState<Menu>(null);
  const [imported, setImported] = useState<{
    file: ImportedFile;
    id: number;
    top: number;
  } | null>(null);
  const fileButton = useRef<HTMLButtonElement>(null);
  const openCount = useRef(0);
  /** Opening a menu closes the import dialog; the same menu button closes its menu. */
  const toggleMenu = (name: Exclude<Menu, null>): void => {
    setImported(null);
    setMenu(menu === name ? null : name);
  };

  const safeName = design.name.replace(/[^\w.-]+/g, '_') || 'design';

  // The import dialog and the menus close on Escape; the dialog also on any click outside it.
  useEffect(() => {
    if (!imported && !menu) return;
    const close = (): void => setImported(null);
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        close();
        setMenu(null);
      }
    };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [imported, menu]);

  const exported = (fileName: string): void => {
    setMessage(`Exported ${fileName}`);
    setMenu(null);
  };

  const openFile = async (file: File): Promise<void> => {
    try {
      const text = await file.text();
      const kind = importKind(file.name);
      if (kind === 'json') {
        const raw = JSON.parse(text) as { design?: string };
        const decoded = typeof raw.design === 'string' ? decodeDesign(raw.design) : null;
        if (!decoded) throw new Error('Not a Smith Online design file');
        setImported(null);
        loadDesign(decoded);
      } else if (kind === 'xmlsc') {
        const next: Design = designFromXmlsc(text, nameFromFile(file.name));
        setImported(null);
        loadDesign(next);
      } else {
        const parsed = readImportFile(file.name, text);
        let note = `${file.name}: ${parsed.rows.length} impedance rows`;
        if (parsed.kind === 'twoPort') {
          importTwoPort(parsed.data, parsed.fileName);
          const src = useDesignStore.getState().design.twoPort?.source;
          const hz = (f: number): string => formatEngineering(f, { unit: 'Hz', digits: 4 });
          note = src?.clamped
            ? `${file.name}: ${hz(design.frequency)} is outside the file (${hz(src.covers[0])} to ${hz(src.covers[1])}); the two-port panel holds the nearest end`
            : `${file.name}: device parameters at ${hz(design.frequency)} are in the two-port panel`;
        }
        openCount.current += 1;
        setImported({
          file: parsed,
          id: openCount.current,
          top: (fileButton.current?.getBoundingClientRect().bottom ?? 40) + 4,
        });
        setMenu(null);
        setMessage(note);
        return;
      }
      setMessage(`Opened ${file.name}`);
    } catch (err) {
      const reason = err instanceof XmlscError || err instanceof Error ? err.message : String(err);
      setMessage(`Could not open ${file.name}: ${reason}`);
    }
  };

  const share = async (): Promise<void> => {
    const url = shareUrl(design, `${location.origin}${location.pathname}`);
    history.replaceState(null, '', `#d=${encodeDesign(design)}`);
    try {
      await navigator.clipboard.writeText(url);
      setMessage(`Share link copied (${url.length} characters)`);
    } catch {
      setMessage('Share link is in the address bar');
    }
  };

  const saveJson = (): void => {
    exportJson({ app: 'Smith Online', version: 1, design: encodeDesign(design) }, safeName);
    setMessage(`Saved ${safeName}.json`);
    setMenu(null);
  };

  const saveXmlsc = (): void => {
    try {
      exportText(`${safeName}.xmlsc`, designToXmlsc(design), 'text/xml');
      setMessage(`Saved ${safeName}.xmlsc`);
    } catch (err) {
      setMessage(`Could not save as .xmlsc: ${err instanceof Error ? err.message : String(err)}`);
    }
    setMenu(null);
  };

  return (
    <header className="topbar" onMouseLeave={() => setMenu(null)}>
      <span className="brand">Smith Online</span>
      <span className="tabs" role="tablist" aria-label="View">
        <button
          className={`btn ${view === 'chart' ? 'on' : ''}`}
          role="tab"
          aria-selected={view === 'chart'}
          onClick={() => setView('chart')}
        >
          Smith chart
        </button>
        <button
          className={`btn ${view === 'response' ? 'on' : ''}`}
          role="tab"
          aria-selected={view === 'response'}
          onClick={() => setView('response')}
        >
          Response
        </button>
      </span>
      <input
        className="name-input"
        value={design.name}
        onChange={(e) => setName(e.target.value)}
        aria-label="Design name"
        spellCheck={false}
      />
      <label className="field">
        f
        <ValueInput
          value={design.frequency}
          unit="Hz"
          digits={6}
          min={1}
          onCommit={(f) => {
            const old = design.frequency;
            setFrequency(f);
            // Keep the sweep around the design frequency: scale its range with f.
            const { start, stop } = design.sweep;
            if (old > 0 && f !== old && !designHasDatapointSweep(design) && design.sweep.enabled) {
              const ratio = f / old;
              const text = `Scale the sweep range (${formatEngineering(start, { unit: 'Hz', digits: 4 })} to ${formatEngineering(stop, { unit: 'Hz', digits: 4 })}) with the new frequency?`;
              if (window.confirm(text)) {
                useDesignStore.getState().setSweep({ start: start * ratio, stop: stop * ratio });
              }
            }
          }}
          width="7.5em"
          ariaLabel="Design frequency"
        />
      </label>
      <label className="field">
        Z0
        <ValueInput
          value={design.z0}
          unit={'Ω'}
          min={1e-3}
          onCommit={setZ0}
          width="5em"
          ariaLabel="Reference impedance"
        />
      </label>
      <span className="spacer" />
      <span className="menu">
        <button
          ref={fileButton}
          className={`btn ${menu === 'file' ? 'on' : ''}`}
          onClick={() => toggleMenu('file')}
          aria-haspopup="menu"
          aria-expanded={menu === 'file'}
          title="New, open, save and export"
        >
          File &#9662;
        </button>
        {menu === 'file' && (
          <div className="dropdown file" role="menu" aria-label="File">
            <button
              role="menuitem"
              onClick={() => {
                setImported(null);
                newDesign();
                onTool(null);
                setMenu(null);
              }}
            >
              <span className="item">
                New <kbd>Ctrl+N</kbd>
              </span>
              <span>Empty network, 50 ohm load, target Z0. Undo brings the old one back.</span>
            </button>
            <button
              role="menuitem"
              onClick={() => {
                setMenu(null);
                fileInput.current?.click();
              }}
            >
              <span className="item">Open&#8230;</span>
              <span>
                Smith V4.1 .xmlsc project, Smith Online .json, Touchstone (.s1p to .s4p), CITI or
                EZNEC Lastz.txt
              </span>
            </button>
            <button role="menuitem" onClick={saveJson}>
              <span className="item">Save as Smith Online (.json)</span>
              <span>Everything in the design, including R, RLC and transformer elements</span>
            </button>
            <button role="menuitem" onClick={saveXmlsc}>
              <span className="item">Save as Smith V4.1 project (.xmlsc)</span>
              <span>Opens in the original; L, C, lines and stubs only</span>
            </button>
            <div className="dropdown-note section">Export</div>
            <button
              role="menuitem"
              disabled={view !== 'chart'}
              title={view !== 'chart' ? 'Switch to the Smith chart to export it' : undefined}
              onClick={() => {
                if (svgRef.current) exportSvg(svgRef.current, safeName);
                exported(`${safeName}.svg`);
              }}
            >
              <span className="item">Chart as SVG</span>
            </button>
            <button
              role="menuitem"
              onClick={() => {
                setMenu(null);
                onReport();
              }}
            >
              <span className="item">Report&#8230;</span>
              <span>Chart, schematic, datapoints and circles as one SVG or a print page</span>
            </button>
            <button
              role="menuitem"
              onClick={() => {
                exportCsv(result, safeName);
                exported(`${safeName}.csv`);
              }}
            >
              <span className="item">Datapoints as CSV</span>
            </button>
            <button
              role="menuitem"
              onClick={() => {
                exportText(`${safeName}.ckt`, designToNetlist(design, safeName));
                exported(`${safeName}.ckt`);
              }}
            >
              <span className="item">Netlist (.ckt)</span>
              <span>Touchstone CKT format, load side at node 1</span>
            </button>
            <div className="dropdown-row" role="group" aria-label="Datapoints and circles (ASCII)">
              <span className="item">Datapoints and circles (ASCII)</span>
              <span className="choices">
                {DELIMITERS.map((d) => (
                  <button
                    key={d.id}
                    role="menuitem"
                    className="btn tiny"
                    title={`Delimiter: ${d.label}`}
                    onClick={() => {
                      exportText(`${safeName}.txt`, designToAscii(design, result, sweep, d.id));
                      exported(`${safeName}.txt (${d.label})`);
                    }}
                  >
                    {d.label}
                  </button>
                ))}
              </span>
            </div>
            {realization && (
              <button
                role="menuitem"
                onClick={() => {
                  exportBom(realization, safeName, elementName);
                  exported(`${safeName}-bom.csv`);
                }}
                title="Ideal and realized value, series and deviation per part"
              >
                <span className="item">Bill of materials (CSV)</span>
              </button>
            )}
          </div>
        )}
        {imported && (
          <ImportDialog
            key={imported.id}
            file={imported.file}
            top={imported.top}
            onClose={() => setImported(null)}
          />
        )}
      </span>
      <input
        ref={fileInput}
        type="file"
        accept={`${OPEN_ACCEPT},application/json,text/xml,text/plain`}
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void openFile(file);
          e.target.value = '';
        }}
      />
      <button className="btn" onClick={undo} disabled={!canUndo} title="Undo (Ctrl+Z)">
        &#8630;
      </button>
      <button className="btn" onClick={redo} disabled={!canRedo} title="Redo (Ctrl+Y)">
        &#8631;
      </button>
      <button
        className={`btn ${tool === 'match' ? 'on' : ''}`}
        onClick={() => onTool('match')}
        title="Reach the target: add L, Pi or T parts ranked by Q, or tune the parts already in the network"
      >
        Auto match
      </button>
      <button
        className={`btn ${tool === 'optimize' ? 'on' : ''}`}
        onClick={() => onTool('optimize')}
        title="Improve the element values for the lowest worst-case VSWR over the sweep range"
      >
        Optimize band
      </button>
      <span className="menu">
        <button
          className={`btn ${menu === 'examples' ? 'on' : ''}`}
          onClick={() => toggleMenu('examples')}
          aria-haspopup="menu"
          aria-expanded={menu === 'examples'}
        >
          Examples &#9662;
        </button>
        {menu === 'examples' && (
          <div className="dropdown wide" role="menu">
            <div className="dropdown-note">
              The example projects of Smith V4.1 by Fritz Dellsperger, loaded from the original
              .xmlsc files.
            </div>
            {EXAMPLES.map((ex) => (
              <button
                key={ex.file}
                role="menuitem"
                onClick={() => {
                  try {
                    setImported(null);
                    loadDesign(designFromXmlsc(ex.xml, ex.title));
                    setMessage(`Loaded ${ex.file}`);
                  } catch (err) {
                    setMessage(
                      `Could not load ${ex.file}: ${err instanceof Error ? err.message : String(err)}`,
                    );
                  }
                  setMenu(null);
                }}
              >
                <strong>{ex.title}</strong>
                <span>{ex.description}</span>
              </button>
            ))}
          </div>
        )}
      </span>
      <button className="btn primary" onClick={() => void share()}>
        Share link
      </button>
      <button
        className="btn icon"
        title={`Theme: ${theme}`}
        onClick={() => onTheme(theme === 'auto' ? 'dark' : theme === 'dark' ? 'light' : 'auto')}
        aria-label="Toggle theme"
      >
        {theme === 'dark' ? '☾' : theme === 'light' ? '☀' : '◑'}
      </button>
    </header>
  );
}
