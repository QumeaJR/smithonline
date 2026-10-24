import { formatEngineering, XmlscError, type AsciiDelimiter } from '@smithonline/core';
import { useRef, useState, type RefObject } from 'react';
import type { LadderResult, Realization, SweepPoint } from '@smithonline/core';
import { activeLimits, designStress, stressSettings } from '../lib/stress';
import { copyChartImage, copyFailure, copyText } from '../lib/clipboard';
import { designHasDatapointSweep, startIndex, userDatapoints } from '../lib/datapoints';
import { designFromXmlsc, nameFromFile, type Design } from '../lib/design';
import { elementName } from '../lib/elements';
import { EXAMPLES } from '../lib/examples';
import { exportBom, exportCsv, exportJson, exportPng, exportSvg, exportText } from '../lib/export';
import { designToAscii, designToNetlist, designToXmlsc } from '../lib/files';
import { designToLtspice, designToS2p, designToSpice } from '../lib/simexport';
import {
  importKind,
  OPEN_ACCEPT,
  readImportFile,
  SPlotOnlyError,
  type ImportedFile,
} from '../lib/import';
import { datapointTable, tableText } from '../lib/report';
import { loadSPlotText } from '../lib/splotActions';
import { addNetworkToSPlot } from '../lib/splotNetwork';
import { decodeDesign, encodeDesign, shareUrl } from '../lib/share';
import { TIPS } from '../lib/tips';
import { useDesignStore } from '../store/useDesignStore';
import { useHelp } from '../store/useHelp';
import { PowerInput } from './PowerInput';
import { ImportDialog } from './ImportDialog';
import { Button, IconButton } from './ui/Button';
import { Field } from './ui/Field';
import {
  IconChevronDown,
  IconHelp,
  IconMoon,
  IconRedo,
  IconSettings,
  IconSun,
  IconThemeAuto,
  IconUndo,
} from './ui/icons';
import { Menu, type MenuEntry } from './ui/Menu';
import { Segmented } from './ui/Segmented';
import { TOURS } from '../lib/tours';
import { useTourStore } from '../store/useTourStore';
import { usePackages } from '../store/usePackages';

/** The design tool panels the header opens over the chart. */
export type Tool = 'match' | 'optimize' | 'montecarlo' | null;

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
  /** Prints the selection last made in the report dialog, without opening it. */
  readonly onPrint?: () => void;
  /** Opens the settings dialog. */
  readonly onSettings?: () => void;
}

const DELIMITERS: readonly { readonly id: AsciiDelimiter; readonly label: string }[] = [
  { id: 'semicolon', label: 'semicolon' },
  { id: 'comma', label: 'comma' },
  { id: 'none', label: 'spaces' },
];

type OpenMenu = 'file' | 'examples' | null;

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
  onPrint,
  onSettings,
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
  const [menu, setMenu] = useState<OpenMenu>(null);
  const [imported, setImported] = useState<{ file: ImportedFile; id: number } | null>(null);
  const fileButton = useRef<HTMLButtonElement>(null);
  const examplesButton = useRef<HTMLButtonElement>(null);
  const openCount = useRef(0);
  /** The same menu button closes its menu; the menus and the import dialog close each other. */
  const toggleMenu = (name: Exclude<OpenMenu, null>): void => {
    setImported(null);
    setMenu(menu === name ? null : name);
  };

  const safeName = design.name.replace(/[^\w.-]+/g, '_') || 'design';

  const exported = (fileName: string): void => {
    setMessage(`Exported ${fileName}`);
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
      } else if (view === 'splot') {
        // The S-Plot view keeps its own file list; the design stays as it is.
        setMessage(loadSPlotText(file.name, text));
        return;
      } else {
        let parsed: ImportedFile;
        try {
          parsed = readImportFile(file.name, text);
        } catch (err) {
          if (!(err instanceof SPlotOnlyError)) throw err;
          // No S11, so nothing for the chart: the file goes to the S-Plot list only.
          loadSPlotText(file.name, text);
          setImported(null);
          const why = err.message.charAt(0).toLowerCase() + err.message.slice(1);
          setMessage(`${file.name}: added to the S-Plot list; ${why}`);
          return;
        }
        let inSPlot = false;
        if (parsed.sPlot) {
          try {
            loadSPlotText(file.name, text);
            inSPlot = true;
          } catch {
            // the chart import above accepted the file; the S-Plot list simply stays as it was
          }
        }
        let note = `${file.name}: ${parsed.rows.length} impedance rows${inSPlot ? '; also in the S-Plot list' : ''}`;
        if (parsed.kind === 'twoPort') {
          importTwoPort(parsed.data, parsed.fileName);
          const src = useDesignStore.getState().design.twoPort?.source;
          const hz = (f: number): string => formatEngineering(f, { unit: 'Hz', digits: 4 });
          note = src?.clamped
            ? `${file.name}: ${hz(design.frequency)} is outside the file (${hz(src.covers[0])} to ${hz(src.covers[1])}); the two-port panel holds the nearest end`
            : `${file.name}: device parameters at ${hz(design.frequency)} are in the two-port panel`;
        }
        openCount.current += 1;
        setImported({ file: parsed, id: openCount.current });
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

  const copyChart = async (): Promise<void> => {
    if (!svgRef.current) return;
    try {
      await copyChartImage(svgRef.current);
      setMessage('Chart copied to the clipboard as a PNG image');
    } catch (err) {
      setMessage(`Could not copy the chart: ${copyFailure(err)}`);
    }
  };

  const copyDatapoints = async (): Promise<void> => {
    const table = datapointTable(result, 'Datapoints', {
      count: userDatapoints(design).length,
      slot: startIndex(design),
    });
    try {
      await copyText(tableText(table));
      setMessage(`Copied ${table.rows.length} datapoints as tab separated text`);
    } catch (err) {
      setMessage(`Could not copy the datapoints: ${copyFailure(err)}`);
    }
  };

  const saveJson = (): void => {
    exportJson({ app: 'Smith Online', version: 1, design: encodeDesign(design) }, safeName);
    setMessage(`Saved ${safeName}.json`);
  };

  /** Write a simulator file; a network the format cannot hold is reported in the status line. */
  const exportSim = (fileName: string, make: () => string, type: string): void => {
    try {
      exportText(fileName, make(), type);
      exported(fileName);
    } catch (err) {
      setMessage(
        `Could not export ${fileName}: ${err instanceof Error ? err.message : String(err)}`,
      );
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

  const chartOnly = view !== 'chart';
  const fileEntries: MenuEntry[] = [
    {
      label: 'New',
      hint: 'Ctrl+N',
      description: 'Empty network, 50 ohm load, target Z0. Undo brings the old one back.',
      onSelect: () => {
        setImported(null);
        newDesign();
        onTool(null);
      },
    },
    {
      label: 'Open\u2026',
      description:
        'Smith V4.1 .xmlsc project, Smith Online .json, Touchstone (.s1p to .s4p), CITI, EZNEC Lastz.txt or VNA CSV (.csv, .txt)',
      onSelect: () => fileInput.current?.click(),
    },
    {
      label: 'Save as Smith Online (.json)',
      description: 'Everything in the design, including R, RLC and transformer elements',
      onSelect: saveJson,
    },
    {
      label: 'Save as Smith V4.1 project (.xmlsc)',
      description: 'Opens in the original; L, C, lines and stubs only',
      onSelect: saveXmlsc,
    },
    { kind: 'section', label: 'Export' },
    {
      label: 'Chart as SVG',
      disabled: chartOnly,
      ...(chartOnly ? { title: 'Switch to the Smith chart to export it' } : {}),
      onSelect: () => {
        if (svgRef.current) exportSvg(svgRef.current, safeName);
        exported(`${safeName}.svg`);
      },
    },
    {
      label: 'Chart as PNG',
      description: '2x resolution, 1600 pixels square, light theme on white',
      disabled: chartOnly,
      ...(chartOnly ? { title: 'Switch to the Smith chart to export it' } : {}),
      onSelect: () => {
        if (!svgRef.current) return;
        exportPng(svgRef.current, safeName).then(
          () => exported(`${safeName}.png`),
          (err: unknown) =>
            setMessage(
              `Could not export the PNG: ${err instanceof Error ? err.message : String(err)}`,
            ),
        );
      },
    },
    {
      label: 'Report\u2026',
      description: 'Chart, schematic, datapoints and circles as one SVG or a print page',
      onSelect: onReport,
    },
    ...(onPrint
      ? [
          {
            label: 'Print',
            description: 'The selection last made in Report, straight to the print dialog',
            onSelect: onPrint,
          },
        ]
      : []),
    {
      label: 'Copy chart as image',
      description: 'PNG on the clipboard, light theme',
      disabled: chartOnly,
      ...(chartOnly ? { title: 'Switch to the Smith chart to copy it' } : {}),
      onSelect: () => void copyChart(),
    },
    {
      label: 'Copy datapoints as text',
      description: 'Tab separated, pastes into a spreadsheet',
      onSelect: () => void copyDatapoints(),
    },
    {
      label: 'Datapoints as CSV',
      onSelect: () => {
        exportCsv(result, safeName, {
          count: userDatapoints(design).length,
          slot: startIndex(design),
        });
        exported(`${safeName}.csv`);
      },
    },
    {
      label: 'Netlist (.ckt)',
      description: 'Touchstone CKT format, load side at node 1',
      onSelect: () => {
        exportText(`${safeName}.ckt`, designToNetlist(design, safeName));
        exported(`${safeName}.ckt`);
      },
    },
    {
      label: 'SPICE netlist (.cir)',
      description: 'Realized values, loss resistors, source and load; ngspice, LTspice, Qucs-S',
      onSelect: () =>
        exportSim(`${safeName}.cir`, () => designToSpice(design, realization), 'text/plain'),
    },
    {
      label: 'LTspice schematic (.asc)',
      description: 'R, L and C only; lines and stubs go to the netlist',
      onSelect: () =>
        exportSim(`${safeName}.asc`, () => designToLtspice(design, realization), 'text/plain'),
    },
    {
      label: 'Touchstone S-parameters (.s2p)',
      description:
        'The network as built, without its load: over the sweep when a frequency sweep is on, else 0.5 f to 2 f',
      onSelect: () =>
        exportSim(
          `${safeName}.s2p`,
          () => designToS2p(design, realization, usePackages.getState().table),
          'text/plain',
        ),
    },
    {
      label: 'Add network to S-Plot',
      description: 'The network as built, live in the S-Plot view',
      title:
        "Plot the network's S-parameters in the S-Plot view; the entry follows the design until you freeze it",
      onSelect: () => setMessage(addNetworkToSPlot()),
    },
    {
      kind: 'choices',
      label: 'Datapoints and circles (ASCII)',
      description: 'Choose the delimiter',
      choices: DELIMITERS.map((d) => ({
        label: d.label,
        title: `Delimiter: ${d.label}`,
        onSelect: () => {
          exportText(`${safeName}.txt`, designToAscii(design, result, sweep, d.id));
          exported(`${safeName}.txt (${d.label})`);
        },
      })),
    },
    ...(realization
      ? [
          {
            label: 'Bill of materials (CSV)',
            title: 'Ideal and realized value, series and deviation per part',
            onSelect: () => {
              exportBom(
                realization,
                safeName,
                elementName,
                designStress(design, design.elements, realization),
                activeLimits(stressSettings(design)),
              );
              exported(`${safeName}-bom.csv`);
            },
          },
        ]
      : []),
  ];

  const exampleEntries: MenuEntry[] = [
    { kind: 'section', label: 'Guided tours' },
    ...TOURS.map((t): MenuEntry => ({
      key: `tour-${t.id}`,
      label: t.title,
      description: t.blurb,
      onSelect: () => useTourStore.getState().start(t.id),
    })),
    { kind: 'section', label: 'Smith V4.1 examples' },
    {
      kind: 'note',
      content:
        'The example projects of Smith V4.1 by Fritz Dellsperger, loaded from the original .xmlsc files.',
    },
    ...EXAMPLES.map((ex): MenuEntry => ({
      key: ex.file,
      label: ex.title,
      description: ex.description,
      onSelect: () => {
        try {
          setImported(null);
          loadDesign(designFromXmlsc(ex.xml, ex.title));
          setMessage(`Loaded ${ex.file}`, { undo: true });
        } catch (err) {
          setMessage(
            `Could not load ${ex.file}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      },
    })),
  ];

  /** f changed with a frequency sweep on: offer to scale the sweep range with it. */
  const commitFrequency = (f: number): void => {
    const old = design.frequency;
    setFrequency(f);
    const { start, stop } = design.sweep;
    if (!(old > 0) || f === old || designHasDatapointSweep(design) || !design.sweep.enabled) return;
    if (useDesignStore.getState().design.frequency !== f) return;
    const ratio = f / old;
    const hz = (v: number): string => formatEngineering(v, { unit: 'Hz', digits: 4 });
    const store = useDesignStore.getState();
    const prior = store.message;
    const offer = `f is now ${hz(f)}; the sweep still runs ${hz(start)} to ${hz(stop)}. Scale sweep makes it ${hz(start * ratio)} to ${hz(stop * ratio)}.`;
    store.setMessage(prior ? `${prior}. ${offer}` : offer, {
      action: {
        label: 'Scale sweep',
        run: () => {
          // The label is the message and names the step for Undo and Redo.
          useDesignStore
            .getState()
            .setSweep(
              { start: start * ratio, stop: stop * ratio },
              `Scaled the sweep to ${hz(start * ratio)} to ${hz(stop * ratio)}`,
            );
        },
      },
    });
  };

  return (
    <header className="topbar">
      <span className="brand">Smith Online</span>
      <Segmented
        className="view-tabs"
        ariaLabel="View"
        value={view}
        onChange={setView}
        options={[
          { value: 'chart', label: 'Smith chart', title: TIPS.tabChart },
          { value: 'response', label: 'Response', title: TIPS.tabResponse },
          { value: 'splot', label: 'S-Plot', title: TIPS.tabSplot },
        ]}
      />
      <input
        className="name-input"
        value={design.name}
        onChange={(e) => setName(e.target.value)}
        aria-label="Design name"
        spellCheck={false}
      />
      <Field
        className="field"
        label="f"
        value={design.frequency}
        unit="Hz"
        digits={6}
        min={1}
        onCommit={commitFrequency}
        ariaLabel="Design frequency"
      />
      <PowerInput />
      <Field
        className="field"
        label="Z0"
        value={design.z0}
        unit={'Ω'}
        min={1e-3}
        onCommit={setZ0}
        ariaLabel="Reference impedance"
      />
      <span className="spacer" />
      <span className="menu">
        <Button
          ref={fileButton}
          className={menu === 'file' ? 'on' : undefined}
          onClick={() => toggleMenu('file')}
          aria-haspopup="menu"
          aria-expanded={menu === 'file'}
          title="New, open, save and export"
        >
          File <IconChevronDown size={14} />
        </Button>
        {menu === 'file' && (
          <Menu
            label="File"
            anchor={fileButton}
            className="file"
            entries={fileEntries}
            onClose={() => setMenu(null)}
          />
        )}
      </span>
      {imported && (
        <ImportDialog key={imported.id} file={imported.file} onClose={() => setImported(null)} />
      )}
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
      <IconButton
        icon={<IconUndo />}
        label="Undo"
        title="Undo (Ctrl+Z)"
        onClick={undo}
        disabled={!canUndo}
      />
      <IconButton
        icon={<IconRedo />}
        label="Redo"
        title="Redo (Ctrl+Y)"
        onClick={redo}
        disabled={!canRedo}
      />
      <Button
        pressed={tool === 'match'}
        onClick={() => onTool('match')}
        title="Reach the target: add L, Pi or T parts ranked by Q, tune the parts already in the network, search a broadband match, or design a quarter-wave transformer or a stub filter"
      >
        Auto match
      </Button>
      <Button
        pressed={tool === 'optimize'}
        onClick={() => onTool('optimize')}
        title="Improve the element values for the lowest worst-case VSWR over the sweep range"
      >
        Optimize band
      </Button>
      <Button
        pressed={tool === 'montecarlo'}
        onClick={() => onTool('montecarlo')}
        title="Random part values within their tolerances: the cloud of input impedances, the VSWR histogram and the yield"
      >
        Tolerance
      </Button>
      <span className="menu">
        <Button
          ref={examplesButton}
          className={menu === 'examples' ? 'on' : undefined}
          onClick={() => toggleMenu('examples')}
          aria-haspopup="menu"
          aria-expanded={menu === 'examples'}
          title={TIPS.examples}
        >
          Examples <IconChevronDown size={14} />
        </Button>
        {menu === 'examples' && (
          <Menu
            label="Examples"
            anchor={examplesButton}
            className="wide examples"
            entries={exampleEntries}
            onClose={() => setMenu(null)}
          />
        )}
      </span>
      <Button variant="primary" onClick={() => void share()} title={TIPS.share}>
        Share link
      </Button>
      {onSettings && (
        <IconButton
          icon={<IconSettings />}
          label="Settings"
          title="Settings: colours, line widths, labels, defaults, schematic direction"
          onClick={onSettings}
        />
      )}
      <IconButton
        icon={<IconHelp />}
        label="Help"
        title={TIPS.help}
        onClick={() => useHelp.getState().toggleHelp()}
      />
      <IconButton
        icon={theme === 'dark' ? <IconMoon /> : theme === 'light' ? <IconSun /> : <IconThemeAuto />}
        label="Toggle theme"
        title={`Theme: ${theme}`}
        onClick={() => onTheme(theme === 'auto' ? 'dark' : theme === 'dark' ? 'light' : 'auto')}
      />
    </header>
  );
}
