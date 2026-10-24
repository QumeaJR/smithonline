import type { LadderResult, Realization, SweepPoint } from '@smithonline/core';
import { useMemo, useState } from 'react';
import { datapointLabel, fmtComplex, fmtDb, fmtDeg, fmtFrequency, fmtNum } from '../lib/format';
import {
  designHasDatapointSweep,
  startIndex,
  sweepLoadsOf,
  userDatapoints,
} from '../lib/datapoints';
import { TIPS } from '../lib/tips';
import { designLadder, effectiveElements } from '../lib/realize';
import { useDesignStore } from '../store/useDesignStore';
import { BandwidthReadout } from './BandwidthReadout';
import { NumberList } from './NumberList';
import { HelpLink } from './HelpLink';
import { TwoPortPanel } from './TwoPortPanel';
import { Button } from './ui/Button';
import { Field } from './ui/Field';
import { Segmented } from './ui/Segmented';
import { Switch } from './ui/Switch';

/** The realized network's evaluation, when Realize mode is on. */
export interface RealizedView {
  readonly realization: Realization;
  readonly sweep: readonly SweepPoint[] | null;
}

interface RightPanelProps {
  readonly result: LadderResult;
  readonly sweep: readonly SweepPoint[] | null;
  readonly realized: RealizedView | null;
}

export function RightPanel({ result: ideal, sweep, realized }: RightPanelProps) {
  const design = useDesignStore((s) => s.design);
  const selected = useDesignStore((s) => s.selected);
  const select = useDesignStore((s) => s.select);
  const { setSweep, setVswrCircles, setQContours } = useDesignStore.getState();
  const [showRealized, setShowRealized] = useState(false);
  const realizedOn = realized !== null && showRealized;
  const result = realizedOn ? realized.realization.result : ideal;
  const sel = selected !== null ? result.info[selected] : undefined;
  const datapointSweep = designHasDatapointSweep(design);
  const loads = sweepLoadsOf(design);
  const dpCount = userDatapoints(design).length;
  const slot = startIndex(design);
  const bandwidthLadder = useMemo(
    () =>
      realizedOn ? realized.realization.ladder : designLadder(design, effectiveElements(design)),
    [realizedOn, realized, design],
  );

  return (
    <>
      <h2 title={TIPS.datapoints}>
        Datapoints at {fmtFrequency(design.frequency)}
        <HelpLink section="starting-a-design" topic="datapoints" />
        {realized && (
          <Segmented
            className="toggle"
            size="sm"
            ariaLabel="Ideal or realized values"
            value={realizedOn ? 'realized' : 'ideal'}
            onChange={(v) => setShowRealized(v === 'realized')}
            options={[
              { value: 'ideal', label: 'Ideal' },
              { value: 'realized', label: 'Realized' },
            ]}
          />
        )}
      </h2>
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
              <td>{datapointLabel(i, dpCount, slot)}</td>
              <td>{fmtComplex(info.z)}</td>
              <td>{fmtNum(info.gammaMag, 3)}</td>
              <td>{info.gammaMag < 1e-6 ? '–' : fmtDeg(info.gammaAngleDeg)}</td>
              <td>{fmtNum(info.vswr, 3)}</td>
              <td>{fmtReturnLoss(info.returnLossDb)}</td>
              <td>{fmtNum(info.q, 2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mono muted small">
        S21 into the load: {fmtDb(result.s21.db, 3)} &nbsp; loaded Q: {fmtNum(result.loadedQ, 2)}
      </p>
      {realized && <RealizedSummary view={realized} />}
      <BandwidthReadout ladder={bandwidthLadder} />

      {sel && (
        <>
          <h2 title={TIPS.selected}>
            Selected {datapointLabel(selected as number, dpCount, slot)}
          </h2>
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
                  {sel.gammaMag < 1e-6 ? '–' : fmtDeg(sel.gammaAngleDeg, 2)}
                </td>
              </tr>
              <tr>
                <td>VSWR</td>
                <td>{fmtNum(sel.vswr, 4)}</td>
              </tr>
              <tr>
                <td>Return loss</td>
                <td>{sel.returnLossDb > 100 ? '> 100 dB' : fmtDb(sel.returnLossDb)}</td>
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

      <h2 title={datapointSweep ? TIPS.datapointSweep : TIPS.frequencySweep}>
        {datapointSweep ? 'Datapoint sweep' : 'Frequency sweep'}
        <HelpLink section="response-view" topic="the sweep" />
      </h2>
      <div className="sweep-settings">
        <Switch
          checked={design.sweep.enabled}
          onChange={(enabled) => {
            setSweep({ enabled });
            useDesignStore.getState().setMessage(null);
          }}
        >
          {datapointSweep
            ? `Apply the network to the ${loads.length} points of ${design.sweep.loads?.length ? (design.sweep.loadsName ?? 'the imported file') : 'the user datapoints'}`
            : 'Sweep the input impedance'}
        </Switch>
        {datapointSweep && (
          <p className="muted small">
            Each point is swept at its own frequency and drawn as SP marker.{' '}
            <Button
              size="sm"
              onClick={() => {
                const store = useDesignStore.getState();
                store.update((d) => ({
                  ...d,
                  sweep: { ...d.sweep, enabled: false, mode: 'frequency' },
                }));
                store.setMessage('Frequency sweep restored; switch the sweep on to run it');
              }}
            >
              Back to frequency sweep
            </Button>
          </p>
        )}
        {!datapointSweep && loads.length > 0 && (
          <p className="muted small">
            {loads.length} datapoints of{' '}
            {design.sweep.loads?.length
              ? (design.sweep.loadsName ?? 'a file')
              : 'the user datapoints'}{' '}
            are kept.{' '}
            <Button
              size="sm"
              onClick={() => {
                const store = useDesignStore.getState();
                store.update((d) => ({
                  ...d,
                  sweep: { ...d.sweep, enabled: true, mode: 'datapoints' },
                }));
                store.setMessage(`Datapoint sweep over ${loads.length} points`);
              }}
            >
              Sweep over them instead
            </Button>
          </p>
        )}
        {!datapointSweep && (
          <div className="row fields">
            <Field
              label="from"
              value={design.sweep.start}
              unit="Hz"
              digits={5}
              min={1}
              onCommit={(start) => setSweep({ start })}
            />
            <Field
              label="to"
              value={design.sweep.stop}
              unit="Hz"
              digits={5}
              min={1}
              onCommit={(stop) => setSweep({ stop })}
            />
            <Field
              label="points"
              value={design.sweep.points}
              plain
              min={2}
              onCommit={(points) => setSweep({ points: Math.min(2001, Math.round(points)) })}
            />
          </div>
        )}
        {sweep && sweep.length > 0 && <SweepTable sweep={sweep} />}
      </div>

      <h2 title={TIPS.circles}>
        Circles and contours
        <HelpLink section="circles-and-contours" topic="circles and contours" />
      </h2>
      <NumberList
        label="VSWR circles"
        itemName="VSWR circle"
        values={design.vswrCircles}
        min={1}
        onChange={setVswrCircles}
        swatch="var(--vswr)"
        placeholder="1.5"
      />
      <NumberList
        label="Q contours"
        itemName="Q contour"
        values={design.qContours}
        min={0}
        onChange={setQContours}
        swatch="var(--q)"
        placeholder="0.6"
      />

      <h2 title={TIPS.twoPort}>
        Two-port device
        <HelpLink section="circles-and-contours" topic="the two-port device" />
      </h2>
      <TwoPortPanel />
    </>
  );
}

/** One line on the realized network at f0, and its worst VSWR over the sweep when one is on. */
function RealizedSummary({ view }: { view: RealizedView }) {
  const { result, sourceLabel } = view.realization;
  const info = result.info[result.info.length - 1];
  if (!info) return null;
  let worst: SweepPoint | undefined;
  for (const p of view.sweep ?? []) if (!worst || p.info.vswr > worst.info.vswr) worst = p;
  return (
    <p className="mono small realized-summary" title="The network built from the realized values">
      Realized ({sourceLabel}): Zin {fmtComplex(info.z, 1)} &#937; &nbsp; |&#915;|{' '}
      {fmtNum(info.gammaMag, 3)} &nbsp; VSWR {fmtNum(info.vswr, 3)} &nbsp; RL{' '}
      {Number.isFinite(info.returnLossDb) ? fmtNum(info.returnLossDb, 1) : '∞'} dB
      {worst && (
        <>
          {' '}
          &nbsp; worst VSWR {fmtNum(worst.info.vswr, 2)} at {fmtFrequency(worst.frequency)}
        </>
      )}
    </p>
  );
}

function SweepTable({ sweep }: { sweep: readonly SweepPoint[] }) {
  const [open, setOpen] = useState(false);
  let worst = sweep[0];
  for (const p of sweep) if (worst && p.info.vswr > worst.info.vswr) worst = p;
  return (
    <div className="sweep-table">
      <Button size="sm" onClick={() => setOpen(!open)} aria-expanded={open}>
        {open ? 'Hide' : 'Show'} {sweep.length} sweep points
      </Button>
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

/** Return loss in dB for a table cell: capped at 100 dB, where the match is perfect for any purpose. */
function fmtReturnLoss(db: number): string {
  if (!Number.isFinite(db) || db > 100) return '> 100';
  return fmtNum(db, 1);
}
