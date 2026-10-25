import { useRef, useState, type ReactNode } from 'react';
import { Button, IconButton } from '../components/ui/Button';
import { IconGrid } from '../components/ui/icons';
import { Sheet } from '../components/ui/Sheet';
import { messageIsError } from '../lib/shellText';
import { TIPS } from '../lib/tips';
import { useDesignStore, type GridDensity } from '../store/useDesignStore';
import { DesignChip } from './DesignChip';
import { ErrorBanner } from './ErrorBanner';

/** The readout in the chart's top band while a finger is on the chart. */
export interface ReadoutBand {
  /** The picked point ("TP2"), named the instant the finger lands; null on empty chart. */
  readonly title: string | null;
  /** z and Z, then Y and Gamma; null while the finger is off the disc. */
  readonly lines: readonly [string, string] | null;
}

export interface ChartChipsProps {
  /** The live readout while a mouse is over the chart; null at rest. */
  readonly readout: string | null;
  /**
   * While a finger is down and moving: the readout in the chart's top band,
   * which replaces the design chip and the grid button for the duration.
   */
  readonly band?: ReadoutBand | null | undefined;
  /** The readout the finger left: it stays in the readout chip until the next message. */
  readonly rest?: string | null | undefined;
  /** What the readout chip says with no message: Zin and VSWR. */
  readonly idle: string;
  /** The locus legend (ideal, realized, with packages), shown in the grid sheet. */
  readonly legend?: ReactNode;
  /** Fit: resets zoom and pan. */
  readonly onFit: () => void;
}

/**
 * The three chips on the phone's chart (docs/07 section 5): the design chip
 * at the top left, the grid button at the top right (Z, Y, density, Labels,
 * Fit in a small sheet) and the readout chip at the bottom left, which holds
 * the last message or the live readout; a tap expands it. An error stays as
 * a banner over the top of the chart until it is dismissed, and only there:
 * the chip keeps the last message that was not one, and no toast repeats it.
 */
export function ChartChips({
  readout,
  band = null,
  rest = null,
  idle,
  legend,
  onFit,
}: ChartChipsProps) {
  const chart = useDesignStore((s) => s.chart);
  const message = useDesignStore((s) => s.message);
  const serial = useDesignStore((s) => s.messageSerial);
  const isError = useDesignStore(messageIsError);
  const { setChart } = useDesignStore.getState();
  const [grid, setGrid] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const gridButton = useRef<HTMLButtonElement>(null);
  // The last message that was not an error: an error leaves it on the chip, a cleared one goes.
  // Kept from render to render: adjusted while rendering when a new message comes in.
  const [last, setLast] = useState<{ serial: number; info: string | null }>({
    serial: -1,
    info: null,
  });
  const info =
    last.serial === serial ? last.info : message === null ? null : isError ? last.info : message;
  if (last.serial !== serial) setLast({ serial, info });
  const text = readout ?? rest ?? info ?? idle;

  return (
    <>
      <ErrorBanner place="chart" />
      {band && (
        <div className="readout-band mono" role="status" aria-label="Readout">
          {band.title && <strong className="readout-band-title">{band.title}</strong>}
          {band.lines && (
            <span className="readout-band-lines">
              <span>{band.lines[0]}</span>
              <span>{band.lines[1]}</span>
            </span>
          )}
        </div>
      )}
      {readout === null && band === null && (
        <div className="chart-chips-top">
          <DesignChip />
          <IconButton
            ref={gridButton}
            className="chart-chip grid-chip"
            icon={<IconGrid />}
            label="Chart grid"
            title="Z and Y grid, density, labels and Fit"
            aria-haspopup="dialog"
            aria-expanded={grid}
            onClick={() => setGrid(!grid)}
          />
        </div>
      )}
      <button
        type="button"
        className={`chart-chip readout-chip${expanded ? ' expanded' : ''}${readout ? ' live' : ''}`}
        aria-expanded={expanded}
        title={text}
        onClick={() => setExpanded(!expanded)}
      >
        <span className="mono">{text}</span>
      </button>
      {grid && (
        <Sheet
          title="Chart grid"
          onClose={() => setGrid(false)}
          className="grid-sheet"
          closeLabel="Close Chart grid"
          inside={[gridButton]}
          returnTo={() => gridButton.current}
        >
          <div className="grid-controls">
            <Button
              pressed={chart.zGrid}
              title={TIPS.zGrid}
              onClick={() => setChart({ zGrid: !chart.zGrid })}
            >
              Z grid
            </Button>
            <Button
              pressed={chart.yGrid}
              title={TIPS.yGrid}
              onClick={() => setChart({ yGrid: !chart.yGrid })}
            >
              Y grid
            </Button>
            <select
              className="btn"
              value={chart.density}
              onChange={(e) => setChart({ density: e.target.value as GridDensity })}
              aria-label="Grid density"
              title={TIPS.density}
            >
              <option value="coarse">Coarse</option>
              <option value="normal">Normal</option>
              <option value="fine">Fine</option>
            </select>
            <Button
              pressed={chart.labels}
              title={TIPS.labels}
              onClick={() => setChart({ labels: !chart.labels })}
            >
              Labels
            </Button>
            <Button
              onClick={() => {
                onFit();
                setGrid(false);
              }}
              title={TIPS.fit}
            >
              Fit
            </Button>
          </div>
          {legend}
        </Sheet>
      )}
    </>
  );
}
