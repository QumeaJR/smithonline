/**
 * Where the focus goes when the control that had it goes away with the content around it (a
 * stale note's Run again, the empty network's Auto match): the first control of the panel
 * on show, never the page body.
 */
const CONTROLS =
  'input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** The first control inside `root` that is not hidden, leaving out the sheet's own head. */
export function firstControl(root: Element | null): HTMLElement | null {
  if (!root) return null;
  for (const el of root.querySelectorAll<HTMLElement>(CONTROLS)) {
    if (el.closest('[hidden], .pushed-head')) continue;
    return el;
  }
  return null;
}

/** The tool panel on show: the pane of the side column, or the panel pushed into the sheet. */
function toolRoot(): Element | null {
  for (const el of document.querySelectorAll('.pushed-tool, .pane-tool')) {
    if (!el.closest('[hidden]')) return el;
  }
  return null;
}

/**
 * Move the focus to the first control of `root` once the change has rendered; without a
 * root, to the first control of the tool panel on show. A control that kept the focus keeps
 * it, unless `force` (a button that opened the panel to work in).
 */
export function focusPanelSoon(root?: Element | null, force = false): void {
  setTimeout(() => {
    const active = document.activeElement;
    if (!force && active && active !== document.body && active.isConnected) return;
    const target = firstControl(root && root.isConnected ? root : toolRoot());
    target?.focus({ preventScroll: true });
  }, 0);
}
