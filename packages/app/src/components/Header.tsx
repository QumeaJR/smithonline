import { refusalReason } from '../lib/analytics/files';
import { track, trackDynamic } from '../lib/analytics/track';
import type { EventA } from '../lib/analytics/schema';
import {
  hasBoardOrPackages,
  layoutAssumptions,
  XmlscError,
  type AsciiDelimiter,
} from '@smithonline/core';
import { useEffect, useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react';
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
import { importKind, OPEN_ACCEPT, type ImportedFile } from '../lib/import';
import { datapointTable, tableText } from '../lib/report';
import { loadSPlotText } from '../lib/splotActions';
import { addNetworkToSPlot } from '../lib/splotNetwork';
import {
  designFileObject,
  designFromJsonFile,
  encodeDesign,
  rememberWrittenLink,
  shareMeasurementNote,
  shareUrl,
} from '../lib/share';
import { useDesignStore } from '../store/useDesignStore';
import { OPEN_BUILD_BOARD } from '../lib/tourUi';

import { openImportText, useImported } from '../lib/importDialog';
import type { MenuEntry } from './ui/Menu';
import { TOURS } from '../lib/tours';
import { WORKFLOWS } from '../lib/workflows';
import { isShipped } from '../lib/workflowKit';
import { openSample, SAMPLES } from '../lib/samples';
import { emitTourEvent } from '../lib/tourEvents';
import { noteBomExported, noteDevice, noteS2pExported } from '../lib/nextSteps';
import { useTourStore } from '../store/useTourStore';
import { designBuild, openedDesign, ownBuild } from '../lib/designBuild';
import { usePartLibrary } from '../store/usePartLibrary';
import { needsName, useOpenProject, useProjects } from '../store/useProjects';
import { shareLinkPartsWarning } from '../lib/parts';
import type { Tool } from '../lib/tools';
import { fileShortcuts, SHORTCUT_HINTS, type FileShortcuts } from '../lib/shortcuts';

import type { Theme } from '../lib/theme';

export type { Tool } from '../lib/tools';
export type { Theme } from '../lib/theme';

/** The layout assumptions the BOM lists: when a part names a package or the board is in the network. */
function bomLayoutNotes(design: Design, realization: Realization): string[] {
  const elements = realization.ladder.elements;
  // The design's own build: the same notes on any machine (docs/09b).
  const { board, table } = designBuild(design);
  if (!hasBoardOrPackages(elements, board)) return [];
  return layoutAssumptions(elements, table, board, {
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

/** The header's shared actions: the File and Learn entries, Share link, the file picker. */
export interface HeaderActions {
  readonly fileEntries: MenuEntry[];
  /** The Learn menu: workflows, lessons, sample files and the Smith V4.1 examples. */
  readonly learnEntries: MenuEntry[];
  /** Copy a link that holds the design; true once it is on the clipboard. */
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

/** The key of the Workflows section of the Learn menu (the start guide's More opens it there). */
export const LEARN_WORKFLOWS = 'workflows';

/** Why the BOM entry is greyed while Realize is off (docs/09 section 2). */
export const BOM_NEEDS_REALIZE = 'Turn Realize on to list standard values';

/**
 * Register the header's file actions for Ctrl+S, Ctrl+O and Ctrl+E while it is the one on
 * screen (the desktop header or the phone's top bar). `exportMenu` opens its File menu at the
 * Export section.
 */
export function useFileShortcuts(
  actions: HeaderActions,
  exportMenu: (quiet?: boolean) => void,
  learnMenu?: (section?: string) => void,
  closeMenus?: () => void,
): void {
  const latest = useRef({ actions, exportMenu, learnMenu, closeMenus });
  useLayoutEffect(() => {
    latest.current = { actions, exportMenu, learnMenu, closeMenus };
  });
  useEffect(() => {
    const mine: FileShortcuts = {
      save: () => latest.current.actions.save(),
      open: () => latest.current.actions.open(),
      exportMenu: (quiet) => latest.current.exportMenu(quiet),
      learnMenu: (section) => latest.current.learnMenu?.(section),
      closeMenus: () => latest.current.closeMenus?.(),
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
 * The header's actions, shared by the desktop header and the phone's More
 * sheet: New, Open, Save and every export in File; the workflows, lessons,
 * sample files and Smith V4.1 examples in Learn; Share link. `onMenuDone` closes the menu that
 * opened the import dialog.
 */
export function useHeaderActions(
  { result, sweep, svgRef, onTool, realization, onReport, onPrint }: HeaderProps,
  onMenuDone: () => void,
): HeaderActions {
  const design = useDesignStore((s) => s.design);
  const view = useDesignStore((s) => s.view);
  const openProject = useOpenProject();
  const projectsReady = useProjects((s) => s.ready);
  const { loadDesign, newDesign, setMessage } = useDesignStore.getState();
  const fileInput = useRef<HTMLInputElement>(null);
  const setImported = (next: { file: ImportedFile; id: number } | null): void =>
    useImported.setState({ imported: next });

  const safeName = design.name.replace(/[^\w.-]+/g, '_') || 'design';

  const exported = (fileName: string): void => {
    setMessage(`Exported ${fileName}`);
  };

  /** The SPICE and LTspice files hold library parts as their fitted circuits: the status line says so. */
  const fittedNote = (fileName: string): void => {
    const els = realization ? realization.ladder.elements : design.elements;
    const n = els.filter((el) => el.kind === 'part').length;
    if (n === 0) return;
    setMessage(
      `Exported ${fileName}; ${n === 1 ? 'the library part is' : `the ${n} library parts are`} written as fitted equivalent circuits (approximate), not as the measured data; the .s2p export uses the data`,
    );
  };

  const openFile = async (file: File): Promise<void> => {
    try {
      const text = await file.text();
      const kind = importKind(file.name);
      if (kind === 'json') {
        const decoded = designFromJsonFile(text);
        if ('problem' in decoded) throw new Error(decoded.problem);
        setImported(null);
        // A file saved before 0.6.0 takes this browser's defaults for its build, and says so.
        const opened = openedDesign(decoded.value);
        // The step's message, with the inline Undo: it replaces the whole design.
        const said = opened.notice
          ? `Opened ${file.name}. ${opened.notice}`
          : `Opened ${file.name}`;
        loadDesign(opened.design, said);
        // The old-design notice carries the way to check the board, beside the Undo.
        if (opened.notice) setMessage(said, { undo: true, action: OPEN_BUILD_BOARD });
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
        const { note, dialog, twoPort } = openImportText(file.name, text);
        if (dialog) onMenuDone();
        setMessage(note);
        if (twoPort) noteDevice();
        return;
      }
    } catch (err) {
      const reason = err instanceof XmlscError || err instanceof Error ? err.message : String(err);
      const k = importKind(file.name);
      if (k === 'json' || k === 'xmlsc') track('refused', k, refusalReason(reason));
      setMessage(`Could not open ${file.name}: ${reason}`, { error: true });
    }
  };

  const share = async (): Promise<boolean> => {
    // The link carries the build, so the as-built network is the same in any browser.
    const own = ownBuild(design);
    const url = shareUrl(own, `${location.origin}${location.pathname}`);
    // Library parts travel as fitted circuits only: the sender is told, with the way to send all.
    const warning = shareLinkPartsWarning(
      design.elements,
      design.realize.enabled && design.realize.series === 'library',
    );
    const left = shareMeasurementNote(design, url.length);
    const tail = [warning, left]
      .filter(Boolean)
      .map((w) => `. ${w as string}`)
      .join('');
    // The link goes to the clipboard and stays out of the address bar, so a reload opens the
    // autosave (the work done since) and not the design as it was when shared.
    try {
      await navigator.clipboard.writeText(url);
      setMessage(`Share link copied (${url.length} characters)${tail}`);
      return true;
    } catch {
      // No clipboard: the address bar holds it to copy from; a reload of this tab opens the
      // autosave when that holds this design or newer, else the link (main.tsx).
      const hash = `#d=${encodeDesign(own)}`;
      history.replaceState(null, '', hash);
      rememberWrittenLink(hash);
      setMessage(`Share link is in the address bar${tail}`);
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

  const saveToProjects = async (): Promise<void> => {
    const projects = useProjects.getState();
    // An untitled design is named first, and a design a project holds already offers that
    // project: both in the Projects dialog.
    if (needsName(useDesignStore.getState().design.name) || projects.sameProject()) {
      projects.setOpen(true, false, true);
      return;
    }
    const name = useDesignStore.getState().design.name;
    const why = await projects.saveCurrent();
    if (why) setMessage(why, { error: true });
    else setMessage(`Saved "${name}" to projects; changes are saved there as you work`);
  };

  const saveJson = (): void => {
    // The .json file keeps the library parts' data and the measured board at full precision.
    exportJson(designFileObject(ownBuild(design)), safeName);
    setMessage(`Saved ${safeName}.json`);
  };

  /** Write a simulator file; a network the format cannot hold is reported in the status line. */
  const exportSim = (fileName: string, make: () => string, type: string): boolean => {
    try {
      exportText(fileName, make(), type);
      exported(fileName);
      return true;
    } catch (err) {
      setMessage(
        `Could not export ${fileName}: ${err instanceof Error ? err.message : String(err)}`,
        { error: true },
      );
      return false;
    }
  };

  const saveXmlsc = (): void => {
    try {
      exportText(`${safeName}.xmlsc`, designToXmlsc(design), 'text/xml');
      // Realize from the part library changes nothing in the file: it holds the ideal values.
      const chosen =
        realization?.elements.filter((e) => e.ideal.kind !== 'part' && e.realized.kind === 'part')
          .length ?? 0;
      setMessage(
        chosen > 0
          ? `Saved ${safeName}.xmlsc with the ideal values: the ${chosen === 1 ? 'library part' : `${chosen} library parts`} Realize chose cannot be stored in it (Smith V4.1 has no parts from measured data); the BOM and the .json file keep them`
          : `Saved ${safeName}.xmlsc`,
      );
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
      label: 'Projects…',
      description:
        'Your designs kept in this browser: open, rename, duplicate, delete, export, import',
      onSelect: () => useProjects.getState().setOpen(true),
    },
    {
      label: 'Save to projects',
      disabled: openProject !== null || !projectsReady,
      description: openProject
        ? `Kept in Projects as "${openProject.name}"; changes are saved there as you work`
        : 'Keep this design in Projects; it then saves itself as you work',
      onSelect: () => void saveToProjects(),
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
    { kind: 'section', key: 'export-simulator', label: 'For a simulator' },
    {
      label: 'Touchstone S-parameters (.s2p)',
      tour: 'file.export.s2p',
      description:
        'As built: realized values, losses, packages, board; without its load, over the measured band of a measured load or the sweep when a frequency sweep is on, else 0.5 f to 2 f',
      onSelect: () => {
        const done = exportSim(
          `${safeName}.s2p`,
          () =>
            designToS2p(design, realization, designBuild(design).table, designBuild(design).board),
          'text/plain',
        );
        if (!done) return;
        emitTourEvent('export-s2p');
        noteS2pExported();
      },
    },
    {
      label: 'SPICE netlist (.cir)',
      tour: 'file.export.spice',
      description:
        'Values and losses; no packages or board. Source and load, library parts as fitted circuits; ngspice, LTspice, Qucs-S',
      onSelect: () => {
        if (
          exportSim(
            `${safeName}.cir`,
            () => designToSpice(design, realization, designBuild(design).board),
            'text/plain',
          )
        ) {
          fittedNote(`${safeName}.cir`);
        }
        emitTourEvent('export-spice');
      },
    },
    {
      label: 'LTspice schematic (.asc)',
      // The SPICE step of the verify workflow names both: both are highlighted.
      tour: 'file.export.spice',
      description:
        'Values and losses; no packages or board. R, L and C only (library parts as fitted circuits); lines and stubs go to the netlist',
      onSelect: () => {
        if (
          exportSim(
            `${safeName}.asc`,
            () => designToLtspice(design, realization, designBuild(design).board),
            'text/plain',
          )
        ) {
          fittedNote(`${safeName}.asc`);
        }
        emitTourEvent('export-spice');
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
    { kind: 'section', key: 'export-build', label: 'For the build' },
    {
      label: 'Bill of materials (CSV)',
      tour: 'file.export.bom',
      disabled: realization === null,
      title: realization
        ? 'Ideal and realized value, series and deviation per part'
        : BOM_NEEDS_REALIZE,
      description: realization ? undefined : BOM_NEEDS_REALIZE,
      onSelect: () => {
        if (!realization) return;
        exportBom(
          realization,
          safeName,
          elementName,
          designStress(design, design.elements, realization),
          activeLimits(stressSettings(design)),
          bomLayoutNotes(design, realization),
        );
        exported(`${safeName}_bom.csv`);
        emitTourEvent('export-bom');
        noteBomExported();
      },
    },
    {
      label: 'Report…',
      tour: 'file.report',
      description: 'Chart, schematic, datapoints and circles as one SVG or a print page',
      onSelect: () => {
        onReport();
        emitTourEvent('report');
      },
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
    { kind: 'section', key: 'export-compare', label: 'Compare in the app' },
    {
      label: 'Add network to S-Plot',
      description: 'The network as built, live in the S-Plot view',
      title:
        "Plot the network's S-parameters in the S-Plot view; the entry follows the design until you freeze it",
      onSelect: () => setMessage(addNetworkToSPlot()),
    },
    { kind: 'section', key: 'export-images', label: 'Images and data' },
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
  ];

  const completed = useTourStore((s) => s.completed);
  const learnEntries: MenuEntry[] = [
    { kind: 'section', key: LEARN_WORKFLOWS, label: 'Workflows' },
    ...WORKFLOWS.filter(isShipped).map((w): MenuEntry => {
      const done = completed.has(w.id);
      return {
        key: `workflow-${w.id}`,
        tour: `learn.workflow.${w.id}`,
        label: (
          <>
            {w.title}
            {done && (
              <span className="learn-done" title="Followed to its last step in this browser">
                <span aria-hidden="true"> ✓</span>
                <span className="visually-hidden">, seen to the end</span>
              </span>
            )}
          </>
        ),
        text: w.title,
        description: w.blurb,
        onSelect: () => {
          setImported(null);
          useTourStore.getState().startWorkflow(w.id);
        },
      };
    }),
    { kind: 'section', key: 'lessons', label: 'Lessons' },
    ...TOURS.map((t): MenuEntry => ({
      key: `tour-${t.id}`,
      label: t.title,
      description: t.blurb,
      onSelect: () => useTourStore.getState().start(t.id),
    })),
    { kind: 'section', key: 'samples', label: 'Sample files' },
    {
      kind: 'note',
      content:
        'Synthetic files made from circuit models, not measurements: each opens as a file of yours would.',
    },
    ...SAMPLES.map((sample): MenuEntry => ({
      key: `sample-${sample.id}`,
      label: sample.title,
      description: sample.description,
      onSelect: () => openSample(sample.id),
    })),
    { kind: 'section', key: 'examples', label: 'Smith V4.1 examples' },
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
          trackDynamic('example', ex.file.replace(/\.xmlsc$/, ''));
        } catch (err) {
          setMessage(
            `Could not load ${ex.title}: ${err instanceof Error ? err.message : String(err)}`,
            { error: true },
          );
        }
      },
    })),
  ];

  // The import dialog mounts at the application root (App.tsx), as Settings and the part
  // library do: inside the top bar its backdrop sat under the phone's panel sheet.
  const hosts = (
    <>
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
    // The handlers read the refs when an entry is chosen, not while this renders.
    // eslint-disable-next-line react-hooks/refs
    fileEntries: [...countExports(fileEntries), viewKeys],
    learnEntries,
    share,
    hosts,
    closeImport: () => setImported(null),
    save: saveJson,
    open: () => fileInput.current?.click(),
  };
}

/** The File menu's exports by their label, for the usage counts (docs/10 section 1.3). */
const EXPORT_COUNTS: Readonly<Record<string, EventA<'export'>>> = {
  'Save as Smith Online (.json)': 'json',
  'Save as Smith V4.1 project (.xmlsc)': 'xmlsc',
  'Touchstone S-parameters (.s2p)': 's2p',
  'SPICE netlist (.cir)': 'spice',
  'LTspice schematic (.asc)': 'ltspice',
  'Netlist (.ckt)': 'ckt',
  'Bill of materials (CSV)': 'bom',
  'Report…': 'report',
  Print: 'print',
  'Add network to S-Plot': 'splot_add',
  'Chart as SVG': 'svg',
  'Chart as PNG': 'png',
  'Copy chart as image': 'copy_chart',
  'Copy datapoints as text': 'copy_dp',
  'Datapoints as CSV': 'csv',
  'Datapoints and circles (ASCII)': 'ascii',
};

/** The same entries, each export counted when chosen; nothing about the design is sent. */
function countExports(entries: readonly MenuEntry[]): MenuEntry[] {
  return entries.map((e): MenuEntry => {
    const label = 'label' in e ? e.label : undefined;
    const kind = typeof label === 'string' ? EXPORT_COUNTS[label] : undefined;
    if (!kind) return e;
    if (e.kind === 'choices') {
      return {
        ...e,
        choices: e.choices.map((c) => ({
          ...c,
          onSelect: () => {
            track('export', kind);
            c.onSelect();
          },
        })),
      };
    }
    if (e.kind === undefined || e.kind === 'item') {
      return {
        ...e,
        onSelect: () => {
          track('export', kind);
          e.onSelect();
        },
      };
    }
    return e;
  });
}
