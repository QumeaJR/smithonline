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
import {
  HALF_FLOOR,
  PEEK_H,
  sheetHeights,
  TOP_BAR_H,
  useLayout,
  type SheetHeights,
} from '../lib/layout';
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
  /** Phone, Response and S-Plot: Zin and VSWR for the live strip at the full detent. */
  readonly live?: ReactNode | undefined;
  /**
   * Phone, Chart view: the schematic strip pinned between the chart hero and the sheet, on show
   * at every detent and on every segment (lifted under the top bar at full).
   */
  readonly strip?: ReactNode | undefined;
  /** The pinned strip's height, px: PINNED_STRIP_H, or PINNED_STRIP_EMPTY_H for an empty ladder. */
  readonly stripHeight?: number | undefined;
  /** The status bar of the tablet, desktop and wide layouts. */
  readonly status: ReactNode;
  /** Classes and style of the main area (the chart's own, such as v-schematic). */
  readonly mainClassName?: string | undefined;
  readonly mainStyle?: CSSProperties | undefined;
  /** Dialogs, the toast and other overlays. */
  readonly children?: ReactNode | undefined;
}

/**
 * Room the square chart hero leaves under it besides the peek detent and the pinned strip, px
 * (index.css): the half detent's floor, so a hero limited by the height ends where the strip
 * begins and the strip ends where the half sheet begins.
 */
const HERO_RESERVE = HALF_FLOOR;

/** A CSS length in pixels as the browser resolves it, or 0 without a layout (tests). */
function probeHeight(css: string): number {
  if (typeof document === 'undefined' || !document.body) return 0;
  const probe = document.createElement('div');
  probe.style.cssText = `position:fixed;left:0;bottom:0;width:0;visibility:hidden;pointer-events:none;height:${css}`;
  document.body.appendChild(probe);
  const h = probe.getBoundingClientRect().height;
  probe.remove();
  return Number.isFinite(h) && h > 0 ? h : 0;
}

/** The bottom safe area inset in pixels, as CSS resolves `env(safe-area-inset-bottom)`. */
const safeBottom = (): number => probeHeight('env(safe-area-inset-bottom, 0px)');

/**
 * The viewport height the hero's CSS sizes itself by (100dvh: the visible height with Safari's
 * toolbars), else innerHeight. The detents and the hero then agree to the pixel.
 */
function viewportHeight(): number {
  if (typeof window === 'undefined') return 800;
  return probeHeight('100dvh') || window.innerHeight;
}

/**
 * The detents in pixels from the top bar, the chart hero and its pinned strip as laid out
 * (`stripH` high, 0 without one) and the safe area. Half starts under the strip; full under
 * the strip lifted to the top bar.
 */
function measureHeights(hero: HTMLElement | null, stripH: number): SheetHeights {
  const vh = viewportHeight();
  const vw = typeof window === 'undefined' ? 390 : window.innerWidth;
  const bar = document.querySelector('.phone-bar')?.getBoundingClientRect().bottom || TOP_BAR_H;
  const safe = safeBottom();
  const box = hero?.getBoundingClientRect();
  // Without a layout (tests, the first frame) the hero is the square of index.css under the bar.
  const square = Math.max(0, Math.min(vw, vh - bar - stripH - PEEK_H - safe - HERO_RESERVE));
  const bottom = (box && box.height > 0 ? box.bottom : bar + square) + stripH;
  const top = bar + stripH;
  return sheetHeights(vh, bottom, top, safe);
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
  strip,
  stripHeight = 0,
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
  const pinned = phone && view === 'chart' && strip !== undefined && strip !== null;
  const pinnedH = pinned ? stripHeight : 0;
  const [heights, setHeights] = useState<SheetHeights>(() =>
    typeof document === 'undefined'
      ? sheetHeights(800, 480, TOP_BAR_H)
      : measureHeights(null, pinnedH),
  );
  /** How far the pinned strip lifts at full to sit under the top bar: the hero's height, px. */
  const [lift, setLift] = useState(0);
  const detent = useShell((s) => s.detent);

  // The half detent follows the chart hero and its strip: measured after layout and on every
  // resize (Safari's toolbar coming and going resizes the visual viewport).
  useLayoutEffect(() => {
    if (!phone) return;
    const measure = (): void => {
      const box = view === 'chart' ? hero.current : null;
      const next = measureHeights(box, pinnedH);
      setHeights((h) =>
        h.peek === next.peek && h.half === next.half && h.full === next.full ? h : next,
      );
      setLift(Math.round(box?.getBoundingClientRect().height ?? 0));
      useShell.getState().setHeights(next);
    };
    measure();
    window.addEventListener('resize', measure);
    window.visualViewport?.addEventListener('resize', measure);
    return () => {
      window.removeEventListener('resize', measure);
      window.visualViewport?.removeEventListener('resize', measure);
    };
  }, [phone, view, pinnedH]);

  // The focus survives a layout change (a rotation, a resized window): the slots' nodes move to
  // other columns, which drops the focus of an element inside them. It goes back to the same
  // element where that still exists and shows, else to the main region.
  const lastFocus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const onFocusIn = (e: FocusEvent): void => {
      if (e.target instanceof HTMLElement && e.target !== document.body)
        lastFocus.current = e.target;
    };
    document.addEventListener('focusin', onFocusIn);
    return () => document.removeEventListener('focusin', onFocusIn);
  }, []);
  const layoutBefore = useRef(layout);
  useLayoutEffect(() => {
    if (layoutBefore.current === layout) return;
    layoutBefore.current = layout;
    const was = lastFocus.current;
    const active = document.activeElement;
    if (!was || (active && active !== document.body && active !== document.documentElement)) return;
    if (was.isConnected && !was.closest('[hidden], [inert]')) {
      was.focus({ preventScroll: true });
      if (document.activeElement === was) return;
    }
    hero.current?.focus({ preventScroll: true });
  }, [layout]);

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
  // The hero leaves room for the pinned strip (index.css); without one the variable is unset (0).
  const appStyle = pinned ? ({ '--pinned-strip-h': `${pinnedH}px` } as CSSProperties) : undefined;
  return (
    <div className={appClass} style={appStyle}>
      {phone ? topBar : header}
      {!phone && !tablet ? (
        <aside className="left" aria-label="Network" hidden={splot} ref={leftRef} />
      ) : null}
      <main
        ref={hero}
        tabIndex={-1}
        className={`${mainClass}${mainClassName ? ` ${mainClassName}` : ''}`}
        style={mainStyle}
      >
        {chart}
      </main>
      {pinned ? (
        <div
          className={`pinned-strip schematic-strip${detent === 'full' ? ' lifted' : ''}`}
          style={{ '--strip-lift': `${-lift}px` } as CSSProperties}
        >
          {strip}
        </div>
      ) : null}
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
          live={pinned ? null : live}
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
          onOpenTool={onOpenTool}
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
