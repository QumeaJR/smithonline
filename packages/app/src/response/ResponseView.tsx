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
import { useEffect, useMemo, useState } from 'react';
import { fmtDeg, fmtFrequency, fmtNum } from '../lib/format';
import { MAX_MARKERS, useDesignStore } from '../store/useDesignStore';
import { resample } from '../lib/overlays';
import { useOverlays } from '../store/useOverlays';
import { LimitPanel } from './LimitPanel';
import { OverlayBar } from './OverlayBar';
import { Plot, type PlotAxis, type PlotLimit, type PlotSeries } from './Plot';

interface ResponseViewProps {
  /** Null when the sweep range is not usable. */
  readonly response: Response | null;
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

/** Changes whenever the theme attribute or the system colour scheme does. */
function useThemeToken(): number {
  const [token, setToken] = useState(0);
  useEffect(() => {
    const bump = (): void => setToken((t) => t + 1);
    const observer = new MutationObserver(bump);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    media.addEventListener('change', bump);
    return () => {
      observer.disconnect();
      media.removeEventListener('change', bump);
    };
  }, []);
  return token;
}

export function ResponseView({ response, designFrequency }: ResponseViewProps) {
  const logX = useDesignStore((s) => s.response.logX);
  const markers = useDesignStore((s) => s.response.markers);
  const limitAreas = useDesignStore((s) => s.design.limits);
  const overlays = useOverlays((s) => s.overlays);
  const { setResponse, addMarker, removeMarker } = useDesignStore.getState();
  const [cursor, setCursor] = useState<number | null>(null);
  const themeToken = useThemeToken();

  const xs = response?.frequency ?? [];
  const panels = useMemo(() => {
    const series = (q: Quantity, scale: 'y' | 'd' = 'y'): PlotSeries => ({
      label: q.label,
      color: q.color,
      values: response?.[q.key] ?? [],
      scale,
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
        <button
          className={`btn ${logX ? '' : 'on'}`}
          onClick={() => setResponse({ logX: false })}
          title="Linear frequency axis"
        >
          Linear f
        </button>
        <button
          className={`btn ${logX ? 'on' : ''}`}
          onClick={() => setResponse({ logX: true })}
          title="Logarithmic frequency axis with log-spaced sweep points"
        >
          Log f
        </button>
        <span className="muted small">
          Click a curve to set a marker ({markers.length} of {MAX_MARKERS}); the dotted line is the
          design frequency.
        </span>
        <span className="spacer" />
        {markers.length > 0 && (
          <button className="btn tiny" onClick={() => setResponse({ markers: [] })}>
            Clear markers
          </button>
        )}
      </div>
      <OverlayBar response={response} />
      <LimitPanel response={response} />
      {response === null ? (
        <p className="hint">
          Set a sweep range with a positive start below the stop frequency in the right panel to
          plot the response.
        </p>
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
              </h3>
              <Plot
                xs={xs}
                series={[...p.series, ...(overlaySeries[pi] ?? [])]}
                logX={logX}
                left={p.left}
                right={p.right}
                markers={markers}
                limits={limitsByPanel[pi] as PlotLimit[]}
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
                    className="btn tiny"
                    onClick={() => removeMarker(c.marker as number)}
                    aria-label={`Remove ${c.label}`}
                    title={`Remove ${c.label}`}
                  >
                    &#215;
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
