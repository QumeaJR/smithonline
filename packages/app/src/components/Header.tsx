import {
  formatEngineering,
  hasBoardOrPackages,
  layoutAssumptions,
  XmlscError,
  type AsciiDelimiter,
} from '@smithonline/core';
import { useEffect, useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react';
import { create } from 'zustand';
import type { LadderResult, Realization, SweepPoint } from '@smithonline/core';
import { activeLimits, designStress, stressSettings } from '../lib/stress';
import { copyChartImage, copyFailure, copyText } from '../lib/clipboard';
import { startIndex, userDatapoints } from '../lib/datapoints';
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
import { useDesignStore } from '../store/useDesignStore';
import { ImportDialog } from './ImportDialog';
import type { MenuEntry } from './ui/Menu';
import { TOURS } from '../lib/tours';
import { useTourStore } from '../store/useTourStore';
import { usePackages } from '../store/usePackages';
import { useBoard } from '../store/useBoard';
import { usePartLibrary } from '../store/usePartLibrary';
import type { Tool } from '../lib/tools';
import { fileShortcuts, SHORTCUT_HINTS, type FileShortcuts } from '../lib/shortcuts';

import type { Theme } from '../lib/theme';

export type { Tool } from '../lib/tools';
export type { Theme } from '../lib/theme';

/** The layout assumptions the BOM lists: when a part names a package or the board is in the network. */
function bomLayoutNotes(design: Design, realization: Realization): string[] {
  const elements = realization.ladder.elements;
  const board = useBoard.getState().board;
  if (!hasBoardOrPackages(elements, board)) return [];
  return layoutAssumptions(elements, usePackages.getState().table, board, {
    z0: design.z0,
    frequency: design.frequency,
  });
}

/** What the header and the phone's More sheet need from the application. */
export interface HeaderProps {
  readonly result: LadderResult;
  readonly sweep: readonly SweepPoint[] | null;
  readonly svgRef: RefObject<SVGSVGElement | null>;
  readonly theme: Theme;
  readonly onTheme: (theme: Theme) => void;
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

/** The header's shared actions: the File and Examples entries, Share link, the file picker. */
export interface HeaderActions {
  readonly fileEntries: MenuEntry[];
  readonly exampleEntries: MenuEntry[];
  /** Put the design in the address and copy the link; true once it is on the clipboard. */
  readonly share: () => Promise<boolean>;
  /** The hidden file input and the import dialog: render them once with the header. */
  readonly hosts: ReactNode;
  /** A menu opened: an open import dialog goes (the menus and the dialog close each other). */
  readonly closeImport: () => void;
  /** Save the design as .json (Ctrl+S). */
  readonly save: () => void;
  /** Pick a file to open (Ctrl+O). */
  readonly open: () => void;
}

/** The key of the Export section of the File menu: Ctrl+E opens the menu there. */
export const EXPORT_SECTION = 'export';

/**
 * Register the header's file actions for Ctrl+S, Ctrl+O and Ctrl+E while it is the one on
 * screen (the desktop header or the phone's top bar). `exportMenu` opens its File menu at the
 * Export section.
 */
export function useFileShortcuts(actions: HeaderActions, exportMenu: () => void): void {
  const latest = useRef({ actions, exportMenu });
  useLayoutEffect(() => {
    latest.current = { actions, exportMenu };
  });
  useEffect(() => {
    const mine: FileShortcuts = {
      save: () => latest.current.actions.save(),
      open: () => latest.current.actions.open(),
      exportMenu: () => latest.current.exportMenu(),
    };
    fileShortcuts.current = mine;
    return () => {
      if (fileShortcuts.current === mine) fileShortcuts.current = null;
    };
  }, []);
}

const DELIMITERS: readonly { readonly id: AsciiDelimiter; readonly label: string }[] = [
  { id: 'semicolon', label: 'semicolon' },
  { id: 'comma', label: 'comma' },
  { id: 'none', label: 'spaces' },
];

/**
 * The open import dialog's file, outside the header: the desktop header and
 * the phone's top bar are different components, and the dialog stays open
 * when a rotation across 700 px swaps one for the other.
 */
const useImported = create<{
  imported: { file: ImportedFile; id: number } | null;
  /** Counts the files opened into the dialog: each opens a dialog of its own. */
  count: number;
}>(() => ({ imported: null, count: 0 }));

/**
 * The header's actions, shared by the desktop header and the phone's More
 * sheet: New, Open, Save and every export in File; the tours and the Smith
 * V4.1 examples in Examples; Share link. `onMenuDone` closes the menu that
 * opened the import dialog.
 */
export function useHeaderActions(
  { result, sweep, svgRef, onTool, realization, onReport, onPrint }: HeaderProps,
  onMenuDone: () => void,
): HeaderActions {
  const design = useDesignStore((s) => s.design);
  const view = useDesignStore((s) => s.view);
  const { loadDesign, newDesign, setMessage, importTwoPort } = useDesignStore.getState();
  const fileInput = useRef<HTMLInputElement>(null);
  const imported = useImported((s) => s.imported);
  const setImported = (next: { file: ImportedFile; id: number } | null): void =>
    useImported.setState({ imported: next });

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
        // The step's message, with the inline Undo: it replaces the whole design.
        loadDesign(decoded, `Opened ${file.name}`);
        return;
      } else if (kind === 'xmlsc') {
        const next: Design = designFromXmlsc(text, nameFromFile(file.name));
        setImported(null);
        loadDesign(next, `Opened ${file.name}`);
        return;
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
        const id = useImported.getState().count + 1;
        useImported.setState({ imported: { file: parsed, id }, count: id });
        onMenuDone();
        setMessage(note);
        return;
      }
    } catch (err) {
      const reason = err instanceof XmlscError || err instanceof Error ? err.message : String(err);
      setMessage(`Could not open ${file.name}: ${reason}`, { error: true });
    }
  };

  const share = async (): Promise<boolean> => {
    const url = shareUrl(design, `${location.origin}${location.pathname}`);
    history.replaceState(null, '', `#d=${encodeDesign(design)}`);
    try {
      await navigator.clipboard.writeText(url);
      setMessage(`Share link copied (${url.length} characters)`);
      return true;
    } catch {
      setMessage('Share link is in the address bar');
      return false;
    }
  };

  const copyChart = async (): Promise<void> => {
    if (!svgRef.current) return;
    try {
      await copyChartImage(svgRef.current);
      setMessage('Chart copied to the clipboard as a PNG image');
    } catch (err) {
      setMessage(`Could not copy the chart: ${copyFailure(err)}`, { error: true });
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
      setMessage(`Could not copy the datapoints: ${copyFailure(err)}`, { error: true });
    }
  };

  const saveJson = (): void => {
    // The .json file keeps the measured data of the library parts it uses: the user's own copy.
    exportJson(
      { app: 'Smith Online', version: 1, design: encodeDesign(design, { partData: true }) },
      safeName,
    );
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
        { error: true },
      );
    }
  };

  const saveXmlsc = (): void => {
    try {
      exportText(`${safeName}.xmlsc`, designToXmlsc(design), 'text/xml');
      setMessage(`Saved ${safeName}.xmlsc`);
    } catch (err) {
      setMessage(`Could not save as .xmlsc: ${err instanceof Error ? err.message : String(err)}`, {
        error: true,
      });
    }
  };

  const chartOnly = view !== 'chart';
  const fileEntries: MenuEntry[] = [
    {
      label: 'New',
      hint: SHORTCUT_HINTS.new,
      description: 'Empty network, 50 ohm load, target Z0. Undo brings the old one back.',
      onSelect: () => {
        setImported(null);
        newDesign();
        onTool(null);
      },
    },
    {
      label: 'Open\u2026',
      hint: SHORTCUT_HINTS.open,
      description:
        'Smith V4.1 .xmlsc project, Smith Online .json, Touchstone (.s1p to .s4p), CITI, EZNEC Lastz.txt or VNA CSV (.csv, .txt)',
      onSelect: () => fileInput.current?.click(),
    },
    {
      label: 'Save as Smith Online (.json)',
      hint: SHORTCUT_HINTS.save,
      description:
        'Everything in the design, including R, RLC, transformer elements and the data of library parts',
      onSelect: saveJson,
    },
    {
      label: 'Save as Smith V4.1 project (.xmlsc)',
      description: 'Opens in the original; L, C, lines and stubs only',
      onSelect: saveXmlsc,
    },
    {
      label: 'Part library\u2026',
      description:
        'Real parts from the manufacturers\u2019 S-parameter files (.s2p), kept in this browser',
      onSelect: () => usePartLibrary.getState().setOpen(true),
    },
    {
      kind: 'section',
      key: EXPORT_SECTION,
      label: (
        <>
          Export <kbd>{SHORTCUT_HINTS.export}</kbd>
        </>
      ),
    },
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
              { error: true },
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
      description:
        'Realized values, loss resistors, source and load; library parts as fitted circuits; ngspice, LTspice, Qucs-S',
      onSelect: () =>
        exportSim(
          `${safeName}.cir`,
          () => designToSpice(design, realization, useBoard.getState().board),
          'text/plain',
        ),
    },
    {
      label: 'LTspice schematic (.asc)',
      description:
        'R, L and C only (library parts as fitted circuits); lines and stubs go to the netlist',
      onSelect: () =>
        exportSim(
          `${safeName}.asc`,
          () => designToLtspice(design, realization, useBoard.getState().board),
          'text/plain',
        ),
    },
    {
      label: 'Touchstone S-parameters (.s2p)',
      description:
        'The network as built, without its load: over the sweep when a frequency sweep is on, else 0.5 f to 2 f',
      onSelect: () =>
        exportSim(
          `${safeName}.s2p`,
          () =>
            designToS2p(
              design,
              realization,
              usePackages.getState().table,
              useBoard.getState().board,
            ),
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
                bomLayoutNotes(design, realization),
              );
              exported(`${safeName}_bom.csv`);
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
          // The step's message, with the inline Undo: it replaces the whole design.
          loadDesign(designFromXmlsc(ex.xml, ex.title), `Loaded ${ex.title}`);
        } catch (err) {
          setMessage(
            `Could not load ${ex.title}: ${err instanceof Error ? err.message : String(err)}`,
            { error: true },
          );
        }
      },
    })),
  ];

  const hosts = (
    <>
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
    </>
  );

  /** The view shortcuts, in a note at the foot of the File menu. */
  const viewKeys: MenuEntry = {
    kind: 'note',
    key: 'view-keys',
    content: (
      <span className="view-keys">
        Views: <kbd>{SHORTCUT_HINTS.views[0]}</kbd> Smith chart,{' '}
        <kbd>{SHORTCUT_HINTS.views[1]}</kbd> Response, <kbd>{SHORTCUT_HINTS.views[2]}</kbd> S-Plot
      </span>
    ),
  };

  return {
    fileEntries: [...fileEntries, viewKeys],
    exampleEntries,
    share,
    hosts,
    closeImport: () => setImported(null),
    save: saveJson,
    open: () => fileInput.current?.click(),
  };
}
