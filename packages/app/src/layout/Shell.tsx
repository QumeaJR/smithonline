import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { PEEK_H, sheetHeights, TOP_BAR_H, useLayout, type SheetHeights } from '../lib/layout';
import type { ToolId } from '../lib/tools';
import type { View } from '../store/useDesignStore';
import { useShell } from '../store/useShell';
import { PanelSheet } from './PanelSheet';
import { SideColumn } from './SideColumn';
import { adopter, SlotHost } from './slots';

export interface ShellProps {
  readonly view: View;
  /** The header of the tablet, desktop and wide layouts. */
  readonly header: ReactNode;
  /** The phone's top bar. */
  readonly topBar: ReactNode;
  /** The main area: the chart with its controls, or the Response or S-Plot view. */
  readonly chart: ReactNode;
  /** The network panel: palette, Realize and Losses, the ladder (the left aside of a desktop). */
  readonly network: ReactNode;
  /** The numbers: datapoints, selected point, sweep, circles, two-port (the right aside). */
  readonly numbers: ReactNode;
  /** The open tool's panel, or null. */
  readonly tool: ReactNode;
  readonly toolId: ToolId | null;
  readonly onOpenTool: (id: ToolId) => void;
  readonly onCloseTool: () => void;
  /** The tour narration: the top of the left column (desktop) or the side column (tablet). */
  readonly tour?: ReactNode | undefined;
  /** Phone: a mode's banner, the header of the sheet at peek. */
  readonly banner?: ReactNode | undefined;
  /** Phone: the tour's title, step and Next for the sheet's header. */
  readonly tourHead?: ReactNode | undefined;
  /** Phone: the tour's narration in the sheet from the half detent up. */
  readonly tourBody?: ReactNode | undefined;
  /** Phone: Zin and VSWR for the live strip at the full detent. */
  readonly live?: ReactNode | undefined;
  /** The status bar of the tablet, desktop and wide layouts. */
  readonly status: ReactNode;
  /** Classes and style of the main area (the chart's own, such as v-schematic). */
  readonly mainClassName?: string | undefined;
  readonly mainStyle?: CSSProperties | undefined;
  /** Dialogs, the toast and other overlays. */
  readonly children?: ReactNode | undefined;
}

/** Room the square chart hero leaves under it besides the peek detent, px (index.css). */
const HERO_RESERVE = 96;

/** The bottom safe area inset in pixels, as CSS resolves `env(safe-area-inset-bottom)`. */
function safeBottom(): number {
  if (typeof document === 'undefined' || !document.body) return 0;
  const probe = document.createElement('div');
  probe.style.cssText =
    'position:fixed;left:0;bottom:0;width:0;visibility:hidden;pointer-events:none;height:env(safe-area-inset-bottom, 0px)';
  document.body.appendChild(probe);
  const h = probe.getBoundingClientRect().height;
  probe.remove();
  return Number.isFinite(h) && h > 0 ? h : 0;
}

/** The detents in pixels from the top bar, the chart hero as laid out and the safe area. */
function measureHeights(hero: HTMLElement | null): SheetHeights {
  const vh = typeof window === 'undefined' ? 800 : window.innerHeight;
  const vw = typeof window === 'undefined' ? 390 : window.innerWidth;
  const bar = document.querySelector('.phone-bar')?.getBoundingClientRect().bottom || TOP_BAR_H;
  const safe = safeBottom();
  const box = hero?.getBoundingClientRect();
  // Without a layout (tests, the first frame) the hero is the square of index.css under the bar.
  const square = Math.max(0, Math.min(vw, vh - bar - PEEK_H - safe - HERO_RESERVE));
  const bottom = box && box.height > 0 ? box.bottom : bar + square;
  return sheetHeights(vh, bottom, bar, safe);
}

interface Hosts {
  readonly network: SlotHost;
  readonly numbers: SlotHost;
  readonly tool: SlotHost;
  readonly tour: SlotHost;
}

/** One host per slot that moves between layouts, made once for the life of the shell. */
function useHosts(): Hosts {
  const [hosts] = useState<Hosts>(() => ({
    network: new SlotHost('network'),
    numbers: new SlotHost('numbers'),
    tool: new SlotHost('tool'),
    tour: new SlotHost('tour'),
  }));
  return hosts;
}

/**
 * The responsive shell of docs/07-interaction-redesign.md section 5. It
 * places the same slots per width: three columns with the header on a
 * desktop (network left, chart, numbers right with an open tool behind the
 * strip "Numbers | tool"); two columns on a tablet (chart, and a side column
 * Network | Numbers plus the tool); on a phone the top bar, the pinned chart
 * and the main sheet Network | Numbers | Tools. The chart never resizes when
 * a tool opens and is never covered by one.
 *
 * Every slot is rendered once at a fixed place in the tree: the chart in the
 * one main element, the dialogs after it, and the network, numbers, tool and
 * tour through portals into host nodes (layout/slots.ts) that the columns of
 * the current layout adopt. Crossing a breakpoint (a phone rotated, a window
 * resized) only moves those nodes, so a running job, typed values, the chart's
 * zoom and open dialogs survive it.
 */
export function Shell({
  view,
  header,
  topBar,
  chart,
  network,
  numbers,
  tool,
  toolId,
  onOpenTool,
  onCloseTool,
  tour,
  banner,
  tourHead,
  tourBody,
  live,
  status,
  mainClassName,
  mainStyle,
  children,
}: ShellProps) {
  const layout = useLayout();
  const phone = layout === 'phone';
  const tablet = layout === 'tablet';
  const hero = useRef<HTMLElement | null>(null);
  const hosts = useHosts();
  const leftRef = useMemo(() => adopter([hosts.tour, hosts.network]), [hosts]);
  const [heights, setHeights] = useState<SheetHeights>(() =>
    typeof document === 'undefined' ? sheetHeights(800, 480, TOP_BAR_H) : measureHeights(null),
  );

  // The half detent follows the chart hero: measured after layout and on every resize.
  useLayoutEffect(() => {
    if (!phone) return;
    const measure = (): void => {
      const next = measureHeights(view === 'chart' ? hero.current : null);
      setHeights((h) =>
        h.peek === next.peek && h.half === next.half && h.full === next.full ? h : next,
      );
      useShell.getState().setHeights(next);
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [phone, view]);

  // Response and S-Plot are pages that scroll under the top bar with the sheet at peek. The
  // page holds under its own name: back on the chart only its hold ends, a mode's stays.
  useEffect(() => {
    if (!phone || view === 'chart') return;
    useShell.getState().hold('peek', undefined, 'page');
    return () => useShell.getState().release('page');
  }, [phone, view]);

  const splot = view === 'splot';
  const appClass = `app layout-${layout} view-${view}${splot ? ' splot-mode' : ''}`;
  const toolSlot = tool === null || tool === undefined || tool === false ? null : hosts.tool;
  const mainClass = phone
    ? view === 'chart'
      ? 'chart-area phone-hero'
      : 'chart-area phone-page'
    : 'chart-area';

  // The children keep their places whatever the layout: a null holds the place of a part
  // another layout has, so React never remounts the main element, the portals or the dialogs.
  return (
    <div className={appClass}>
      {phone ? topBar : header}
      {!phone && !tablet ? (
        <aside className="left" aria-label="Network" hidden={splot} ref={leftRef} />
      ) : null}
      <main
        ref={hero}
        className={`${mainClass}${mainClassName ? ` ${mainClassName}` : ''}`}
        style={mainStyle}
      >
        {chart}
      </main>
      {phone ? (
        <PanelSheet
          heights={heights}
          network={hosts.network}
          numbers={hosts.numbers}
          tool={toolSlot}
          toolId={toolId}
          onOpenTool={onOpenTool}
          onCloseTool={onCloseTool}
          banner={banner}
          tourHead={tourHead}
          tourBody={tourBody}
          live={live}
        />
      ) : (
        <SideColumn
          layout={layout}
          top={tablet ? hosts.tour : undefined}
          network={tablet ? hosts.network : undefined}
          numbers={hosts.numbers}
          tool={toolSlot}
          toolId={toolId}
          onCloseTool={onCloseTool}
          hidden={splot}
        />
      )}
      {phone ? null : status}
      {createPortal(network, hosts.network.el, 'network')}
      {createPortal(numbers, hosts.numbers.el, 'numbers')}
      {createPortal(toolSlot ? tool : null, hosts.tool.el, 'tool')}
      {/* The phone has the tour in the sheet's header and body instead. */}
      {createPortal(phone ? null : tour, hosts.tour.el, 'tour')}
      {children}
    </div>
  );
}
