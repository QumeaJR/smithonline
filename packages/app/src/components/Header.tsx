import { XmlscError } from '@smithonline/core';
import { useRef, useState, type RefObject } from 'react';
import type { LadderResult } from '@smithonline/core';
import { designFromXmlsc, nameFromFile, type Design } from '../lib/design';
import { EXAMPLES } from '../lib/examples';
import { exportCsv, exportJson, exportSvg } from '../lib/export';
import { decodeDesign, encodeDesign, shareUrl } from '../lib/share';
import { useDesignStore } from '../store/useDesignStore';
import { ValueInput } from './ValueInput';

interface HeaderProps {
  readonly result: LadderResult;
  readonly svgRef: RefObject<SVGSVGElement | null>;
  readonly theme: 'light' | 'dark' | 'auto';
  readonly onTheme: (theme: 'light' | 'dark' | 'auto') => void;
}

export function Header({ result, svgRef, theme, onTheme }: HeaderProps) {
  const design = useDesignStore((s) => s.design);
  const canUndo = useDesignStore((s) => s.past.length > 0);
  const canRedo = useDesignStore((s) => s.future.length > 0);
  const { undo, redo, setName, setFrequency, setZ0, loadDesign, setMessage } =
    useDesignStore.getState();
  const fileInput = useRef<HTMLInputElement>(null);
  const [menu, setMenu] = useState<'examples' | 'export' | null>(null);

  const safeName = design.name.replace(/[^\w.-]+/g, '_') || 'design';

  const openFile = async (file: File): Promise<void> => {
    try {
      const text = await file.text();
      let next: Design;
      if (/\.json$/i.test(file.name)) {
        const raw = JSON.parse(text) as { design?: string };
        const decoded = typeof raw.design === 'string' ? decodeDesign(raw.design) : null;
        if (!decoded) throw new Error('Not a Smith Online design file');
        next = decoded;
      } else {
        next = designFromXmlsc(text, nameFromFile(file.name));
      }
      loadDesign(next);
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

  return (
    <header className="topbar" onMouseLeave={() => setMenu(null)}>
      <span className="brand">Smith Online</span>
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
          onCommit={setFrequency}
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
      <button
        className="btn"
        onClick={() => fileInput.current?.click()}
        title="Open a Smith V4.1 .xmlsc project or a Smith Online .json file"
      >
        Open
      </button>
      <input
        ref={fileInput}
        type="file"
        accept=".xmlsc,.json,application/json,text/xml"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void openFile(file);
          e.target.value = '';
        }}
      />
      <button
        className="btn"
        onClick={() =>
          exportJson({ app: 'Smith Online', version: 1, design: encodeDesign(design) }, safeName)
        }
        title="Save the design as a Smith Online .json file"
      >
        Save
      </button>
      <span className="menu">
        <button className="btn" onClick={() => setMenu(menu === 'export' ? null : 'export')}>
          Export &#9662;
        </button>
        {menu === 'export' && (
          <div className="dropdown" role="menu">
            <button
              role="menuitem"
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
