import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { designFromXmlsc, emptyDesign, identify, type Design } from './lib/design';
import { EXAMPLES } from './lib/examples';
import { designFromLocation } from './lib/share';
import { useDesignStore } from './store/useDesignStore';
import { initSettings, useSettings } from './store/useSettings';
import './index.css';

const STORAGE_KEY = 'smithonline.design.v1';

/**
 * Share link first, then the autosaved design, then Example 5 as a demo. A
 * share link and the demo are not new designs (the start guide stays away);
 * an autosaved one is new while its ladder is empty.
 */
function initialDesign(): { design: Design; fresh?: boolean } {
  const shared = designFromLocation(location.hash);
  if (shared) return { design: shared, fresh: false };
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved) as Design;
      if (Array.isArray(parsed.elements) && parsed.load) {
        // Fields added since the design was saved take their defaults.
        return { design: { ...emptyDesign(), ...parsed, elements: identify(parsed.elements) } };
      }
    }
  } catch {
    // fall through to the demo
  }
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
    <App />
  </StrictMode>,
);
