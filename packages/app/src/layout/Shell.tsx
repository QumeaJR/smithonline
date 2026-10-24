import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { sheetHeights, TOP_BAR_H, useLayout, type SheetHeights } from '../lib/layout';
import type { ToolId } from '../lib/tools';
import type { View } from '../store/useDesignStore';
import { useShell } from '../store/useShell';
import { PanelSheet } from './PanelSheet';
import { SideColumn } from './SideColumn';

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

/** The detents in pixels from the top bar and the chart hero as laid out. */
function measureHeights(hero: HTMLElement | null): SheetHeights {
  const vh = typeof window === 'undefined' ? 800 : window.innerHeight;
  const vw = typeof window === 'undefined' ? 390 : window.innerWidth;
  const bar = document.querySelector('.phone-bar')?.getBoundingClientRect().bottom || TOP_BAR_H;
  const box = hero?.getBoundingClientRect();
  // Without a layout (tests, the first frame) the square hero sits under the bar.
  const bottom = box && box.height > 0 ? box.bottom : bar + Math.min(vw, vh * 0.55);
  return sheetHeights(vh, bottom, bar);
}

/**
 * The responsive shell of docs/07-interaction-redesign.md section 5. It
 * places the same slots per width: three columns with the header on a
 * desktop (network left, chart, numbers right with an open tool behind the
 * strip "Numbers | tool"); two columns on a tablet (chart, and a side column
 * Network | Numbers plus the tool); on a phone the top bar, the pinned chart
 * and the main sheet Network | Numbers | Tools. The chart never resizes when
 * a tool opens and is never covered by one.
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
  const hero = useRef<HTMLElement | null>(null);
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
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [phone, view]);

  // Response and S-Plot are pages that scroll under the top bar with the sheet at peek.
  useEffect(() => {
    if (!phone) return;
    const shell = useShell.getState();
    if (view !== 'chart') shell.hold('peek');
    else shell.release();
  }, [phone, view]);

  const splot = view === 'splot';
  const appClass = `app layout-${layout} view-${view}${splot ? ' splot-mode' : ''}`;

  if (phone) {
    return (
      <div className={appClass}>
        {topBar}
        <main
          ref={hero}
          className={`${view === 'chart' ? 'chart-area phone-hero' : 'chart-area phone-page'}${mainClassName ? ` ${mainClassName}` : ''}`}
          style={mainStyle}
        >
          {chart}
        </main>
        <PanelSheet
          heights={heights}
          network={network}
          numbers={numbers}
          tool={tool}
          toolId={toolId}
          onOpenTool={onOpenTool}
          onCloseTool={onCloseTool}
          banner={banner}
          tourHead={tourHead}
          tourBody={tourBody}
          live={live}
        />
        {children}
      </div>
    );
  }

  const tablet = layout === 'tablet';
  return (
    <div className={appClass}>
      {header}
      {!tablet && (
        <aside className="left" aria-label="Network" hidden={splot}>
          {tour}
          {network}
        </aside>
      )}
      <main
        ref={hero}
        className={`chart-area${mainClassName ? ` ${mainClassName}` : ''}`}
        style={mainStyle}
      >
        {chart}
      </main>
      <SideColumn
        layout={layout}
        top={tablet ? tour : undefined}
        network={tablet ? network : undefined}
        numbers={numbers}
        tool={tool}
        toolId={toolId}
        onCloseTool={onCloseTool}
        hidden={splot}
      />
      {status}
      {children}
    </div>
  );
}
