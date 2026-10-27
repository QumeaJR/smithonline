import { complex, measuredLoadInfo } from '@smithonline/core';
import { useMemo, useState } from 'react';
import type { ImportedFile } from '../lib/import';
import { nominalRow, sweepOverRows, usableRows } from '../lib/importDialog';
import { fmtComplex, fmtFrequency } from '../lib/format';
import { useDesignStore } from '../store/useDesignStore';
import { useSPlotStore } from '../store/useSPlotStore';
import { useTourStore } from '../store/useTourStore';
import { useCoarsePointer } from '../lib/pointer';
import { loadModelText, pointsLoadModel, useFitVersion } from '../lib/measuredLoad';
import { Dialog } from './ui/Dialog';
import { Switch } from './ui/Switch';
import { noteMeasuredLoad } from '../lib/nextSteps';
import { compareProblem, compareWithDesign } from '../lib/boardFit';

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
  // Within the measure and retune workflow the file is the measured board: Compare leads.
  const comparing = useTourStore((s) => s.tour?.id === 'measure-retune');
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
  const rows = useMemo(() => usableRows(file), [file]);
  // Why Compare cannot take this file, in words (the button's title and the note).
  const compareWhy =
    design.elements.length === 0
      ? 'it needs a network: the measured S11 of a built board is set against the network as designed'
      : (compareProblem(file)?.replace(`${file.fileName} `, 'the file ') ?? null);
  /** The load model a sweep over the rows would give the band tools (fitted from six rows). */
  const fits = useFitVersion();
  const fitInfo = useMemo(
    () => (rows.length >= 2 ? measuredLoadInfo(pointsLoadModel(rows, design.z0)) : null),
    // fits: the model arrives from the fitting worker.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, design.z0, fits],
  );
  const nearest = nominalRow(rows, design.frequency);

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
    if (!sweepOverRows(file)) return;
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
            className={comparing ? 'btn primary' : 'btn'}
            onClick={() => compareWithDesign(file)}
            disabled={compareWhy !== null}
            title={
              compareWhy ??
              'This file is the measured S11 of the built board: overlay it on the network as built, then fit what moved and retune (Build, Measured board). The load stays as it is.'
            }
            data-tour="import.compare"
          >
            Compare with the design
          </button>
          <button
            className={comparing ? 'btn' : 'btn primary'}
            onClick={sweepAll}
            disabled={rows.length < 2}
            title="Every band tool reads the load across frequency from these rows; DP1 becomes the row nearest the design frequency"
            data-tour="import.useRows"
          >
            {rows.length === 1
              ? 'Use the row as the load'
              : `Use all ${rows.length} rows as the load`}
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
      <div className="dropdown-note import-choice">
        <strong>Compare with the design</strong>: the board you built, measured; it is set against
        the network as built and the load stays. <strong>Use all rows as the load</strong>: the
        load, measured (an antenna, a device input).
        {compareWhy && <span className="muted"> Compare: {compareWhy}.</span>}
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
