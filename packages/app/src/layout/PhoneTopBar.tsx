import { useRef, useState } from 'react';
import { useHeaderActions, type HeaderProps } from '../components/Header';
import { nextTheme } from '../lib/theme';
import { Button, IconButton } from '../components/ui/Button';
import { IconMenu, IconRedo, IconUndo } from '../components/ui/icons';
import { Menu } from '../components/ui/Menu';
import { Segmented } from '../components/ui/Segmented';
import { Sheet } from '../components/ui/Sheet';
import { TIPS } from '../lib/tips';
import { toolInfo } from '../lib/tools';
import { useDesignStore } from '../store/useDesignStore';
import { useHelp } from '../store/useHelp';
import { useShell } from '../store/useShell';

type Open = 'more' | 'file' | 'examples' | null;

/**
 * The phone's top bar (docs/07 section 5): 44 px plus the safe area, with
 * More (a sheet with the header's groups: Data, Settings, Help), the view
 * segmented control with short labels, and Undo and Redo as icon buttons.
 */
export function PhoneTopBar(props: HeaderProps) {
  const { theme, onTheme, onTool, onSettings } = props;
  const view = useDesignStore((s) => s.view);
  const setView = useDesignStore((s) => s.setView);
  const canUndo = useDesignStore((s) => s.past.length > 0);
  const canRedo = useDesignStore((s) => s.future.length > 0);
  const guideClosed = useShell((s) => s.guideClosed);
  const { undo, redo } = useDesignStore.getState();
  const [open, setOpen] = useState<Open>(null);
  const moreButton = useRef<HTMLButtonElement>(null);
  const actions = useHeaderActions(props, () => setOpen(null));
  /** A row of the More sheet: the sheet goes, then the row acts. */
  const run = (fn: () => void) => () => {
    setOpen(null);
    fn();
  };

  return (
    <header className="topbar phone-bar">
      <IconButton
        ref={moreButton}
        icon={<IconMenu />}
        label="More"
        title="File, examples, share link, settings and help"
        aria-haspopup="dialog"
        aria-expanded={open === 'more'}
        onClick={() => {
          actions.closeImport();
          setOpen(open === 'more' ? null : 'more');
        }}
      />
      <Segmented
        className="view-tabs"
        ariaLabel="View"
        value={view}
        onChange={setView}
        options={[
          { value: 'chart', label: 'Chart', title: TIPS.tabChart },
          { value: 'response', label: 'Response', title: TIPS.tabResponse },
          { value: 'splot', label: 'S-Plot', title: TIPS.tabSplot },
        ]}
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
      {open === 'more' && (
        <Sheet
          title="More"
          onClose={() => setOpen(null)}
          className="more-sheet"
          closeLabel="Close More"
          inside={[moreButton]}
          returnTo={() => moreButton.current}
        >
          <div className="more-groups">
            <section role="group" aria-label="Data">
              <h3>Data</h3>
              <Button variant="quiet" onClick={() => setOpen('file')}>
                File
                <span className="desc">New, open, save and export</span>
              </Button>
              <Button variant="quiet" onClick={() => setOpen('examples')}>
                Examples
                <span className="desc">{TIPS.examples}</span>
              </Button>
              <Button variant="quiet" onClick={run(() => void actions.share())}>
                Share link
                <span className="desc">
                  Puts the whole design in the address and copies the link
                </span>
              </Button>
            </section>
            <section role="group" aria-label="Settings">
              <h3>Settings</h3>
              <Button variant="quiet" onClick={run(() => onTool('montecarlo'))}>
                {toolInfo('montecarlo').label}
                <span className="desc">{toolInfo('montecarlo').description}</span>
              </Button>
              {onSettings && (
                <Button variant="quiet" onClick={run(onSettings)}>
                  Settings
                  <span className="desc">
                    Colours, line widths, labels, defaults, schematic direction
                  </span>
                </Button>
              )}
              <Button variant="quiet" onClick={() => onTheme(nextTheme(theme))}>
                Theme: {theme}
                <span className="desc">Cycles auto (follows the system), dark and light</span>
              </Button>
            </section>
            <section role="group" aria-label="Help">
              <h3>Help</h3>
              <Button variant="quiet" onClick={run(() => useHelp.getState().openHelp())}>
                Help
                <span className="desc">The user guide</span>
              </Button>
              {guideClosed && (
                <Button
                  variant="quiet"
                  onClick={run(() => {
                    useShell.getState().showGuide();
                    useShell.getState().setPane('network');
                  })}
                >
                  Show the start guide
                  <span className="desc">The three steps of a match, at the head of Network</span>
                </Button>
              )}
            </section>
          </div>
        </Sheet>
      )}
      {open === 'file' && (
        <Menu
          label="File"
          anchor={moreButton}
          className="file"
          entries={actions.fileEntries}
          onClose={() => setOpen(null)}
        />
      )}
      {open === 'examples' && (
        <Menu
          label="Examples"
          anchor={moreButton}
          className="wide examples"
          entries={actions.exampleEntries}
          onClose={() => setOpen(null)}
        />
      )}
      {actions.hosts}
    </header>
  );
}
