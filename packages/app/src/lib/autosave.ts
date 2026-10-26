import { emptyDesign, identify, type Design } from './design';
import { buildPatch, elementsOf } from './share';

/** Where the design is autosaved in the browser. */
export const DESIGN_STORAGE_KEY = 'smithonline.design.v1';

/**
 * The autosaved design, or null when there is none or it cannot be read. Its
 * elements go through the same check as a share link or a file (every field in
 * range, a microstrip's stackup normalized), so a design saved before a check
 * existed cannot bring a bad value back.
 */
export function readSavedDesign(): Design | null {
  try {
    const saved = localStorage.getItem(DESIGN_STORAGE_KEY);
    if (!saved) return null;
    const parsed = JSON.parse(saved) as Design;
    if (!parsed || !parsed.load) return null;
    const elements = elementsOf(parsed.elements);
    if (!elements) return null;
    // The build is checked as a link's is; one saved before 0.6.0 has none (lib/designBuild.ts).
    const build = buildPatch((parsed as { build?: unknown }).build);
    if (!build) return null;
    const { build: _raw, ...rest } = parsed;
    void _raw;
    // Fields added since the design was saved take their defaults.
    return { ...emptyDesign(), ...rest, elements: identify(elements), ...build };
  } catch {
    return null;
  }
}
