import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { readSavedDesign } from './lib/autosave';
import { designFromXmlsc, emptyDesign, type Design } from './lib/design';
import { EXAMPLES } from './lib/examples';
import { designFromLocation } from './lib/share';
import { useDesignStore } from './store/useDesignStore';
import { usePartLibrary } from './store/usePartLibrary';
import { initSettings, useSettings } from './store/useSettings';
import './index.css';

/**
 * Share link first, then the autosaved design, then Example 5 as a demo. A
 * share link and the demo are not new designs (the start guide stays away);
 * an autosaved one is new while its ladder is empty.
 */
function initialDesign(): { design: Design; fresh?: boolean } {
  const shared = designFromLocation(location.hash);
  if (shared) return { design: shared, fresh: false };
  const saved = readSavedDesign();
  if (saved) return { design: saved };
  const demo = EXAMPLES.find((e) => e.file === 'Example5.xmlsc');
  if (demo) {
    try {
      return { design: designFromXmlsc(demo.xml, demo.title), fresh: false };
    } catch {
      // fall through
    }
  }
  const { defaultFrequency, defaultZ0 } = useSettings.getState().settings;
  return { design: emptyDesign({ frequency: defaultFrequency, z0: defaultZ0 }), fresh: true };
}

initSettings();
// The part library is read from the browser's IndexedDB in the background.
void usePartLibrary.getState().init();
const initial = initialDesign();
useDesignStore
  .getState()
  .init(initial.design, initial.fresh === undefined ? undefined : { fresh: initial.fresh });

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
