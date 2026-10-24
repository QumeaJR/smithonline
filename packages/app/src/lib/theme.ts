/** The colour theme: auto follows the system (the default), or dark or light. */
export type Theme = 'light' | 'dark' | 'auto';

/** The next theme of the toggle: auto, dark, light. */
export const nextTheme = (theme: Theme): Theme =>
  theme === 'auto' ? 'dark' : theme === 'dark' ? 'light' : 'auto';
