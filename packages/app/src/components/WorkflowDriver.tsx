import { useEffect } from 'react';
import { isTextEditing } from '../lib/helpKey';
import { ANCHOR_WAIT_MS, anchorSelector, findAnchor } from '../lib/tourAnchor';
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
    const check = (): void => {
      frame = 0;
      const el = findAnchor(anchor);
      if (el) {
        setMissing(false);
        if (el !== shown) {
          shown = el;
          // Never pull a field being typed in out of view, and never take the focus.
          const active = document.activeElement as HTMLElement | null;
          if (!isTextEditing(active) || active === el) {
            el.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
          }
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
      if (frame === 0) frame = requestAnimationFrame(check);
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['hidden', 'data-tour', 'inert'],
    });
    return () => {
      clearTimeout(timer);
      cancelAnimationFrame(first);
      if (frame !== 0) cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [tour, step, anchor]);

  if (!anchor) return null;
  const selector = anchorSelector(anchor);
  return (
    <style>{`${selector}{outline:2px solid var(--accent);outline-offset:2px;box-shadow:0 0 0 6px var(--accent-soft);border-radius:var(--radius-sm);animation:tour-anchor-pulse 600ms var(--ease-std) 1;}`}</style>
  );
}
