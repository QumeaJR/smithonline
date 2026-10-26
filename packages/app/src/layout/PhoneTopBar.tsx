import { useRef, useState } from 'react';
import {
  EXPORT_SECTION,
  useFileShortcuts,
  useHeaderActions,
  type HeaderProps,
} from '../components/Header';
import { nextTheme, themeName } from '../lib/theme';
import { Button, IconButton } from '../components/ui/Button';
import { IconMenu, IconRedo, IconUndo } from '../components/ui/icons';
import { Menu } from '../components/ui/Menu';
import { Segmented } from '../components/ui/Segmented';
import { Sheet } from '../components/ui/Sheet';
import { TIPS } from '../lib/tips';
import { useDesignStore } from '../store/useDesignStore';
import { useHelp } from '../store/useHelp';
import { usePartLibrary } from '../store/usePartLibrary';
import { useShell } from '../store/useShell';

type Open = 'more' | 'file' | 'learn' | null;

/**
 * The phone's top bar (docs/07 section 5): 44 px plus the safe area, with
 * More (a sheet with the header's groups: Data; Settings; Help with Learn), the view
 * segmented control with short labels, and Undo and Redo as icon buttons.
 */
export function PhoneTopBar(props: HeaderProps) {
  const { theme, onTheme, onSettings } = props;
  const view = useDesignStore((s) => s.view);
  const setView = useDesignStore((s) => s.setView);
  const canUndo = useDesignStore((s) => s.past.length > 0);
  const canRedo = useDesignStore((s) => s.future.length > 0);
  const guideClosed = useShell((s) => s.guideClosed);
  const { undo, redo } = useDesignStore.getState();
  const [open, setOpen] = useState<Open>(null);
  /** The File menu opened by Ctrl+E (a hardware keyboard): it opens at its Export section. */
  const [atExport, setAtExport] = useState(false);
  /** The File menu opened by a workflow step: at Export, the focus left where it is. */
  const [quietMenu, setQuietMenu] = useState(false);
  /** The Learn menu opened at a section (the start guide's More opens it at Workflows). */
  const [learnAt, setLearnAt] = useState<string | undefined>(undefined);
  const moreButton = useRef<HTMLButtonElement>(null);
  const actions = useHeaderActions(props, () => setOpen(null));
  useFileShortcuts(
    actions,
    (quiet) => {
      actions.closeImport();
      setAtExport(true);
      setQuietMenu(quiet === true);
      setOpen('file');
    },
    (section) => {
      actions.closeImport();
      setLearnAt(section);
      setOpen('learn');
    },
    () => setOpen(null),
  );
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
        title="File, share link, settings, Learn and help"
        data-tour="header.more header.file header.learn"
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
          { value: 'chart', label: 'Chart', title: TIPS.tabChart, tour: 'view.chart' },
          { value: 'response', label: 'Response', title: TIPS.tabResponse, tour: 'view.response' },
          { value: 'splot', label: 'S-Plot', title: TIPS.tabSplot, tour: 'view.splot' },
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
              <Button
                variant="quiet"
                onClick={() => {
                  setAtExport(false);
                  setQuietMenu(false);
                  setOpen('file');
                }}
              >
                File
                <span className="desc">New, open, save and export</span>
              </Button>
              <Button variant="quiet" onClick={run(() => usePartLibrary.getState().setOpen(true))}>
                Part library
                <span className="desc">Real parts from the manufacturers&apos; .s2p files</span>
              </Button>
              <Button variant="quiet" onClick={run(() => void actions.share())}>
                Share link
                <span className="desc">Copies a link that holds the whole design</span>
              </Button>
            </section>
            <section role="group" aria-label="Settings">
              <h3>Settings</h3>
              {onSettings && (
                <Button variant="quiet" onClick={run(onSettings)}>
                  Settings
                  <span className="desc">{TIPS.settings}</span>
                </Button>
              )}
              <Button variant="quiet" onClick={() => onTheme(nextTheme(theme))}>
                Theme: {themeName(theme)}
                <span className="desc">Cycles auto (follows the system), dark and light</span>
              </Button>
            </section>
            <section role="group" aria-label="Help">
              <h3>Help</h3>
              <Button
                variant="quiet"
                onClick={() => {
                  setLearnAt(undefined);
                  setOpen('learn');
                }}
              >
                Learn
                <span className="desc">{TIPS.learn}</span>
              </Button>
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
              <Button
                variant="quiet"
                onClick={run(() => {
                  window.open('./licenses.txt', '_blank', 'noopener');
                })}
              >
                Licences
                <span className="desc">Smith Online is open source (MIT); third-party notices</span>
              </Button>
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
          focusSection={atExport ? EXPORT_SECTION : undefined}
          quietFocus={quietMenu}
          onClose={() => setOpen(null)}
        />
      )}
      {open === 'learn' && (
        <Menu
          label="Learn"
          anchor={moreButton}
          className="wide examples learn"
          entries={actions.learnEntries}
          focusSection={learnAt}
          onClose={() => setOpen(null)}
        />
      )}
      {actions.hosts}
    </header>
  );
}
