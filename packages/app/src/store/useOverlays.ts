import { create } from 'zustand';
import {
  MAX_OVERLAYS,
  OVERLAY_COLORS,
  OVERLAY_KEY,
  parseOverlays,
  snapshot,
  type Overlay,
} from '../lib/overlays';
import { newId } from '../lib/design';
import type { Response } from '@smithonline/core';

interface OverlayState {
  overlays: Overlay[];
  /** Set when the browser refused to keep the overlays (private mode, quota). */
  unsaved: boolean;
  /** Store the curves under a name; refused (false) once MAX_OVERLAYS are kept. */
  store: (name: string, color: string, response: Response) => boolean;
  remove: (id: string) => void;
  rename: (id: string, name: string) => void;
  clear: () => void;
}

function load(): Overlay[] {
  try {
    return parseOverlays(localStorage.getItem(OVERLAY_KEY));
  } catch {
    return [];
  }
}

function save(overlays: readonly Overlay[]): boolean {
  try {
    localStorage.setItem(OVERLAY_KEY, JSON.stringify(overlays));
    return true;
  } catch {
    return false;
  }
}

/** The next colour not in use, so removing one and storing again does not repeat a colour. */
export function nextOverlayColor(overlays: readonly Overlay[]): string {
  const used = new Set(overlays.map((o) => o.color));
  return (
    OVERLAY_COLORS.find((c) => !used.has(c)) ?? OVERLAY_COLORS[overlays.length % 10] ?? '#e03131'
  );
}

export const useOverlays = create<OverlayState>()((set, get) => {
  const keep = (overlays: Overlay[]): void => set({ overlays, unsaved: !save(overlays) });
  return {
    overlays: load(),
    unsaved: false,
    store: (name, color, response) => {
      const { overlays } = get();
      if (overlays.length >= MAX_OVERLAYS) return false;
      keep([...overlays, snapshot(newId(), name, color, response)]);
      return true;
    },
    remove: (id) => keep(get().overlays.filter((o) => o.id !== id)),
    rename: (id, name) => keep(get().overlays.map((o) => (o.id === id ? { ...o, name } : o))),
    clear: () => keep([]),
  };
});
