import { useLayoutEffect, useRef } from 'react';
import { TourPanel } from './TourPanel';

/**
 * The tour's head on top of the File sheet and full-screen dialogs (the part library, the import
 * dialog), which cover the bottom sheet's head. Its height (it grows when its buttons wrap below
 * the title) is published as --tour-head-h, so a full-screen dialog starts below it and keeps its
 * title and Done in reach (D6 QA round 3).
 */
export function TourOverlayHead() {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    const root = document.documentElement;
    if (!el) return undefined;
    const publish = (): void => root.style.setProperty('--tour-head-h', `${el.offsetHeight}px`);
    publish();
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(publish) : null;
    ro?.observe(el);
    return () => {
      ro?.disconnect();
      root.style.removeProperty('--tour-head-h');
    };
  }, []);
  return (
    <div className="tour-overlay-head" data-keeps-overlays="" ref={ref}>
      <TourPanel mode="head" overlay />
    </div>
  );
}
