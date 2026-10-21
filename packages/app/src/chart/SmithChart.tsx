import { zToGamma, type Complex, type LadderResult, type SweepPoint } from '@smithonline/core';
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { ChartCircle } from '../lib/circles';
import { datapointLabel, fmtFrequency } from '../lib/format';
import type { ChartOptions } from '../store/useDesignStore';
import { gridCircles, gridLabels } from './grid';

export interface ChartProps {
  readonly result: LadderResult;
  readonly z0: number;
  readonly options: ChartOptions;
  readonly selected: number | null;
  readonly sweep: readonly SweepPoint[] | null;
  /** A frequency sweep is drawn as a locus, a datapoint sweep as SP markers. */
  readonly sweepKind: 'frequency' | 'datapoints';
  /** The realized network, drawn dashed beside the ideal one. */
  readonly realized: LadderResult | null;
  readonly realizedSweep: readonly SweepPoint[] | null;
  /** Where the network should land, drawn as a hollow square. */
  readonly target: Complex;
  readonly vswrCircles: readonly number[];
  readonly qContours: readonly number[];
  /** Stability, gain and noise circles of the two-port device. */
  readonly deviceCircles: readonly ChartCircle[];
  /** Colour of each element locus, in ladder order. */
  readonly arcColors: readonly string[];
  readonly onSelect: (index: number | null) => void;
  readonly onHover: (gamma: Complex | null) => void;
  /** A datapoint is being dragged to this reflection coefficient. */
  readonly onDragDatapoint: (index: number, gamma: Complex) => void;
  readonly onDragEnd: () => void;
  /** Preview of an element being placed or a suggested match. */
  readonly ghost: Ghost | null;
  /** A plain click on the chart while an element is armed: place it here. */
  readonly onPlace: ((gamma: Complex) => void) | null;
  /** Double click: ask for match suggestions towards this point. */
  readonly onSuggest: (gamma: Complex, clientX: number, clientY: number) => void;
  /** Bump to reset zoom and pan. */
  readonly fitKey: number;
  /** Right click at this reflection coefficient and screen position, on datapoint `point` if any. */
  readonly onContextMenu: (
    gamma: Complex,
    clientX: number,
    clientY: number,
    point: number | null,
  ) => void;
  readonly svgRef: RefObject<SVGSVGElement | null>;
}

export interface Ghost {
  /** Where the armed element can reach from the current input point, as impedances. */
  readonly reach: readonly Complex[];
  /** Loci of the previewed elements, as impedances. */
  readonly arcs: readonly (readonly Complex[])[];
  /** Where the preview lands. */
  readonly marker: Complex | null;
  readonly label: string;
  readonly color: string;
}

/** Keep dragged points inside the chart so the impedance stays finite. */
function clampGamma(g: Complex, max = 0.995): Complex {
  const m = Math.hypot(g.re, g.im);
  return m > max ? { re: (g.re * max) / m, im: (g.im * max) / m } : g;
}

interface View {
  readonly cx: number;
  readonly cy: number;
  readonly half: number;
}

const HOME: View = { cx: 0, cy: 0, half: 1.18 };

function pathOf(points: readonly Complex[], z0: number): string {
  let d = '';
  for (const z of points) {
    const g = zToGamma(z, z0);
    if (!Number.isFinite(g.re) || !Number.isFinite(g.im)) continue;
    // Clamp far-away points so a near-open does not blow up the path extents.
    const m = Math.hypot(g.re, g.im);
    const k = m > 3 ? 3 / m : 1;
    d += `${d ? 'L' : 'M'}${(g.re * k).toFixed(5)} ${(-g.im * k).toFixed(5)}`;
  }
  return d;
}

export function SmithChart({
  result,
  z0,
  options,
  selected,
  sweep,
  sweepKind,
  realized,
  realizedSweep,
  target,
  vswrCircles,
  qContours,
  deviceCircles,
  arcColors,
  onSelect,
  onHover,
  onDragDatapoint,
  onDragEnd,
  onContextMenu,
  ghost,
  onPlace,
  onSuggest,
  fitKey,
  svgRef,
}: ChartProps) {
  const [view, setView] = useState<View>(HOME);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ x: number; y: number; cx: number; cy: number; moved: boolean } | null>(
    null,
  );
  /** Index of the datapoint under the pointer while it is being dragged. */
  const dragPoint = useRef<number | null>(null);
  const k = view.half / HOME.half; // scales text and markers so they stay the same size on screen

  const toChart = useCallback(
    (clientX: number, clientY: number): Complex | null => {
      const svg = svgRef.current;
      if (!svg) return null;
      const ctm = svg.getScreenCTM();
      if (!ctm) return null;
      const p = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
      return { re: p.x, im: -p.y };
    },
    [svgRef],
  );

  // Wheel zoom needs a non-passive listener to stop the page from scrolling.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      const at = toChart(e.clientX, e.clientY);
      if (!at) return;
      setView((v) => {
        const factor = Math.exp(e.deltaY * 0.0015);
        const half = Math.min(4, Math.max(0.05, v.half * factor));
        const s = half / v.half;
        return { half, cx: at.re + (v.cx - at.re) * s, cy: -at.im + (v.cy + at.im) * s };
      });
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, [svgRef, toChart]);

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>): void => {
    if (e.button !== 0) return;
    drag.current = { x: e.clientX, y: e.clientY, cx: view.cx, cy: view.cy, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>): void => {
    const g = toChart(e.clientX, e.clientY);
    onHover(g && Math.hypot(g.re, g.im) <= 1 ? g : null);
    if (dragPoint.current !== null) {
      if (g) onDragDatapoint(dragPoint.current, clampGamma(g));
      return;
    }
    const d = drag.current;
    if (!d) return;
    const svg = e.currentTarget;
    const scale = (2 * view.half) / svg.clientWidth;
    const dx = (e.clientX - d.x) * scale;
    const dy = (e.clientY - d.y) * scale;
    if (Math.abs(dx) + Math.abs(dy) > 0.002 && !d.moved) {
      d.moved = true;
      setDragging(true);
    }
    if (d.moved) setView((v) => ({ ...v, cx: d.cx - dx, cy: d.cy - dy }));
  };
  const onPointerUp = (e: React.PointerEvent<SVGSVGElement>): void => {
    if (dragPoint.current !== null) {
      dragPoint.current = null;
      setDragging(false);
      onDragEnd();
      return;
    }
    const d = drag.current;
    drag.current = null;
    setDragging(false);
    if (d && !d.moved) {
      const g = toChart(e.clientX, e.clientY);
      if (onPlace && g && Math.hypot(g.re, g.im) <= 1) onPlace(clampGamma(g));
      else if (e.target === e.currentTarget) onSelect(null);
    }
  };

  // The Fit button resets zoom and pan.
  const [lastFit, setLastFit] = useState(fitKey);
  if (fitKey !== lastFit) {
    setLastFit(fitKey);
    setView(HOME);
  }
  const startPointDrag = (index: number) => (e: React.PointerEvent<SVGGElement>) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    dragPoint.current = index;
    setDragging(true);
    onSelect(index);
    e.currentTarget.ownerSVGElement?.setPointerCapture(e.pointerId);
  };

  const zCircles = options.zGrid ? gridCircles(options.density, 1) : [];
  const yCircles = options.yGrid ? gridCircles(options.density, -1) : [];
  const labels = options.labels
    ? [
        ...(options.zGrid ? gridLabels(options.density, 1) : []),
        ...(options.yGrid && !options.zGrid ? gridLabels(options.density, -1) : []),
      ]
    : [];
  const gammas = result.datapoints.map((z) => zToGamma(z, z0));
  const fontSize = 0.045 * k;

  return (
    <svg
      ref={svgRef}
      className="smith-chart"
      viewBox={`${view.cx - view.half} ${view.cy - view.half} ${2 * view.half} ${2 * view.half}`}
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="Smith chart"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={() => onHover(null)}
      onDoubleClick={(e) => {
        const g = toChart(e.clientX, e.clientY);
        if (g && Math.hypot(g.re, g.im) <= 1) onSuggest(clampGamma(g), e.clientX, e.clientY);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        const g = toChart(e.clientX, e.clientY);
        if (g && Math.hypot(g.re, g.im) <= 1) onContextMenu(g, e.clientX, e.clientY, null);
      }}
      style={{ cursor: dragging ? 'grabbing' : 'crosshair', touchAction: 'none' }}
    >
      <defs>
        <clipPath id="unit-disk">
          <circle cx={0} cy={0} r={1} />
        </clipPath>
      </defs>
      <circle cx={0} cy={0} r={1} className="chart-disk" />
      <g
        clipPath="url(#unit-disk)"
        className="grid-y"
        fill="none"
        vectorEffect="non-scaling-stroke"
      >
        {yCircles.map((c, i) => (
          <circle
            key={i}
            cx={c.cx}
            cy={c.cy}
            r={c.r}
            className={c.major ? 'major' : 'minor'}
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </g>
      <g clipPath="url(#unit-disk)" className="grid-z" fill="none">
        {zCircles.map((c, i) => (
          <circle
            key={i}
            cx={c.cx}
            cy={c.cy}
            r={c.r}
            className={c.major ? 'major' : 'minor'}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        <line x1={-1} y1={0} x2={1} y2={0} className="major" vectorEffect="non-scaling-stroke" />
      </g>
      <circle
        cx={0}
        cy={0}
        r={1}
        className="chart-rim"
        fill="none"
        vectorEffect="non-scaling-stroke"
      />
      <g className="grid-labels" fontSize={fontSize}>
        {labels.map((l, i) => (
          <text
            key={i}
            x={l.x}
            y={l.y === 0 ? -0.012 * k : l.y + fontSize * 0.35}
            textAnchor={l.anchor}
          >
            {l.text}
          </text>
        ))}
      </g>

      <g className="circles" fill="none" clipPath="url(#unit-disk)">
        {vswrCircles.map((v) => (
          <circle
            key={`v${v}`}
            cx={0}
            cy={0}
            r={(v - 1) / (v + 1)}
            className="vswr"
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {qContours.flatMap((q) =>
          [1, -1].map((s) => (
            <circle
              key={`q${q}${s}`}
              cx={0}
              cy={s / q}
              r={Math.sqrt(1 + 1 / (q * q))}
              className="q"
              vectorEffect="non-scaling-stroke"
            />
          )),
        )}
      </g>

      <g className="device-circles" fill="none">
        {(() => {
          /** Labels already placed, so a second one at the same spot moves down a line. */
          const placed: { x: number; y: number }[] = [];
          const apart = (x: number, y: number): [number, number] => {
            let yy = y;
            for (const p of placed) {
              if (Math.abs(p.x - x) < 0.3 * k && Math.abs(p.y - yy) < fontSize * 1.2) {
                yy = p.y + fontSize * 1.2;
              }
            }
            placed.push({ x, y: yy });
            return [x, yy];
          };
          return deviceCircles.map((c, i) => {
            const { center, radius } = c.circle;
            if (!(radius < 50)) return null;
            // Label at the top of the circle; a stability circle that dwarfs the
            // chart is described in the device panel instead.
            if (radius >= 1.5 && c.kind === 'stability') {
              // Label where the circle comes closest to the chart centre, which is
              // the part of it that lies on or near the chart.
              const d = Math.hypot(center.re, center.im) || 1;
              // Distance of that point from the centre, clamped to the chart edge so the
              // label stays in view when the circle lies entirely outside the chart.
              const reach = Math.max(-1.02, Math.min(1.02, d - radius));
              const px = (center.re / d) * reach;
              const py = (center.im / d) * reach;
              const [lx, ly] = apart(px, -py - 0.02 * k);
              return (
                <g key={i} className={c.kind}>
                  <circle
                    cx={center.re}
                    cy={-center.im}
                    r={radius}
                    vectorEffect="non-scaling-stroke"
                  />
                  <text
                    x={lx}
                    y={ly}
                    textAnchor="middle"
                    fontSize={fontSize * 0.85}
                    strokeWidth={0.01 * k}
                  >
                    {c.label}
                  </text>
                </g>
              );
            }
            const ly = -center.im - radius - 0.02 * k;
            return (
              <g key={i} className={c.kind}>
                <circle
                  cx={center.re}
                  cy={-center.im}
                  r={radius}
                  vectorEffect="non-scaling-stroke"
                  clipPath={c.kind === 'stability' ? undefined : 'url(#unit-disk)'}
                />
                <text
                  x={center.re}
                  y={ly}
                  textAnchor="middle"
                  fontSize={fontSize * 0.85}
                  strokeWidth={0.01 * k}
                >
                  {c.label}
                </text>
              </g>
            );
          });
        })()}
      </g>

      {sweep && sweepKind === 'datapoints' && (
        <g className="sweep points" fill="none">
          {sweep.map((p, i) => {
            const g = zToGamma(p.zin, z0);
            if (!Number.isFinite(g.re) || !Number.isFinite(g.im)) return null;
            return (
              <g key={i}>
                <circle cx={g.re} cy={-g.im} r={0.018 * k} className="sweep-end" />
                <text x={g.re + 0.028 * k} y={-g.im + fontSize * 0.35} fontSize={fontSize * 0.85}>
                  SP{i + 1}
                </text>
              </g>
            );
          })}
        </g>
      )}

      {sweep && sweepKind === 'frequency' && sweep.length > 1 && (
        <g className="sweep" fill="none">
          <path
            d={pathOf(
              sweep.map((p) => p.zin),
              z0,
            )}
            vectorEffect="non-scaling-stroke"
          />
          {[sweep[0], sweep[sweep.length - 1]].map((p, i) => {
            if (!p) return null;
            const g = zToGamma(p.zin, z0);
            return (
              <g key={i}>
                <circle cx={g.re} cy={-g.im} r={0.014 * k} className="sweep-end" />
                <text x={g.re + 0.025 * k} y={-g.im + fontSize * 0.35} fontSize={fontSize * 0.85}>
                  {fmtFrequency(p.frequency)}
                </text>
              </g>
            );
          })}
        </g>
      )}

      <g className="arcs" fill="none">
        {result.arcs.map((arc, i) => (
          <path
            key={i}
            d={pathOf(arc, z0)}
            stroke={arcColors[i] ?? 'currentColor'}
            strokeWidth={0.012 * k}
            strokeLinecap="round"
            opacity={selected === null || selected === i + 1 || selected === i ? 1 : 0.45}
          />
        ))}
      </g>

      {realized && (
        <g className="realized" fill="none" pointerEvents="none">
          {realizedSweep && realizedSweep.length > 1 && (
            <path
              className="realized-sweep"
              d={pathOf(
                realizedSweep.map((p) => p.zin),
                z0,
              )}
              vectorEffect="non-scaling-stroke"
            />
          )}
          {realized.arcs.map((arc, i) => (
            <path
              key={i}
              d={pathOf(arc, z0)}
              stroke={arcColors[i] ?? 'currentColor'}
              strokeWidth={0.009 * k}
              strokeDasharray={`${0.035 * k} ${0.022 * k}`}
              strokeLinecap="butt"
              opacity={selected === null || selected === i + 1 || selected === i ? 0.9 : 0.4}
            />
          ))}
          {realized.datapoints.map((z, i) => {
            if (i === 0) return null;
            const g = zToGamma(z, z0);
            return (
              <circle
                key={i}
                cx={g.re}
                cy={-g.im}
                r={(i === realized.datapoints.length - 1 ? 0.022 : 0.014) * k}
                className="realized-dp"
                strokeWidth={0.006 * k}
              />
            );
          })}
        </g>
      )}

      {ghost && (
        <g className="ghost" fill="none" pointerEvents="none">
          {ghost.reach.length > 1 && (
            <path d={pathOf(ghost.reach, z0)} className="reach" vectorEffect="non-scaling-stroke" />
          )}
          {ghost.arcs.map((arc, i) => (
            <path
              key={i}
              d={pathOf(arc, z0)}
              className="arc"
              stroke={ghost.color}
              strokeWidth={0.014 * k}
            />
          ))}
          {ghost.marker &&
            (() => {
              const g = zToGamma(ghost.marker, z0);
              return (
                <>
                  <circle
                    cx={g.re}
                    cy={-g.im}
                    r={0.03 * k}
                    className="marker"
                    strokeWidth={0.008 * k}
                  />
                  <text
                    x={g.re + 0.045 * k}
                    y={-g.im + 0.015 * k}
                    fontSize={fontSize * 0.9}
                    strokeWidth={0.012 * k}
                  >
                    {ghost.label}
                  </text>
                </>
              );
            })()}
        </g>
      )}

      {(() => {
        const gt = zToGamma(target, z0);
        if (!Number.isFinite(gt.re) || !Number.isFinite(gt.im)) return null;
        return (
          <g className="target" aria-label="Target impedance">
            <rect
              x={gt.re - 0.04 * k}
              y={-gt.im - 0.04 * k}
              width={0.08 * k}
              height={0.08 * k}
              strokeWidth={0.006 * k}
              transform={`rotate(45 ${gt.re} ${-gt.im})`}
            />
            <text
              x={gt.re + 0.05 * k}
              y={-gt.im + 0.05 * k}
              fontSize={fontSize}
              fontWeight={600}
              strokeWidth={0.012 * k}
            >
              Target
            </text>
          </g>
        );
      })()}

      <g className="datapoints">
        {gammas.map((g, i) => (
          <g
            key={i}
            className={i === selected ? 'dp selected' : 'dp'}
            onPointerDown={startPointDrag(i)}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onContextMenu(g, e.clientX, e.clientY, i);
            }}
            role="button"
            aria-label={`${datapointLabel(i)}, drag to tune`}
          >
            {/* Stroke widths in chart units: a CSS px width would be taken as chart units here.
                The two ends of the chain, load and source, are squares; the nodes between are dots. */}
            {i === 0 || i === gammas.length - 1 ? (
              <rect
                x={g.re - (i === selected ? 0.032 : 0.025) * k}
                y={-g.im - (i === selected ? 0.032 : 0.025) * k}
                width={(i === selected ? 0.064 : 0.05) * k}
                height={(i === selected ? 0.064 : 0.05) * k}
                strokeWidth={0.006 * k}
              />
            ) : (
              <circle
                cx={g.re}
                cy={-g.im}
                r={(i === selected ? 0.034 : 0.026) * k}
                strokeWidth={0.006 * k}
              />
            )}
            <text
              x={g.re + 0.04 * k}
              y={-g.im - 0.03 * k}
              fontSize={fontSize}
              fontWeight={700}
              strokeWidth={0.012 * k}
            >
              {datapointLabel(i)}
            </text>
          </g>
        ))}
      </g>
    </svg>
  );
}
