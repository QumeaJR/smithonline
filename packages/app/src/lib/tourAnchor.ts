/** How long a step's prepare has to bring its anchor up before the fallback text shows, ms. */
export const ANCHOR_WAIT_MS = 300;

/** The attribute selector of a workflow anchor (anchor ids are words, dots and dashes). */
export function anchorSelector(id: string): string {
  return `[data-tour~="${id.replace(/["\\\]]/g, '')}"]`;
}

/**
 * The anchor of a step on screen: in the document, not inside a hidden pane and not made
 * invisible (the phone's sheet at peek hides its body with visibility), so the fallback shows.
 */
export function findAnchor(id: string): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  const all = document.querySelectorAll<HTMLElement>(anchorSelector(id));
  for (const el of all) {
    if (el.closest('[hidden], [inert]')) continue;
    if (getComputedStyle(el).visibility === 'hidden') continue;
    return el;
  }
  return null;
}
