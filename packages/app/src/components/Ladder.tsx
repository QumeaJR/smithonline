import {
  complex,
  elementExceeds,
  formatEngineering,
  isPackageId,
  nearestIndex,
  packageById,
  packageSelfResonance,
  packagesFor,
  type ElementStress,
  type LadderResult,
  type Realization,
  type RealizedElement,
} from '@smithonline/core';
import { useMemo, useState, type DragEvent } from 'react';
import { targetOf, type DesignElement } from '../lib/design';
import { elementName, elementSummary, primaryValue, withPrimaryValue } from '../lib/elements';
import { fmtComplex, fmtFrequency } from '../lib/format';
import { effectiveElements, realizedText, sliderSteps } from '../lib/realize';
import { activeLimits, designStress, stressSettings } from '../lib/stress';
import { useDesignStore } from '../store/useDesignStore';
import { usePackages } from '../store/usePackages';
import { startIndex } from '../lib/datapoints';
import { Datapoints } from './Datapoints';
import { LoadFields } from './LoadFields';
import { DimensionsDialog } from './DimensionsDialog';
import { WindingDialog } from './WindingDialog';
import { useCoarsePointer } from '../lib/pointer';
import { Badge } from './ui/Badge';
import { Button, IconButton } from './ui/Button';
import { Field } from './ui/Field';
import {
  IconArrowDown,
  IconArrowRight,
  IconArrowUp,
  IconClose,
  IconGrip,
  IconLock,
  IconUnlock,
} from './ui/icons';
import { OverflowMenu, type OverflowItem } from './ui/OverflowMenu';
import { Slider } from './ui/Slider';

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
  const [dimensionsFor, setDimensionsFor] = useState<number | null>(null);

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
          <Badge className="idx" color="var(--marker)" style={{ color: 'var(--panel)' }}>
            DP{startIndex(design) + 1}
          </Badge>
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
          onDimensions={() => setDimensionsFor(i)}
        />
      ))}
      {dimensionsFor !== null && (
        <DimensionsDialog index={dimensionsFor} onClose={() => setDimensionsFor(null)} />
      )}
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
          <Badge className="idx" color="var(--accent)" style={{ color: 'var(--on-accent)' }}>
            <IconArrowRight size={12} />
          </Badge>
          <span className="name">Target</span>
          <span className="mono muted">
            {fmtComplex(targetOf(design))} &#937;
            {design.target === null ? ' (Z0)' : ''}
          </span>
        </div>
        <div className="row fields">
          <Field
            label="R"
            value={targetOf(design).re}
            unit={'Ω'}
            min={1e-6}
            onCommit={(re) => setTarget(complex(re, targetOf(design).im))}
            ariaLabel="Target resistance"
          />
          <Field
            label="X"
            value={targetOf(design).im}
            unit={'Ω'}
            onCommit={(im) => setTarget(complex(targetOf(design).re, im))}
            ariaLabel="Target reactance"
          />
          <Button
            size="sm"
            pressed={design.target === null}
            onClick={() => setTarget(null)}
            title="Match to the reference impedance, the centre of the chart"
          >
            = Z0
          </Button>
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
  /** Opens the Dimensions dialog; used by lines and stubs. */
  readonly onDimensions: () => void;
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
  onDimensions,
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
  // On a touch screen the small buttons of the card collapse into one overflow menu.
  const coarse = useCoarsePointer();
  const isLine =
    element.kind === 'line' || element.kind === 'openStub' || element.kind === 'shortStub';
  const overflow: OverflowItem[] = [
    { label: 'Move up', disabled: index === 0, onSelect: () => moveElement(index, -1) },
    { label: 'Move down', disabled: index === count - 1, onSelect: () => moveElement(index, 1) },
    ...(isLine ? [{ label: 'Dimensions…', onSelect: onDimensions }] : []),
    ...(element.kind === 'L' ? [{ label: 'Winding…', onSelect: onWinding }] : []),
    { label: 'Delete', destructive: true, onSelect: () => removeElement(index) },
  ];

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
          <IconGrip size={14} />
        </span>
        <Badge className="idx" color={element.color}>
          {index + 1}
        </Badge>
        <span className="name">{elementName(element)}</span>
        <span className="mono muted small">{elementSummary(element)}</span>
        <span className="actions">
          {coarse ? (
            <OverflowMenu label={`More for element ${index + 1}`} items={overflow} />
          ) : (
            <>
              <IconButton
                size="sm"
                icon={<IconArrowUp size={13} />}
                label="Move up"
                title="Move towards the load"
                disabled={index === 0}
                onClick={(e) => (e.stopPropagation(), moveElement(index, -1))}
              />
              <IconButton
                size="sm"
                icon={<IconArrowDown size={13} />}
                label="Move down"
                title="Move towards the source"
                disabled={index === count - 1}
                onClick={(e) => (e.stopPropagation(), moveElement(index, 1))}
              />
              <IconButton
                size="sm"
                className="destructive-icon"
                icon={<IconClose size={13} />}
                label="Delete"
                onClick={(e) => (e.stopPropagation(), removeElement(index))}
              />
            </>
          )}
        </span>
      </div>
      <div className="row fields">
        {element.kind === 'R' && (
          <Field
            label="R"
            value={element.value}
            unit={'Ω'}
            min={0}
            onCommit={(value) => patch({ value })}
          />
        )}
        {(element.kind === 'L' || element.kind === 'C') && (
          <>
            <Field
              label={element.kind}
              value={element.value}
              unit={element.kind === 'L' ? 'H' : 'F'}
              min={0}
              onCommit={(value) => patch({ value })}
            />
            <span className="q-field">
              <Field
                label="Q"
                title={
                  defaultQ > 0
                    ? `Quality factor; 0 uses the default Q of ${defaultQ} from the Losses setting`
                    : 'Quality factor, 0 for ideal'
                }
                value={element.q ?? 0}
                plain
                min={0}
                inputClassName={
                  defaultQ > 0 && !(element.q && element.q > 0) ? 'default-q' : undefined
                }
                onCommit={(q) => updateElement(index, q > 0 ? { ...element, q } : omitQ(element))}
              />
              {defaultQ > 0 && !(element.q && element.q > 0) && (
                <span className="muted small">= {defaultQ}</span>
              )}
            </span>
            <PackageField index={index} element={element} />
          </>
        )}
        {element.kind === 'RLC' && (
          <>
            <Field
              label="R"
              value={element.r ?? 0}
              unit={'Ω'}
              min={0}
              onCommit={(r) => patch({ r })}
            />
            <Field
              label="L"
              value={element.l ?? 0}
              unit="H"
              min={0}
              onCommit={(l) => patch({ l })}
            />
            <Field
              label="C"
              value={element.c ?? 0}
              unit="F"
              min={0}
              onCommit={(c) => patch({ c })}
            />
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
          <Field
            label="n"
            title="Voltage ratio; the source sees n squared times the load"
            value={element.n}
            plain
            min={1e-6}
            onCommit={(n) => patch({ n })}
          />
        )}
        {isLine && (
          <>
            <Field
              label={<>l/&#955;</>}
              title="Electrical length in wavelengths at the design frequency"
              value={element.length}
              plain
              digits={5}
              min={0}
              onCommit={(length) => patch({ length })}
            />
            <Field
              label="Z0"
              value={element.z0}
              unit={'Ω'}
              min={1e-3}
              onCommit={(z0) => patch({ z0 })}
            />
            {!coarse && (
              <Button
                size="sm"
                onClick={(e) => (e.stopPropagation(), onDimensions())}
                title="Track width and physical length on a substrate or coax"
              >
                Dimensions&#8230;
              </Button>
            )}
          </>
        )}
        {element.kind === 'line' && (
          <>
            <Field
              label={<>&#949;r</>}
              title="Effective relative permittivity"
              value={element.er ?? 1}
              plain
              min={1}
              onCommit={(er) => patch({ er })}
            />
            <Field
              label={<>&#945;</>}
              title="Attenuation in dB per metre of physical length"
              value={element.alphaDbPerM ?? 0}
              plain
              min={0}
              suffix="dB/m"
              onCommit={(alphaDbPerM) => patch({ alphaDbPerM })}
            />
          </>
        )}
      </div>
      {primary && (
        <div className="row tune">
          {steps ? (
            <>
              <Slider
                min={0}
                max={steps.length - 1}
                step={1}
                value={nearestIndex(steps, primary.value)}
                ticks={steps.length}
                title={`Step through the ${sourceName} values around ${formatEngineering(center, { unit: primary.unit })}; press Reset to recentre`}
                ariaLabel={`Step ${elementName(element)} through ${sourceName} values`}
                ariaValuetext={formatEngineering(primary.value, { unit: primary.unit })}
                onChange={(v) =>
                  updateElement(index, withPrimaryValue(element, steps[v] ?? primary.value), true)
                }
                onCommit={commit}
                onClick={(e) => e.stopPropagation()}
              />
              <span className="mono small step-label" title={`${sourceName} value`}>
                {formatEngineering(primary.value, { unit: primary.unit })}
              </span>
            </>
          ) : (
            <Slider
              min={-1}
              max={1}
              step={0.001}
              value={Math.max(-1, Math.min(1, sliderPos))}
              title="Tune from 0.2x to 5x; press Reset to recentre"
              ariaLabel={`Tune ${elementName(element)}`}
              onChange={(v) =>
                updateElement(index, withPrimaryValue(element, center * 5 ** v), true)
              }
              onCommit={commit}
              onClick={(e) => e.stopPropagation()}
            />
          )}
          <Button
            size="sm"
            title="Recentre the slider on the current value"
            onClick={(e) => {
              e.stopPropagation();
              setCenter(primary.value);
            }}
          >
            Reset
          </Button>
        </div>
      )}
      {element.kind === 'L' && (!coarse || element.note) && (
        <div className="row note-line small">
          {!coarse && (
            <Button
              size="sm"
              title="Turns and wire length for an air-core coil or a toroid"
              onClick={(e) => {
                e.stopPropagation();
                onWinding();
              }}
            >
              Winding&#8230;
            </Button>
          )}
          {element.note && (
            <>
              <span className="note-text" title="Note of this inductor">
                {element.note}
              </span>
              <IconButton
                size="sm"
                icon={<IconClose size={13} />}
                label="Clear the note"
                onClick={(e) => {
                  e.stopPropagation();
                  const { note: _note, ...rest } = element;
                  void _note;
                  updateElement(index, rest as DesignElement);
                }}
              />
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
          <Button
            variant="icon"
            size="sm"
            className="lock"
            pressed={realized.locked}
            onClick={(e) => {
              e.stopPropagation();
              toggleLock(index);
            }}
            title={
              realized.locked
                ? 'Locked at the exact value; click to let Realize snap it'
                : 'Click to keep this element at its exact value'
            }
            aria-label={realized.locked ? 'Unlock element' : 'Lock element'}
          >
            {realized.locked ? <IconLock size={13} /> : <IconUnlock size={13} />}
          </Button>
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

/**
 * The component package of an inductor or capacitor: none, or a row of the
 * parasitics table (Settings). With a package the card names the part's
 * self-resonant frequency, the first thing a builder wants to know.
 */
function PackageField({
  index,
  element,
}: {
  readonly index: number;
  readonly element: DesignElement & { kind: 'L' | 'C' };
}) {
  const table = usePackages((s) => s.table);
  const setPackage = useDesignStore((s) => s.setPackage);
  const offered = packagesFor(table, element.kind);
  const chosen = element.package ? packageById(table, element.package) : undefined;
  const srf = chosen ? packageSelfResonance(element, chosen) : null;
  return (
    <label
      className="package-field"
      title={
        chosen
          ? `${chosen.label}: the dotted locus adds its parasitics. ${chosen.source}`
          : 'Component package; adds typical parasitics as a dotted locus (table in Settings)'
      }
    >
      Pkg
      <select
        value={element.package ?? ''}
        onChange={(e) => setPackage(index, isPackageId(e.target.value) ? e.target.value : null)}
        onClick={(e) => e.stopPropagation()}
        aria-label={`Package of element ${index + 1}`}
      >
        <option value="">none</option>
        {offered.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label}
          </option>
        ))}
        {element.package && !offered.some((p) => p.id === element.package) && (
          <option value={element.package}>{element.package}</option>
        )}
      </select>
      {srf !== null && (
        <span className="muted small" title="Self-resonant frequency with the package's parasitics">
          SRF {fmtFrequency(srf)}
        </span>
      )}
    </label>
  );
}

function omitQ(el: DesignElement & { kind: 'L' | 'C' }): DesignElement {
  const { q: _q, ...rest } = el;
  void _q;
  return rest;
}
