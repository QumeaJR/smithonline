import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button, IconButton } from '../components/ui/Button';
import { IconChevronLeft, IconDownload, IconMaximize, IconMinimize } from '../components/ui/icons';
import { Menu } from '../components/ui/Menu';
import { track } from '../lib/analytics/track';
import { useLayout } from '../lib/layout';
import { useEscapeLayer } from '../lib/overlay';
import { useDesignStore } from '../store/useDesignStore';
import { Plot, type PlotHandle, type PlotProps } from './Plot';
import { exportPlot, plotFileBase, plotFooter, type PlotFormat } from './plotExport';
import { ZoomChip } from './ZoomChip';

/** Which view a plot lives in, for the usage counts. */
export type PlotKind = 'response' | 'splot' | 'measured';

export interface PlotPanelProps {
  /** The panel's name in its head and its buttons: "VSWR". */
  readonly title: string;
  /** The panel in file names: "vswr" gives "antenna_vswr.png". */
  readonly fileId: string;
  /** The head's content: the title and the legend (default the title alone). */
  readonly heading?: ReactNode;
  readonly kind: PlotKind;
  /** The plot (its handle, Enlarge key and gestures come from the panel). */
  readonly plot: Omit<PlotProps, 'handleRef' | 'onEnlarge' | 'gestures' | 'title'>;
  readonly enlarged: boolean;
  readonly onEnlarge: (on: boolean) => void;
  readonly className?: string;
  readonly tour?: string | undefined;
  /** Between the head and the plot: a summary of what it shows. */
  readonly intro?: ReactNode;
  /** Hidden but mounted, while another panel of its view is enlarged. */
  readonly hidden?: boolean;
  /**
   * The plot keeps its own zoom (an S-Plot graph, the measured-board plot): its head shows the
   * zoom chip with Reset while it is zoomed. The Response plots share one chip in the toolbar.
   */
  readonly ownZoom?: boolean;
  /** The title in an export, with the unit of the y axis ("Gain and return loss, dB"). */
  readonly exportTitle?: string | undefined;
}

const FORMATS: readonly { format: PlotFormat; label: string; description: string }[] = [
  { format: 'png', label: 'PNG image', description: '1600 x 900 pixels on white, as zoomed' },
  { format: 'svg', label: 'SVG drawing', description: 'For a report or Inkscape, as zoomed' },
  { format: 'csv', label: 'CSV data', description: 'Every curve over the full range' },
];

/**
 * One plot with its head (docs/10 section 4.3): the title and legend, then
 * Enlarge and Export at the right. Enlarged, the panel fills the plot area
 * of its view (full screen on a phone) and its head reads "Back to all
 * plots"; Escape returns. Export saves PNG, SVG or CSV of this plot.
 */
export function PlotPanel({
  title,
  fileId,
  heading,
  kind,
  plot,
  enlarged,
  onEnlarge,
  className,
  tour,
  intro,
  hidden = false,
  ownZoom = false,
  exportTitle,
}: PlotPanelProps) {
  const handle = useRef<PlotHandle | null>(null);
  const root = useRef<HTMLElement>(null);
  const enlargeButton = useRef<HTMLButtonElement>(null);
  const exportButton = useRef<HTMLButtonElement>(null);
  const [menu, setMenu] = useState(false);
  const phone = useLayout() === 'phone';
  const designName = useDesignStore((s) => s.design.name);

  const setEnlarged = (on: boolean): void => {
    if (on) track('plot', 'enlarge', kind);
    onEnlarge(on);
  };
  useEscapeLayer('plot', enlarged, () => setEnlarged(false), root);
  // Enlarged, the plot takes the focus; back, the Enlarge button does.
  const was = useRef(enlarged);
  useEffect(() => {
    if (was.current === enlarged) return;
    was.current = enlarged;
    const target = enlarged
      ? root.current?.querySelector<HTMLElement>('.plot-host')
      : enlargeButton.current;
    target?.focus({ preventScroll: !enlarged });
  }, [enlarged]);

  const save = (format: PlotFormat): void => {
    const view = handle.current?.view();
    const xs = plot.xs;
    const fallbackX: [number, number] = [xs[0] ?? 0, xs[xs.length - 1] ?? 1];
    const picture = {
      title: exportTitle ?? title,
      xs,
      series: plot.series,
      left: plot.left,
      right: plot.right,
      logX: plot.logX,
      xRange: view?.xRange ?? fallbackX,
      yRange: view?.yRange ?? ([0, 1] as const),
      dRange: view?.dRange,
      markers: plot.markers,
      limits: plot.limits,
      vswrBand: plot.vswrBand,
      designFrequency: plot.designFrequency,
      spanGaps: plot.spanGaps,
      footer: plotFooter(designName),
    };
    const { setMessage } = useDesignStore.getState();
    exportPlot(format, plotFileBase(designName, fileId), picture).then(
      (name) => {
        setMessage(`Saved ${name}`);
        track('export', `plot_${format}`);
      },
      (err: unknown) =>
        setMessage(
          `Could not save the ${format.toUpperCase()}: ${err instanceof Error ? err.message : String(err)}`,
          { error: true },
        ),
    );
  };

  const exportMenu = (
    <>
      <IconButton
        ref={exportButton}
        size="sm"
        icon={<IconDownload size={14} />}
        label={`Export ${title}`}
        title={`Export ${title}: PNG, SVG or CSV`}
        aria-haspopup="menu"
        aria-expanded={menu}
        className={menu ? 'on' : undefined}
        onClick={() => setMenu(!menu)}
      />
      {menu && (
        <Menu
          label={`Export ${title}`}
          anchor={exportButton}
          onClose={() => setMenu(false)}
          prefer={{ align: 'end' }}
          entries={FORMATS.map((f) => ({
            label: f.label,
            description: f.description,
            onSelect: () => save(f.format),
          }))}
        />
      )}
    </>
  );

  return (
    <section
      ref={root}
      className={`panel plot-panel${enlarged ? ' enlarged' : ''}${className ? ` ${className}` : ''}`}
      data-tour={tour}
      data-plot={fileId}
      aria-label={enlarged ? `${title}, enlarged` : undefined}
      hidden={hidden}
    >
      <div className="plot-panel-head">
        {enlarged && phone && (
          <Button
            variant="quiet"
            size="sm"
            className="plot-back"
            onClick={() => setEnlarged(false)}
            aria-label="Back to all plots"
          >
            <IconChevronLeft size={16} /> Plots
          </Button>
        )}
        <h3>{heading ?? title}</h3>
        <span className="plot-panel-actions">
          {ownZoom && plot.xRange && plot.onXRange && (
            <ZoomChip
              range={plot.xRange}
              onReset={() => {
                track('plot', 'reset', kind);
                plot.onXRange?.(null);
              }}
              what="this plot"
            />
          )}
          {enlarged && !phone && (
            <Button variant="quiet" size="sm" onClick={() => setEnlarged(false)}>
              <IconMinimize size={14} /> Back to all plots
            </Button>
          )}
          {!enlarged && (
            <IconButton
              ref={enlargeButton}
              size="sm"
              icon={<IconMaximize size={14} />}
              label={`Enlarge ${title}`}
              title={`Enlarge ${title} (E on the plot); Escape returns`}
              onClick={() => setEnlarged(true)}
            />
          )}
          {exportMenu}
        </span>
      </div>
      {intro}
      <Plot
        {...plot}
        onXRange={
          plot.onXRange
            ? (r) => {
                track('plot', r ? 'zoom' : 'reset', kind);
                plot.onXRange?.(r);
              }
            : undefined
        }
        title={title}
        handleRef={handle}
        onEnlarge={() => setEnlarged(!enlarged)}
        gestures={enlarged && phone}
      />
    </section>
  );
}
