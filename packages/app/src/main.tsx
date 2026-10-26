import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { autosaveHold, keepUnreadableAutosave, readSavedDesign } from './lib/autosave';
import { designFromXmlsc, type Design } from './lib/design';
import {
  droppedPackagesNotice,
  newDesignFromDefaults,
  openedDesign,
  startNotice,
} from './lib/designBuild';
import { EXAMPLES } from './lib/examples';
import { download } from './lib/export';
import { OPEN_BUILD_BOARD } from './lib/tourUi';
import {
  designFromLocation,
  dropLinkFromAddressBar,
  linkOpening,
  wroteThisLink,
} from './lib/share';
import { useDesignStore } from './store/useDesignStore';
import { usePackages, packagesDropped } from './store/usePackages';
import { usePartLibrary } from './store/usePartLibrary';
import { initSettings, useSettings } from './store/useSettings';
import './index.css';

/** What the start says once the application is on screen, in order. */
const notices: string[] = [];
let noticeError = false;
let noticeUndo = false;
let noticeAction: (typeof startNotice)['action'];

/**
 * The autosave this version cannot read is kept under a backup key before anything can write
 * over it, and the start says so with a button that saves a copy as a file.
 */
function keepUnreadable(): void {
  const unreadable = keepUnreadableAutosave();
  if (!unreadable) return;
  noticeError = true;
  const save = (): void => {
    download(
      'smithonline-unreadable-autosave.json',
      new Blob([unreadable.text], { type: 'application/json' }),
    );
    autosaveHold.held = false;
  };
  noticeAction = { label: 'Save a copy', run: save };
  notices.push(
    unreadable.key
      ? `Your autosaved design could not be opened by this version; it is kept in this browser (${unreadable.key}), and Save a copy saves it as a file.`
      : 'Your autosaved design could not be opened by this version, and this browser has no room to keep a copy: autosave is paused until you Save a copy as a file.',
  );
}

/**
 * A share link first (as a step after the autosaved design, so Undo brings that back), then the
 * autosaved design, then Example 5 as a demo. A share link and the demo are not new designs (the
 * start guide stays away); an autosaved one is new while its ladder is empty. The link leaves
 * the address bar once it is read, so a reload opens the autosave with the work done since.
 */
function start(): void {
  const store = useDesignStore.getState();
  const hash = location.hash;
  // A link this tab put in the address bar itself (Share without a clipboard) is not opened
  // again on a reload: the autosave is newer.
  const shared = wroteThisLink(hash) ? null : designFromLocation(hash);
  const linkRefused = hash.startsWith('#d=') && !shared && !wroteThisLink(hash);
  dropLinkFromAddressBar();
  const saved = readSavedDesign();
  if (!saved) keepUnreadable();
  if (saved) {
    // A link or an autosave from before 0.6.0 takes this browser's defaults for its build.
    const opened = openedDesign(saved);
    store.init(opened.design);
    if (!shared && opened.notice) {
      notices.push(opened.notice);
      noticeAction ??= OPEN_BUILD_BOARD;
    }
  } else if (!shared) {
    const demo = EXAMPLES.find((e) => e.file === 'Example5.xmlsc');
    let design: Design | null;
    try {
      design = demo ? designFromXmlsc(demo.xml, demo.title) : null;
    } catch {
      design = null;
    }
    if (design) store.init(design, { fresh: false });
    else store.init(newDesignFromDefaults(), { fresh: true });
  }
  if (shared) {
    linkOpening.pending = true;
    const opened = openedDesign(shared);
    const said = saved
      ? `Opened "${opened.design.name}" from the link. Undo brings back your previous design.`
      : `Opened "${opened.design.name}" from the link.`;
    if (saved) {
      store.loadDesign(opened.design, `Opened "${opened.design.name}" from the link`);
      noticeUndo = true;
    } else {
      store.init(opened.design, { fresh: false });
    }
    notices.unshift(said);
    if (opened.notice) {
      notices.push(opened.notice);
      noticeAction ??= OPEN_BUILD_BOARD;
    }
  }
  if (linkRefused) {
    noticeError = true;
    notices.unshift('The link in the address bar is not a Smith Online design; it was not opened.');
  }
}

initSettings();
// The package defaults are read with the stores above; numbers out of range were set back.
void usePackages.getState();
const dropped = droppedPackagesNotice(packagesDropped.list);
if (dropped) notices.push(dropped);
// The part library is read from the browser's IndexedDB in the background.
void usePartLibrary.getState().init();
start();
// The chart starts with the grid options of Settings, Appearance.
useDesignStore.getState().setChart(useSettings.getState().settings.chart);
// Said once the application is on screen (App.tsx), so the phone's toast shows it as well.
startNotice.text = notices.length > 0 ? notices.join(' ') : null;
startNotice.error = noticeError;
startNotice.undo = noticeUndo;
startNotice.action = noticeAction;

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root element #root not found');
}

createRoot(container).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
