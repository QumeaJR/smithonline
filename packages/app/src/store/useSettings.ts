import { create } from 'zustand';
import {
  DEFAULT_SETTINGS,
  applySettings,
  loadSettings,
  storeSettings,
  type ColorKey,
  type Settings,
} from '../lib/settings';

interface SettingsState {
  settings: Settings;
  /** Change settings; applied to the page and stored at once. */
  update: (patch: Partial<Settings>) => void;
  /** One colour; null returns it to the theme's own. */
  setColor: (key: ColorKey, value: string | null) => void;
  setPaletteColor: (index: number, value: string) => void;
  reset: () => void;
}

export const useSettings = create<SettingsState>()((set, get) => {
  const commit = (settings: Settings): void => {
    applySettings(settings);
    storeSettings(settings);
    set({ settings });
  };
  return {
    settings: DEFAULT_SETTINGS,
    update: (patch) => commit({ ...get().settings, ...patch }),
    setColor: (key, value) =>
      commit({ ...get().settings, colors: { ...get().settings.colors, [key]: value } }),
    setPaletteColor: (index, value) =>
      commit({
        ...get().settings,
        palette: get().settings.palette.map((c, i) => (i === index ? value : c)),
      }),
    reset: () => commit(DEFAULT_SETTINGS),
  };
});

/** Read the stored settings and apply them; called once at startup, before the first render. */
export function initSettings(): void {
  const settings = loadSettings();
  applySettings(settings);
  useSettings.setState({ settings });
}
