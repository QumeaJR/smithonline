import { useRef, useState } from 'react';
import { DesignFields } from '../components/DesignFields';
import { useHeaderActions, type HeaderProps } from '../components/Header';
import { nextTheme } from '../lib/theme';
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
import { TIPS } from '../lib/tips';
import { TOOLS, type ToolId } from '../lib/tools';
import { useDesignStore } from '../store/useDesignStore';
import { useHelp } from '../store/useHelp';
import { useJobs } from '../store/useJobs';

type OpenMenu = 'file' | 'examples' | null;

export interface DesktopHeaderProps extends HeaderProps {
  /** The tool's segment is on show in the right column; otherwise a running job shows a dot. */
  readonly toolShown: boolean;
}

/**
 * The header of the tablet, desktop and wide layouts (docs/07 section 5), in
 * groups by purpose. Each group is a bordered cluster with a hairline between
 * neighbours and a wider gap between groups: brand and view on the left; the
 * design strip (name, f, power, Z0) with Undo and Redo in the centre; data
 * (File, Examples, Share link), design tools (Auto match, Optimize band) and
 * settings (Tolerance, Settings) on the right, then Help and Theme as icons.
 */
export function DesktopHeader(props: DesktopHeaderProps) {
  const { theme, onTheme, tool, onTool, onSettings, toolShown } = props;
  const view = useDesignStore((s) => s.view);
  const setView = useDesignStore((s) => s.setView);
  const canUndo = useDesignStore((s) => s.past.length > 0);
  const canRedo = useDesignStore((s) => s.future.length > 0);
  const jobs = useJobs((s) => s.jobs);
  const { undo, redo } = useDesignStore.getState();
  const [menu, setMenu] = useState<OpenMenu>(null);
  const fileButton = useRef<HTMLButtonElement>(null);
  const examplesButton = useRef<HTMLButtonElement>(null);
  const actions = useHeaderActions(props, () => setMenu(null));
  /** The same menu button closes its menu; the menus and the import dialog close each other. */
  const toggleMenu = (name: Exclude<OpenMenu, null>): void => {
    actions.closeImport();
    setMenu(menu === name ? null : name);
  };

  const toolButton = (id: ToolId) => {
    const info = TOOLS.find((t) => t.id === id);
    if (!info) return null;
    // A job runs behind another segment: a dot on its button says so.
    const busy = Boolean(jobs[id]) && !(tool === id && toolShown);
    return (
      <Button
        pressed={tool === id}
        onClick={() => onTool(id)}
        title={info.description}
        className={busy ? 'has-badge' : undefined}
      >
        {info.label}
        {busy && (
          <span className="badge-dot" role="status" aria-label={`${info.label} is running`} />
        )}
      </Button>
    );
  };

  return (
    <header className="topbar desktop-header">
      <div className="hgroup hgroup-brand">
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
      </div>
      <div className="hgroup hgroup-design">
        <div className="cluster design-strip" role="group" aria-label="Design">
          <DesignFields />
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
            >
              File <IconChevronDown size={14} />
            </Button>
            {menu === 'file' && (
              <Menu
                label="File"
                anchor={fileButton}
                className="file"
                entries={actions.fileEntries}
                onClose={() => setMenu(null)}
              />
            )}
          </span>
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
                prefer={{ align: 'end' }}
                entries={actions.exampleEntries}
                onClose={() => setMenu(null)}
              />
            )}
          </span>
          <Button onClick={() => void actions.share()} title={TIPS.share}>
            Share link
          </Button>
        </div>
        <div className="cluster" role="group" aria-label="Design tools">
          {toolButton('match')}
          {toolButton('optimize')}
        </div>
        <div className="cluster" role="group" aria-label="Settings">
          {toolButton('montecarlo')}
          {onSettings && (
            <IconButton
              icon={<IconSettings />}
              label="Settings"
              title="Settings: colours, line widths, labels, defaults, schematic direction"
              onClick={onSettings}
            />
          )}
        </div>
        <span className="hicons">
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
            label="Toggle theme"
            title={`Theme: ${theme}`}
            onClick={() => onTheme(nextTheme(theme))}
          />
        </span>
      </div>
      {actions.hosts}
    </header>
  );
}
