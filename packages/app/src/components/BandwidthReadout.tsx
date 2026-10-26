import { measuredLoadInfo, type Ladder, type LoadModel } from '@smithonline/core';
import { useMemo } from 'react';
import { ladderBandwidth } from '../lib/bandwidth';
import { fmtNum } from '../lib/format';
import { formatEngineering } from '@smithonline/core';

/** Four significant digits are plenty for a band edge. */
const fmtFrequency = (f: number): string => formatEngineering(f, { unit: 'Hz', digits: 4 });
import { useDesignStore } from '../store/useDesignStore';
import { designVswrLimit, vswrLimitRefusal } from '../lib/tolerance';
import { ValueInput } from './ValueInput';

interface BandwidthReadoutProps {
  readonly ladder: Ladder;
  /** The load across frequency (a measured load); default the ladder's fixed load. */
  readonly load?: LoadModel;
}

/**
 * Usable bandwidth under the datapoints table: the span around the design
 * frequency over which VSWR towards the target (Z0 while none is set) stays
 * below the design's limit, the meaning Tolerance and the next steps share.
 */
export function BandwidthReadout({ ladder, load }: BandwidthReadoutProps) {
  const limit = useDesignStore((s) => designVswrLimit(s.design));
  const target = useDesignStore((s) => s.design.target);
  const { setVswrLimit } = useDesignStore.getState();
  const bw = useMemo(
    () => (limit > 1 ? ladderBandwidth(ladder, limit, load ?? ladder.load, target) : null),
    [ladder, limit, load, target],
  );
  const towards = target ? 'the target' : 'Z0';
  const bare = ladder.elements.length === 0;
  const f0 = ladder.frequency;
  const measured = measuredLoadInfo(load);
  const outside = measured !== null && !(f0 >= measured.band[0] && f0 <= measured.band[1]);
  /** Over a measured load an open edge is the end of the data, not more band beyond it. */
  const open = (edge: boolean): string => (edge && !measured ? '> ' : '');

  return (
    <div className="bandwidth" aria-label="Usable bandwidth">
      <div className="row">
        <span>Usable bandwidth, VSWR &#8804;</span>
        <ValueInput
          value={limit}
          plain
          digits={3}
          validate={vswrLimitRefusal}
          width="4.5em"
          onCommit={setVswrLimit}
          ariaLabel="VSWR limit"
          title="The design's VSWR limit; the band is where VSWR towards the target (Z0 while none is set) stays below it. Also the limit of Tolerance and the next steps"
        />
      </div>
      {bare ? (
        <p className="muted small">Add elements to see the usable band.</p>
      ) : bw ? (
        <p className="mono small" data-testid="bandwidth-result">
          {bw.lowOpen && !measured ? '< ' : ''}
          {fmtFrequency(bw.low)} to {open(bw.highOpen)}
          {fmtFrequency(bw.high)}
          <br />
          span {open(bw.lowOpen || bw.highOpen)}
          {fmtFrequency(bw.span)}, {open(bw.lowOpen || bw.highOpen)}
          {fmtNum((100 * bw.span) / f0, 1)} % of f0
          {target && (
            <>
              <br />
              <span className="muted">VSWR towards the target</span>
            </>
          )}
          {measured && (bw.lowOpen || bw.highOpen) && (
            <>
              <br />
              <span className="muted">
                Reaches the end of the data at{' '}
                {[bw.lowOpen ? bw.low : null, bw.highOpen ? bw.high : null]
                  .filter((v): v is number => v !== null)
                  .map(fmtFrequency)
                  .join(' and ')}
                ; the band may go on past it.
              </span>
            </>
          )}
        </p>
      ) : outside ? (
        <p className="muted small">
          The design frequency lies outside the measured data; no usable band is read from it.
        </p>
      ) : (
        <p className="muted small">
          {limit > 1
            ? `VSWR at ${fmtFrequency(f0)} is above ${fmtNum(limit, 2)}; no usable band.`
            : 'The limit must be above 1.'}{' '}
          VSWR is referred to {towards} at the source end.
        </p>
      )}
    </div>
  );
}
