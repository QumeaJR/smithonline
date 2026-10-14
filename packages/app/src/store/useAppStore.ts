import { create } from 'zustand';

interface AppState {
  /** Reference impedance in ohm. */
  z0: number;
  setZ0: (z0: number) => void;
}

export const useAppStore = create<AppState>()((set) => ({
  z0: 50,
  setZ0: (z0) => set({ z0 }),
}));
