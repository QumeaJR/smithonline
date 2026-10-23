import type { Ladder } from '@smithonline/core';
import { useMemo } from 'react';
import { ladderBandwidth } from '../lib/bandwidth';
import { fmtFrequency, fmtNum } from '../lib/format';
import { useDesignStore } from '../store/useDesignStore';
import { ValueInput } from './ValueInput';

interface BandwidthReadoutProps {
  readonly ladder: Ladder;
}

/**
 * Usable bandwidth under the datapoints table: the span around the design
 * frequency over which VSWR stays below the limit.
 */
export function BandwidthReadout({ ladder }: BandwidthReadoutProps) {
  const limit = useDesignStore((s) => s.response.vswrLimit);
  const { setResponse } = useDesignStore.getState();
  const bw = useMemo(() => (limit > 1 ? ladderBandwidth(ladder, limit) : null), [ladder, limit]);
  const f0 = ladder.frequency;

  return (
    <div className="bandwidth" aria-label="Usable bandwidth">
      <div className="row">
        <span>Usable bandwidth, VSWR &#8804;</span>
        <ValueInput
          value={limit}
          plain
          digits={3}
          min={1.0001}
          width="4.5em"
          onCommit={(vswrLimit) => setResponse({ vswrLimit })}
          ariaLabel="VSWR limit"
          title="VSWR limit; the band is where VSWR stays below it"
        />
      </div>
      {bw ? (
        <p className="mono small" data-testid="bandwidth-result">
          {bw.lowOpen ? '< ' : ''}
          {fmtFrequency(bw.low)} to {bw.highOpen ? '> ' : ''}
          {fmtFrequency(bw.high)}
          <br />
          span {bw.lowOpen || bw.highOpen ? '> ' : ''}
          {fmtFrequency(bw.span)}, {bw.lowOpen || bw.highOpen ? '> ' : ''}
          {fmtNum((100 * bw.span) / f0, 1)} % of f0
        </p>
      ) : (
        <p className="muted small">
          {limit > 1
            ? `VSWR at ${fmtFrequency(f0)} is above ${fmtNum(limit, 2)}; no usable band.`
            : 'The limit must be above 1.'}
        </p>
      )}
    </div>
  );
}
