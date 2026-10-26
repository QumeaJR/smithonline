/**
 * The interface a guided workflow drives (docs/09 section 3.0): the view,
 * the tools, the side column's segment, the phone's sheet, Settings, the
 * menus and the sample files. The application registers how it opens and
 * closes a tool (App.tsx); without it (a test of a panel alone) the shell
 * store is set directly.
 */
import { useDesignStore } from '../store/useDesignStore';
import { useShell, type BuildSection, type MatchMode } from '../store/useShell';
import { layoutForWidth } from './layout';
import { openSample } from './samples';
import { fileShortcuts } from './shortcuts';
import type { ToolId } from './tools';
import type { Place, TourUi } from './workflowKit';

/** What the application registers: its own open and close of a tool (panes, sheet, chart view). */
export interface AppBridge {
  readonly openTool: (id: ToolId) => void;
  readonly closeTool: () => void;
}

export const appBridge: { current: AppBridge | null } = { current: null };

function layoutNow(): ReturnType<typeof layoutForWidth> {
  return layoutForWidth(typeof window === 'undefined' ? 1440 : window.innerWidth);
}

function openTool(id: ToolId, mode?: MatchMode): void {
  const shell = useShell.getState();
  if (mode !== undefined) shell.setMatchMode(mode);
  if (appBridge.current) {
    appBridge.current.openTool(id);
    return;
  }
  if (shell.tool !== id) shell.setTool(id);
  shell.toolOpened();
}

function show(place: Place): void {
  const shell = useShell.getState();
  const layout = layoutNow();
  const phone = layout === 'phone';
  const narrow = phone || layout === 'tablet';
  if (place === 'network') {
    if (narrow) shell.setPane('network');
  } else if (place === 'numbers') {
    shell.setPane('numbers');
  } else if (place === 'tool') {
    // The Tools segment: the open tool's panel, or the list with the tool to open.
    if (narrow) shell.setPane('tool');
    if (shell.tool !== null) shell.pushTool();
  } else if (place === 'chart') {
    if (useDesignStore.getState().view !== 'chart') useDesignStore.getState().setView('chart');
  }
  if (!phone) return;
  // The phone's sheet: half shows a panel under the chart, peek leaves the chart free.
  if (place === 'chart' || place === 'page') shell.setDetent('peek');
  else if (place === 'network' || place === 'numbers' || place === 'tool') {
    if (shell.detent === 'peek') shell.setDetent('half');
  }
}

/** Open the Build tool at a section (Edit… in the network row, a next step, a workflow). */
function openBuild(section?: BuildSection): void {
  if (section) useShell.getState().showBuildSection(section);
  openTool('build');
  show('tool');
}

export const tourUi: TourUi = {
  setView: (view) => useDesignStore.getState().setView(view),
  openTool,
  openBuild,
  closeTool: () => {
    if (appBridge.current) appBridge.current.closeTool();
    else {
      useShell.getState().setTool(null);
      useShell.getState().toolClosed();
    }
  },
  setPane: (pane) => useShell.getState().setPane(pane),
  setDetent: (detent) => useShell.getState().setDetent(detent),
  show,
  openSettings: (section) => useShell.getState().openSettings(section ?? null),
  openSample,
  openMenu: (id, section) => {
    // Opened at Export without moving the focus: the step's highlight is the only one.
    if (id === 'file') fileShortcuts.current?.exportMenu(true);
    else fileShortcuts.current?.learnMenu?.(section);
  },
  closeMenu: () => fileShortcuts.current?.closeMenus?.(),
};
