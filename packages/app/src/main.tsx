import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import {
  autosaveHold,
  autosaveIsCurrent,
  keepReplacedAutosave,
  keepUnreadableAutosave,
  readSavedDesign,
  type KeptCopy,
} from './lib/autosave';
import { designFromXmlsc, type Design } from './lib/design';
import {
  droppedPackagesNotice,
  newDesignFromDefaults,
  openedDesign,
  ownBuild,
  startNotice,
} from './lib/designBuild';
import { EXAMPLES } from './lib/examples';
import { download } from './lib/export';
import { OPEN_BUILD_BOARD } from './lib/tourUi';
import {
  designFileOfText,
  designFromLocation,
  dropLinkFromAddressBar,
  linkOpening,
  rememberWrittenLink,
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

/** Where the backups are listed, with the way to open or save each. */
const DATA_PLACE = 'Settings, Data in this browser';

/**
 * The autosave this version cannot read is kept under a backup key before anything can write
 * over it, and the start says why it could not be opened, with a button that saves it as a
 * design file (File, Open reads it, and says why if it still cannot open it).
 */
function keepUnreadable(): void {
  const unreadable = keepUnreadableAutosave();
  if (!unreadable) return;
  noticeError = true;
  const save = (): void => {
    download(
      'smithonline-unreadable-autosave.json',
      new Blob([designFileOfText(unreadable.text)], { type: 'application/json' }),
    );
    autosaveHold.held = false;
  };
  noticeAction = { label: 'Save a copy', run: save };
  const why = `Your autosaved design could not be opened by this version: ${unreadable.problem}.`;
  notices.push(
    unreadable.key
      ? `${why} It is kept in this browser (${DATA_PLACE}), and Save a copy saves it as a file.`
      : unreadable.full
        ? `${why} The five backups in this browser are all in use, so autosave is paused until you Save a copy as a file (or clear a backup in ${DATA_PLACE}).`
        : `${why} This browser has no room to keep a copy, so autosave is paused until you Save a copy as a file.`,
  );
}

/**
 * What became of the design a link replaced, after "Opened ... from the link.": kept under a
 * backup key of its own (Settings opens it again), or why not; Undo brings it back either way.
 */
function replacedWords(previous: string, kept: KeptCopy | null): string {
  if (kept?.key) {
    return `Your previous design "${previous}" is kept in this browser: Undo brings it back now, and ${DATA_PLACE}, opens it later.`;
  }
  const why = kept?.full
    ? `the backups in this browser are all in use (clear one in ${DATA_PLACE})`
    : 'this browser has no room to keep a copy';
  return `Undo brings back your previous design "${previous}"; ${why}, so save it as a file before you close the tab.`;
}

/** The design as it evaluates, without the ids and colours each opening gives its elements. */
function contentOf(design: Design): string {
  const own = ownBuild(design);
  return JSON.stringify({
    ...own,
    elements: own.elements.map((el) => {
      const { id: _id, color: _color, ...rest } = el;
      void _id;
      void _color;
      return rest;
    }),
  });
}

/** True when two designs hold the same content (a link opened over itself). */
function sameDesign(a: Design, b: Design): boolean {
  return contentOf(a) === contentOf(b);
}

/**
 * The link stays in the address bar until the autosave holds its design (App.tsx), so a
 * reload before that, or while the autosave cannot write, opens it again rather than losing
 * it. Once saved it leaves, and a reload opens the autosave with the work done since.
 */
function holdLinkUntilSaved(hash: string): void {
  rememberWrittenLink(hash);
  linkOpening.dropWhenSaved = true;
}

/**
 * A share link first (as a step after the autosaved design, so Undo brings that back, and the
 * autosave kept under a backup key), then the autosaved design, then Example 5 as a demo. A
 * share link and the demo are not new designs (the start guide stays away); an autosaved one
 * is new while its ladder is empty.
 */
function start(): void {
  const store = useDesignStore.getState();
  const hash = location.hash;
  const isLink = hash.startsWith('#d=');
  // A link this tab put in the address bar itself (Share without a clipboard, or a link not yet
  // autosaved) is skipped when the autosave holds that design or newer. While the autosave could
  // not write (paused, storage full), the link is the only copy of the work: it opens.
  const skip = isLink && wroteThisLink(hash) && autosaveIsCurrent();
  const shared = isLink && !skip ? designFromLocation(hash) : null;
  const linkRefused = isLink && !skip && !shared;
  if (shared) holdLinkUntilSaved(hash);
  else dropLinkFromAddressBar();
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
    const opening = `Opened "${opened.design.name}" from the link.`;
    // The autosave is kept under a backup key before the link's design is autosaved over it,
    // unless it holds the link's design already.
    const same = saved !== null && sameDesign(saved, opened.design);
    if (saved && !same) {
      const kept = keepReplacedAutosave();
      store.loadDesign(opened.design, `Opened "${opened.design.name}" from the link`);
      noticeUndo = true;
      notices.unshift(`${opening} ${replacedWords(saved.name, kept)}`);
    } else {
      store.init(opened.design, { fresh: false });
      notices.unshift(opening);
    }
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

/**
 * A link pasted into the address bar of the running application opens as an undoable step,
 * with the design it replaces kept under a backup key, as at the start.
 */
function openPastedLink(): void {
  const hash = location.hash;
  if (!hash.startsWith('#d=')) return;
  const store = useDesignStore.getState();
  const shared = designFromLocation(hash);
  if (!shared) {
    dropLinkFromAddressBar();
    store.setMessage(
      'The link in the address bar is not a Smith Online design; it was not opened.',
      { error: true },
    );
    return;
  }
  const previous = store.design.name;
  const opened = openedDesign(shared);
  if (sameDesign(store.design, opened.design)) {
    dropLinkFromAddressBar();
    store.setMessage(`"${opened.design.name}" from the link is the design on show already.`);
    return;
  }
  const kept = keepReplacedAutosave();
  holdLinkUntilSaved(hash);
  linkOpening.pending = true;
  store.loadDesign(opened.design, `Opened "${opened.design.name}" from the link`);
  store.setMessage(
    `Opened "${opened.design.name}" from the link. ${replacedWords(previous, kept)}${
      opened.notice ? ` ${opened.notice}` : ''
    }`,
    { undo: true, ...(opened.notice ? { action: OPEN_BUILD_BOARD } : {}) },
  );
}

initSettings();
// The package defaults are read with the stores above; numbers out of range were set back.
void usePackages.getState();
const dropped = droppedPackagesNotice(packagesDropped.list);
if (dropped) notices.push(dropped);
// The part library is read from the browser's IndexedDB in the background.
void usePartLibrary.getState().init();
start();
window.addEventListener('hashchange', openPastedLink);
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
