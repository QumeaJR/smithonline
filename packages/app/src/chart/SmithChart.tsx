import { zToGamma, type Complex, type LadderResult, type SweepPoint } from '@smithonline/core';
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { ARC_COLORS } from '../lib/colors';
import { datapointLabel, fmtFrequency } from '../lib/format';
import type { ChartOptions } from '../store/useDesignStore';
import { gridCircles, gridLabels } from './grid';

export interface ChartProps {
  readonly result: LadderResult;
  readonly z0: number;
  readonly options: ChartOptions;
  readonly selected: number | null;
  readonly sweep: readonly SweepPoint[] | null;
  readonly vswrCircles: readonly number[];
  readonly qContours: readonly number[];
  readonly onSelect: (index: number | null) => void;
  readonly onHover: (gamma: Complex | null) => void;
  readonly svgRef: RefObject<SVGSVGElement | null>;
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
  vswrCircles,
  qContours,
  onSelect,
  onHover,
  svgRef,
}: ChartProps) {
  const [view, setView] = useState<View>(HOME);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ x: number; y: number; cx: number; cy: number; moved: boolean } | null>(
    null,
  );
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
    const d = drag.current;
    drag.current = null;
    setDragging(false);
    if (d && !d.moved && e.target === e.currentTarget) onSelect(null);
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
      onDoubleClick={() => setView(HOME)}
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

      {sweep && sweep.length > 1 && (
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
            stroke={ARC_COLORS[i % ARC_COLORS.length]}
            strokeWidth={0.012 * k}
            strokeLinecap="round"
            opacity={selected === null || selected === i + 1 || selected === i ? 1 : 0.45}
          />
        ))}
      </g>

      <g className="datapoints">
        {gammas.map((g, i) => (
          <g
            key={i}
            className={i === selected ? 'dp selected' : 'dp'}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => onSelect(i)}
            role="button"
            aria-label={`${datapointLabel(i)}`}
          >
            {/* Stroke widths in chart units: a CSS px width would be taken as chart units here. */}
            <circle
              cx={g.re}
              cy={-g.im}
              r={(i === selected ? 0.034 : 0.026) * k}
              strokeWidth={0.006 * k}
            />
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
