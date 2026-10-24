/**
 * Dialogs can stack: Help opens over Settings, Dimensions or the report. Two
 * things then matter: a key press belongs to the dialog on top only, and an
 * action taken in the top dialog (a Try link in Help that loads an example)
 * has to clear the dialogs under it, which belong to other components.
 */
import { useEffect } from 'react';

export const CLOSE_DIALOGS_EVENT = 'smithonline:close-dialogs';

/** True when `el` is the last dialog in the document, the one on top of the stack. */
export function isTopDialog(el: Element | null): boolean {
  if (!el || typeof document === 'undefined') return false;
  const dialogs = document.querySelectorAll('[role="dialog"]');
  return dialogs.length > 0 && dialogs[dialogs.length - 1] === el;
}

/** Ask every dialog that listens to close. The caller closes itself afterwards. */
export function closeOtherDialogs(): void {
  window.dispatchEvent(new Event(CLOSE_DIALOGS_EVENT));
}

/** Close this dialog when another one asks for the stage. */
export function useCloseOnRequest(onClose: () => void): void {
  useEffect(() => {
    window.addEventListener(CLOSE_DIALOGS_EVENT, onClose);
    return () => window.removeEventListener(CLOSE_DIALOGS_EVENT, onClose);
  }, [onClose]);
}
