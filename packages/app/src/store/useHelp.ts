import { create } from 'zustand';

interface HelpState {
  /** Whether the help dialog (the user guide) is showing. */
  open: boolean;
  /** The section id the dialog scrolls to when it opens; null starts at the top. */
  section: string | null;
  openHelp: (section?: string) => void;
  closeHelp: () => void;
  toggleHelp: () => void;
}

export const useHelp = create<HelpState>()((set, get) => ({
  open: false,
  section: null,
  openHelp: (section) => set({ open: true, section: section ?? null }),
  closeHelp: () => set({ open: false, section: null }),
  toggleHelp: () => (get().open ? get().closeHelp() : get().openHelp()),
}));
