import { useMemo } from 'react';
import { fmtFrequency } from '../lib/format';
import { designLoadInfo, hasMeasuredLoad, useFitVersion } from '../lib/measuredLoad';
import { tourUi } from '../lib/tourUi';
import { useDesignStore } from '../store/useDesignStore';
import { Button } from './ui/Button';
import { Switch } from './ui/Switch';

/**
 * The front door of a measured load (docs/09 section 2): a line at the head
 * of the load card naming the file, its rows, its band and the model, with
 * Match over the band (Auto match, Broadband) and the chart switch for the
 * measured load. A synthetic sample says so.
 */
export function MeasuredLoadHeader() {
  const design = useDesignStore((s) => s.design);
  const shown = useDesignStore((s) => s.chart.measuredLoad);
  const fits = useFitVersion();
  const measured = hasMeasuredLoad(design);
  const info = useMemo(
    () => (measured ? designLoadInfo(design) : null),
    // fits: the model arrives from the fitting worker.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [measured, design.sweep.loads, design.z0, fits],
  );
  if (!measured || !info) return null;
  const name = design.sweep.loadsName ?? 'imported rows';
  const synthetic = /synthetic/i.test(name);
  const model =
    info.mode === 'fitted' && info.fit ? `fitted (order ${info.fit.order})` : 'joined linearly';
  return (
    <div className="measured-header small" onClick={(e) => e.stopPropagation()}>
      <span className="measured-header-text">
        Measured load: <span className="mono">{name}</span>
        {synthetic && <span className="muted"> (synthetic sample, not a measurement)</span>},{' '}
        {design.sweep.loads?.length ?? info.points} rows, {fmtFrequency(info.band[0])} to{' '}
        {fmtFrequency(info.band[1])}, {model}
      </span>
      <span className="measured-header-actions">
        <Button
          size="sm"
          variant="quiet"
          onClick={() => tourUi.openTool('match', 'broadband')}
          title="Open Auto match, Broadband: the best ladder over the measured band, with the Bode-Fano limit"
        >
          Match over the band
        </Button>
        <Switch
          className="small"
          checked={shown}
          onChange={(measuredLoad) => useDesignStore.getState().setChart({ measuredLoad })}
          title="Draw the measured rows and the load model on the chart"
        >
          Show on chart
        </Switch>
      </span>
    </div>
  );
}
