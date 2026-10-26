import { complex, measuredLoadInfo } from '@smithonline/core';
import { useMemo, useState } from 'react';
import type { ImportedFile } from '../lib/import';
import { fmtComplex, fmtFrequency } from '../lib/format';
import { useDesignStore } from '../store/useDesignStore';
import { useSPlotStore } from '../store/useSPlotStore';
import { useCoarsePointer } from '../lib/pointer';
import { loadModelText, pointsLoadModel, useFitVersion } from '../lib/measuredLoad';
import { Dialog } from './ui/Dialog';
import { Switch } from './ui/Switch';
import { noteMeasuredLoad } from '../lib/nextSteps';

interface ImportDialogProps {
  readonly file: ImportedFile;
  readonly onClose: () => void;
}

/**
 * The rows of an imported one-port, two-port, CITI or EZNEC file: click a
 * row to make it the load (DP1) at its frequency, or sweep the network over
 * every row (Smith V4.1 "sweep versus datapoints"). A file that went to the
 * S-Plot list as well can be opened there.
 */
export function ImportDialog({ file, onClose }: ImportDialogProps) {
  const design = useDesignStore((s) => s.design);
  const {
    updateFollowingDevice: update,
    setMessage,
    importTwoPort,
    setView,
  } = useDesignStore.getState();
  const [keepFrequency, setKeepFrequency] = useState(false);
  const coarse = useCoarsePointer();
  /**
   * Centres the nearest row in the row list once the dialog is on screen, by scrolling the
   * list itself: scrollIntoView would scroll the page behind the dialog as well.
   */
  const scrollTo = (el: HTMLTableRowElement | null): void => {
    const box = el?.closest<HTMLElement>('.import-rows');
    if (!el || !box) return;
    box.scrollTop = Math.max(0, el.offsetTop - (box.clientHeight - el.offsetHeight) / 2);
  };
  // A DC row cannot be a design frequency; it is not offered.
  const rows = useMemo(() => file.rows.filter((r) => r.frequency > 0), [file.rows]);
  /** The load model a sweep over the rows would give the band tools (fitted from six rows). */
  const fits = useFitVersion();
  const fitInfo = useMemo(
    () => (rows.length >= 2 ? measuredLoadInfo(pointsLoadModel(rows, design.z0)) : null),
    // fits: the model arrives from the fitting worker.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, design.z0, fits],
  );
  const nearest = rows.reduce(
    (best, r, i) =>
      Math.abs(r.frequency - design.frequency) <
      Math.abs((rows[best] as typeof r).frequency - design.frequency)
        ? i
        : best,
    0,
  );

  const applyRow = (i: number): void => {
    const row = rows[i];
    if (!row) return;
    // One step, named by its message, so Undo and Redo repeat it.
    update(
      (d) => ({
        ...d,
        load: complex(row.z.re, row.z.im),
        ...(keepFrequency ? {} : { frequency: row.frequency }),
        elements: keepFrequency
          ? d.elements
          : d.elements.map((el) =>
              el.kind === 'line' || el.kind === 'openStub' || el.kind === 'shortStub'
                ? { ...el, refFrequency: row.frequency }
                : el,
            ),
      }),
      keepFrequency
        ? `Load set from ${file.fileName}: ${fmtComplex(row.z)} Ω (${fmtFrequency(row.frequency)} row), design frequency kept at ${fmtFrequency(design.frequency)}`
        : `Load set from ${file.fileName}: ${fmtComplex(row.z)} Ω at ${fmtFrequency(row.frequency)}`,
    );
    onClose();
  };

  const sweepAll = (): void => {
    const start = rows[nearest];
    if (!start) return;
    update(
      (d) => ({
        ...d,
        load: complex(start.z.re, start.z.im),
        frequency: start.frequency,
        elements: d.elements.map((el) =>
          el.kind === 'line' || el.kind === 'openStub' || el.kind === 'shortStub'
            ? { ...el, refFrequency: start.frequency }
            : el,
        ),
        sweep: {
          ...d.sweep,
          enabled: true,
          loads: rows,
          loadsName: file.fileName,
          mode: 'datapoints',
        },
      }),
      start.frequency === design.frequency
        ? `Datapoint sweep over ${rows.length} points of ${file.fileName}; DP1 is the ${fmtFrequency(start.frequency)} row, at the design frequency`
        : `Datapoint sweep over ${rows.length} points of ${file.fileName}. Design frequency set to ${fmtFrequency(start.frequency)}, the nominal row`,
    );
    onClose();
    noteMeasuredLoad();
  };

  /** The newest S-Plot entry of this file becomes the active one. */
  const showInSPlot = (): void => {
    const sp = useSPlotStore.getState();
    const entry = [...sp.files].reverse().find((f) => f.fileName === file.fileName);
    if (!entry) {
      setMessage(`${file.fileName} is not in the S-Plot list`, { error: true });
      return;
    }
    sp.setActive(entry.id);
    setView('splot');
    setMessage(`${file.fileName} shown in the S-Plot view`);
    onClose();
  };

  return (
    <Dialog
      title="Import"
      subtitle={file.fileName}
      onClose={onClose}
      closeLabel="Close the import dialog"
      className="import-dialog"
      draggable="import"
      footer={
        <>
          <button
            className="btn primary"
            onClick={sweepAll}
            disabled={rows.length < 2}
            title="Every band tool reads the load across frequency from these rows; DP1 becomes the row nearest the design frequency"
            data-tour="import.useRows"
          >
            Use all {rows.length} rows as the load
          </button>
          <button className="btn dialog-close" onClick={onClose}>
            Close
          </button>
        </>
      }
    >
      <div className="dropdown-note">
        <strong>{file.fileName}</strong>: {file.description}.
        {/synthetic/i.test(file.fileName) && (
          <> A synthetic sample made from a circuit model, not a measurement.</>
        )}
        {file.kind === 'twoPort' && (
          <>
            {' '}
            The device parameters at {fmtFrequency(design.frequency)} fill the two-port panel.{' '}
            <button className="btn sm" onClick={() => importTwoPort(file.data, file.fileName)}>
              Fill again
            </button>
          </>
        )}
        {file.sPlot && (
          <>
            {' '}
            <button
              className="btn sm"
              onClick={showInSPlot}
              title="The file is in the S-Plot list too: graphs of its S-parameters, stability and gain"
            >
              Show in S-Plot
            </button>
          </>
        )}
        {file.notes && file.notes.length > 0 && (
          <span className="import-notes">
            {file.notes.map((n) => (
              <span key={n}>{n}.</span>
            ))}
          </span>
        )}
      </div>
      {fitInfo && (
        <div className="dropdown-note fit-quality" data-testid="import-load-model">
          Swept as a measured load, the {rows.length} rows are{' '}
          <span className={fitInfo.mode === 'fitted' ? '' : 'warn-text'}>
            {loadModelText(fitInfo)}
          </span>{' '}
          (Γ at Z0 {design.z0} Ω); Optimize band, Broadband, Tolerance, the usable bandwidth and the
          Response view then follow that model across {fmtFrequency(fitInfo.band[0])} to{' '}
          {fmtFrequency(fitInfo.band[1])}.
        </div>
      )}
      <div className="import-options">
        <span className="small muted">
          {coarse ? 'Tap' : 'Click'} a row to use it as the load (DP1).
        </span>
        <Switch className="small" checked={keepFrequency} onChange={setKeepFrequency}>
          keep the design frequency on a row {coarse ? 'tap' : 'click'}
        </Switch>
      </div>
      <div className="import-rows">
        <table className="dp-table">
          <thead>
            <tr>
              <th>#</th>
              <th>f</th>
              <th>Z (&#937;)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr
                key={i}
                className={i === nearest ? 'sel' : ''}
                ref={i === nearest ? scrollTo : undefined}
                onClick={() => applyRow(i)}
                title="Use as load"
              >
                <td>{i + 1}</td>
                <td>{fmtFrequency(r.frequency)}</td>
                <td>{fmtComplex(r.z)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Dialog>
  );
}
