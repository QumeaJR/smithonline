import {
  isShunt,
  type Element,
  type LadderResult,
  type Realization,
  type RealizedElement,
} from '@smithonline/core';
import type { KeyboardEvent, PointerEvent, RefObject } from 'react';
import type { DesignElement } from '../lib/design';
import { textOnColor } from '../lib/colors';
import { clampStripHeight, STRIP_DEFAULT, STRIP_MAX, STRIP_MIN } from '../lib/strip';
import { startIndex } from '../lib/datapoints';
import { elementSummary } from '../lib/elements';
import { fmtComplex, fmtNum, hasValue, NO_VALUE, noValueAt } from '../lib/format';
import { realizedText } from '../lib/realize';
import {
  cellOffsets,
  cellWidth,
  labelWidth,
  SNAP_W,
  stripComplex,
  stripLabel,
  TERMINAL_LEAD,
  terminalLines,
  terminalWidth,
  valueWidth,
  type StripLabel,
} from '../lib/schematicCells';
import { useCoarsePointer } from '../lib/pointer';
import { pointerHints } from '../lib/tips';
import { useDesignStore } from '../store/useDesignStore';

const CELL = 56;
/** Height of the drawing, drawing units: the `height` prop scales from it. */
export const SCHEMATIC_H = 84;
const H = SCHEMATIC_H;
/** Height of the compact drawing of an empty ladder (load and Zin only), drawing units. */
export const SCHEMATIC_H_COMPACT = 56;
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
    case 'microstrip':
      return 'M1 10h3M26 10h3M4 8h22v4H4z';
    case 'part':
      // The C or L symbol with a small filled tag: a part from the library, measured data.
      return el.part.type === 'C'
        ? 'M1 10h11M18 10h11M12 3v14M18 3v14M22 1h5v5h-5z'
        : 'M1 10h4a3 3 0 0 1 6 0a3 3 0 0 1 6 0a3 3 0 0 1 6 0h6M24 1h5v5h-5z';
  }
}

interface SchematicProps {
  readonly result: LadderResult;
  /** Rendered height in CSS pixels of the full 84-unit drawing; the drawing scales with it. */
  readonly height?: number;
  readonly svgRef?: RefObject<SVGSVGElement | null>;
  /** Draw the ladder top to bottom at its natural size (the Settings schematic direction). */
  readonly vertical?: boolean;
  /**
   * Realize mode's network, or null: each cell then shows the realized value the network uses,
   * a snapped one with a small marker, and the ideal value in its title.
   */
  readonly realization?: Realization | null;
  /**
   * The network as built (the realized values, the packages' parasitics) when it differs from
   * the ideal one: the Zin terminal shows its Zin and VSWR, the ideal ones go to the title.
   */
  readonly built?: BuiltNetwork | null;
  /** An empty ladder (load and Zin only) is drawn 56 units tall instead of 84: the phone's strip. */
  readonly compactEmpty?: boolean;
  /** After a tap selected a cell: 0 is the load, 1 the first part (the phone scrolls its card). */
  readonly onPick?: (index: number) => void;
}

/** The network as built and how it differs from the ideal one ("realized values, packages"). */
export interface BuiltNetwork {
  readonly result: LadderResult;
  readonly label: string;
  /** The packages or the board are in it: the terminal says "as built" next to its Zin. */
  readonly asBuilt?: boolean;
}

/** The realized elements of a realization by their index in the ladder. */
function realizedByIndex(
  realization: Realization | null | undefined,
): Map<number, RealizedElement> {
  return new Map((realization?.elements ?? []).map((re) => [re.index, re]));
}

/** A part's title: its value, the realized and the ideal one when Realize snapped it, its package. */
function partTitle(
  index: number,
  el: DesignElement,
  re: RealizedElement | undefined,
  sourceLabel: string,
): string {
  const ideal = elementSummary(el);
  const pkg = (el.kind === 'L' || el.kind === 'C') && el.package ? `, package ${el.package}` : '';
  if (re && re.parts.some((p) => p.source !== 'exact')) {
    return `${index + 1}: ${realizedText(re, sourceLabel)}, ideal ${ideal}${pkg}`;
  }
  return `${index + 1}: ${ideal}${pkg}`;
}

const vswrText = (vswr: number | undefined): string =>
  vswr === undefined ? NO_VALUE : fmtNum(vswr, 3);

const zinText = (r: LadderResult): string =>
  hasValue(r.zin)
    ? `Zin ${fmtComplex(r.zin, 2)} Ω, VSWR ${vswrText(r.info[r.info.length - 1]?.vswr)}`
    : `Zin: ${noValueAt(r.frequency)} (a library part has no data there)`;

/** The Zin terminal's title: Zin and VSWR as shown, and the ideal ones when it shows as built. */
function terminalTitle(result: LadderResult, built: BuiltNetwork | null | undefined): string {
  if (!built) return zinText(result);
  return `${zinText(built.result)} with the ${built.label}; with the ideal values ${zinText(result)}`;
}

/**
 * The two lines of the Zin terminal: of the network as built when there is one, marked
 * "as built" when the packages or the board are in it (the ideal values go to the title).
 */
function terminalOf(
  result: LadderResult,
  built: BuiltNetwork | null | undefined,
): readonly [string, string] {
  const r = built?.result ?? result;
  const [zin, vswr] = terminalLines(r.zin, r.info[r.info.length - 1]?.vswr);
  return built?.asBuilt ? [zin, `${vswr}, as built`] : [zin, vswr];
}

/** A value under its symbol, centred on `mid`, with the snap marker after it when snapped. */
function ValueText({
  label,
  mid,
  y,
}: {
  readonly label: StripLabel;
  readonly mid: number;
  readonly y: number;
}) {
  const x = label.snapped ? mid - SNAP_W / 2 : mid;
  return (
    <>
      <text x={x} y={y} textAnchor="middle" className={label.snapped ? 'value snapped' : 'value'}>
        {label.text}
      </text>
      {label.snapped && (
        <circle
          className="snap-mark"
          cx={x + valueWidth(label.text) / 2 + SNAP_W / 2}
          cy={y - 7}
          r={2}
        />
      )}
    </>
  );
}

/** The network as a ladder: load and source at the ends, horizontal by default or vertical. */
export function Schematic({
  result,
  height = H,
  svgRef,
  vertical = false,
  realization = null,
  built = null,
  compactEmpty = false,
  onPick,
}: SchematicProps) {
  const design = useDesignStore((s) => s.design);
  const selected = useDesignStore((s) => s.selected);
  const storeSelect = useDesignStore((s) => s.select);
  const select = (index: number | null): void => {
    storeSelect(index);
    if (index !== null) onPick?.(index);
  };
  const realized = realizedByIndex(realization);
  const sourceLabel = realization?.sourceLabel ?? '';
  if (vertical) {
    return (
      <VerticalLadder
        result={result}
        elements={design.elements}
        load={design.load}
        startNumber={startIndex(design) + 1}
        selected={selected}
        onSelect={select}
        realization={realization}
        built={built}
        {...(svgRef ? { svgRef } : {})}
      />
    );
  }

  // Every cell is as wide as its label needs (three significant digits, the package, the snap
  // marker), so labels never run into each other at any width; a long ladder scrolls.
  const compact = compactEmpty && design.elements.length === 0;
  const h = compact ? SCHEMATIC_H_COMPACT : H;
  const wireY = compact ? 26 : WIRE_Y;
  const valueY = h - 8;
  const scale = height / H;
  const loadText = stripComplex(design.load);
  const labels = design.elements.map((el, i) => stripLabel(el, realized.get(i)));
  const terminal = terminalOf(result, built);
  const widths = [
    cellWidth(loadText),
    ...labels.map((l) => labelWidth(l)),
    terminalWidth(terminal),
  ];
  const { x: xs, total: width } = cellOffsets(widths);
  const loadW = widths[0] as number;
  const src = xs[xs.length - 1] as number;
  const dp = startIndex(design) + 1;

  return (
    <svg
      ref={svgRef}
      className={compact ? 'schematic compact' : 'schematic'}
      viewBox={`0 0 ${width} ${h}`}
      width={width * scale}
      height={h * scale}
      role="img"
      aria-label="Schematic of the network from load to source"
    >
      {/* Load: a box with ZL, wire out to the right */}
      <g
        className={selected === 0 ? 'cell selected' : 'cell'}
        data-cell={0}
        onClick={() => select(0)}
      >
        <title>{`DP${dp}, load: ${fmtComplex(design.load, 2)} Ω`}</title>
        <rect x={loadW / 2 - 18} y={wireY - 12} width={24} height={24} rx={3} className="sym" />
        <text x={loadW / 2 - 6} y={wireY + 4} textAnchor="middle" className="sym-label">
          ZL
        </text>
        <line x1={loadW / 2 + 6} y1={wireY} x2={loadW} y2={wireY} className="wire" />
        <text x={loadW / 2} y={valueY} textAnchor="middle" className="value">
          {loadText}
        </text>
        <text x={loadW / 2} y={compact ? 10 : 12} textAnchor="middle" className="badge-text">
          DP{dp}
        </text>
      </g>
      {design.elements.map((el, i) => (
        <Cell
          key={el.id}
          index={i}
          element={el}
          x={xs[i + 1] as number}
          width={widths[i + 1] as number}
          label={labels[i] as StripLabel}
          title={partTitle(i, el, realized.get(i), sourceLabel)}
          valueY={valueY}
          selected={selected === i + 1}
          onSelect={() => select(i + 1)}
        />
      ))}
      {/* Source: the open terminal with Zin and the VSWR the network gives */}
      <g className="cell terminal" data-cell="zin">
        <title>{terminalTitle(result, built)}</title>
        <line x1={src} y1={wireY} x2={src + 12} y2={wireY} className="wire" />
        <circle cx={src + 15} cy={wireY} r={3} className="sym" fill="none" />
        <text x={src + TERMINAL_LEAD} y={wireY + 4} className="value terminal-text">
          {terminal[0]}
        </text>
        <text x={src + TERMINAL_LEAD} y={wireY + 18} className="value terminal-text">
          {terminal[1]}
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
  /** Realize mode's network: the labels show the realized values. */
  readonly realization?: Realization | null;
  /** The network as built: the Zin terminal shows its Zin and VSWR. */
  readonly built?: BuiltNetwork | null;
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
  realization = null,
  built = null,
}: VerticalProps) {
  const n = elements.length;
  const x = V_WIRE_X;
  const total = CELL * (n + 2);
  const bottom = CELL * (n + 1);
  const realized = realizedByIndex(realization);
  const sourceLabel = realization?.sourceLabel ?? '';
  const terminal = terminalOf(result, built);
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
      <g
        className={selected === 0 ? 'cell selected' : 'cell'}
        data-cell={0}
        onClick={() => onSelect(0)}
      >
        <rect x={x - 12} y={6} width={24} height={24} rx={3} className="sym" />
        <text x={x} y={22} textAnchor="middle" className="sym-label">
          ZL
        </text>
        <line x1={x} y1={30} x2={x} y2={CELL} className="wire" />
        <text x={x + 20} y={16} className="badge-text">
          DP{startNumber}
        </text>
        <text x={x + 20} y={30} className="value">
          {stripComplex(load)}
        </text>
      </g>
      {elements.map((el, i) => {
        const y0 = CELL * (i + 1);
        const mid = y0 + CELL / 2;
        const sel = selected === i + 1;
        const path = symbolPath(el);
        const label = stripLabel(el, realized.get(i));
        const labelX = isShunt(el) ? x + 4 : x + 18;
        const labelY = isShunt(el) ? mid - 14 : mid + 4;
        return (
          <g
            key={el.id}
            className={sel ? 'cell selected' : 'cell'}
            data-cell={i + 1}
            onClick={() => onSelect(i + 1)}
          >
            <title>{partTitle(i, el, realized.get(i), sourceLabel)}</title>
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
              </>
            )}
            <text x={labelX} y={labelY} className={label.snapped ? 'value snapped' : 'value'}>
              {label.text}
            </text>
            {label.snapped && (
              <circle
                className="snap-mark"
                cx={labelX + valueWidth(label.text) + SNAP_W / 2}
                cy={labelY - 7}
                r={2}
              />
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
      <g className="cell terminal" data-cell="zin">
        <title>{terminalTitle(result, built)}</title>
        <line x1={x} y1={bottom} x2={x} y2={bottom + 18} className="wire" />
        <circle cx={x} cy={bottom + 21} r={3} className="sym" fill="none" />
        <text x={x + 10} y={bottom + 25} className="value terminal-text">
          {terminal[0]}
        </text>
        <text x={x + 10} y={bottom + 39} className="value terminal-text">
          {terminal[1]}
        </text>
      </g>
    </svg>
  );
}

interface CellProps {
  readonly index: number;
  readonly element: DesignElement;
  readonly x: number;
  /** The cell's width, sized to its label. */
  readonly width: number;
  /** The value under the symbol (three significant digits, the package, the snap marker). */
  readonly label: StripLabel;
  readonly title: string;
  /** Baseline of the value, drawing units. */
  readonly valueY: number;
  readonly selected: boolean;
  readonly onSelect: () => void;
}

function Cell({ index, element, x, width, label, title, valueY, selected, onSelect }: CellProps) {
  const shunt = isShunt(element);
  const path = symbolPath(element);
  const mid = x + width / 2;
  return (
    <g className={selected ? 'cell selected' : 'cell'} data-cell={index + 1} onClick={onSelect}>
      <title>{title}</title>
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
      <ValueText label={label} mid={mid} y={valueY} />
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
  const hints = pointerHints(useCoarsePointer());
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
      title={hints.stripHandle(`${STRIP_MIN} to ${STRIP_MAX} px`)}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      onDoubleClick={() => onChange(STRIP_DEFAULT)}
    >
      <span aria-hidden="true" />
    </div>
  );
}
