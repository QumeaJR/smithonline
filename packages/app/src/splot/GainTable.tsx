/**
 * The gain table of the S-Plot view: MAG, MSG, K, mu and s12 per frequency of
 * the active file. A selected row is marked in every graph.
 */
import { formatEngineering } from '@smithonline/core';
import { useEffect, useRef } from 'react';
import { fmtNum } from '../lib/format';
import { analysisOf } from '../lib/splot';
import { listNames, missingParameters } from '../lib/splotActions';
import { useSPlotStore, type SPlotEntry } from '../store/useSPlotStore';

function dbCell(v: number | undefined): string {
  if (v === undefined || Number.isNaN(v)) return '–';
  if (!Number.isFinite(v)) return v > 0 ? '∞' : '-∞';
  return fmtNum(v, 2);
}

function numCell(v: number | undefined, decimals = 3): string {
  if (v === undefined || Number.isNaN(v)) return '–';
  if (!Number.isFinite(v)) return '∞';
  return v >= 1000 ? v.toExponential(2) : fmtNum(v, decimals);
}

export function GainTable({ entry }: { readonly entry: SPlotEntry | null }) {
  const selected = useSPlotStore((s) => s.selected);
  const select = useSPlotStore((s) => s.select);
  const selectedRow = useRef<HTMLTableRowElement>(null);
  useEffect(() => {
    selectedRow.current?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  if (!entry) return <p className="hint small">Load an S-parameter file to see the gain table.</p>;
  const a = analysisOf(entry.data);
  const missing = missingParameters(entry);
  if (entry.data.ports >= 2 && missing.length > 0) {
    return (
      <p className="hint small">
        {entry.fileName} has no {listNames(missing)}: MAG, MSG, K and μ need s11, s21, s12 and s22.
      </p>
    );
  }
  if (!a.k || !a.mu || !a.magDb || !a.msgDb || !a.db.s12) {
    return (
      <p className="hint small">
        {entry.fileName} is a one-port: MAG, MSG, K and μ need a two-port file.
      </p>
    );
  }
  const { k, mu, magDb, msgDb } = a;
  const s12Db = a.db.s12;
  return (
    <div className="gain-table-wrap">
      <table className="gain-table">
        <thead>
          <tr>
            <th>f</th>
            <th title="Maximum available gain, K above 1">MAG dB</th>
            <th title="Maximum stable gain |s21/s12|">MSG dB</th>
            <th title="Rollett stability factor">K</th>
            <th title="Edwards and Sinsky stability measure">μ</th>
            <th>s12 dB</th>
          </tr>
        </thead>
        <tbody>
          {a.frequency.map((f, i) => (
            <tr
              key={i}
              ref={selected === i ? selectedRow : undefined}
              className={selected === i ? 'selected' : ''}
              onClick={() => select(selected === i ? null : i)}
              aria-selected={selected === i}
            >
              <td>{formatEngineering(f, { unit: 'Hz', digits: 4 })}</td>
              <td>{dbCell(magDb[i])}</td>
              <td>{dbCell(msgDb[i])}</td>
              <td className={(k[i] as number) < 1 ? 'warn' : ''}>{numCell(k[i])}</td>
              <td className={(mu[i] as number) < 1 ? 'warn' : ''}>{numCell(mu[i])}</td>
              <td>{dbCell(s12Db[i])}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
