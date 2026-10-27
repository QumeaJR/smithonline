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
import { useBandLimit } from '../store/useBandLimit';
import { BODE_FANO_TIP } from '../lib/broadband';
import { ladderBandwidth } from '../lib/bandwidth';
import { designLoadInfo, designLoadModel, loadModelText, useFitVersion } from '../lib/measuredLoad';
import { designLadder, effectiveElements } from '../lib/realize';
import { fmtDeg, fmtFrequency, fmtNum, NO_VALUE } from '../lib/format';
import { useCoarsePointer } from '../lib/pointer';
import { pointerHints } from '../lib/tips';
import { MAX_MARKERS, useDesignStore } from '../store/useDesignStore';
import { designVswrLimit } from '../lib/tolerance';
import { resample } from '../lib/overlays';
import { useOverlays } from '../store/useOverlays';
import { LimitPanel } from './LimitPanel';
import { MeasuredBoardPanel } from './MeasuredBoardPanel';
import { OverlayBar } from './OverlayBar';
import type { PlotAxis, PlotLimit, PlotSeries } from './Plot';
import { PlotPanel } from './PlotPanel';
import { validRange, type Range } from '../lib/plotZoom';
import { ZoomChip } from './ZoomChip';
import { useThemeToken } from './useThemeToken';
import { IconClose } from '../components/ui/icons';
import { Button } from '../components/ui/Button';
import { Segmented } from '../components/ui/Segmented';
import { EmptyState } from '../components/ui/EmptyState';
import { applyHalfToDoubleSweep, HALF_TO_DOUBLE_LABEL } from '../lib/emptyActions';
import { sweepRangeNote } from '../lib/parts';

interface ResponseViewProps {
  /** Null when the sweep range is not usable. */
  readonly response: Response | null;
  /** The response of the network as built with its component packages; null without packages. */
  readonly packaged?: Response | null;
  /** What the network as built adds: "packages", "the board" or both. */
  readonly builtWhat?: string | null;
  /**
   * Over a measured load: the network applied to each measured point, at the measured
   * frequencies (all among the response's), drawn as dots on the model's curves.
   */
  readonly measured?: Response | null;
  /** |S11| and VSWR of the load alone (no network), at the response's frequencies. */
  readonly loadAlone?: Response | null;
  readonly designFrequency: number;
}

/** Curve colours; the Smith chart keeps its own palette for elements. */
/**
 * Load without network comes on by itself the first time a measured load is shown in this
 * session (docs/09 section 2): the plot then shows what the match bought. Later the switch is
 * the user's.
 */
let loadAloneShown = false;
/** True the first time it is asked in this session, false after. */
function firstMeasuredShow(): boolean {
  if (loadAloneShown) return false;
  loadAloneShown = true;
  return true;
}

/** The Bode-Fano limit line: a neutral grey that reads in both themes. */
const BODE_FANO_COLOR = '#868e96';

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
  unit: 'dB',
  exportUnit: 'dB',
  // Deep nulls of |S11| are not worth the vertical space; keep the floor at -60 dB.
  range: (min, max) => [Math.max(min, -60), Math.max(max, 0.5)],
};
const VSWR_AXIS: PlotAxis = {
  format: (v) => `${v}`,
  range: (_min, max) => [1, Math.max(1.5, Math.min(max, 50))],
};
const OHM_AXIS: PlotAxis = {
  format: (v) => `${v}`,
  unit: 'Ω',
  exportUnit: 'ohm',
  range: (min, max) => [Math.max(min, -2000), Math.min(max, 2000)],
};
const DEG_AXIS: PlotAxis = { format: (v) => `${v}°`, exportUnit: 'deg' };
const DELAY_AXIS: PlotAxis = {
  format: (v) => formatEngineering(v, { unit: 's', digits: 3 }),
  exportUnit: 's',
  range: (min, max) => [Math.max(min, -1e-6), Math.min(max, 1e-6)],
};

export function ResponseView({
  response,
  packaged = null,
  builtWhat = null,
  measured = null,
  loadAlone = null,
  designFrequency,
}: ResponseViewProps) {
  const hints = pointerHints(useCoarsePointer());
  const logX = useDesignStore((s) => s.response.logX);
  const markers = useDesignStore((s) => s.response.markers);
  const limitAreas = useDesignStore((s) => s.design.limits);
  const overlays = useOverlays((s) => s.overlays);
  const vswrLimit = useDesignStore((s) => designVswrLimit(s.design));
  const design = useDesignStore((s) => s.design);
  const { setResponse, addMarker, removeMarker } = useDesignStore.getState();
  const [cursor, setCursor] = useState<number | null>(null);
  const themeToken = useThemeToken();

  const xs = response?.frequency ?? [];
  const loadAloneOn = useDesignStore((s) => s.response.loadAlone ?? false);
  // The shared frequency zoom holds for the sweep it was made on (docs/10 section 4.2): a new
  // sweep range, Log f or measured load clears it.
  const zoomBasis = `${xs[0] ?? ''}|${xs[xs.length - 1] ?? ''}|${logX}|${design.sweep.loads ? design.sweep.loads.length : 0}|${Boolean(measured)}`;
  const storedZoom = useDesignStore((s) => s.response.xZoom ?? null);
  const xZoom: Range | null =
    storedZoom && storedZoom.basis === zoomBasis && validRange(storedZoom.range, logX)
      ? storedZoom.range
      : null;
  const setXZoom = (r: Range | null): void =>
    setResponse({ xZoom: r ? { range: [r[0], r[1]], basis: zoomBasis } : null });
  const enlarged = useDesignStore((s) => s.response.enlarged ?? null);
  const setEnlarged = (id: string, on: boolean): void => setResponse({ enlarged: on ? id : null });
  useEffect(() => {
    if (!measured || !firstMeasuredShow()) return;
    if (!useDesignStore.getState().response.loadAlone) setResponse({ loadAlone: true });
  }, [measured, setResponse]);
  /** Where a library part's data stops short of the plotted range: the plots leave it empty. */
  const noDataNote = useMemo(() => {
    const fs = response?.frequency ?? [];
    if (fs.length === 0) return null;
    return sweepRangeNote(design.elements, Math.min(...fs), Math.max(...fs));
  }, [design.elements, response]);
  /** The measured load's model, for the note over the plots. */
  const fits = useFitVersion();
  const loadInfo = useMemo(
    () => (measured ? designLoadInfo(design) : null),
    // fits: the model arrives from the fitting worker.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [measured, design, fits],
  );
  /** The usable band of the network the plots show (ideal values with the loss model). */
  const vswrBand = useMemo(() => {
    if (!(vswrLimit > 1)) return undefined;
    const bw = ladderBandwidth(
      designLadder(design, effectiveElements(design)),
      vswrLimit,
      designLoadModel(design),
    );
    return { limit: vswrLimit, band: bw ? { low: bw.low, high: bw.high } : null };
    // fits: the model arrives from the fitting worker.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [design, vswrLimit, fits]);
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
        id: 'gain',
        name: 'Gain and return loss',
        title: 'Gain and return loss, dB',
        series: [series(s21), series(s11)],
        left: DB_AXIS,
        quantities: { s21Db: 'y', s11Db: 'y' } as PanelQuantities,
      },
      {
        id: 'vswr',
        name: 'VSWR',
        title: 'VSWR',
        series: [series(vswr)],
        left: VSWR_AXIS,
        band: true,
        quantities: { vswr: 'y' } as PanelQuantities,
      },
      {
        id: 'impedance',
        name: 'Input impedance',
        title: 'Input impedance, Ω',
        series: [series(r), series(x)],
        left: OHM_AXIS,
        quantities: { r: 'y', x: 'y' } as PanelQuantities,
      },
      {
        id: 'phase',
        name: 'S21 phase and group delay',
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
                label: `${s.label} with ${builtWhat ?? 'packages'}`,
                values: q ? packaged[q.key] : [],
                dash: [1, 4],
              };
            })
          : [],
      ),
    [panels, packaged, builtWhat],
  );

  /** The measured points per panel: the panel's quantities as dots at the measured frequencies. */
  const measuredSeries = useMemo(() => {
    if (!measured || !response) return panels.map((): PlotSeries[] => []);
    const at = new Map<number, number>();
    response.frequency.forEach((f, i) => at.set(f, i));
    const align = (values: readonly number[]): (number | null)[] => {
      const out = new Array<number | null>(response.frequency.length).fill(null);
      measured.frequency.forEach((f, k) => {
        const i = at.get(f);
        if (i !== undefined) out[i] = values[k] ?? null;
      });
      return out;
    };
    return panels.map((p): PlotSeries[] =>
      p.series.map((s) => {
        const q = QUANTITIES.find((x) => x.label === s.label);
        return {
          ...s,
          label: `${s.label} measured`,
          values: q ? align(measured[q.key]) : [],
          points: true,
        };
      }),
    );
  }, [panels, measured, response]);

  /** The load alone, before the network: |S11| and VSWR dashed in their colours. */
  const loadAloneSeries = useMemo(
    () =>
      panels.map((p): PlotSeries[] =>
        loadAlone
          ? p.series.flatMap((s): PlotSeries[] => {
              const q = QUANTITIES.find((x) => x.label === s.label);
              if (!q || (q.key !== 's11Db' && q.key !== 'vswr')) return [];
              return [
                { ...s, label: `${s.label} load alone`, values: loadAlone[q.key], dash: [3, 3] },
              ];
            })
          : [],
      ),
    [panels, loadAlone],
  );

  /** The Bode-Fano limit of the last Broadband search over these rows, dashed on the VSWR plot. */
  const bandLimit = useBandLimit((s) => s.limit);
  const limitSeries = useMemo((): PlotSeries | null => {
    if (!measured || !bandLimit || bandLimit.loads !== design.sweep.loads) return null;
    return {
      label: 'Bode-Fano limit',
      color: BODE_FANO_COLOR,
      values: xs.map((f) => (f >= bandLimit.start && f <= bandLimit.stop ? bandLimit.floor : null)),
      dash: [8, 4],
    };
    // xs follows the response.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [measured, bandLimit, design.sweep.loads, response]);

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
        {xZoom && <ZoomChip range={xZoom} onReset={() => setXZoom(null)} />}
        <span className="spacer" />
        <Button
          size="sm"
          pressed={loadAloneOn}
          onClick={() => setResponse({ loadAlone: !loadAloneOn })}
          title="Also plot |S11| and VSWR of the load alone, before the network, to see what the network improves"
          data-tour="response.loadAlone"
        >
          Load without network
        </Button>
        {markers.length > 0 && (
          <Button size="sm" onClick={() => setResponse({ markers: [] })}>
            Clear markers
          </Button>
        )}
      </div>
      <p className="muted small response-hint">
        {hints.responseMarker} ({markers.length} of {MAX_MARKERS}); the dotted line is the design
        frequency. {hints.plotZoom}.
      </p>
      {measured && loadInfo && (
        <p className="muted small measured-load-note">
          Over the measured load: the curves follow the load model ({loadModelText(loadInfo)})
          across the measured band, and the dots are the network on each measured point.
        </p>
      )}
      {noDataNote && (
        <p className="small warn-text response-no-data" role="note">
          {noDataNote}.
        </p>
      )}
      <OverlayBar response={response} />
      <LimitPanel response={response} />
      {design.measurement && (
        <div className="plots measured-plots" hidden={enlarged !== null && enlarged !== 'measured'}>
          <MeasuredBoardPanel
            logX={logX}
            enlarged={enlarged === 'measured'}
            onEnlarge={(on) => setEnlarged('measured', on)}
          />
        </div>
      )}
      {response === null ? (
        <EmptyState
          className="response-empty"
          title="Set a sweep range"
          line="The plots need a sweep range of two different positive frequencies; set it in the sweep panel under Numbers, or take an octave on each side of f."
          action={{
            label: HALF_TO_DOUBLE_LABEL,
            onClick: applyHalfToDoubleSweep,
            title: `Sweep from ${fmtFrequency(designFrequency / 2)} to ${fmtFrequency(designFrequency * 2)}`,
          }}
        />
      ) : (
        <div
          className={`plots${enlarged !== null ? ' has-enlarged' : ''}`}
          hidden={enlarged === 'measured' && Boolean(design.measurement)}
        >
          {panels.map((p, pi) => (
            <PlotPanel
              key={p.id}
              title={p.name}
              exportTitle={p.title}
              fileId={p.id}
              kind="response"
              enlarged={enlarged === p.id}
              hidden={enlarged !== null && enlarged !== p.id && enlarged !== 'measured'}
              onEnlarge={(on) => setEnlarged(p.id, on)}
              heading={
                <>
                  {p.title}
                  {p.series.map((s) => (
                    <span className="legend" key={s.label}>
                      <span className="sw" style={{ background: s.color }} />
                      {s.label}
                    </span>
                  ))}
                  {(measuredSeries[pi]?.length ?? 0) > 0 && (
                    <span className="legend" title="Dots: the network on each measured point">
                      <span className="sw dot" />
                      measured
                    </span>
                  )}
                  {(loadAloneSeries[pi]?.length ?? 0) > 0 && (
                    <span className="legend" title="Dashed: the load alone, before the network">
                      <span className="sw dashed" />
                      load alone
                    </span>
                  )}
                  {packaged && (
                    <span
                      className="legend"
                      title={`Dotted: the network as built with ${builtWhat ?? 'packages'}`}
                    >
                      <span className="sw dotted" />
                      with {builtWhat ?? 'packages'}
                    </span>
                  )}
                  {'band' in p && limitSeries && (
                    <span className="legend" title={BODE_FANO_TIP}>
                      <span className="sw dashed" style={{ borderColor: BODE_FANO_COLOR }} />
                      Bode-Fano limit
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
                </>
              }
              plot={{
                xs,
                series: [
                  ...p.series,
                  ...(loadAloneSeries[pi] ?? []),
                  ...(measuredSeries[pi] ?? []),
                  ...(packagedSeries[pi] ?? []),
                  ...(overlaySeries[pi] ?? []),
                  ...('band' in p && limitSeries ? [limitSeries] : []),
                ],
                logX,
                left: p.left,
                right: p.right,
                markers,
                limits: limitsByPanel[pi] as PlotLimit[],
                vswrBand: 'band' in p ? vswrBand : undefined,
                designFrequency,
                themeToken,
                onCursor: setCursor,
                xRange: xZoom,
                onXRange: setXZoom,
                onClick: (idx) => {
                  const f = xs[idx];
                  if (f === undefined) return;
                  const had = useDesignStore.getState().response.markers.includes(f);
                  addMarker(f);
                  // The first click of a double click is taken back (Plot.tsx).
                  return had
                    ? undefined
                    : () => {
                        const at = useDesignStore.getState().response.markers.indexOf(f);
                        if (at >= 0) removeMarker(at);
                      };
                },
              }}
            />
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
              <td key={c.label}>{c.idx !== null ? fmtFrequency(xs[c.idx] as number) : NO_VALUE}</td>
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
                return <td key={c.label}>{v === undefined ? NO_VALUE : q.format(v)}</td>;
              })}
            </tr>
          ))}
          {loadAlone &&
            QUANTITIES.filter((q) => q.key === 's11Db' || q.key === 'vswr').map((q) => (
              <tr key={`${q.key}-alone`} className="load-alone-row">
                <td title="The load alone, before the network">
                  <span className="sw dashed" />
                  {q.label} load alone
                </td>
                {columns.map((c) => {
                  const v = c.idx !== null ? loadAlone[q.key][c.idx] : undefined;
                  return <td key={c.label}>{v === undefined ? NO_VALUE : q.format(v)}</td>;
                })}
              </tr>
            ))}
          {packaged &&
            QUANTITIES.filter(
              (q) => q.key === 's11Db' || q.key === 'vswr' || q.key === 's21Db',
            ).map((q) => (
              <tr key={`${q.key}-built`} className="as-built-row">
                <td title={`Dotted: the network as built with ${builtWhat ?? 'packages'}`}>
                  <span className="sw dotted" />
                  {q.label} as built
                </td>
                {columns.map((c) => {
                  const v = c.idx !== null ? packaged[q.key][c.idx] : undefined;
                  return (
                    <td key={c.label}>
                      {v === undefined || !Number.isFinite(v) ? NO_VALUE : q.format(v)}
                    </td>
                  );
                })}
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  );
}
