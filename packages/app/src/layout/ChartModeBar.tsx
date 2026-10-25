import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { bannerSpots, placeBanner, type BannerSpot, type Box } from '../lib/bannerPlace';

export interface ChartModeBarProps {
  /** The mode's banner (an armed part, datapoint input). */
  readonly children: ReactNode;
  /** Changes when the banner's text changes (another part armed): it is measured again. */
  readonly contentKey: string;
  readonly svgRef: RefObject<SVGSVGElement | null>;
  readonly toolbarRef: RefObject<HTMLElement | null>;
}

type Place =
  | {
      readonly kind: 'chart';
      readonly spot: BannerSpot;
      readonly left: number;
      readonly top: number;
      readonly maxWidth: number;
    }
  | {
      readonly kind: 'status';
      readonly left: number;
      readonly top: number;
      readonly width: number;
      readonly height: number;
    };

const boxOf = (r: DOMRect): Box => ({
  left: r.left,
  top: r.top,
  width: r.width,
  height: r.height,
});

/** The banner's size at `maxWidth`, from a hidden copy (React's own node keeps its styles). */
function measureAt(el: HTMLElement, maxWidth: number): { width: number; height: number } {
  const probe = el.cloneNode(true) as HTMLElement;
  probe.removeAttribute('id');
  probe.setAttribute('aria-hidden', 'true');
  probe.style.cssText = `position:absolute;left:0;top:0;right:auto;visibility:hidden;pointer-events:none;max-width:${maxWidth}px`;
  el.parentElement?.appendChild(probe);
  const r = probe.getBoundingClientRect();
  probe.remove();
  return { width: Math.ceil(r.width), height: Math.ceil(r.height) };
}

/**
 * A mode's banner on a tablet or desktop chart (docs/07 section 5). It is
 * placed by measurement: the disc and its rim labels are read from the chart,
 * and the banner goes to the first corner of the chart's margin where it
 * clears them and the toolbar, at its full width or wrapped to two lines.
 * When no corner is free (a short window, a zoomed chart) it lies over the
 * status bar under the chart column instead. It never resizes the chart.
 */
export function ChartModeBar({ children, contentKey, svgRef, toolbarRef }: ChartModeBarProps) {
  const bar = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<Place | null>(null);

  useLayoutEffect(() => {
    const el = bar.current;
    const svg = svgRef.current;
    const area = el?.parentElement;
    if (!el || !svg || !area) return;
    const measure = (): void => {
      const a = area.getBoundingClientRect();
      const s = svg.getBoundingClientRect();
      const rim = svg.querySelector('.chart-rim')?.getBoundingClientRect();
      // No layout (a test without a renderer): the stylesheet's place under the toolbar stays.
      if (!rim || !(rim.width > 0) || !(a.width > 0) || !(s.width > 0)) {
        setPlace(null);
        return;
      }
      const disc = { cx: rim.left + rim.width / 2, cy: rim.top + rim.height / 2, r: rim.width / 2 };
      const tb = toolbarRef.current?.getBoundingClientRect();
      const toolbar = tb && tb.width > 0 ? boxOf(tb) : null;
      const obstacles: Box[] = [...svg.querySelectorAll('.grid-labels text')]
        .map((t) => boxOf(t.getBoundingClientRect()))
        .filter((b) => b.width > 0);
      if (toolbar) obstacles.push(toolbar);
      // The chart's part of the column: down to the bottom of the drawn chart, not the strip.
      const region: Box = {
        left: a.left,
        top: a.top,
        width: a.width,
        height: Math.max(0, Math.min(a.bottom, s.bottom + 10) - a.top),
      };
      // Full width, then wrapped to two lines, then narrow enough for the band beside the disc.
      for (const maxWidth of [region.width - 28, 300, 220, 160]) {
        if (!(maxWidth > 120)) continue;
        const size = measureAt(el, maxWidth);
        const found = placeBanner(bannerSpots(region, size, toolbar), region, disc, obstacles);
        if (found) {
          const next: Place = {
            kind: 'chart',
            spot: found.spot,
            left: Math.round(found.box.left - a.left),
            top: Math.round(found.box.top - a.top),
            maxWidth,
          };
          setPlace((p) =>
            p?.kind === 'chart' &&
            p.spot === next.spot &&
            p.left === next.left &&
            p.top === next.top &&
            p.maxWidth === next.maxWidth
              ? p
              : next,
          );
          return;
        }
      }
      const status = document.querySelector('.statusbar')?.getBoundingClientRect();
      if (!status || !(status.height > 0)) {
        setPlace(null);
        return;
      }
      const next: Place = {
        kind: 'status',
        left: Math.round(a.left),
        top: Math.round(status.top),
        width: Math.round(a.width),
        height: Math.round(status.height),
      };
      setPlace((p) =>
        p?.kind === 'status' &&
        p.left === next.left &&
        p.top === next.top &&
        p.width === next.width &&
        p.height === next.height
          ? p
          : next,
      );
    };
    measure();
    window.addEventListener('resize', measure);
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    resize?.observe(area);
    if (toolbarRef.current) resize?.observe(toolbarRef.current);
    // A zoom or pan moves the disc; the grid options change the labels.
    const mutation =
      typeof MutationObserver === 'undefined' ? null : new MutationObserver(() => measure());
    mutation?.observe(svg, { attributes: true, attributeFilter: ['viewBox'] });
    const labels = svg.querySelector('.grid-labels');
    if (labels) mutation?.observe(labels, { childList: true });
    return () => {
      window.removeEventListener('resize', measure);
      resize?.disconnect();
      mutation?.disconnect();
    };
  }, [svgRef, toolbarRef, contentKey]);

  const inStatus = place?.kind === 'status';
  return (
    <>
      <div
        ref={bar}
        className={`chart-mode-bar${place?.kind === 'chart' ? ` at-${place.spot}` : ''}`}
        data-place={place ? (place.kind === 'chart' ? place.spot : 'status') : 'default'}
        style={
          place?.kind === 'chart'
            ? { top: place.top, left: place.left, right: 'auto', maxWidth: place.maxWidth }
            : inStatus
              ? { visibility: 'hidden' }
              : undefined
        }
        aria-hidden={inStatus || undefined}
        inert={inStatus || undefined}
      >
        {children}
      </div>
      {place?.kind === 'status' &&
        createPortal(
          <div
            className="chart-mode-bar in-status"
            data-place="status"
            style={{
              position: 'fixed',
              left: place.left,
              top: place.top,
              width: place.width,
              height: place.height,
              maxWidth: 'none',
            }}
          >
            {children}
          </div>,
          document.body,
        )}
    </>
  );
}
