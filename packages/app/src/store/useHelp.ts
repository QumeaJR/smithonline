import { track } from '../lib/analytics/track';
import { create } from 'zustand';
import { useShell } from './useShell';

/** Where Help returns to when it closes: Settings, when "What is sent" opened it there. */
export type HelpReturn = 'settings' | null;

interface HelpState {
  /** Whether the help dialog (the user guide) is showing. */
  open: boolean;
  /** The section id the dialog scrolls to when it opens; null starts at the top. */
  section: string | null;
  /** The dialog Help came from and goes back to on close (Escape, X or Close). */
  returnTo: HelpReturn;
  openHelp: (section?: string, returnTo?: HelpReturn) => void;
  /** Close Help; it returns to the dialog it came from unless `back` is false. */
  closeHelp: (back?: boolean) => void;
  toggleHelp: () => void;
}

export const useHelp = create<HelpState>()((set, get) => ({
  open: false,
  section: null,
  returnTo: null,
  openHelp: (section, returnTo = null) => {
    if (!get().open) track('help', 'open');
    set({ open: true, section: section ?? null, returnTo });
  },
  closeHelp: (back = true) => {
    const { returnTo } = get();
    set({ open: false, section: null, returnTo: null });
    if (back && returnTo === 'settings') useShell.getState().openSettings('behaviour');
  },
  toggleHelp: () => (get().open ? get().closeHelp() : get().openHelp()),
}));
