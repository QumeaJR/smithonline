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
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { LONG_PRESS_MS, longPressMove, longPressStart, type LongPress } from '../chart/gestures';
import {
  autoScrollSpeed,
  cardShift,
  dropIndex,
  MOUSE_DRAG_SLOP,
  outsideList,
  placeholderShift,
  type CardBox,
  type ListRect,
} from '../lib/ladderDrag';
import { useEscapeLayer } from '../lib/overlay';
import { focusPanelSoon } from '../lib/focusPanel';
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
import { designSpread, fmtShare } from '../lib/sensitivity';
import { useFitVersion } from '../lib/measuredLoad';
import { ShareBar } from './ToleranceDepth';
import { useDesignStore } from '../store/useDesignStore';
import { usePackages } from '../store/usePackages';
import { startIndex } from '../lib/datapoints';
import { Datapoints } from './Datapoints';
import { useStartGuideVisible } from './useStartGuideVisible';
import { EmptyState } from './ui/EmptyState';
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
  /** Opens Auto match: the empty ladder's action. */
  readonly onAutoMatch?: (() => void) | undefined;
  /** Show each part's share of the tolerance spread (while the Tolerance panel is open). */
  readonly showSpread?: boolean;
}

/** The panel that scrolls the ladder: the nearest ancestor that scrolls, or null. */
function scrollerOf(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const o = getComputedStyle(p);
    if (/(auto|scroll)/.test(o.overflowY)) return p;
  }
  return null;
}

/**
 * The panel that holds the ladder, on screen: the box of the panel that scrolls it (the
 * left column on a desktop, the side column on a tablet, the sheet on the phone), clipped
 * by the panels around it; the ladder's own box when nothing scrolls it. Out of this box
 * is out of the list: above the first card on show inside the panel is still in it (and
 * scrolls it), while the chart beside it is out even where the list runs on under it.
 */
function panelRect(el: HTMLElement, scroller: HTMLElement | null): ListRect {
  const r = (scroller ?? el).getBoundingClientRect();
  let rect: ListRect = { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
  for (let p = (scroller ?? el).parentElement; p; p = p.parentElement) {
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

/** A card being dragged: which element, where it would land (null: out of the list). */
interface CardDrag {
  /** The element in the hand, by its id: a change to the design under the drag follows it. */
  readonly id: string;
  readonly to: number | null;
  /** The lifted card on the screen (fixed, over every panel): it follows the pointer. */
  readonly left: number;
  readonly top: number;
  readonly width: number;
  /** The dragged card's height and the gap after it: how far the others move aside. */
  readonly step: number;
  /** The cards as they lie now, for the placeholder's slot. */
  readonly cards: readonly CardBox[];
}

/** A press on a card's grip, before and during the drag. */
interface GripPress {
  readonly pointer: number;
  /** The element pressed, by its id. */
  readonly id: string;
  /** Its index now (it follows a change to the design under the drag). */
  from: number;
  readonly x: number;
  readonly y: number;
  readonly touch: boolean;
  started: boolean;
  lp: LongPress;
  timer: ReturnType<typeof setTimeout> | null;
  cards: CardBox[];
  panel: ListRect;
  scroller: HTMLElement | null;
  step: number;
  /** The pointer's last position, client px. */
  px: number;
  py: number;
  /** Where the pointer holds the card: its offset from the card's top left corner, px. */
  ox: number;
  oy: number;
  width: number;
  /** Where it would land now; null while the pointer is out of the list. */
  to: number | null;
  /** The auto-scroll's animation frame while the pointer is at an edge of the panel. */
  frame: number | null;
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
  /** This is the card being dragged: it stays as the placeholder of its slot. */
  readonly lifted: boolean;
  /** ... and it is out of the list: releasing it removes the part. */
  readonly removing: boolean;
  /** Another card moving aside, or the placeholder moving to the slot, px. */
  readonly shift: number;
}

export function Ladder({ result, realization, guide, onAutoMatch, showSpread }: LadderProps) {
  const guideVisible = useStartGuideVisible();
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
  const fits = useFitVersion();
  const spread = useMemo(
    () => (showSpread ? designSpread(design) : null),
    // fits: the measured load model arrives from the fitting worker.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [showSpread, design, fits],
  );
  const removeElement = useDesignStore((s) => s.removeElement);
  const coarse = useCoarsePointer();
  const [windingFor, setWindingFor] = useState<number | null>(null);
  const [dimensionsFor, setDimensionsFor] = useState<number | null>(null);
  const [drag, setDrag] = useState<CardDrag | null>(null);
  const press = useRef<GripPress | null>(null);
  /** A drag just ended: the click that follows it does not select a card. */
  const swallow = useRef(false);
  const root = useRef<HTMLDivElement>(null);

  /** The index of the element `id` in the design as it is now, or -1 when it is gone. */
  const indexOf = (id: string): number =>
    useDesignStore.getState().design.elements.findIndex((e) => e.id === id);

  /**
   * Read the cards and the panel as they lie now (at the start, after a scroll, after a
   * change to the design). False when the dragged element is gone.
   */
  const measure = (p: GripPress): boolean => {
    const box = root.current;
    const from = indexOf(p.id);
    if (!box || from < 0) return false;
    p.from = from;
    const els = [...box.querySelectorAll<HTMLElement>('[data-element-index]')];
    const rects = els.map((el) => el.getBoundingClientRect());
    const me = rects[from];
    const after = rects[from + 1];
    const before = rects[from - 1];
    const gap = after && me ? after.top - me.bottom : before && me ? me.top - before.bottom : 8;
    p.cards = rects.map((c) => ({ top: c.top, height: c.height }));
    p.scroller = scrollerOf(box);
    p.panel = panelRect(box, p.scroller);
    p.step = (me?.height ?? 0) + Math.max(0, gap);
    return true;
  };

  /** Where the card lands for the pointer's last position, and the view of it. */
  const place = (p: GripPress): void => {
    const out = outsideList(p.panel, p.px, p.py);
    p.to = out ? null : dropIndex(p.cards, p.from, p.py);
    setDrag({
      id: p.id,
      to: p.to,
      left: p.px - p.ox,
      top: p.py - p.oy,
      width: p.width,
      step: p.step,
      cards: p.cards,
    });
  };

  /** The cards and the list as they lie when the drag begins. */
  const begin = (p: GripPress): void => {
    if (!measure(p)) return;
    const me = root.current
      ?.querySelectorAll<HTMLElement>('[data-element-index]')
      [p.from]?.getBoundingClientRect();
    p.ox = me ? p.x - me.left : 0;
    p.oy = me ? p.y - me.top : 0;
    p.width = me?.width ?? 0;
    p.started = true;
    place(p);
  };

  const stopScroll = (p: GripPress): void => {
    if (p.frame !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(p.frame);
    }
    p.frame = null;
  };

  /**
   * Near the top or bottom edge of the panel the panel scrolls, faster the nearer the edge;
   * the scroll event measures the cards again.
   */
  const autoScroll = (p: GripPress): void => {
    if (p.frame !== null || typeof requestAnimationFrame !== 'function') return;
    const step = (): void => {
      p.frame = null;
      if (press.current !== p || !p.started || !p.scroller) return;
      const speed = autoScrollSpeed(p.panel, p.px, p.py);
      if (speed === 0) return;
      const before = p.scroller.scrollTop;
      p.scroller.scrollTop = before + speed;
      if (p.scroller.scrollTop === before) return; // at the end of the panel
      p.frame = requestAnimationFrame(step);
    };
    if (p.scroller && autoScrollSpeed(p.panel, p.px, p.py) !== 0) {
      p.frame = requestAnimationFrame(step);
    }
  };

  /**
   * The drag ends: released out of the list removes the part with an Undo
   * message naming it; released in the list moves it there. A cancel (Escape,
   * or the browser taking the pointer) leaves the ladder as it was, and so
   * does a drag whose element went away under it.
   */
  const end = (p: GripPress, cancelled: boolean): void => {
    if (p.timer !== null) clearTimeout(p.timer);
    stopScroll(p);
    press.current = null;
    if (!p.started) return;
    setDrag(null);
    swallow.current = true;
    setTimeout(() => {
      swallow.current = false;
    }, 0);
    const now = indexOf(p.id);
    if (cancelled || now < 0) return;
    if (now !== p.from && measure(p)) place(p);
    if (p.to === null) removeElement(now);
    else if (p.to !== now) reorderElement(now, p.to);
  };

  const track = (p: GripPress, x: number, y: number): void => {
    p.px = x;
    p.py = y;
    // The design changed under the drag (a Delete, an Undo): follow the element.
    if (indexOf(p.id) !== p.from && !measure(p)) {
      end(p, true);
      return;
    }
    place(p);
    autoScroll(p);
  };

  // A change to the design under the drag: measure again, or end the drag without a change
  // when the element in the hand is gone.
  useLayoutEffect(() => {
    const p = press.current;
    if (!p?.started) return;
    if (!measure(p)) end(p, true);
    else place(p);
    // `end`, `measure` and `place` read the latest state through refs and the store.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [design.elements]);

  // A scroll of the panel under the drag (the wheel, the auto-scroll): the cards moved.
  const dragging = drag !== null;
  useEffect(() => {
    if (!dragging) return;
    const onScroll = (): void => {
      const p = press.current;
      if (!p?.started) return;
      if (!measure(p)) end(p, true);
      else place(p);
    };
    document.addEventListener('scroll', onScroll, true);
    return () => document.removeEventListener('scroll', onScroll, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragging]);

  const grip = (index: number): GripHandlers => ({
    onPointerDown: (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      // The buttons and fields of the row keep their own press.
      if ((e.target as HTMLElement).closest('button, input, select, textarea, a, label')) return;
      const element = useDesignStore.getState().design.elements[index];
      if (!element) return;
      const touch = e.pointerType !== 'mouse';
      capturePointer(e.currentTarget, e.pointerId);
      const p: GripPress = {
        pointer: e.pointerId,
        id: element.id,
        from: index,
        x: e.clientX,
        y: e.clientY,
        touch,
        started: false,
        lp: longPressStart(e.clientX, e.clientY, e.timeStamp),
        timer: null,
        cards: [],
        panel: { left: 0, top: 0, right: 0, bottom: 0 },
        scroller: null,
        step: 0,
        px: e.clientX,
        py: e.clientY,
        ox: 0,
        oy: 0,
        width: 0,
        to: index,
        frame: null,
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
      if (!p || p.pointer !== e.pointerId) return;
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
      if (!p || p.pointer !== e.pointerId) return;
      if (p.started) track(p, e.clientX, e.clientY);
      if (press.current === p) end(p, false);
    },
    // The browser or the window took the pointer: the drag is cancelled, wherever it was.
    onPointerCancel: (e) => {
      const p = press.current;
      if (!p || p.pointer !== e.pointerId) return;
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
  // Escape puts the card back and does nothing else: the drag is the top of the Escape stack
  // while it lasts, so an armed part or an open tool stays.
  useEscapeLayer('drag', dragging, () => {
    const p = press.current;
    if (p) end(p, true);
  });

  /** The dragged element's index now (it follows the design), or -1. */
  const dragFrom = drag ? design.elements.findIndex((e) => e.id === drag.id) : -1;
  const viewOf = (i: number): CardDragView | null =>
    drag === null || dragFrom < 0
      ? null
      : {
          lifted: i === dragFrom,
          removing: i === dragFrom && drag.to === null,
          shift:
            i === dragFrom
              ? drag.to === null
                ? 0
                : placeholderShift(drag.cards, dragFrom, drag.to)
              : cardShift(i, dragFrom, drag.to, drag.step),
        };
  const liftedElement = dragFrom >= 0 ? design.elements[dragFrom] : undefined;

  return (
    <div className={`ladder${drag ? ' reordering' : ''}`} ref={root}>
      {guide}
      <div className={`card load ${selected === 0 ? 'selected' : ''}`} onClick={() => select(0)}>
        <div className="row">
          <Badge className="idx" color="var(--marker)" style={{ color: 'var(--surface)' }}>
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
          spreadShare={spread ? (spread.byElement.get(i) ?? 0) : null}
          drag={viewOf(i)}
          grip={grip(i)}
          swallowClick={() => swallow.current}
          onDimensions={() => setDimensionsFor(i)}
        />
      ))}
      {dimensionsFor !== null && (
        <DimensionsDialog index={dimensionsFor} onClose={() => setDimensionsFor(null)} />
      )}
      {design.elements.length === 0 && !guideVisible && (
        <EmptyState
          className="ladder-empty"
          title="No parts yet"
          line={pointerHints(coarse).emptyLadder}
          action={
            onAutoMatch
              ? {
                  label: 'Auto match',
                  onClick: () => {
                    onAutoMatch();
                    // The panel opened to work in takes the focus, not the page body.
                    focusPanelSoon(null, true);
                  },
                  title: 'Open Auto match: L, Pi and T networks to the target, ranked by Q',
                }
              : undefined
          }
        />
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
            // A value typed over the default Z0 sets the target, 50 at Z0 50 too.
            commitUnchanged={design.target === null}
            onCommit={(re) => setTarget(complex(re, targetOf(design).im))}
            ariaLabel="Target resistance"
          />
          <Field
            label="X"
            value={targetOf(design).im}
            unit={'Ω'}
            commitUnchanged={design.target === null}
            onCommit={(im) => setTarget(complex(targetOf(design).re, im))}
            ariaLabel="Target reactance"
          />
          <Button
            size="sm"
            pressed={targetOf(design).re === design.z0 && targetOf(design).im === 0}
            // An explicit target equal to Z0: the match goes to the centre, and the start
            // guide's "Set the target" counts it as set.
            onClick={() => setTarget(complex(design.z0, 0))}
            title="Match to the reference impedance, the centre of the chart"
          >
            = Z0
          </Button>
        </div>
      </div>
      {windingFor !== null && (
        <WindingDialog index={windingFor} onClose={() => setWindingFor(null)} />
      )}
      {drag &&
        liftedElement &&
        createPortal(
          // The card in the hand, over every panel and the chart: the scrolling panel that
          // holds the list would clip it. Its place in the list keeps a placeholder.
          <div
            className={`card lifted drag-ghost${drag.to === null ? ' remove-cue' : ''}`}
            style={{ left: drag.left, top: drag.top, width: drag.width || undefined }}
            aria-hidden="true"
          >
            {drag.to === null && (
              <span className="remove-cue-mark">
                <IconTrash size={16} /> Remove
              </span>
            )}
            <div className="row">
              <span className="handle">
                <IconGrip size={14} />
              </span>
              <Badge className="idx" color={liftedElement.color}>
                {dragFrom + 1}
              </Badge>
              <span className="name">{elementName(liftedElement)}</span>
              <span className="mono muted small">{elementSummary(liftedElement)}</span>
            </div>
          </div>,
          document.body,
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
  /** The part's share of the tolerance spread (Tolerance panel open); null when not shown. */
  readonly spreadShare: number | null;
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
  spreadShare,
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
  /**
   * A slider drag (or a run of key presses) ends as one step named after the part and the
   * value it ended on: the message says it and Undo and Redo repeat it.
   */
  const commitTune = (): void => {
    const d = useDesignStore.getState().design;
    const at = d.elements.findIndex((e) => e.id === element.id);
    const now = at >= 0 ? d.elements[at] : undefined;
    commit(now ? `Tuned ${elementName(now)} ${at + 1} to ${elementSummary(now)}` : undefined);
  };
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
  /**
   * Move the card and keep the focus on it: the moved card's own control takes the focus back
   * (the menu button, or the same arrow while it is still enabled), not whatever button now
   * sits at the old position.
   */
  const move = (direction: -1 | 1, focus: 'menu' | 'arrow'): void => {
    moveElement(index, direction);
    const id = element.id;
    setTimeout(() => {
      const card = document.querySelector<HTMLElement>(`[data-element-id="${id}"]`);
      if (!card) return;
      const same = card.querySelector<HTMLButtonElement>(
        `button[aria-label="${direction < 0 ? 'Move up' : 'Move down'}"]:not(:disabled)`,
      );
      const target =
        focus === 'menu'
          ? card.querySelector<HTMLElement>('.menu.overflow > button')
          : (same ?? card.querySelector<HTMLElement>('button[aria-label^="Move"]:not(:disabled)'));
      target?.focus({ preventScroll: true });
    }, 0);
  };
  const overflow: OverflowItem[] = [
    { label: 'Move up', disabled: index === 0, onSelect: () => move(-1, 'menu') },
    { label: 'Move down', disabled: index === count - 1, onSelect: () => move(1, 'menu') },
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
    drag?.lifted ? 'drag-placeholder' : '',
    drag?.removing ? 'removed' : '',
    drag ? 'shifting' : '',
  ]
    .filter(Boolean)
    .join(' ');
  const transform = drag && drag.shift !== 0 ? `translateY(${drag.shift}px)` : undefined;

  return (
    <div
      className={classes}
      data-element-index={index}
      data-element-id={element.id}
      style={transform ? { transform } : undefined}
      onClick={() => {
        if (!swallowClick()) select(index + 1);
      }}
    >
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
                onClick={(e) => (e.stopPropagation(), move(-1, 'arrow'))}
              />
              <IconButton
                size="sm"
                icon={<IconArrowDown size={13} />}
                label="Move down"
                title="Move towards the source"
                disabled={index === count - 1}
                onClick={(e) => (e.stopPropagation(), move(1, 'arrow'))}
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
                onCommit={commitTune}
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
              onCommit={commitTune}
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
      {spreadShare !== null && (
        <div
          className="row spread-line small"
          title="Share of the tolerance spread of Γ this part causes (sensitivity times tolerance)"
        >
          <ShareBar share={spreadShare} />
          <span className="mono">{fmtShare(spreadShare)}</span>
          <span className="muted">of the spread</span>
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
            title={realized.locked ? pointerHints(coarse).lockOn : pointerHints(coarse).lockOff}
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
