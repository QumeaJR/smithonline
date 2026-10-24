/** What the shortcut reads of an element; a DOM element fits. */
export interface KeyTarget {
  readonly tagName?: string;
  readonly type?: string;
  readonly isContentEditable?: boolean;
}

/** The slice of a keyboard event the help shortcut looks at; a DOM KeyboardEvent fits. */
export interface HelpKeyEvent {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly altKey: boolean;
  /** True for the repeats of a held key; a held F1 must not flicker the dialog. */
  readonly repeat?: boolean;
  readonly target: EventTarget | KeyTarget | null;
}

/** True while the focus is in a field where typing text is the point: text inputs, text areas, editable content. */
export function isTextEditing(target: EventTarget | KeyTarget | null): boolean {
  if (!target) return false;
  const t = target as KeyTarget;
  if (t.tagName === 'TEXTAREA' || t.isContentEditable) return true;
  return (
    t.tagName === 'INPUT' &&
    !/^(checkbox|radio|range|button|submit|file|color)$/i.test(t.type ?? '')
  );
}

/**
 * F1 opens the help from anywhere; "?" does it only when nothing is being typed
 * into, so a question mark in a name or a value field stays a question mark.
 */
export function isHelpKey(e: HelpKeyEvent): boolean {
  if (e.repeat) return false;
  if (e.key === 'F1') return !e.ctrlKey && !e.metaKey && !e.altKey;
  if (e.key !== '?' || e.ctrlKey || e.metaKey || e.altKey) return false;
  return !isTextEditing(e.target) && (e.target as KeyTarget | null)?.tagName !== 'SELECT';
}
