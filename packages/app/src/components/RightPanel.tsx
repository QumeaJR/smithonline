import type { LadderResult, SweepPoint } from '@smithonline/core';
import { useState } from 'react';
import { datapointLabel, fmtComplex, fmtDb, fmtDeg, fmtFrequency, fmtNum } from '../lib/format';
import { useDesignStore } from '../store/useDesignStore';
import { NumberList } from './NumberList';
import { TwoPortPanel } from './TwoPortPanel';
import { ValueInput } from './ValueInput';

interface RightPanelProps {
  readonly result: LadderResult;
  readonly sweep: readonly SweepPoint[] | null;
}

export function RightPanel({ result, sweep }: RightPanelProps) {
  const design = useDesignStore((s) => s.design);
  const selected = useDesignStore((s) => s.selected);
  const select = useDesignStore((s) => s.select);
  const { setSweep, setVswrCircles, setQContours } = useDesignStore.getState();
  const sel = selected !== null ? result.info[selected] : undefined;

  return (
    <>
      <h2>Datapoints at {fmtFrequency(design.frequency)}</h2>
      <table className="dp-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Z (&#937;)</th>
            <th>|&#915;|</th>
            <th>&#8736;&#915;</th>
            <th>VSWR</th>
            <th>RL</th>
            <th>Q</th>
          </tr>
        </thead>
        <tbody>
          {result.info.map((info, i) => (
            <tr key={i} className={i === selected ? 'sel' : ''} onClick={() => select(i)}>
              <td>{datapointLabel(i)}</td>
              <td>{fmtComplex(info.z)}</td>
              <td>{fmtNum(info.gammaMag, 3)}</td>
              <td>{fmtDeg(info.gammaAngleDeg)}</td>
              <td>{fmtNum(info.vswr, 3)}</td>
              <td>{Number.isFinite(info.returnLossDb) ? fmtNum(info.returnLossDb, 1) : '∞'}</td>
              <td>{fmtNum(info.q, 2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mono muted small">
        S21 into the load: {fmtDb(result.s21.db, 3)} &nbsp; loaded Q: {fmtNum(result.loadedQ, 2)}
      </p>

      {sel && (
        <>
          <h2>Selected {datapointLabel(selected as number)}</h2>
          <table className="detail">
            <tbody>
              <tr>
                <td>Z</td>
                <td>{fmtComplex(sel.z, 3)} &#937;</td>
              </tr>
              <tr>
                <td>z</td>
                <td>{fmtComplex({ re: sel.z.re / design.z0, im: sel.z.im / design.z0 }, 4)}</td>
              </tr>
              <tr>
                <td>Y</td>
                <td>{fmtComplex({ re: sel.y.re * 1e3, im: sel.y.im * 1e3 }, 3)} mS</td>
              </tr>
              <tr>
                <td>&#915;</td>
                <td>
                  {fmtComplex(sel.gamma, 4)} = {fmtNum(sel.gammaMag, 4)} &#8736;{' '}
                  {fmtDeg(sel.gammaAngleDeg, 2)}
                </td>
              </tr>
              <tr>
                <td>VSWR</td>
                <td>{fmtNum(sel.vswr, 4)}</td>
              </tr>
              <tr>
                <td>Return loss</td>
                <td>{fmtDb(sel.returnLossDb)}</td>
              </tr>
              <tr>
                <td>Mismatch loss</td>
                <td>{fmtDb(sel.mismatchLossDb, 4)}</td>
              </tr>
              <tr>
                <td>Q</td>
                <td>{fmtNum(sel.q, 4)}</td>
              </tr>
            </tbody>
          </table>
        </>
      )}

      <h2>Frequency sweep</h2>
      <div className="sweep-settings">
        <label className="check">
          <input
            type="checkbox"
            checked={design.sweep.enabled}
            onChange={(e) => setSweep({ enabled: e.target.checked })}
          />
          Sweep the input impedance
        </label>
        <div className="row fields">
          <label>
            from
            <ValueInput
              value={design.sweep.start}
              unit="Hz"
              digits={5}
              min={1}
              onCommit={(start) => setSweep({ start })}
            />
          </label>
          <label>
            to
            <ValueInput
              value={design.sweep.stop}
              unit="Hz"
              digits={5}
              min={1}
              onCommit={(stop) => setSweep({ stop })}
            />
          </label>
          <label>
            points
            <ValueInput
              value={design.sweep.points}
              plain
              min={2}
              onCommit={(points) => setSweep({ points: Math.min(2001, Math.round(points)) })}
            />
          </label>
        </div>
        {sweep && sweep.length > 0 && <SweepTable sweep={sweep} />}
      </div>

      <h2>Circles and contours</h2>
      <NumberList
        label="VSWR circles"
        values={design.vswrCircles}
        min={1}
        onChange={setVswrCircles}
        swatch="var(--vswr)"
        placeholder="1.5"
      />
      <NumberList
        label="Q contours"
        values={design.qContours}
        min={0}
        onChange={setQContours}
        swatch="var(--q)"
        placeholder="0.6"
      />

      <h2>Two-port device</h2>
      <TwoPortPanel />
    </>
  );
}

function SweepTable({ sweep }: { sweep: readonly SweepPoint[] }) {
  const [open, setOpen] = useState(false);
  let worst = sweep[0];
  for (const p of sweep) if (worst && p.info.vswr > worst.info.vswr) worst = p;
  return (
    <div className="sweep-table">
      <button className="btn tiny" onClick={() => setOpen(!open)}>
        {open ? 'Hide' : 'Show'} {sweep.length} sweep points
      </button>
      {worst && (
        <span className="mono muted small">
          &nbsp;worst VSWR {fmtNum(worst.info.vswr, 2)} at {fmtFrequency(worst.frequency)}
        </span>
      )}
      {open && (
        <table className="dp-table">
          <thead>
            <tr>
              <th>#</th>
              <th>f</th>
              <th>Z (&#937;)</th>
              <th>VSWR</th>
              <th>S21</th>
            </tr>
          </thead>
          <tbody>
            {sweep.map((p, i) => (
              <tr key={i}>
                <td>SP{i + 1}</td>
                <td>{fmtFrequency(p.frequency)}</td>
                <td>{fmtComplex(p.zin)}</td>
                <td>{fmtNum(p.info.vswr, 3)}</td>
                <td>{fmtDb(p.s21.db)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
