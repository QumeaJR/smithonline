import { formatEngineering, XmlscError, type AsciiDelimiter } from '@smithonline/core';
import { useRef, useState, type RefObject } from 'react';
import type { LadderResult, SweepPoint } from '@smithonline/core';
import { designFromXmlsc, nameFromFile, type Design } from '../lib/design';
import { EXAMPLES } from '../lib/examples';
import { exportCsv, exportJson, exportSvg, exportText } from '../lib/export';
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
}

const DELIMITERS: readonly { readonly id: AsciiDelimiter; readonly label: string }[] = [
  { id: 'semicolon', label: 'semicolon' },
  { id: 'comma', label: 'comma' },
  { id: 'none', label: 'spaces' },
];

export function Header({ result, sweep, svgRef, theme, onTheme, tool, onTool }: HeaderProps) {
  const design = useDesignStore((s) => s.design);
  const view = useDesignStore((s) => s.view);
  const setView = useDesignStore((s) => s.setView);
  const canUndo = useDesignStore((s) => s.past.length > 0);
  const canRedo = useDesignStore((s) => s.future.length > 0);
  const { undo, redo, setName, setFrequency, setZ0, loadDesign, setMessage, importTwoPort } =
    useDesignStore.getState();
  const fileInput = useRef<HTMLInputElement>(null);
  const [menu, setMenu] = useState<'examples' | 'save' | 'export' | null>(null);
  const [imported, setImported] = useState<ImportedFile | null>(null);

  const safeName = design.name.replace(/[^\w.-]+/g, '_') || 'design';

  const openFile = async (file: File): Promise<void> => {
    try {
      const text = await file.text();
      const kind = importKind(file.name);
      if (kind === 'json') {
        const raw = JSON.parse(text) as { design?: string };
        const decoded = typeof raw.design === 'string' ? decodeDesign(raw.design) : null;
        if (!decoded) throw new Error('Not a Smith Online design file');
        loadDesign(decoded);
      } else if (kind === 'xmlsc') {
        const next: Design = designFromXmlsc(text, nameFromFile(file.name));
        loadDesign(next);
      } else {
        const parsed = readImportFile(file.name, text);
        if (parsed.kind === 'twoPort') importTwoPort(parsed.data, parsed.fileName);
        setImported(parsed);
        setMenu(null);
        setMessage(
          parsed.kind === 'twoPort'
            ? `${file.name}: device parameters at ${formatEngineering(design.frequency, { unit: 'Hz', digits: 4 })} are in the two-port panel`
            : `${file.name}: ${parsed.rows.length} impedance rows`,
        );
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

  const saveXmlsc = (): void => {
    try {
      exportText(`${safeName}.xmlsc`, designToXmlsc(design), 'text/xml');
      setMessage(`Saved ${safeName}.xmlsc`);
    } catch (err) {
      setMessage(`Could not save as .xmlsc: ${err instanceof Error ? err.message : String(err)}`);
    }
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
            if (
              old > 0 &&
              f !== old &&
              !design.sweep.loads &&
              (design.sweep.enabled || start !== stop)
            ) {
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
      <button className="btn" onClick={undo} disabled={!canUndo} title="Undo (Ctrl+Z)">
        &#8630;
      </button>
      <button className="btn" onClick={redo} disabled={!canRedo} title="Redo (Ctrl+Y)">
        &#8631;
      </button>
      <button
        className={`btn ${tool === 'match' ? 'on' : ''}`}
        onClick={() => onTool('match')}
        title="L, Pi or T networks from Zin to a target, ranked by Q"
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
        <button className="btn" onClick={() => setMenu(menu === 'examples' ? null : 'examples')}>
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
      <span className="menu">
        <button
          className="btn"
          onClick={() => fileInput.current?.click()}
          title="Open a Smith V4.1 .xmlsc project, a Smith Online .json file, or a Touchstone (.s1p to .s4p), CITI (.citi, .cti) or EZNEC Lastz.txt file"
        >
          Open
        </button>
        {imported && <ImportDialog file={imported} onClose={() => setImported(null)} />}
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
      <span className="menu">
        <button className="btn" onClick={() => setMenu(menu === 'save' ? null : 'save')}>
          Save &#9662;
        </button>
        {menu === 'save' && (
          <div className="dropdown" role="menu">
            <button
              role="menuitem"
              onClick={() => {
                exportJson(
                  { app: 'Smith Online', version: 1, design: encodeDesign(design) },
                  safeName,
                );
                setMenu(null);
              }}
            >
              Smith Online (.json)
              <span>Everything in the design, including R, RLC and transformer elements</span>
            </button>
            <button
              role="menuitem"
              onClick={() => {
                saveXmlsc();
                setMenu(null);
              }}
            >
              Smith V4.1 project (.xmlsc)
              <span>Opens in the original; L, C, lines and stubs only</span>
            </button>
          </div>
        )}
      </span>
      <span className="menu">
        <button className="btn" onClick={() => setMenu(menu === 'export' ? null : 'export')}>
          Export &#9662;
        </button>
        {menu === 'export' && (
          <div className="dropdown" role="menu">
            <button
              role="menuitem"
              disabled={view !== 'chart'}
              title={view !== 'chart' ? 'Switch to the Smith chart to export it' : undefined}
              onClick={() => {
                if (svgRef.current) exportSvg(svgRef.current, safeName);
                setMenu(null);
              }}
            >
              Chart as SVG
            </button>
            <button
              role="menuitem"
              onClick={() => {
                exportCsv(result, safeName);
                setMenu(null);
              }}
            >
              Datapoints as CSV
            </button>
            <button
              role="menuitem"
              onClick={() => {
                exportText(`${safeName}.ckt`, designToNetlist(design, safeName));
                setMenu(null);
              }}
            >
              Netlist (.ckt)
              <span>Touchstone CKT format, load side at node 1</span>
            </button>
            <div className="dropdown-note">Datapoints and circles (ASCII), delimiter:</div>
            {DELIMITERS.map((d) => (
              <button
                key={d.id}
                role="menuitem"
                onClick={() => {
                  exportText(`${safeName}.txt`, designToAscii(design, result, sweep, d.id));
                  setMenu(null);
                }}
              >
                {d.label}
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
