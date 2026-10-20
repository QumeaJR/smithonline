import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { designFromXmlsc, emptyDesign, identify, type Design } from './lib/design';
import { EXAMPLES } from './lib/examples';
import { designFromLocation } from './lib/share';
import { useDesignStore } from './store/useDesignStore';
import './index.css';

const STORAGE_KEY = 'smithonline.design.v1';

/** Share link first, then the autosaved design, then Example 5 as a demo. */
function initialDesign(): Design {
  const shared = designFromLocation(location.hash);
  if (shared) return shared;
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved) as Design;
      if (Array.isArray(parsed.elements) && parsed.load) {
        // Fields added since the design was saved take their defaults.
        return { ...emptyDesign(), ...parsed, elements: identify(parsed.elements) };
      }
    }
  } catch {
    // fall through to the demo
  }
  const demo = EXAMPLES.find((e) => e.file === 'Example5.xmlsc');
  if (demo) {
    try {
      return designFromXmlsc(demo.xml, demo.title);
    } catch {
      // fall through
    }
  }
  return emptyDesign();
}

useDesignStore.getState().init(initialDesign());

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root element #root not found');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
