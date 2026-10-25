import { useRef, useState, type ReactNode } from 'react';
import { Button, IconButton } from '../components/ui/Button';
import { IconGrid } from '../components/ui/icons';
import { Sheet } from '../components/ui/Sheet';
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
  /**
   * While a finger is on the chart (or a mouse over it): the readout in one line over the
   * chart's top edge, which replaces the design chip and the grid button for the duration.
   */
  readonly band?: ReadoutBand | null | undefined;
  /** The locus legend (ideal, realized, with packages), shown in the grid sheet. */
  readonly legend?: ReactNode;
  /** Fit: resets zoom and pan. */
  readonly onFit: () => void;
}

/**
 * The chips on the phone's chart (docs/07 section 5): the design chip at the
 * top left and the grid button at the top right (Z, Y, density, Labels, Fit
 * in a small sheet), both over the chart's corners. Nothing sits on the lower
 * rim: Zin and VSWR are at the end of the schematic strip pinned under the
 * chart, a message passes as the toast, and an error stays as a banner over
 * the top of the chart until it is dismissed. While a finger is on the chart
 * the readout takes the top edge in one line.
 */
export function ChartChips({ band = null, legend, onFit }: ChartChipsProps) {
  const chart = useDesignStore((s) => s.chart);
  const { setChart } = useDesignStore.getState();
  const [grid, setGrid] = useState(false);
  const gridButton = useRef<HTMLButtonElement>(null);

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
      {band === null && (
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
