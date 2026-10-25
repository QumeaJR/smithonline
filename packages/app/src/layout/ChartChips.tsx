import { useRef, useState, type ReactNode } from 'react';
import { Button, IconButton } from '../components/ui/Button';
import { IconClose, IconGrid } from '../components/ui/icons';
import { Sheet } from '../components/ui/Sheet';
import { messageIsError } from '../lib/shellText';
import { TIPS } from '../lib/tips';
import { useDesignStore, type GridDensity } from '../store/useDesignStore';
import { DesignChip } from './DesignChip';

export interface ChartChipsProps {
  /** The live readout while a finger or the pointer is on the chart; null at rest. */
  readonly readout: string | null;
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
export function ChartChips({ readout, idle, legend, onFit }: ChartChipsProps) {
  const chart = useDesignStore((s) => s.chart);
  const message = useDesignStore((s) => s.message);
  const serial = useDesignStore((s) => s.messageSerial);
  const isError = useDesignStore(messageIsError);
  const { setChart } = useDesignStore.getState();
  const [grid, setGrid] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [dismissed, setDismissed] = useState(-1);
  const gridButton = useRef<HTMLButtonElement>(null);
  const error = isError && dismissed !== serial ? message : null;
  // The last message that was not an error: an error leaves it on the chip, a cleared one goes.
  // Kept from render to render: adjusted while rendering when a new message comes in.
  const [last, setLast] = useState<{ serial: number; info: string | null }>({
    serial: -1,
    info: null,
  });
  const info =
    last.serial === serial ? last.info : message === null ? null : isError ? last.info : message;
  if (last.serial !== serial) setLast({ serial, info });
  const text = readout ?? info ?? idle;

  return (
    <>
      {error && (
        <div className="chart-error" role="alert">
          <span>{error}</span>
          <IconButton
            size="sm"
            icon={<IconClose size={14} />}
            label="Dismiss the error"
            onClick={() => setDismissed(serial)}
          />
        </div>
      )}
      {readout === null && (
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
