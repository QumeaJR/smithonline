import { useEffect } from 'react';
import { isTextEditing } from '../lib/helpKey';
import { ANCHOR_WAIT_MS, anchorSelector, findAnchor } from '../lib/tourAnchor';

/**
 * Scroll `box` so `el` lies in its visible part, with a margin; the page does not move. The
 * margins are the anchor's scroll-margin where it has one (index.css: clear of the sticky head
 * of a pushed page, Build or a tool, and of the sheet's foot).
 */
function revealIn(box: HTMLElement, el: HTMLElement, margin = 16): void {
  const style = getComputedStyle(el);
  const above = parseFloat(style.scrollMarginTop) || margin;
  const below = parseFloat(style.scrollMarginBottom) || margin;
  const top = el.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop;
  const bottom = top + el.offsetHeight;
  if (top < box.scrollTop + above) box.scrollTop = Math.max(0, top - above);
  else if (bottom > box.scrollTop + box.clientHeight - below) {
    box.scrollTop = bottom - box.clientHeight + below;
  }
  // The workflow's narration above the anchor (the phone's sheet) is never left cut to a
  // sliver of Back and Next: it shows whole where the anchor still fits below it, else it
  // scrolls out of sight (the sheet's head keeps the step's title and Next).
  const panel = box.querySelector<HTMLElement>('.tour-panel');
  if (!panel || panel.contains(el)) return;
  const panelTop =
    panel.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop;
  const panelBottom = panelTop + panel.offsetHeight;
  if (!(box.scrollTop > panelTop && box.scrollTop < panelBottom)) return;
  if (bottom <= panelTop + box.clientHeight - 4) box.scrollTop = Math.max(0, panelTop);
  else box.scrollTop = panelBottom;
}

/** The nearest ancestor of `el` that scrolls its content vertically, or null. */
function scrollBox(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const y = getComputedStyle(p).overflowY;
    if ((y === 'auto' || y === 'scroll') && p.scrollHeight > p.clientHeight) return p;
  }
  return null;
}

/** How long a sheet or dialog takes to slide in (--dur-slow and a margin), ms. */
const ANCHOR_SETTLE_MS = 450;
import { isWorkflow, useTourStore, workflowSteps } from '../store/useTourStore';

/**
 * Points at the anchor of the running workflow's step (docs/09 section 3.0):
 * a 2 px accent outline with a soft halo and one short pulse (none under
 * reduced motion), scrolled into view without taking the focus or moving a
 * field being typed in. Nothing is covered or blocked. When the anchor is
 * not on screen ANCHOR_WAIT_MS after the step came on show, the panel says
 * where to go and its button brings the place up; the anchor is looked for
 * again whenever the page changes.
 *
 * The highlight is a rule on the anchor's attribute rather than a class put
 * on the element, so a re-render of the element can never drop it.
 */
export function WorkflowDriver() {
  const tour = useTourStore((s) => s.tour);
  const step = useTourStore((s) => s.step);
  const current = isWorkflow(tour) ? workflowSteps(tour)[step] : undefined;
  const anchor = current?.anchor;

  useEffect(() => {
    const { setMissing } = useTourStore.getState();
    if (!anchor) {
      setMissing(false);
      return;
    }
    let waited = false;
    let shown: HTMLElement | null = null;
    let frame = 0;
    let fallback: ReturnType<typeof setTimeout> | null = null;
    let settle: ReturnType<typeof setTimeout> | null = null;
    let late: ReturnType<typeof setTimeout> | null = null;
    /** Scroll the anchor into view, unless that would pull a field being typed in away. */
    const reveal = (el: HTMLElement): void => {
      const active = document.activeElement as HTMLElement | null;
      if (isTextEditing(active) && active !== el) return;
      // Inside a sheet or a dialog the anchor is scrolled into its own list, measured against
      // the list, so a sheet still sliding in does not throw the measure off.
      const box = el.closest('.sheet, .modal, .panel-sheet') ? scrollBox(el) : null;
      if (box) revealIn(box, el);
      else el.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    };
    const check = (): void => {
      frame = 0;
      const el = findAnchor(anchor);
      if (el) {
        setMissing(false);
        if (el !== shown) {
          shown = el;
          // Never pull a field being typed in out of view, and never take the focus.
          reveal(el);
          // An anchor in a sheet or dialog that is still sliding in measured as on screen: once
          // it has settled, it is scrolled into its sheet's view again.
          // The phone's panel sheet can still be rising then: once more after twice the time.
          if (settle !== null) clearTimeout(settle);
          if (late !== null) clearTimeout(late);
          settle = setTimeout(() => {
            settle = null;
            if (shown === el && el.isConnected) reveal(el);
          }, ANCHOR_SETTLE_MS);
          late = setTimeout(() => {
            late = null;
            if (shown === el && el.isConnected) reveal(el);
          }, 2 * ANCHOR_SETTLE_MS);
        }
      } else {
        shown = null;
        if (waited) setMissing(true);
      }
    };
    const timer = setTimeout(() => {
      waited = true;
      check();
    }, ANCHOR_WAIT_MS);
    // The step's prepare renders with the next commit; look again after it.
    const first = requestAnimationFrame(check);
    const observer = new MutationObserver(() => {
      if (frame !== 0) return;
      frame = requestAnimationFrame(check);
      // A page drawn in the background runs no frames: the check comes by a timer as well.
      if (fallback !== null) clearTimeout(fallback);
      fallback = setTimeout(() => {
        fallback = null;
        if (frame !== 0) {
          cancelAnimationFrame(frame);
          check();
        }
      }, 100);
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['hidden', 'data-tour', 'inert', 'class'],
    });
    return () => {
      clearTimeout(timer);
      if (settle !== null) clearTimeout(settle);
      if (late !== null) clearTimeout(late);
      cancelAnimationFrame(first);
      if (frame !== 0) cancelAnimationFrame(frame);
      if (fallback !== null) clearTimeout(fallback);
      observer.disconnect();
    };
  }, [tour, step, anchor]);

  if (!anchor) return null;
  const selector = anchorSelector(anchor);
  return (
    <style>{`${selector}{outline:2px solid var(--accent);outline-offset:2px;box-shadow:0 0 0 6px var(--accent-soft);border-radius:var(--radius-sm);animation:tour-anchor-pulse 600ms var(--ease-std) 1;}`}</style>
  );
}
