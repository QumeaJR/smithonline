import {
  complex,
  elementExceeds,
  formatEngineering,
  nearestIndex,
  type ElementStress,
  type LadderResult,
  type Realization,
  type RealizedElement,
} from '@smithonline/core';
import { useMemo, useState, type DragEvent } from 'react';
import { targetOf, type DesignElement } from '../lib/design';
import { elementName, elementSummary, primaryValue, withPrimaryValue } from '../lib/elements';
import { fmtComplex } from '../lib/format';
import { effectiveElements, realizedText, sliderSteps } from '../lib/realize';
import { activeLimits, designStress, stressSettings } from '../lib/stress';
import { useDesignStore } from '../store/useDesignStore';
import { startIndex } from '../lib/datapoints';
import { Datapoints } from './Datapoints';
import { LoadFields } from './LoadFields';
import { ValueInput } from './ValueInput';
import { WindingDialog } from './WindingDialog';

interface LadderProps {
  readonly result: LadderResult;
  /** The realized network when Realize mode is on. */
  readonly realization: Realization | null;
}

const DRAG_TYPE = 'application/x-smithonline-element';

export function Ladder({ result, realization }: LadderProps) {
  const design = useDesignStore((s) => s.design);
  const selected = useDesignStore((s) => s.selected);
  const select = useDesignStore((s) => s.select);
  const setTarget = useDesignStore((s) => s.setTarget);
  const reorderElement = useDesignStore((s) => s.reorderElement);
  const stressRows = useMemo(
    () => designStress(design, effectiveElements(design), realization),
    [design, realization],
  );
  const limits = activeLimits(stressSettings(design));
  const [windingFor, setWindingFor] = useState<number | null>(null);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);

  const onDragOver = (index: number) => (e: DragEvent<HTMLDivElement>) => {
    if (dragFrom === null) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dropAt !== index) setDropAt(index);
  };
  const onDrop = (index: number) => (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (dragFrom !== null) reorderElement(dragFrom, index);
    setDragFrom(null);
    setDropAt(null);
  };

  return (
    <div className="ladder">
      <div className={`card load ${selected === 0 ? 'selected' : ''}`} onClick={() => select(0)}>
        <div className="row">
          <span className="idx" style={{ background: 'var(--marker)' }}>
            DP{startIndex(design) + 1}
          </span>
          <span className="name">Load</span>
          <span className="mono muted">{fmtComplex(design.load)} &#937;</span>
        </div>
        <LoadFields />
      </div>
      <Datapoints />
      {design.elements.map((el, i) => (
        <ElementCard
          key={el.id}
          index={i}
          element={el}
          count={design.elements.length}
          after={result.datapoints[i + 1]}
          realized={realization?.elements[i]}
          realizedAfter={realization?.result.datapoints[i + 1]}
          onWinding={() => setWindingFor(i)}
          stress={stressRows?.[i] ?? null}
          over={stressRows?.[i] ? elementExceeds(stressRows[i] as ElementStress, limits) : null}
          sourceLabel={realization?.sourceLabel ?? ''}
          dragging={dragFrom === i}
          dropTarget={dropAt === i && dragFrom !== null && dragFrom !== i}
          dropBefore={dragFrom !== null && i < dragFrom}
          onDragStart={(e) => {
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData(DRAG_TYPE, String(i));
            setDragFrom(i);
          }}
          onDragEnd={() => {
            setDragFrom(null);
            setDropAt(null);
          }}
          onDragOver={onDragOver(i)}
          onDrop={onDrop(i)}
        />
      ))}
      {design.elements.length === 0 && (
        <p className="muted hint">
          Add elements from the palette above or right-click the chart. They are inserted at the
          source end, like in the original.
        </p>
      )}
      <div
        className="card target"
        title="Where the network should land; the hollow square on the chart"
      >
        <div className="row">
          <span className="idx" style={{ background: 'var(--accent)' }}>
            &#8594;
          </span>
          <span className="name">Target</span>
          <span className="mono muted">
            {fmtComplex(targetOf(design))} &#937;
            {design.target === null ? ' (Z0)' : ''}
          </span>
        </div>
        <div className="row fields">
          <label>
            R
            <ValueInput
              value={targetOf(design).re}
              unit={'Ω'}
              min={1e-6}
              onCommit={(re) => setTarget(complex(re, targetOf(design).im))}
              ariaLabel="Target resistance"
            />
          </label>
          <label>
            X
            <ValueInput
              value={targetOf(design).im}
              unit={'Ω'}
              onCommit={(im) => setTarget(complex(targetOf(design).re, im))}
              ariaLabel="Target reactance"
            />
          </label>
          <button
            className={`btn tiny ${design.target === null ? 'on' : ''}`}
            onClick={() => setTarget(null)}
            title="Match to the reference impedance, the centre of the chart"
          >
            = Z0
          </button>
        </div>
      </div>
      {windingFor !== null && (
        <WindingDialog index={windingFor} onClose={() => setWindingFor(null)} />
      )}
    </div>
  );
}

interface CardProps {
  readonly index: number;
  readonly element: DesignElement;
  readonly count: number;
  readonly after: { re: number; im: number } | undefined;
  readonly realized: RealizedElement | undefined;
  readonly realizedAfter: { re: number; im: number } | undefined;
  /** Voltage and current of the element at the source power; null when no power is set or the kind has none. */
  readonly stress: ElementStress | null;
  readonly over: { readonly voltage: boolean; readonly current: boolean } | null;
  readonly sourceLabel: string;
  readonly dragging: boolean;
  readonly dropTarget: boolean;
  readonly dropBefore: boolean;
  readonly onDragStart: (e: DragEvent<HTMLDivElement>) => void;
  readonly onDragEnd: () => void;
  readonly onDragOver: (e: DragEvent<HTMLDivElement>) => void;
  readonly onDrop: (e: DragEvent<HTMLDivElement>) => void;
  /** Open the winding helper for this inductor. */
  readonly onWinding: () => void;
}

function ElementCard({
  index,
  element,
  count,
  after,
  realized,
  realizedAfter,
  stress,
  over,
  sourceLabel,
  dragging,
  dropTarget,
  dropBefore,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
  onWinding,
}: CardProps) {
  const selected = useDesignStore((s) => s.selected);
  const losses = useDesignStore((s) => s.design.losses);
  const realize = useDesignStore((s) => s.design.realize);
  const { select, updateElement, removeElement, moveElement, commit, toggleLock } =
    useDesignStore.getState();
  const defaultQ = losses.enabled
    ? element.kind === 'L'
      ? losses.inductorQ
      : element.kind === 'C'
        ? losses.capacitorQ
        : 0
    : 0;
  const primary = primaryValue(element);
  // The slider spans 0.2x to 5x of the value it was centred on (log scale), or, with
  // Realize on, the series or stock values around that centre.
  const [center, setCenter] = useState(primary?.value ?? 1);
  const sliderPos = primary ? Math.log(primary.value / center) / Math.log(5) : 0;
  const steps = useMemo(
    () => (primary ? sliderSteps(realize, element, center) : null),
    [realize, element, center, primary],
  );
  const sourceName = realize.series === 'stock' ? 'stock' : realize.series;
  const isSelected = selected === index + 1;

  const patch = (p: Partial<DesignElement>): void =>
    updateElement(index, { ...element, ...p } as DesignElement);

  const classes = [
    'card',
    isSelected ? 'selected' : '',
    dragging ? 'dragging' : '',
    dropTarget ? (dropBefore ? 'drop-before' : 'drop-after') : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={classes}
      onClick={() => select(index + 1)}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <div
        className="row grip"
        draggable
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        title="Drag to reorder"
      >
        <span className="handle" aria-hidden="true">
          &#8942;&#8942;
        </span>
        <span className="idx" style={{ background: element.color }}>
          {index + 1}
        </span>
        <span className="name">{elementName(element)}</span>
        <span className="mono muted small">{elementSummary(element)}</span>
        <span className="actions">
          <button
            className="btn tiny"
            disabled={index === 0}
            onClick={(e) => (e.stopPropagation(), moveElement(index, -1))}
            title="Move towards the load"
          >
            &#9650;
          </button>
          <button
            className="btn tiny"
            disabled={index === count - 1}
            onClick={(e) => (e.stopPropagation(), moveElement(index, 1))}
            title="Move towards the source"
          >
            &#9660;
          </button>
          <button
            className="btn tiny"
            onClick={(e) => (e.stopPropagation(), removeElement(index))}
            title="Delete"
          >
            &#215;
          </button>
        </span>
      </div>
      <div className="row fields">
        {element.kind === 'R' && (
          <label>
            R
            <ValueInput
              value={element.value}
              unit={'Ω'}
              min={0}
              onCommit={(value) => patch({ value })}
            />
          </label>
        )}
        {(element.kind === 'L' || element.kind === 'C') && (
          <>
            <label>
              {element.kind}
              <ValueInput
                value={element.value}
                unit={element.kind === 'L' ? 'H' : 'F'}
                min={0}
                onCommit={(value) => patch({ value })}
              />
            </label>
            <label
              title={
                defaultQ > 0
                  ? `Quality factor; 0 uses the default Q of ${defaultQ} from the Losses setting`
                  : 'Quality factor, 0 for ideal'
              }
            >
              Q
              <ValueInput
                value={element.q ?? 0}
                plain
                min={0}
                className={defaultQ > 0 && !(element.q && element.q > 0) ? 'default-q' : ''}
                onCommit={(q) => updateElement(index, q > 0 ? { ...element, q } : omitQ(element))}
              />
              {defaultQ > 0 && !(element.q && element.q > 0) && (
                <span className="muted small">= {defaultQ}</span>
              )}
            </label>
          </>
        )}
        {element.kind === 'RLC' && (
          <>
            <label>
              R
              <ValueInput
                value={element.r ?? 0}
                unit={'Ω'}
                min={0}
                onCommit={(r) => patch({ r })}
              />
            </label>
            <label>
              L
              <ValueInput value={element.l ?? 0} unit="H" min={0} onCommit={(l) => patch({ l })} />
            </label>
            <label>
              C
              <ValueInput value={element.c ?? 0} unit="F" min={0} onCommit={(c) => patch({ c })} />
            </label>
            <label>
              <select
                value={element.connection}
                onChange={(e) => patch({ connection: e.target.value as 'series' | 'parallel' })}
                aria-label="Connection"
              >
                <option value="parallel">R || L || C</option>
                <option value="series">R + L + C</option>
              </select>
            </label>
          </>
        )}
        {element.kind === 'transformer' && (
          <label title="Voltage ratio; the source sees n squared times the load">
            n
            <ValueInput value={element.n} plain min={1e-6} onCommit={(n) => patch({ n })} />
          </label>
        )}
        {(element.kind === 'line' ||
          element.kind === 'openStub' ||
          element.kind === 'shortStub') && (
          <>
            <label title="Electrical length in wavelengths at the design frequency">
              l/&#955;
              <ValueInput
                value={element.length}
                plain
                digits={5}
                min={0}
                onCommit={(length) => patch({ length })}
              />
            </label>
            <label>
              Z0
              <ValueInput
                value={element.z0}
                unit={'Ω'}
                min={1e-3}
                onCommit={(z0) => patch({ z0 })}
              />
            </label>
          </>
        )}
        {element.kind === 'line' && (
          <>
            <label title="Effective relative permittivity">
              &#949;r
              <ValueInput value={element.er ?? 1} plain min={1} onCommit={(er) => patch({ er })} />
            </label>
            <label title="Attenuation in dB per metre of physical length">
              &#945;
              <ValueInput
                value={element.alphaDbPerM ?? 0}
                plain
                min={0}
                onCommit={(alphaDbPerM) => patch({ alphaDbPerM })}
              />
              <span className="muted small">dB/m</span>
            </label>
          </>
        )}
      </div>
      {primary && (
        <div className="row tune">
          {steps ? (
            <>
              <input
                type="range"
                min={0}
                max={steps.length - 1}
                step={1}
                value={nearestIndex(steps, primary.value)}
                title={`Step through the ${sourceName} values around ${formatEngineering(center, { unit: primary.unit })}; press Reset to recentre`}
                aria-label={`Step ${elementName(element)} through ${sourceName} values`}
                aria-valuetext={formatEngineering(primary.value, { unit: primary.unit })}
                onChange={(e) =>
                  updateElement(
                    index,
                    withPrimaryValue(element, steps[Number(e.target.value)] ?? primary.value),
                    true,
                  )
                }
                onPointerUp={commit}
                onKeyUp={commit}
                onClick={(e) => e.stopPropagation()}
              />
              <span className="mono small step-label" title={`${sourceName} value`}>
                {formatEngineering(primary.value, { unit: primary.unit })}
              </span>
            </>
          ) : (
            <input
              type="range"
              min={-1}
              max={1}
              step={0.001}
              value={Math.max(-1, Math.min(1, sliderPos))}
              title="Tune from 0.2x to 5x; press Reset to recentre"
              aria-label={`Tune ${elementName(element)}`}
              onChange={(e) =>
                updateElement(
                  index,
                  withPrimaryValue(element, center * 5 ** Number(e.target.value)),
                  true,
                )
              }
              onPointerUp={commit}
              onKeyUp={commit}
              onClick={(e) => e.stopPropagation()}
            />
          )}
          <button
            className="btn tiny"
            title="Recentre the slider on the current value"
            onClick={(e) => {
              e.stopPropagation();
              setCenter(primary.value);
            }}
          >
            Reset
          </button>
        </div>
      )}
      {element.kind === 'L' && (
        <div className="row note-line small">
          <button
            className="btn tiny"
            title="Turns and wire length for an air-core coil or a toroid"
            onClick={(e) => {
              e.stopPropagation();
              onWinding();
            }}
          >
            Winding&#8230;
          </button>
          {element.note && (
            <>
              <span className="note-text" title="Note of this inductor">
                {element.note}
              </span>
              <button
                className="btn tiny"
                aria-label="Clear the note"
                title="Clear the note"
                onClick={(e) => {
                  e.stopPropagation();
                  const { note: _note, ...rest } = element;
                  void _note;
                  updateElement(index, rest as DesignElement);
                }}
              >
                &#215;
              </button>
            </>
          )}
        </div>
      )}
      {after && <div className="row mono muted small">&#8594; {fmtComplex(after)} &#937;</div>}
      {stress && (
        <div
          className="row stress-line mono small"
          title={stress.parts
            .map(
              (p) =>
                `${p.part}: ${formatEngineering(p.vPeak, { unit: 'V', digits: 3 })} peak, ${formatEngineering(p.iRms, { unit: 'A', digits: 3 })} RMS`,
            )
            .join('; ')}
        >
          <span className={over?.voltage ? 'over' : ''}>
            V<sub>pk</sub> {formatEngineering(stress.vPeak, { unit: 'V', digits: 3 })}
          </span>
          <span className={over?.current ? 'over' : ''}>
            I<sub>rms</sub> {formatEngineering(stress.iRms, { unit: 'A', digits: 3 })}
          </span>
        </div>
      )}
      {realized && (
        <div className={`row realized-line mono small ${realized.locked ? 'locked' : ''}`}>
          <button
            className={`btn tiny lock ${realized.locked ? 'on' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              toggleLock(index);
            }}
            title={
              realized.locked
                ? 'Locked at the exact value; click to let Realize snap it'
                : 'Click to keep this element at its exact value'
            }
            aria-pressed={realized.locked}
            aria-label={realized.locked ? 'Unlock element' : 'Lock element'}
          >
            {realized.locked ? '\u{1F512}' : '\u{1F513}'}
          </button>
          <span className="text" title="Realized value and deviation from the ideal value">
            {realized.locked ? 'locked, exact' : realizedText(realized, sourceLabel)}
          </span>
          {realizedAfter && (
            <span className="muted" title="Node impedance of the realized network">
              &#8594; {fmtComplex(realizedAfter)} &#937;
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function omitQ(el: DesignElement & { kind: 'L' | 'C' }): DesignElement {
  const { q: _q, ...rest } = el;
  void _q;
  return rest;
}
