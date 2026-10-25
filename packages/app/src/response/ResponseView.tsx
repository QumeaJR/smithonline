/**
 * The Response view: four stacked panels of the ladder's response over the
 * sweep range, a shared cursor, markers and a readout table.
 */
import {
  formatEngineering,
  limitStatus,
  type LimitQuantity,
  type Response,
} from '@smithonline/core';
import { useMemo, useState } from 'react';
import { ladderBandwidth } from '../lib/bandwidth';
import { designLadder, effectiveElements } from '../lib/realize';
import { fmtDeg, fmtFrequency, fmtNum } from '../lib/format';
import { useCoarsePointer } from '../lib/pointer';
import { pointerHints } from '../lib/tips';
import { MAX_MARKERS, useDesignStore } from '../store/useDesignStore';
import { resample } from '../lib/overlays';
import { useOverlays } from '../store/useOverlays';
import { LimitPanel } from './LimitPanel';
import { OverlayBar } from './OverlayBar';
import { Plot, type PlotAxis, type PlotLimit, type PlotSeries } from './Plot';
import { useThemeToken } from './useThemeToken';
import { IconClose } from '../components/ui/icons';
import { Button } from '../components/ui/Button';
import { Segmented } from '../components/ui/Segmented';
import { EmptyState } from '../components/ui/EmptyState';
import { applyHalfToDoubleSweep, HALF_TO_DOUBLE_LABEL } from '../lib/emptyActions';

interface ResponseViewProps {
  /** Null when the sweep range is not usable. */
  readonly response: Response | null;
  /** The response of the network as built with its component packages; null without packages. */
  readonly packaged?: Response | null;
  readonly designFrequency: number;
}

/** Curve colours; the Smith chart keeps its own palette for elements. */
const COLORS = {
  s21: '#1c7ed6',
  s11: '#d6336c',
  vswr: '#2f9e44',
  r: '#7048e8',
  x: '#f08c00',
  phase: '#0ca678',
  delay: '#e8590c',
};

/** The y scale each limit quantity of a panel is read on. */
type PanelQuantities = Partial<Record<LimitQuantity, 'y' | 'd'>>;

interface Quantity {
  readonly key: keyof Omit<Response, 'frequency'>;
  readonly label: string;
  readonly color: string;
  readonly format: (v: number) => string;
}

const QUANTITIES: readonly Quantity[] = [
  { key: 's21Db', label: '|S21|', color: COLORS.s21, format: (v) => `${fmtNum(v, 2)} dB` },
  { key: 's11Db', label: '|S11|', color: COLORS.s11, format: (v) => `${fmtNum(v, 2)} dB` },
  { key: 'vswr', label: 'VSWR', color: COLORS.vswr, format: (v) => fmtNum(v, 3) },
  { key: 'r', label: 'R', color: COLORS.r, format: (v) => `${fmtNum(v, 2)} Ω` },
  { key: 'x', label: 'X', color: COLORS.x, format: (v) => `${fmtNum(v, 2)} Ω` },
  { key: 'phaseDeg', label: 'Phase S21', color: COLORS.phase, format: (v) => fmtDeg(v, 1) },
  {
    key: 'groupDelay',
    label: 'Group delay',
    color: COLORS.delay,
    format: (v) => formatEngineering(v, { unit: 's', digits: 3 }),
  },
];

const DB_AXIS: PlotAxis = {
  format: (v) => `${v}`,
  // Deep nulls of |S11| are not worth the vertical space; keep the floor at -60 dB.
  range: (min, max) => [Math.max(min, -60), Math.max(max, 0.5)],
};
const VSWR_AXIS: PlotAxis = {
  format: (v) => `${v}`,
  range: (_min, max) => [1, Math.max(1.5, Math.min(max, 50))],
};
const OHM_AXIS: PlotAxis = {
  format: (v) => `${v}`,
  range: (min, max) => [Math.max(min, -2000), Math.min(max, 2000)],
};
const DEG_AXIS: PlotAxis = { format: (v) => `${v}°` };
const DELAY_AXIS: PlotAxis = {
  format: (v) => formatEngineering(v, { unit: 's', digits: 3 }),
  range: (min, max) => [Math.max(min, -1e-6), Math.min(max, 1e-6)],
};

export function ResponseView({ response, packaged = null, designFrequency }: ResponseViewProps) {
  const hints = pointerHints(useCoarsePointer());
  const logX = useDesignStore((s) => s.response.logX);
  const markers = useDesignStore((s) => s.response.markers);
  const limitAreas = useDesignStore((s) => s.design.limits);
  const overlays = useOverlays((s) => s.overlays);
  const vswrLimit = useDesignStore((s) => s.response.vswrLimit);
  const design = useDesignStore((s) => s.design);
  const { setResponse, addMarker, removeMarker } = useDesignStore.getState();
  const [cursor, setCursor] = useState<number | null>(null);
  const themeToken = useThemeToken();

  const xs = response?.frequency ?? [];
  /** The usable band of the network the plots show (ideal values with the loss model). */
  const vswrBand = useMemo(() => {
    if (!(vswrLimit > 1)) return undefined;
    const bw = ladderBandwidth(designLadder(design, effectiveElements(design)), vswrLimit);
    return { limit: vswrLimit, band: bw ? { low: bw.low, high: bw.high } : null };
  }, [design, vswrLimit]);
  const panels = useMemo(() => {
    const series = (q: Quantity, scale: 'y' | 'd' = 'y'): PlotSeries => ({
      label: q.label,
      color: q.color,
      values: response?.[q.key] ?? [],
      scale,
      format: q.format,
    });
    const [s21, s11, vswr, r, x, phase, delay] = QUANTITIES as [
      Quantity,
      Quantity,
      Quantity,
      Quantity,
      Quantity,
      Quantity,
      Quantity,
    ];
    return [
      {
        title: 'Gain and return loss, dB',
        series: [series(s21), series(s11)],
        left: DB_AXIS,
        quantities: { s21Db: 'y', s11Db: 'y' } as PanelQuantities,
      },
      {
        title: 'VSWR',
        series: [series(vswr)],
        left: VSWR_AXIS,
        band: true,
        quantities: { vswr: 'y' } as PanelQuantities,
      },
      {
        title: 'Input impedance, Ω',
        series: [series(r), series(x)],
        left: OHM_AXIS,
        quantities: { r: 'y', x: 'y' } as PanelQuantities,
      },
      {
        title: 'S21 phase and group delay',
        series: [series(phase), series(delay, 'd')],
        left: DEG_AXIS,
        right: DELAY_AXIS,
        quantities: { phaseDeg: 'y', groupDelay: 'd' } as PanelQuantities,
      },
    ];
  }, [response]);

  /** The network as built: the same quantities dotted in the same colours. */
  const packagedSeries = useMemo(
    () =>
      panels.map((p): PlotSeries[] =>
        packaged
          ? p.series.map((s) => {
              const q = QUANTITIES.find((x) => x.label === s.label);
              return {
                ...s,
                label: `${s.label} with packages`,
                values: q ? packaged[q.key] : [],
                dash: [1, 4],
              };
            })
          : [],
      ),
    [panels, packaged],
  );

  /** Stored curves per panel: each overlay draws the panel's quantities dashed in its own colour. */
  const overlaySeries = useMemo(
    () =>
      panels.map((p): PlotSeries[] =>
        overlays.flatMap((o) =>
          (Object.keys(p.quantities) as LimitQuantity[]).map((key, k) => ({
            label: `${o.name} ${QUANTITIES.find((q) => q.key === key)?.label ?? key}`,
            color: o.color,
            values: resample(o, key, xs),
            scale: p.quantities[key] ?? 'y',
            dash: k === 0 ? [6, 4] : [2, 3],
          })),
        ),
      ),
    // xs follows the response.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [panels, overlays, response],
  );

  /** The limit areas on each panel, shaded red when the curve breaks them. */
  const limitsByPanel = useMemo(
    () =>
      panels.map((p): PlotLimit[] =>
        (limitAreas ?? []).flatMap((a): PlotLimit[] => {
          const scale = p.quantities[a.quantity];
          if (!scale) return [];
          const status = response ? limitStatus(a, response) : null;
          return [
            {
              f1: a.f1,
              f2: a.f2,
              kind: a.kind,
              value: a.value,
              scale,
              violated: status !== null && status.worst > 0,
            },
          ];
        }),
      ),
    [panels, limitAreas, response],
  );

  /** Nearest sample index of a marker frequency, for the readout. */
  const indexOf = (f: number): number | null => {
    if (xs.length === 0) return null;
    let best = 0;
    for (let i = 1; i < xs.length; i++) {
      if (Math.abs((xs[i] as number) - f) < Math.abs((xs[best] as number) - f)) best = i;
    }
    return best;
  };

  const columns: {
    readonly label: string;
    readonly idx: number | null;
    readonly marker?: number;
  }[] = [
    { label: 'Cursor', idx: cursor !== null && cursor < xs.length ? cursor : null },
    ...markers.map((f, i) => ({ label: `M${i + 1}`, idx: indexOf(f), marker: i })),
  ];

  return (
    <div className="response">
      <div className="response-toolbar">
        <Segmented
          ariaLabel="Frequency axis"
          value={logX ? 'log' : 'linear'}
          onChange={(v) => setResponse({ logX: v === 'log' })}
          options={[
            { value: 'linear', label: 'Linear f', title: 'Linear frequency axis' },
            {
              value: 'log',
              label: 'Log f',
              title: 'Logarithmic frequency axis with log-spaced sweep points',
            },
          ]}
        />
        <span className="muted small">
          {hints.responseMarker} ({markers.length} of {MAX_MARKERS}); the dotted line is the design
          frequency.
        </span>
        <span className="spacer" />
        {markers.length > 0 && (
          <Button size="sm" onClick={() => setResponse({ markers: [] })}>
            Clear markers
          </Button>
        )}
      </div>
      <OverlayBar response={response} />
      <LimitPanel response={response} />
      {response === null ? (
        <EmptyState
          className="response-empty"
          title="Set a sweep range"
          line="The plots need a positive start below the stop frequency; set it in the sweep panel under Numbers, or take an octave on each side of f."
          action={{
            label: HALF_TO_DOUBLE_LABEL,
            onClick: applyHalfToDoubleSweep,
            title: `Sweep from ${fmtFrequency(designFrequency / 2)} to ${fmtFrequency(designFrequency * 2)}`,
          }}
        />
      ) : (
        <div className="plots">
          {panels.map((p, pi) => (
            <section className="panel" key={p.title}>
              <h3>
                {p.title}
                {p.series.map((s) => (
                  <span className="legend" key={s.label}>
                    <span className="sw" style={{ background: s.color }} />
                    {s.label}
                  </span>
                ))}
                {packaged && (
                  <span className="legend" title="Dotted: the network as built with its packages">
                    <span className="sw dotted" />
                    with packages
                  </span>
                )}
                {'band' in p && vswrBand && (
                  <span className="legend">
                    <span className="sw band" />
                    {vswrBand.band
                      ? `VSWR below ${vswrBand.limit}`
                      : `limit ${vswrBand.limit}, not met at f0`}
                  </span>
                )}
              </h3>
              <Plot
                xs={xs}
                series={[...p.series, ...(packagedSeries[pi] ?? []), ...(overlaySeries[pi] ?? [])]}
                logX={logX}
                left={p.left}
                right={p.right}
                markers={markers}
                limits={limitsByPanel[pi] as PlotLimit[]}
                vswrBand={'band' in p ? vswrBand : undefined}
                designFrequency={designFrequency}
                themeToken={themeToken}
                onCursor={setCursor}
                onClick={(idx) => {
                  const f = xs[idx];
                  if (f !== undefined) addMarker(f);
                }}
              />
            </section>
          ))}
        </div>
      )}
      <table className="readout-table">
        <thead>
          <tr>
            <th />
            {columns.map((c) => (
              <th key={c.label}>
                {c.label}
                {c.marker !== undefined && (
                  <button
                    type="button"
                    className="btn icon sm"
                    onClick={() => removeMarker(c.marker as number)}
                    aria-label={`Remove ${c.label}`}
                    title={`Remove ${c.label}`}
                  >
                    <IconClose size={13} />
                  </button>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>f</td>
            {columns.map((c) => (
              <td key={c.label}>{c.idx !== null ? fmtFrequency(xs[c.idx] as number) : '–'}</td>
            ))}
          </tr>
          {QUANTITIES.map((q) => (
            <tr key={q.key}>
              <td>
                <span className="sw" style={{ background: q.color }} />
                {q.label}
              </td>
              {columns.map((c) => {
                const v = c.idx !== null ? response?.[q.key][c.idx] : undefined;
                return <td key={c.label}>{v === undefined ? '–' : q.format(v)}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
