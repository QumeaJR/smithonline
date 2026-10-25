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
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { LONG_PRESS_MS, longPressMove, longPressStart, type LongPress } from '../chart/gestures';
import {
  cardShift,
  dropIndex,
  MOUSE_DRAG_SLOP,
  outsideList,
  type CardBox,
  type ListRect,
} from '../lib/ladderDrag';
import { targetOf, type DesignElement } from '../lib/design';
import {
  elementName,
  elementSummary,
  primaryValue,
  sliderCentre,
  withPrimaryValue,
} from '../lib/elements';
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
import { capturePointer, useCoarsePointer } from '../lib/pointer';
import { pointerHints } from '../lib/tips';
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
  IconTrash,
  IconUnlock,
} from './ui/icons';
import { OverflowMenu, type OverflowItem } from './ui/OverflowMenu';
import { Slider } from './ui/Slider';

interface LadderProps {
  readonly result: LadderResult;
  /** The realized network when Realize mode is on. */
  readonly realization: Realization | null;
  /** The start guide, at the head of the ladder directly above the load card. */
  readonly guide?: ReactNode;
}

/**
 * The part of the list on show: its box clipped by the panels that scroll it (the phone's
 * sheet, a column), so a card dragged over the chart is out of the list even where the list
 * runs on under it.
 */
function visibleRect(el: HTMLElement): ListRect {
  const r = el.getBoundingClientRect();
  let rect: ListRect = { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
  for (let p = el.parentElement; p; p = p.parentElement) {
    const o = getComputedStyle(p);
    if (!/(auto|scroll|hidden|clip)/.test(`${o.overflowY}${o.overflowX}`)) continue;
    const c = p.getBoundingClientRect();
    rect = {
      left: Math.max(rect.left, c.left),
      top: Math.max(rect.top, c.top),
      right: Math.min(rect.right, c.right),
      bottom: Math.min(rect.bottom, c.bottom),
    };
  }
  return rect;
}

/** A card being dragged: where it came from, where it would land (null: out of the list). */
interface CardDrag {
  readonly from: number;
  readonly to: number | null;
  /** The pointer's movement since the press, px: the card follows it. */
  readonly dx: number;
  readonly dy: number;
  /** The dragged card's height and the gap after it: how far the others move aside. */
  readonly step: number;
}

/** A press on a card's grip, before and during the drag. */
interface GripPress {
  readonly id: number;
  readonly from: number;
  readonly x: number;
  readonly y: number;
  readonly touch: boolean;
  started: boolean;
  lp: LongPress;
  timer: ReturnType<typeof setTimeout> | null;
  cards: CardBox[];
  list: ListRect;
  step: number;
  /** Where it would land now; null while the pointer is out of the list. */
  to: number | null;
}

/** The handlers of a card's grip row. */
interface GripHandlers {
  readonly onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void;
  readonly onPointerMove: (e: ReactPointerEvent<HTMLElement>) => void;
  readonly onPointerUp: (e: ReactPointerEvent<HTMLElement>) => void;
  readonly onPointerCancel: (e: ReactPointerEvent<HTMLElement>) => void;
}

/** How a card shows during a drag of any card. */
interface CardDragView {
  /** This is the card being dragged. */
  readonly lifted: boolean;
  /** ... and it is out of the list: releasing it removes the part. */
  readonly removing: boolean;
  readonly dx: number;
  readonly dy: number;
  /** Another card moving aside, px. */
  readonly shift: number;
}

export function Ladder({ result, realization, guide }: LadderProps) {
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
  const removeElement = useDesignStore((s) => s.removeElement);
  const coarse = useCoarsePointer();
  const [windingFor, setWindingFor] = useState<number | null>(null);
  const [dimensionsFor, setDimensionsFor] = useState<number | null>(null);
  const [drag, setDrag] = useState<CardDrag | null>(null);
  const press = useRef<GripPress | null>(null);
  /** A drag just ended: the click that follows it does not select a card. */
  const swallow = useRef(false);
  const root = useRef<HTMLDivElement>(null);

  /** The cards and the list as they lie when the drag begins. */
  const begin = (p: GripPress): void => {
    const box = root.current;
    if (!box) return;
    const els = [...box.querySelectorAll<HTMLElement>('[data-element-index]')];
    const rects = els.map((el) => el.getBoundingClientRect());
    const me = rects[p.from];
    const after = rects[p.from + 1];
    const before = rects[p.from - 1];
    const gap = after && me ? after.top - me.bottom : before && me ? me.top - before.bottom : 8;
    p.cards = rects.map((c) => ({ top: c.top, height: c.height }));
    p.list = visibleRect(box);
    p.step = (me?.height ?? 0) + Math.max(0, gap);
    p.started = true;
    p.to = p.from;
    setDrag({ from: p.from, to: p.from, dx: 0, dy: 0, step: p.step });
  };

  /**
   * The drag ends: released out of the list (or lost there) removes the part
   * with an Undo message naming it; released in the list moves it there; a
   * cancel inside the list leaves the ladder as it was.
   */
  const end = (p: GripPress, cancelled: boolean): void => {
    if (p.timer !== null) clearTimeout(p.timer);
    press.current = null;
    if (!p.started) return;
    setDrag(null);
    swallow.current = true;
    setTimeout(() => {
      swallow.current = false;
    }, 0);
    if (p.to === null) removeElement(p.from);
    else if (!cancelled && p.to !== p.from) reorderElement(p.from, p.to);
  };

  const track = (p: GripPress, x: number, y: number): void => {
    const out = outsideList(p.list, x, y);
    p.to = out ? null : dropIndex(p.cards, p.from, y);
    setDrag({ from: p.from, to: p.to, dx: x - p.x, dy: y - p.y, step: p.step });
  };

  const grip = (index: number): GripHandlers => ({
    onPointerDown: (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      // The buttons and fields of the row keep their own press.
      if ((e.target as HTMLElement).closest('button, input, select, textarea, a, label')) return;
      const touch = e.pointerType !== 'mouse';
      capturePointer(e.currentTarget, e.pointerId);
      const p: GripPress = {
        id: e.pointerId,
        from: index,
        x: e.clientX,
        y: e.clientY,
        touch,
        started: false,
        lp: longPressStart(e.clientX, e.clientY, e.timeStamp),
        timer: null,
        cards: [],
        list: { left: 0, top: 0, right: 0, bottom: 0 },
        step: 0,
        to: index,
      };
      press.current = p;
      // A touch screen lifts the card after a long press, so a swipe still scrolls the panel.
      if (touch) {
        p.timer = setTimeout(() => {
          p.timer = null;
          if (press.current === p && !p.started && p.lp.state === 'pending') begin(p);
        }, LONG_PRESS_MS);
      }
    },
    onPointerMove: (e) => {
      const p = press.current;
      if (!p || p.id !== e.pointerId) return;
      if (!p.started) {
        if (p.touch) {
          p.lp = longPressMove(p.lp, e.clientX, e.clientY);
          if (p.lp.state === 'cancelled') end(p, true);
          return;
        }
        if (Math.hypot(e.clientX - p.x, e.clientY - p.y) <= MOUSE_DRAG_SLOP) return;
        begin(p);
      }
      track(p, e.clientX, e.clientY);
    },
    onPointerUp: (e) => {
      const p = press.current;
      if (!p || p.id !== e.pointerId) return;
      if (p.started) track(p, e.clientX, e.clientY);
      end(p, false);
    },
    // The browser or the window took the pointer: out of the list that is a release there.
    onPointerCancel: (e) => {
      const p = press.current;
      if (!p || p.id !== e.pointerId) return;
      end(p, true);
    },
  });

  // While a card is lifted on a touch screen the panel does not scroll under the finger, and
  // Escape puts the card back.
  useEffect(() => {
    const box = root.current;
    if (!box) return;
    const onTouchMove = (e: TouchEvent): void => {
      if (press.current?.started && e.cancelable) e.preventDefault();
    };
    box.addEventListener('touchmove', onTouchMove, { passive: false });
    return () => box.removeEventListener('touchmove', onTouchMove);
  }, []);
  const dragging = drag !== null;
  useEffect(() => {
    if (!dragging) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      const p = press.current;
      if (!p) return;
      e.preventDefault();
      e.stopPropagation();
      p.to = p.from;
      end(p, true);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  const viewOf = (i: number): CardDragView | null =>
    drag === null
      ? null
      : {
          lifted: i === drag.from,
          removing: i === drag.from && drag.to === null,
          dx: i === drag.from ? drag.dx : 0,
          dy: i === drag.from ? drag.dy : 0,
          shift: cardShift(i, drag.from, drag.to, drag.step),
        };

  return (
    <div className={`ladder${drag ? ' reordering' : ''}`} ref={root}>
      {guide}
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
          drag={viewOf(i)}
          grip={grip(i)}
          swallowClick={() => swallow.current}
          onDimensions={() => setDimensionsFor(i)}
        />
      ))}
      {dimensionsFor !== null && (
        <DimensionsDialog index={dimensionsFor} onClose={() => setDimensionsFor(null)} />
      )}
      {design.elements.length === 0 && (
        <p className="muted hint">{pointerHints(coarse).emptyLadder}</p>
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
  /** How the card shows while a card of the ladder is dragged; null otherwise. */
  readonly drag: CardDragView | null;
  /** The pointer handlers of the grip row: drag to reorder, out of the list to remove. */
  readonly grip: GripHandlers;
  /** A drag just ended: its click does not select the card. */
  readonly swallowClick: () => boolean;
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
  drag,
  grip,
  swallowClick,
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
  // A value of 0 cannot centre a log scale: the centre falls back to the palette's starting value.
  const centreFor = (el: DesignElement): number => {
    const { z0, frequency } = useDesignStore.getState().design;
    return sliderCentre(el, z0, frequency);
  };
  const [center, setCenter] = useState(() => centreFor(element));
  const ratio = primary ? Math.log(primary.value / center) / Math.log(5) : 0;
  // 0 lies at -Infinity on the log scale (the knob rests at the left end); NaN rests mid-track.
  const sliderPos = Number.isNaN(ratio) ? 0 : Math.max(-1, Math.min(1, ratio));
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
  // Each value field is named for the element and the quantity, "Series C 2 capacitance": the
  // accessible name of the input and the name in a refusal message.
  const named = (quantity: string): { ariaLabel: string; name: string } => {
    const text = `${elementName(element)} ${index + 1} ${quantity}`;
    return { ariaLabel: text, name: text };
  };

  const classes = [
    'card',
    isSelected ? 'selected' : '',
    drag?.lifted ? 'lifted' : '',
    drag?.removing ? 'remove-cue' : '',
    drag && !drag.lifted ? 'shifting' : '',
  ]
    .filter(Boolean)
    .join(' ');
  const transform = drag
    ? drag.lifted
      ? `translate(${drag.dx}px, ${drag.dy}px)`
      : drag.shift !== 0
        ? `translateY(${drag.shift}px)`
        : undefined
    : undefined;

  return (
    <div
      className={classes}
      data-element-index={index}
      style={transform ? { transform } : undefined}
      onClick={() => {
        if (!swallowClick()) select(index + 1);
      }}
    >
      {drag?.removing && (
        <span className="remove-cue-mark" aria-hidden="true">
          <IconTrash size={16} /> Remove
        </span>
      )}
      <div
        className="row grip"
        {...grip}
        onContextMenu={(e) => {
          // A long press on a touch screen lifts the card; no menu of the browser's own.
          if (coarse) e.preventDefault();
        }}
        title={
          coarse
            ? 'Long press and drag to reorder; drag out of the list to remove'
            : 'Drag to reorder; drop outside the list to remove'
        }
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
            <OverflowMenu
              label={`More for element ${index + 1}`}
              title={`${elementName(element)} ${index + 1}, ${elementSummary(element)}`}
              closeLabel={`Close ${elementName(element)} ${index + 1}`}
              items={overflow}
            />
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
            {...named('resistance')}
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
              {...named(element.kind === 'L' ? 'inductance' : 'capacitance')}
              value={element.value}
              unit={element.kind === 'L' ? 'H' : 'F'}
              min={0}
              onCommit={(value) => patch({ value })}
            />
            <span className="q-field">
              <Field
                label="Q"
                {...named('Q')}
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
              {...named('resistance')}
              value={element.r ?? 0}
              unit={'Ω'}
              min={0}
              onCommit={(r) => patch({ r })}
            />
            <Field
              label="L"
              {...named('inductance')}
              value={element.l ?? 0}
              unit="H"
              min={0}
              onCommit={(l) => patch({ l })}
            />
            <Field
              label="C"
              {...named('capacitance')}
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
            {...named('turns ratio')}
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
              {...named('electrical length')}
              title="Electrical length in wavelengths at the design frequency"
              value={element.length}
              plain
              digits={5}
              min={0}
              onCommit={(length) => patch({ length })}
            />
            <Field
              label="Z0"
              {...named('impedance')}
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
              {...named('effective permittivity')}
              title="Effective relative permittivity"
              value={element.er ?? 1}
              plain
              min={1}
              onCommit={(er) => patch({ er })}
            />
            <Field
              label={<>&#945;</>}
              {...named('attenuation')}
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
              value={sliderPos}
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
              setCenter(centreFor(element));
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
