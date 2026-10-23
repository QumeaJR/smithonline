import { isShunt, type Element, type LadderResult } from '@smithonline/core';
import type { KeyboardEvent, PointerEvent, RefObject } from 'react';
import type { DesignElement } from '../lib/design';
import { clampStripHeight, STRIP_DEFAULT, STRIP_MAX, STRIP_MIN } from '../lib/strip';
import { elementSummary } from '../lib/elements';
import { fmtComplex } from '../lib/format';
import { useDesignStore } from '../store/useDesignStore';

const CELL = 56;
const H = 84;
const WIRE_Y = 30;

/**
 * Horizontal symbol of an element on a 30 x 20 box with its wire at y = 10
 * from x = 1 to x = 29. Shunt parts are the same symbol rotated downwards.
 */
function symbolPath(el: Element): string {
  switch (el.kind) {
    case 'R':
      return 'M1 10h5l2-5 4 10 4-10 4 10 2-5h8';
    case 'L':
      return 'M1 10h4a3 3 0 0 1 6 0a3 3 0 0 1 6 0a3 3 0 0 1 6 0h6';
    case 'C':
      return 'M1 10h11M18 10h11M12 3v14M18 3v14';
    case 'RLC':
      return el.connection === 'series'
        ? 'M1 10h2l1-3 2 6 2-6 1 3h2a2 2 0 0 1 4 0a2 2 0 0 1 4 0h1M22 10h2M26 10h3M24 5v10M26 5v10'
        : 'M1 10h4M25 10h4M5 3v14M25 3v14M5 3h4l1-2 2 4 2-4 2 4 1-2h8M5 10h4a2 2 0 0 1 4 0a2 2 0 0 1 4 0h8M5 17h8M17 17h8M13 14v6M17 14v6';
    case 'transformer':
      return 'M1 10h5M24 10h5M6 4v12M24 4v12M9 5a2.5 2.5 0 0 1 0 5a2.5 2.5 0 0 1 0 5M21 5a2.5 2.5 0 0 0 0 5a2.5 2.5 0 0 0 0 5M14 4v12M16 4v12';
    case 'line':
      return 'M1 10h3M26 10h3M4 6h22v8H4z';
    case 'openStub':
      return 'M1 10h3M4 6h22v8H4z';
    case 'shortStub':
      return 'M1 10h3M4 6h22v8H4zM26 10h3M29 4v12';
  }
}

interface SchematicProps {
  readonly result: LadderResult;
  /** Rendered height in CSS pixels; the drawing scales with it. */
  readonly height?: number;
  readonly svgRef?: RefObject<SVGSVGElement | null>;
}

/** The network as a horizontal ladder: load on the left, source on the right. */
export function Schematic({ result, height = H, svgRef }: SchematicProps) {
  const design = useDesignStore((s) => s.design);
  const selected = useDesignStore((s) => s.selected);
  const select = useDesignStore((s) => s.select);
  const n = design.elements.length;
  const width = CELL * (n + 2);

  return (
    <svg
      ref={svgRef}
      className="schematic"
      viewBox={`0 0 ${width} ${H}`}
      width={(width * height) / H}
      height={height}
      role="img"
      aria-label="Schematic of the network from load to source"
    >
      {/* Load: a box with ZL, wire out to the right */}
      <g className={selected === 0 ? 'cell selected' : 'cell'} onClick={() => select(0)}>
        <rect x={10} y={WIRE_Y - 12} width={24} height={24} rx={3} className="sym" />
        <text x={22} y={WIRE_Y + 4} textAnchor="middle" className="sym-label">
          ZL
        </text>
        <line x1={34} y1={WIRE_Y} x2={CELL} y2={WIRE_Y} className="wire" />
        <text x={CELL / 2} y={H - 8} textAnchor="middle" className="value">
          {fmtComplex(design.load, 1)}
        </text>
        <text x={CELL / 2} y={12} textAnchor="middle" className="badge-text">
          DP1
        </text>
      </g>
      {design.elements.map((el, i) => (
        <Cell
          key={el.id}
          index={i}
          element={el}
          x={CELL * (i + 1)}
          selected={selected === i + 1}
          onSelect={() => select(i + 1)}
        />
      ))}
      {/* Source: open terminals with Zin */}
      <g className="cell">
        <line
          x1={CELL * (n + 1)}
          y1={WIRE_Y}
          x2={CELL * (n + 1) + 18}
          y2={WIRE_Y}
          className="wire"
        />
        <circle cx={CELL * (n + 1) + 21} cy={WIRE_Y} r={3} className="sym" fill="none" />
        <text x={CELL * (n + 1) + 28} y={WIRE_Y + 4} className="sym-label">
          Zin
        </text>
        <text x={CELL * (n + 1) + CELL / 2} y={H - 8} textAnchor="middle" className="value">
          {fmtComplex(result.zin, 1)}
        </text>
      </g>
    </svg>
  );
}

interface CellProps {
  readonly index: number;
  readonly element: DesignElement;
  readonly x: number;
  readonly selected: boolean;
  readonly onSelect: () => void;
}

function Cell({ index, element, x, selected, onSelect }: CellProps) {
  const shunt = isShunt(element);
  const path = symbolPath(element);
  const mid = x + CELL / 2;
  return (
    <g className={selected ? 'cell selected' : 'cell'} onClick={onSelect}>
      <title>{`${index + 1}: ${elementSummary(element)}`}</title>
      {shunt ? (
        <>
          <line x1={x} y1={WIRE_Y} x2={x + CELL} y2={WIRE_Y} className="wire" />
          {/* rotate the horizontal symbol to hang down from the wire */}
          <path
            d={path}
            className="sym"
            transform={`translate(${mid} ${WIRE_Y}) rotate(90) translate(-1 -10)`}
          />
          {element.kind !== 'openStub' && element.kind !== 'shortStub' && (
            <path
              d={`M${mid - 6} ${WIRE_Y + 28}h12M${mid - 4} ${WIRE_Y + 31}h8M${mid - 2} ${WIRE_Y + 34}h4`}
              className="sym"
            />
          )}
        </>
      ) : (
        <>
          <line x1={x} y1={WIRE_Y} x2={x + 13} y2={WIRE_Y} className="wire" />
          <path d={path} className="sym" transform={`translate(${x + 13} ${WIRE_Y - 10})`} />
          <line x1={x + 43} y1={WIRE_Y} x2={x + CELL} y2={WIRE_Y} className="wire" />
        </>
      )}
      <circle cx={mid} cy={9} r={7} fill={element.color} />
      <text x={mid} y={12} textAnchor="middle" className="badge-text on-color">
        {index + 1}
      </text>
      <text x={mid} y={H - 8} textAnchor="middle" className="value">
        {elementSummary(element).split(',')[0]}
      </text>
    </g>
  );
}

interface HandleProps {
  readonly height: number;
  readonly onChange: (height: number) => void;
}

/**
 * The drag handle between the chart and the schematic strip. Dragging up
 * makes the strip taller; the arrow keys move it in steps, Home and End go
 * to the limits, a double click restores the default.
 */
export function SchematicHandle({ height, onChange }: HandleProps) {
  const onPointerDown = (e: PointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return;
    e.preventDefault();
    const el = e.currentTarget;
    const startY = e.clientY;
    const start = height;
    el.setPointerCapture(e.pointerId);
    const move = (ev: globalThis.PointerEvent): void => {
      onChange(clampStripHeight(start - (ev.clientY - startY)));
    };
    const up = (): void => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    const step = e.shiftKey ? 24 : 8;
    const next =
      e.key === 'ArrowUp'
        ? height + step
        : e.key === 'ArrowDown'
          ? height - step
          : e.key === 'Home'
            ? STRIP_MIN
            : e.key === 'End'
              ? STRIP_MAX
              : null;
    if (next === null) return;
    e.preventDefault();
    onChange(clampStripHeight(next));
  };
  return (
    <div
      className="strip-handle"
      role="separator"
      aria-orientation="horizontal"
      aria-label="Schematic strip height"
      aria-valuemin={STRIP_MIN}
      aria-valuemax={STRIP_MAX}
      aria-valuenow={height}
      tabIndex={0}
      title={`Drag to resize the schematic (${STRIP_MIN} to ${STRIP_MAX} px); double-click for the default`}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      onDoubleClick={() => onChange(STRIP_DEFAULT)}
    >
      <span aria-hidden="true" />
    </div>
  );
}
