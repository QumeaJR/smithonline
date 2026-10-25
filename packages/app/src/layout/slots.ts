import type { ReactNode, RefCallback } from 'react';

/**
 * A DOM node that holds one slot of the shell (the network panel, the
 * numbers, the open tool, the tour) for the life of the shell. The shell
 * renders the slot's React tree into it once, with a portal at a fixed place
 * in its own tree, and the layout only moves the node between containers (the
 * left column, the side column, the phone's sheet). Crossing a breakpoint
 * thus never unmounts a panel: a running job, typed values and scroll state
 * stay (docs/07-interaction-redesign.md section 5).
 */
export class SlotHost {
  readonly el: HTMLDivElement;
  /** A stable ref callback: the element it is put on adopts the node as its last child. */
  readonly adopt: RefCallback<HTMLElement>;

  constructor(name: string) {
    this.el = document.createElement('div');
    this.el.className = `slot-host slot-${name}`;
    this.adopt = adopter([this]);
  }
}

/** A ref callback that adopts the hosts in this order and gives them up on unmount. */
export function adopter(hosts: readonly SlotHost[]): RefCallback<HTMLElement> {
  return (parent) => {
    if (!parent) return;
    for (const h of hosts) parent.appendChild(h.el);
    return () => {
      for (const h of hosts) if (h.el.parentNode === parent) parent.removeChild(h.el);
    };
  };
}

/** A slot as a column takes it: React content of its own, or the shell's host. */
export type Slot = ReactNode | SlotHost;

export function isHost(slot: Slot): slot is SlotHost {
  return slot instanceof SlotHost;
}

/** Props for a container of a slot: the host is adopted by ref, other content renders inside. */
export function slotProps(slot: Slot): {
  ref?: RefCallback<HTMLElement>;
  children?: ReactNode;
} {
  return isHost(slot) ? { ref: slot.adopt } : { children: slot };
}

/** Whether a slot has something to show (a host always does; its content may be empty). */
export function slotFilled(slot: Slot): boolean {
  return slot !== null && slot !== undefined && slot !== false;
}
