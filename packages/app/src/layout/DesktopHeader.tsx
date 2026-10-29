import { useRef, useState } from 'react';
import { DesignFields } from '../components/DesignFields';
import {
  EXPORT_SECTION,
  useFileShortcuts,
  useHeaderActions,
  type HeaderProps,
} from '../components/Header';
import { nextTheme, themeName } from '../lib/theme';
import { Button, IconButton } from '../components/ui/Button';
import {
  IconChevronDown,
  IconHelp,
  IconMoon,
  IconRedo,
  IconSettings,
  IconSun,
  IconThemeAuto,
  IconUndo,
} from '../components/ui/icons';
import { Menu } from '../components/ui/Menu';
import { Segmented } from '../components/ui/Segmented';
import { ShareButton } from '../components/ShareButton';
import { TIPS } from '../lib/tips';
import type { OverlayPrefer } from '../lib/overlay';
import { TOOL_ANCHORS, TOOLS, toolTip, type ToolId } from '../lib/tools';
import { useDesignStore } from '../store/useDesignStore';
import { useHelp } from '../store/useHelp';
import { useJobs } from '../store/useJobs';
import { isWorkflow, useTourStore } from '../store/useTourStore';
import { useLayout } from '../lib/layout';

type OpenMenu = 'file' | 'learn' | null;

/** Header labels shorter than the tool's name, where the meaning stays clear. */
const SHORT_LABELS: Partial<Record<ToolId, string>> = { optimize: 'Optimize' };

export interface DesktopHeaderProps extends HeaderProps {
  /** The tool's segment is on show in the right column; otherwise a running job shows a dot. */
  readonly toolShown: boolean;
}

/**
 * A menu opened while a workflow's panel stands in the tablet's side column, to the right of
 * the header's buttons, opens leftwards, so neither hides the other.
 */
const CLEAR_OF_TOUR_PANEL: { prefer: OverlayPrefer } = { prefer: { align: 'end' } };

/**
 * The header of the tablet, desktop and wide layouts (docs/07 section 5), in
 * groups by purpose. Each group is a bordered cluster with a hairline between
 * neighbours and a wider gap between groups: brand and view on the left; the
 * design strip (name, f, power, Z0) with Undo and Redo in the centre; data
 * (File, Share link), design tools (Auto match, Optimize band, Tolerance),
 * Settings, then help (Learn, Help and Theme) on the right (docs/09 section 2).
 * One 48 px row from 1440 px up: labels are short where the meaning stays
 * clear ("Optimize", "Share"), the full name in the title and the
 * accessible name. Narrower, the actions wrap to a second row on the right.
 */
export function DesktopHeader(props: DesktopHeaderProps) {
  const { theme, onTheme, tool, onTool, onSettings, toolShown } = props;
  const view = useDesignStore((s) => s.view);
  const setView = useDesignStore((s) => s.setView);
  const canUndo = useDesignStore((s) => s.past.length > 0);
  const canRedo = useDesignStore((s) => s.future.length > 0);
  const jobs = useJobs((s) => s.jobs);
  const finished = useJobs((s) => s.finished);
  // A workflow's panel in the tablet's side column: menus open clear of it.
  const workflowRunning = useTourStore((s) => isWorkflow(s.tour));
  const tabletTour = useLayout() === 'tablet' && workflowRunning;
  const { undo, redo } = useDesignStore.getState();
  const [menu, setMenu] = useState<OpenMenu>(null);
  /** The File menu opened by Ctrl+E: it opens at its Export section. */
  const [atExport, setAtExport] = useState(false);
  /** The File menu opened by a workflow step: at Export, the focus left where it is. */
  const [quietMenu, setQuietMenu] = useState(false);
  const fileButton = useRef<HTMLButtonElement>(null);
  const learnButton = useRef<HTMLButtonElement>(null);
  /** The Learn menu opened by a workflow or the start guide: it opens at that section. */
  const [learnAt, setLearnAt] = useState<string | undefined>(undefined);
  const actions = useHeaderActions(props, () => setMenu(null));
  useFileShortcuts(
    actions,
    (quiet) => {
      actions.closeImport();
      setAtExport(true);
      setQuietMenu(quiet === true);
      setMenu('file');
    },
    (section) => {
      actions.closeImport();
      setLearnAt(section);
      setMenu('learn');
    },
    () => setMenu(null),
  );
  /** The same menu button closes its menu; the menus and the import dialog close each other. */
  const toggleMenu = (name: Exclude<OpenMenu, null>): void => {
    actions.closeImport();
    setAtExport(false);
    setQuietMenu(false);
    setLearnAt(undefined);
    setMenu(menu === name ? null : name);
  };

  const toolButton = (id: ToolId) => {
    const info = TOOLS.find((t) => t.id === id);
    if (!info) return null;
    // A job runs behind another segment (or another view): a dot on its button says so.
    const busy = Boolean(jobs[id]) && !(tool === id && toolShown);
    // A job that finished while its tool was closed or covered: a check dot until it shows.
    const ready = !busy && finished[id] !== undefined && !(tool === id && toolShown);
    return (
      <Button
        pressed={tool === id}
        onClick={() => onTool(id)}
        title={toolTip(info)}
        aria-label={
          busy ? `${info.label}, running` : ready ? `${info.label}, result ready` : info.label
        }
        className={busy || ready ? 'has-badge' : undefined}
        data-tool={id}
        data-tour={TOOL_ANCHORS[id]}
      >
        {SHORT_LABELS[id] ?? info.label}
        {busy && <span className="badge-dot" aria-hidden="true" />}
        {ready && <span className="badge-dot done" aria-hidden="true" />}
      </Button>
    );
  };

  return (
    <header className="topbar desktop-header">
      <div className="hgroup hgroup-brand">
        <span className="brand" title="SmithChart.Online">
          <img
            className="brand-mark brand-mark-light"
            src="./brand/mark-light.svg"
            alt=""
            width={22}
            height={22}
          />
          <img
            className="brand-mark brand-mark-dark"
            src="./brand/mark-dark.svg"
            alt=""
            width={22}
            height={22}
          />
          SmithChart<span className="brand-tld">.Online</span>
        </span>
        <Segmented
          className="view-tabs"
          ariaLabel="View"
          value={view}
          onChange={setView}
          options={[
            { value: 'chart', label: 'Smith chart', title: TIPS.tabChart, tour: 'view.chart' },
            {
              value: 'response',
              label: 'Response',
              title: TIPS.tabResponse,
              tour: 'view.response',
            },
            { value: 'splot', label: 'S-Plot', title: TIPS.tabSplot, tour: 'view.splot' },
          ]}
        />
      </div>
      <div className="hgroup hgroup-design">
        <div className="cluster design-strip" role="group" aria-label="Design">
          <DesignFields compactChip />
        </div>
        <div className="cluster" role="group" aria-label="History">
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
        </div>
      </div>
      <div className="hgroup hgroup-actions">
        <div className="cluster" role="group" aria-label="Data">
          <span className="menu">
            <Button
              ref={fileButton}
              className={menu === 'file' ? 'on' : undefined}
              onClick={() => toggleMenu('file')}
              aria-haspopup="menu"
              aria-expanded={menu === 'file'}
              title="New, open, save and export"
              aria-label="File"
              data-tour="header.file"
            >
              File <IconChevronDown size={14} />
            </Button>
            {menu === 'file' && (
              <Menu
                label="File"
                anchor={fileButton}
                className="file"
                entries={actions.fileEntries}
                focusSection={atExport ? EXPORT_SECTION : undefined}
                quietFocus={quietMenu}
                onClose={() => setMenu(null)}
                {...(tabletTour ? CLEAR_OF_TOUR_PANEL : {})}
              />
            )}
          </span>
          <ShareButton onShare={actions.share} />
        </div>
        <div className="cluster" role="group" aria-label="Design tools">
          {toolButton('match')}
          {toolButton('optimize')}
          {toolButton('montecarlo')}
          {toolButton('build')}
        </div>
        {onSettings && (
          <div className="cluster" role="group" aria-label="Settings">
            <IconButton
              icon={<IconSettings />}
              label="Settings"
              title={`Settings: ${TIPS.settings.charAt(0).toLowerCase()}${TIPS.settings.slice(1)}`}
              onClick={onSettings}
            />
          </div>
        )}
        <span className="hicons" role="group" aria-label="Help">
          <span className="menu">
            <Button
              ref={learnButton}
              className={menu === 'learn' ? 'on' : undefined}
              onClick={() => toggleMenu('learn')}
              aria-haspopup="menu"
              aria-expanded={menu === 'learn'}
              title={TIPS.learn}
              aria-label="Learn"
              data-tour="header.learn"
            >
              Learn <IconChevronDown size={14} />
            </Button>
            {menu === 'learn' && (
              <Menu
                label="Learn"
                anchor={learnButton}
                className="wide examples learn"
                prefer={{ align: 'end' }}
                entries={actions.learnEntries}
                focusSection={learnAt}
                onClose={() => setMenu(null)}
              />
            )}
          </span>
          <IconButton
            icon={<IconHelp />}
            label="Help"
            title={TIPS.help}
            onClick={() => useHelp.getState().toggleHelp()}
          />
          <IconButton
            icon={
              theme === 'dark' ? <IconMoon /> : theme === 'light' ? <IconSun /> : <IconThemeAuto />
            }
            label={`Theme: ${themeName(theme)}`}
            title={`Theme: ${themeName(theme)}; press for ${themeName(nextTheme(theme))}`}
            onClick={() => onTheme(nextTheme(theme))}
          />
        </span>
      </div>
      {actions.hosts}
    </header>
  );
}
