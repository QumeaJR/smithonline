/** The colour theme: auto follows the system (the default), or dark or light. */
export type Theme = 'light' | 'dark' | 'auto';

/** The next theme of the toggle: auto, dark, light. */
export const nextTheme = (theme: Theme): Theme =>
  theme === 'auto' ? 'dark' : theme === 'dark' ? 'light' : 'auto';

/** The theme in words, for the toggle's name: "follows the system", "dark", "light". */
export const themeName = (theme: Theme): string =>
  theme === 'auto' ? 'follows the system' : theme;
