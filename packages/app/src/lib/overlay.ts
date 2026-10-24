/**
 * The overlay model of docs/07-interaction-redesign.md section 2.3 and 4:
 * where a popover goes (a pure function that prefers the anchor's alignment,
 * flips and clamps), the one Escape stack (the top overlay first, then an
 * armed part, then an open tool panel, then the tour), the shared focus trap
 * with focus return to the opener, and the drag offset of a dialog clamped to
 * the window. Overlays never scroll the page: every focus call here passes
 * `preventScroll`.
 */
import { useEffect, useId, useLayoutEffect, useRef, type RefObject } from 'react';
/** A value field with typed text takes the first Escape (see isFieldEscape in refusal.ts). */
const isFieldEscape = (e: KeyboardEvent): boolean =>
  e.target instanceof HTMLElement && e.target.hasAttribute('data-editing');

/** Distance an overlay keeps from the window edges, px. */
export const OVERLAY_GUTTER = 12;

/** The part of a DOMRect the positioning reads; a DOMRect fits. */
export interface Rect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface Size {
  readonly width: number;
  readonly height: number;
}

export interface Viewport {
  readonly width: number;
  readonly height: number;
}

export interface OverlayPrefer {
  /** Below the anchor (default) or above it. */
  readonly side?: 'bottom' | 'top';
  /** The overlay's left edge on the anchor's left edge (start, default) or right on right (end). */
  readonly align?: 'start' | 'end';
  /** Space between the anchor and the overlay, px; default 4. */
  readonly gap?: number;
  /** Distance to the window edges, px; default OVERLAY_GUTTER. */
  readonly gutter?: number;
}

export interface OverlayPosition {
  readonly left: number;
  readonly top: number;
  readonly side: 'bottom' | 'top';
  readonly align: 'start' | 'end';
  /** Set when the overlay is taller than the room on its side of the anchor; it then scrolls inside. */
  readonly maxHeight?: number;
  /** Set when the overlay is wider than the window allows. */
  readonly maxWidth?: number;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), hi);

/**
 * Where an overlay of `size` goes next to `anchor` (a button, or a point as a
 * rectangle of zero size) inside `viewport`. It takes the preferred side and
 * alignment, flips to the other one when the preferred one would leave the
 * window and the other fits, and finally clamps into the window less the
 * gutter. An overlay taller than the room on its side (below the anchor, or
 * above it when flipped) is limited to that room and scrolls inside, so it
 * never covers its own anchor; one wider than the window is limited to it.
 */
export function positionOverlay(
  anchor: Rect,
  size: Size,
  viewport: Viewport,
  prefer: OverlayPrefer = {},
): OverlayPosition {
  const gap = prefer.gap ?? 4;
  const g = prefer.gutter ?? OVERLAY_GUTTER;
  const right = anchor.left + anchor.width;
  const bottom = anchor.top + anchor.height;
  const room = {
    width: Math.max(0, viewport.width - 2 * g),
    height: Math.max(0, viewport.height - 2 * g),
  };
  const w = Math.min(size.width, room.width);

  // Vertical: below or above, flipping when only the other side fits. The room on a side runs
  // from the anchor (plus the gap) to the window edge less the gutter.
  const below = bottom + gap;
  const roomBelow = Math.max(0, viewport.height - g - Math.max(below, g));
  const roomAbove = Math.max(0, Math.min(anchor.top - gap, viewport.height - g) - g);
  const fitsBelow = size.height <= roomBelow;
  const fitsAbove = size.height <= roomAbove;
  let side = prefer.side ?? 'bottom';
  if (
    side === 'bottom' &&
    !fitsBelow &&
    (fitsAbove || anchor.top - g > viewport.height - g - bottom)
  ) {
    side = 'top';
  } else if (
    side === 'top' &&
    !fitsAbove &&
    (fitsBelow || viewport.height - g - bottom > anchor.top - g)
  ) {
    side = 'bottom';
  }
  const h = Math.min(size.height, side === 'bottom' ? roomBelow : roomAbove);
  const above = anchor.top - gap - h;
  const top = clamp(side === 'bottom' ? below : above, g, Math.max(g, viewport.height - g - h));

  // Horizontal: start on the anchor's left edge, or end on its right edge.
  const start = anchor.left;
  const end = right - w;
  const fitsStart = start + w <= viewport.width - g;
  const fitsEnd = end >= g;
  let align = prefer.align ?? 'start';
  if (align === 'start' && !fitsStart && fitsEnd) align = 'end';
  else if (align === 'end' && !fitsEnd && fitsStart) align = 'start';
  const left = clamp(align === 'start' ? start : end, g, Math.max(g, viewport.width - g - w));

  return {
    left,
    top,
    side,
    align,
    ...(size.height > h ? { maxHeight: h } : {}),
    ...(size.width > room.width ? { maxWidth: room.width } : {}),
  };
}

/** A drag offset of a dialog, px from where the layout puts it. */
export interface Offset {
  readonly x: number;
  readonly y: number;
}

/**
 * The offset that keeps a dialog inside the window: `rect` is where the dialog
 * sits with no offset. A dialog larger than the window keeps its left and top
 * edges (the title bar) inside.
 */
export function clampOffset(offset: Offset, rect: Rect, viewport: Viewport, margin = 8): Offset {
  const minX = margin - rect.left;
  const maxX = viewport.width - margin - (rect.left + rect.width);
  const minY = margin - rect.top;
  const maxY = viewport.height - margin - (rect.top + rect.height);
  return {
    x: maxX < minX ? minX : clamp(offset.x, minX, maxX),
    y: maxY < minY ? minY : clamp(offset.y, minY, maxY),
  };
}

/* ------------------------------------------------------------------------------------------ */
/* The Escape stack                                                                           */
/* ------------------------------------------------------------------------------------------ */

/**
 * What a layer of the Escape stack is: an overlay (menu, popover, sheet,
 * dialog), a mode (an armed part, datapoint input), an open tool panel, or
 * the tour. Escape closes the top overlay, the most recent first; with no
 * overlay open it cancels the mode, then closes the tool, then the tour.
 */
export type LayerLevel = 'overlay' | 'mode' | 'panel' | 'tour';

const RANK: Readonly<Record<LayerLevel, number>> = { overlay: 3, mode: 2, panel: 1, tour: 0 };

interface Layer {
  readonly id: string;
  readonly level: LayerLevel;
  readonly seq: number;
  readonly escape: () => void;
  readonly container: () => Element | null;
}

let layers: Layer[] = [];
let nextSeq = 1;

function topOf(list: readonly Layer[]): Layer | undefined {
  let best: Layer | undefined;
  for (const l of list) {
    if (!best || RANK[l.level] > RANK[best.level] || (l.level === best.level && l.seq > best.seq)) {
      best = l;
    }
  }
  return best;
}

function onKeyDown(e: KeyboardEvent): void {
  if (e.key !== 'Escape' || e.isComposing) return;
  const top = topOf(layers);
  if (!top) return;
  // A field with typed text inside the top layer (or anywhere, under a mode or the tour)
  // reverts on the first Escape; the layer closes on the next one.
  if (isFieldEscape(e)) {
    const c = top.container();
    if (!c || (e.target instanceof Node && c.contains(e.target))) return;
  }
  e.stopPropagation();
  e.preventDefault();
  top.escape();
}

/** Put a layer on the stack under `id`; returns the function that takes it off again. */
export function pushLayer(
  id: string,
  level: LayerLevel,
  escape: () => void,
  container: () => Element | null = () => null,
): () => void {
  const layer: Layer = { id, level, seq: nextSeq++, escape, container };
  if (layers.length === 0 && typeof window !== 'undefined') {
    window.addEventListener('keydown', onKeyDown, true);
  }
  layers = [...layers, layer];
  return () => {
    const before = layers.length;
    layers = layers.filter((l) => l !== layer);
    if (layers.length === before) return;
    if (layers.length === 0 && typeof window !== 'undefined') {
      window.removeEventListener('keydown', onKeyDown, true);
    }
  };
}

/** True when the layer is the top one of the whole stack. */
export function isTopLayer(id: string): boolean {
  return topOf(layers)?.id === id;
}

/** The level of the top layer, or null when the stack is empty. */
export function topLevel(): LayerLevel | null {
  return topOf(layers)?.level ?? null;
}

/** How many layers are on the stack. */
export function layerCount(): number {
  return layers.length;
}

/**
 * Keep a layer on the Escape stack while `active`. The handler may change on
 * every render without moving the layer: its place in the stack is fixed
 * when it becomes active. Returns the layer id.
 */
export function useEscapeLayer(
  level: LayerLevel,
  active: boolean,
  onEscape: () => void,
  container?: RefObject<Element | null>,
): string {
  const id = useId();
  const handler = useRef(onEscape);
  const box = useRef(container);
  useLayoutEffect(() => {
    handler.current = onEscape;
    box.current = container;
  });
  useLayoutEffect(() => {
    if (!active) return;
    return pushLayer(
      id,
      level,
      () => handler.current(),
      () => box.current?.current ?? null,
    );
  }, [active, level, id]);
  return id;
}

/* ------------------------------------------------------------------------------------------ */
/* Focus and outside presses                                                                  */
/* ------------------------------------------------------------------------------------------ */

const FOCUSABLE =
  'a[href], button:not(:disabled), input:not(:disabled):not([type="hidden"]), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

/** The elements of `root` the Tab key reaches, in document order. */
export function focusables(root: Element): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) => !el.closest('[hidden], [inert]') && el.getAttribute('aria-hidden') !== 'true',
  );
}

/** Focus without scrolling the page or any panel to it. */
export function focusQuietly(el: HTMLElement | null | undefined): void {
  el?.focus({ preventScroll: true });
}

export interface FocusTrapOptions {
  /** The layer of the overlay: Tab is trapped only while it is the top layer. */
  readonly layer: string;
  /**
   * The element to focus on open; default the first focusable one, else the container. A
   * picker returning null leaves the focus where it is.
   */
  readonly initialFocus?: () => HTMLElement | null | undefined;
  /** Give the focus back to the opener on close; default true. */
  readonly restoreFocus?: boolean;
  /** Cycle Tab inside (default, a modal overlay); false leaves Tab alone (a popover). */
  readonly trapTab?: boolean;
  /** The opener the focus returns to; default the element focused when the overlay opened. */
  readonly returnTo?: () => HTMLElement | null | undefined;
}

/**
 * One focus trap for every dialog and sheet: on open the focus moves in (and
 * the page does not scroll to it), Tab and Shift+Tab cycle inside while the
 * overlay is on top, and on close the focus returns to the opener when it is
 * still in the document. A click outside that moved the focus to the page is
 * corrected after the browser's own focus change.
 */
export function useFocusTrap(
  container: RefObject<HTMLElement | null>,
  { layer, initialFocus, restoreFocus = true, trapTab = true, returnTo }: FocusTrapOptions,
): void {
  const layerRef = useRef(layer);
  const initial = useRef(initialFocus);
  const restore = useRef(restoreFocus);
  const trap = useRef(trapTab);
  const back = useRef(returnTo);
  useLayoutEffect(() => {
    layerRef.current = layer;
    initial.current = initialFocus;
    restore.current = restoreFocus;
    trap.current = trapTab;
    back.current = returnTo;
  });
  useEffect(() => {
    const opener =
      back.current?.() ??
      (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    // Where the opener sits, so the focus has somewhere near to go if it is gone at close.
    const ancestors: HTMLElement[] = [];
    for (let p = opener?.parentElement; p; p = p.parentElement) ancestors.push(p);
    const root = container.current;
    if (root) {
      const pick = initial.current;
      // A picker that finds nothing (a menu with every item disabled) leaves the focus alone.
      const first = pick ? pick() : focusables(root)[0];
      if (first) focusQuietly(first);
      else if (!pick) {
        if (!root.hasAttribute('tabindex')) root.setAttribute('tabindex', '-1');
        focusQuietly(root);
      }
    }
    const onTab = (e: KeyboardEvent): void => {
      const box = container.current;
      if (e.key !== 'Tab' || !trap.current || !box || !isTopLayer(layerRef.current)) return;
      const items = focusables(box);
      const firstItem = items[0];
      const lastItem = items[items.length - 1];
      if (!firstItem || !lastItem) {
        e.preventDefault();
        return;
      }
      const at = document.activeElement;
      const inside = at instanceof Node && box.contains(at);
      if (e.shiftKey && (!inside || at === firstItem || at === box)) {
        e.preventDefault();
        focusQuietly(lastItem);
      } else if (!e.shiftKey && (!inside || at === lastItem)) {
        e.preventDefault();
        focusQuietly(firstItem);
      }
    };
    window.addEventListener('keydown', onTab, true);
    return () => {
      window.removeEventListener('keydown', onTab, true);
      if (!restore.current || !opener) return;
      // Only when the focus went with the overlay: a press on another field outside keeps it there.
      const lost = (): boolean => {
        const at = document.activeElement;
        return !at || at === document.body || !at.isConnected || Boolean(root?.contains(at));
      };
      const give = (): void => {
        if (!lost()) return;
        const usable = opener.isConnected && !opener.matches(':disabled');
        if (usable) focusQuietly(opener);
        else focusQuietly(focusFallback(ancestors, root));
      };
      give();
      setTimeout(give, 0);
    };
    // Mount and unmount only: the trap follows its overlay's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

/**
 * Where the focus goes when the opener left the document (or was disabled) by
 * the time its overlay closed: the nearest focusable ancestor of where it was,
 * else the main region, else the first focusable element near where it was.
 */
function focusFallback(
  ancestors: readonly HTMLElement[],
  overlay: Element | null,
): HTMLElement | null {
  const outside = (el: Element): boolean => !overlay?.contains(el);
  const connected = ancestors.filter((a) => a.isConnected && a !== document.body);
  const own = connected.find((a) => a.matches(FOCUSABLE) && outside(a));
  if (own) return own;
  const main = document.querySelector<HTMLElement>('main');
  if (main) {
    if (!main.hasAttribute('tabindex')) main.setAttribute('tabindex', '-1');
    return main;
  }
  for (const a of [...connected, document.body]) {
    const near = focusables(a).find(outside);
    if (near) return near;
  }
  return null;
}

/**
 * Close an overlay on a pointer press outside it while it is the top layer.
 * Capture phase: the tool panels and dialogs stop pointerdown from bubbling.
 * Presses inside any of `inside` (the overlay, its opener) are ignored.
 */
export function useOutsidePress(
  active: boolean,
  layer: string,
  inside: readonly RefObject<Element | null>[],
  onOutside: () => void,
): void {
  const handler = useRef(onOutside);
  const refs = useRef(inside);
  const layerRef = useRef(layer);
  useLayoutEffect(() => {
    handler.current = onOutside;
    refs.current = inside;
    layerRef.current = layer;
  });
  useEffect(() => {
    if (!active) return;
    const onPointer = (e: PointerEvent): void => {
      if (!isTopLayer(layerRef.current)) return;
      const target = e.target;
      if (!(target instanceof Node)) return;
      if (refs.current.some((r) => r.current?.contains(target))) return;
      handler.current();
    };
    window.addEventListener('pointerdown', onPointer, true);
    return () => window.removeEventListener('pointerdown', onPointer, true);
  }, [active]);
}

/** The window size, for positioning. */
export function viewportSize(): Viewport {
  return {
    width: document.documentElement.clientWidth || window.innerWidth,
    height: window.innerHeight || document.documentElement.clientHeight,
  };
}

/* ------------------------------------------------------------------------------------------ */
/* Shared by the overlay components                                                           */
/* ------------------------------------------------------------------------------------------ */

/** What an overlay is anchored to: a button, or a point on the screen (a right-click). */
export type Anchor = RefObject<HTMLElement | null> | { readonly x: number; readonly y: number };

/** The rectangle of an anchor in viewport coordinates; a point is a rectangle of no size. */
export function anchorRect(anchor: Anchor): Rect {
  if ('current' in anchor) {
    const r = anchor.current?.getBoundingClientRect();
    return r
      ? { left: r.left, top: r.top, width: r.width, height: r.height }
      : { left: 0, top: 0, width: 0, height: 0 };
  }
  return { left: anchor.x, top: anchor.y, width: 0, height: 0 };
}

/** The opener element of an anchor, where the focus goes back to. */
export function anchorElement(anchor: Anchor): HTMLElement | null {
  return 'current' in anchor ? anchor.current : null;
}

export const MENU_ITEMS = '[role="menuitem"]:not(:disabled), [role="menuitemradio"]:not(:disabled)';

/** The text typeahead compares: the item's label, else its whole text. */
function itemText(el: HTMLElement): string {
  return (el.dataset.text ?? el.querySelector('.label')?.textContent ?? el.textContent ?? '')
    .trim()
    .toLowerCase();
}

/**
 * Keyboard of a menu list: Up and Down move and wrap, Home and End jump,
 * a letter moves to the next item starting with it. Enter and Space are the
 * buttons' own. Returns true when the key was used.
 */
export function menuKey(
  list: HTMLElement,
  e: { key: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean },
): boolean {
  const items = [...list.querySelectorAll<HTMLElement>(MENU_ITEMS)];
  if (items.length === 0) return e.key === 'ArrowDown' || e.key === 'ArrowUp';
  const at = items.indexOf(document.activeElement as HTMLElement);
  let next = -1;
  if (e.key === 'ArrowDown') next = (at + 1) % items.length;
  else if (e.key === 'ArrowUp') next = at <= 0 ? items.length - 1 : at - 1;
  else if (e.key === 'Home') next = 0;
  else if (e.key === 'End') next = items.length - 1;
  else if (e.key.length === 1 && /\S/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
    const ch = e.key.toLowerCase();
    for (let k = 1; k <= items.length; k++) {
      const i = (Math.max(at, -1) + k) % items.length;
      if (itemText(items[i] as HTMLElement).startsWith(ch)) {
        next = i;
        break;
      }
    }
    if (next < 0) return false;
  } else return false;
  focusQuietly(items[next]);
  return true;
}

/** A drag of the grabber this far down closes the sheet (or drops full to half), px. */
const CLOSE_DISTANCE = 80;
/** A flick down faster than this closes it whatever the distance, px per ms. */
const FLICK_SPEED = 0.6;
/** A flick has to travel at least this far: a tap that slips a few pixels is not one, px. */
const FLICK_MIN_DISTANCE = 16;

/** What a released drag does: close, or the detent to settle at. */
export function settleSheet(
  detent: 'half' | 'full',
  dy: number,
  ms: number,
): 'half' | 'full' | 'close' {
  const speed = ms > 0 ? dy / ms : 0;
  if (dy >= FLICK_MIN_DISTANCE && speed > FLICK_SPEED) return 'close';
  if (dy < -CLOSE_DISTANCE / 2) return 'full';
  if (dy > CLOSE_DISTANCE) return detent === 'full' && dy < 2.5 * CLOSE_DISTANCE ? 'half' : 'close';
  return detent;
}

/** Where each draggable dialog was left in this session, by its key. */
const positions = new Map<string, Offset>();

/** Forget the remembered dialog positions (tests). */
export function resetDialogPositions(): void {
  positions.clear();
}

/** The remembered offset of a draggable dialog, if it was moved in this session. */
export function dialogPosition(key: string): Offset | undefined {
  return positions.get(key);
}

/** Remember where a draggable dialog was left. */
export function rememberDialogPosition(key: string, offset: Offset): void {
  positions.set(key, offset);
}
