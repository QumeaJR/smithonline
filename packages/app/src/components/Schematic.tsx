import { isShunt, type Element, type LadderResult } from '@smithonline/core';
import type { KeyboardEvent, PointerEvent, RefObject } from 'react';
import type { DesignElement } from '../lib/design';
import { textOnColor } from '../lib/colors';
import { clampStripHeight, STRIP_DEFAULT, STRIP_MAX, STRIP_MIN } from '../lib/strip';
import { startIndex } from '../lib/datapoints';
import { elementSummary } from '../lib/elements';
import { fmtComplex } from '../lib/format';
import { cellOffsets, cellWidth, stripComplex, stripValue } from '../lib/schematicCells';
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
  /** Draw the ladder top to bottom at its natural size (the Settings schematic direction). */
  readonly vertical?: boolean;
}

/** The network as a ladder: load and source at the ends, horizontal by default or vertical. */
export function Schematic({ result, height = H, svgRef, vertical = false }: SchematicProps) {
  const design = useDesignStore((s) => s.design);
  const selected = useDesignStore((s) => s.selected);
  const select = useDesignStore((s) => s.select);
  if (vertical) {
    return (
      <VerticalLadder
        result={result}
        elements={design.elements}
        load={design.load}
        startNumber={startIndex(design) + 1}
        selected={selected}
        onSelect={select}
        {...(svgRef ? { svgRef } : {})}
      />
    );
  }

  // Every cell is as wide as its value needs (three significant digits), so values never run
  // into each other at any width.
  const loadText = stripComplex(design.load);
  const zinText = stripComplex(result.zin);
  const texts = design.elements.map((el) => stripValue(el));
  const widths = [cellWidth(loadText), ...texts.map((t) => cellWidth(t)), cellWidth(zinText)];
  const { x: xs, total: width } = cellOffsets(widths);
  const loadW = widths[0] as number;
  const src = xs[xs.length - 1] as number;
  const srcW = widths[widths.length - 1] as number;

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
        <title>{`DP${startIndex(design) + 1}, load: ${fmtComplex(design.load, 2)} Ω`}</title>
        <rect x={loadW / 2 - 18} y={WIRE_Y - 12} width={24} height={24} rx={3} className="sym" />
        <text x={loadW / 2 - 6} y={WIRE_Y + 4} textAnchor="middle" className="sym-label">
          ZL
        </text>
        <line x1={loadW / 2 + 6} y1={WIRE_Y} x2={loadW} y2={WIRE_Y} className="wire" />
        <text x={loadW / 2} y={H - 8} textAnchor="middle" className="value">
          {loadText}
        </text>
        <text x={loadW / 2} y={12} textAnchor="middle" className="badge-text">
          DP{startIndex(design) + 1}
        </text>
      </g>
      {design.elements.map((el, i) => (
        <Cell
          key={el.id}
          index={i}
          element={el}
          x={xs[i + 1] as number}
          width={widths[i + 1] as number}
          text={texts[i] as string}
          selected={selected === i + 1}
          onSelect={() => select(i + 1)}
        />
      ))}
      {/* Source: open terminals with Zin */}
      <g className="cell">
        <title>{`Zin: ${fmtComplex(result.zin, 2)} Ω`}</title>
        <line x1={src} y1={WIRE_Y} x2={src + 18} y2={WIRE_Y} className="wire" />
        <circle cx={src + 21} cy={WIRE_Y} r={3} className="sym" fill="none" />
        <text x={src + 28} y={WIRE_Y + 4} className="sym-label">
          Zin
        </text>
        <text x={src + srcW / 2} y={H - 8} textAnchor="middle" className="value">
          {zinText}
        </text>
      </g>
    </svg>
  );
}

/** Width of the vertical drawing and the x of its wire, in drawing units. */
const V_WIDTH = 190;
const V_WIRE_X = 46;

interface VerticalProps {
  readonly result: LadderResult;
  readonly elements: readonly DesignElement[];
  readonly load: { readonly re: number; readonly im: number };
  /** DP number of the datapoint the network starts from. */
  readonly startNumber: number;
  readonly selected: number | null;
  readonly onSelect: (index: number | null) => void;
  readonly svgRef?: RefObject<SVGSVGElement | null>;
}

/**
 * The ladder top to bottom, load at the top and the source at the bottom.
 * Series parts sit on the wire, shunt parts branch off to the right; the
 * labels stay upright so the drawing reads like the horizontal one.
 */
export function VerticalLadder({
  result,
  elements,
  load,
  startNumber,
  selected,
  onSelect,
  svgRef,
}: VerticalProps) {
  const n = elements.length;
  const x = V_WIRE_X;
  const total = CELL * (n + 2);
  const bottom = CELL * (n + 1);
  return (
    <svg
      ref={svgRef}
      className="schematic vertical"
      viewBox={`0 0 ${V_WIDTH} ${total}`}
      width={V_WIDTH}
      height={total}
      role="img"
      aria-label="Schematic of the network from load at the top to source at the bottom"
    >
      <g className={selected === 0 ? 'cell selected' : 'cell'} onClick={() => onSelect(0)}>
        <rect x={x - 12} y={6} width={24} height={24} rx={3} className="sym" />
        <text x={x} y={22} textAnchor="middle" className="sym-label">
          ZL
        </text>
        <line x1={x} y1={30} x2={x} y2={CELL} className="wire" />
        <text x={x + 20} y={16} className="badge-text">
          DP{startNumber}
        </text>
        <text x={x + 20} y={30} className="value">
          {fmtComplex(load, 1)}
        </text>
      </g>
      {elements.map((el, i) => {
        const y0 = CELL * (i + 1);
        const mid = y0 + CELL / 2;
        const sel = selected === i + 1;
        const path = symbolPath(el);
        return (
          <g key={el.id} className={sel ? 'cell selected' : 'cell'} onClick={() => onSelect(i + 1)}>
            <title>{`${i + 1}: ${elementSummary(el)}`}</title>
            {isShunt(el) ? (
              <>
                <line x1={x} y1={y0} x2={x} y2={y0 + CELL} className="wire" />
                <path d={path} className="sym" transform={`translate(${x} ${mid - 10})`} />
                {el.kind !== 'openStub' && el.kind !== 'shortStub' && (
                  <path
                    d={`M${x + 28} ${mid - 6}v12M${x + 31} ${mid - 4}v8M${x + 34} ${mid - 2}v4`}
                    className="sym"
                  />
                )}
                <text x={x + 4} y={mid - 14} className="value">
                  {elementSummary(el).split(',')[0]}
                </text>
              </>
            ) : (
              <>
                <line x1={x} y1={y0} x2={x} y2={y0 + 13} className="wire" />
                <path
                  d={path}
                  className="sym"
                  transform={`translate(${x} ${y0 + 13}) rotate(90) translate(-1 -10)`}
                />
                <line x1={x} y1={y0 + 41} x2={x} y2={y0 + CELL} className="wire" />
                <text x={x + 18} y={mid + 4} className="value">
                  {elementSummary(el).split(',')[0]}
                </text>
              </>
            )}
            <circle cx={x - 24} cy={mid} r={7} fill={el.color} />
            <text
              x={x - 24}
              y={mid + 3}
              textAnchor="middle"
              className="badge-text on-color"
              style={{ fill: textOnColor(el.color) }}
            >
              {i + 1}
            </text>
          </g>
        );
      })}
      <g className="cell">
        <line x1={x} y1={bottom} x2={x} y2={bottom + 18} className="wire" />
        <circle cx={x} cy={bottom + 21} r={3} className="sym" fill="none" />
        <text x={x + 10} y={bottom + 25} className="sym-label">
          Zin
        </text>
        <text x={x + 10} y={bottom + 39} className="value">
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
  /** The cell's width, sized to its value. */
  readonly width: number;
  /** The value under the symbol, three significant digits. */
  readonly text: string;
  readonly selected: boolean;
  readonly onSelect: () => void;
}

function Cell({ index, element, x, width, text, selected, onSelect }: CellProps) {
  const shunt = isShunt(element);
  const path = symbolPath(element);
  const mid = x + width / 2;
  return (
    <g className={selected ? 'cell selected' : 'cell'} onClick={onSelect}>
      <title>{`${index + 1}: ${elementSummary(element)}`}</title>
      {shunt ? (
        <>
          <line x1={x} y1={WIRE_Y} x2={x + width} y2={WIRE_Y} className="wire" />
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
          <line x1={x} y1={WIRE_Y} x2={mid - 15} y2={WIRE_Y} className="wire" />
          <path d={path} className="sym" transform={`translate(${mid - 15} ${WIRE_Y - 10})`} />
          <line x1={mid + 15} y1={WIRE_Y} x2={x + width} y2={WIRE_Y} className="wire" />
        </>
      )}
      <circle cx={mid} cy={9} r={7} fill={element.color} />
      <text
        x={mid}
        y={12}
        textAnchor="middle"
        className="badge-text on-color"
        style={{ fill: textOnColor(element.color) }}
      >
        {index + 1}
      </text>
      <text x={mid} y={H - 8} textAnchor="middle" className="value">
        {text}
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
