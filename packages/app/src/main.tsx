import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { readSavedDesign } from './lib/autosave';
import { designFromXmlsc, type Design } from './lib/design';
import { newDesignFromDefaults, openedDesign, startNotice } from './lib/designBuild';
import { EXAMPLES } from './lib/examples';
import { designFromLocation, linkOpening } from './lib/share';
import { useDesignStore } from './store/useDesignStore';
import { usePartLibrary } from './store/usePartLibrary';
import { initSettings, useSettings } from './store/useSettings';
import './index.css';

/**
 * Share link first, then the autosaved design, then Example 5 as a demo. A
 * share link and the demo are not new designs (the start guide stays away);
 * an autosaved one is new while its ladder is empty.
 */
function initialDesign(): { design: Design; fresh?: boolean; notice?: string } {
  // A link or an autosave from before 0.6.0 takes this browser's defaults for its build.
  const shared = designFromLocation(location.hash);
  if (shared) {
    linkOpening.pending = true;
    const opened = openedDesign(shared);
    return { design: opened.design, fresh: false, ...noticeOf(opened.notice) };
  }
  const saved = readSavedDesign();
  if (saved) {
    const opened = openedDesign(saved);
    return { design: opened.design, ...noticeOf(opened.notice) };
  }
  const demo = EXAMPLES.find((e) => e.file === 'Example5.xmlsc');
  if (demo) {
    try {
      return { design: designFromXmlsc(demo.xml, demo.title), fresh: false };
    } catch {
      // fall through
    }
  }
  return { design: newDesignFromDefaults(), fresh: true };
}

function noticeOf(notice: string | null): { notice?: string } {
  return notice ? { notice } : {};
}

initSettings();
// The part library is read from the browser's IndexedDB in the background.
void usePartLibrary.getState().init();
const initial = initialDesign();
useDesignStore
  .getState()
  .init(initial.design, initial.fresh === undefined ? undefined : { fresh: initial.fresh });
// The chart starts with the grid options of Settings, Appearance.
useDesignStore.getState().setChart(useSettings.getState().settings.chart);
// Said once the application is on screen (App.tsx), so the phone's toast shows it as well.
startNotice.text = initial.notice ?? null;

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
