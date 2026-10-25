/**
 * The arithmetic of a ladder card drag (docs/07 section 4, Ladder card), pure
 * and tested in node: the slot the dragged card lands in, how far the other
 * cards move aside to open it or to close the gap when the card is out of the
 * list, and whether the pointer is out of the list.
 */

/** A card's place in the list when the drag began, client px. */
export interface CardBox {
  readonly top: number;
  readonly height: number;
}

export interface ListRect {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/**
 * The index the card dragged from `from` lands at for a pointer at `y`: the
 * number of other cards whose middle lies above the pointer.
 */
export function dropIndex(cards: readonly CardBox[], from: number, y: number): number {
  let to = 0;
  cards.forEach((c, i) => {
    if (i !== from && y > c.top + c.height / 2) to += 1;
  });
  return to;
}

/**
 * How far card `i` moves while the card from `from` is dragged to `to`, px:
 * the cards between move by `step` (the dragged card's height and the gap)
 * to open its slot. Out of the list (`to` null) the cards after it move up
 * and close its gap.
 */
export function cardShift(i: number, from: number, to: number | null, step: number): number {
  if (i === from) return 0;
  if (to === null) return i > from ? -step : 0;
  if (from < to && i > from && i <= to) return -step;
  if (from > to && i >= to && i < from) return step;
  return 0;
}

/** The pointer is out of the list (with `margin` px of slack around it). */
export function outsideList(list: ListRect, x: number, y: number, margin = 0): boolean {
  return (
    x < list.left - margin ||
    x > list.right + margin ||
    y < list.top - margin ||
    y > list.bottom + margin
  );
}

/** A mouse drag begins after this movement, px. */
export const MOUSE_DRAG_SLOP = 4;
