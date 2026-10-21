import { complex } from '@smithonline/core';
import { useState } from 'react';
import type { ImportedFile } from '../lib/import';
import { fmtComplex, fmtFrequency } from '../lib/format';
import { useDesignStore } from '../store/useDesignStore';

interface ImportDialogProps {
  readonly file: ImportedFile;
  readonly onClose: () => void;
}

/**
 * The rows of an imported one-port, two-port, CITI or EZNEC file: click a
 * row to make it the load (DP1) at its frequency, or sweep the network over
 * every row (Smith V4.1 "sweep versus datapoints").
 */
export function ImportDialog({ file, onClose }: ImportDialogProps) {
  const design = useDesignStore((s) => s.design);
  const { update, setMessage, importTwoPort } = useDesignStore.getState();
  const [keepFrequency, setKeepFrequency] = useState(false);
  const rows = file.rows;
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
    update((d) => ({
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
    }));
    setMessage(
      `Load set from ${file.fileName}: ${fmtComplex(row.z)} Ω at ${fmtFrequency(row.frequency)}`,
    );
    onClose();
  };

  const sweepAll = (): void => {
    update((d) => ({
      ...d,
      sweep: { ...d.sweep, enabled: true, loads: rows, loadsName: file.fileName },
    }));
    setMessage(`Datapoint sweep over ${rows.length} points of ${file.fileName}`);
    onClose();
  };

  return (
    <div className="dropdown wide import-dialog" onPointerDown={(e) => e.stopPropagation()}>
      <div className="dropdown-note">
        <strong>{file.fileName}</strong>: {file.description}.
        {file.kind === 'twoPort' && (
          <>
            {' '}
            The device parameters at {fmtFrequency(design.frequency)} fill the two-port panel.{' '}
            <button className="btn tiny" onClick={() => importTwoPort(file.data, file.fileName)}>
              Fill again
            </button>
          </>
        )}
        <button
          className="btn tiny"
          style={{ float: 'right' }}
          onClick={onClose}
          aria-label="Close"
        >
          &#215;
        </button>
      </div>
      <div className="row" style={{ padding: '4px 10px', gap: 8, alignItems: 'center' }}>
        <span className="small muted">Click a row to use it as the load (DP1).</span>
        <label className="check small">
          <input
            type="checkbox"
            checked={keepFrequency}
            onChange={(e) => setKeepFrequency(e.target.checked)}
          />
          keep the design frequency
        </label>
        <span className="spacer" />
        <button className="btn tiny primary" onClick={sweepAll} disabled={rows.length < 2}>
          Sweep over all {rows.length} points
        </button>
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
    </div>
  );
}
