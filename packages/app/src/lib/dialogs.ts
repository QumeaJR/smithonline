/**
 * Dialogs can stack: Help opens over Settings, Dimensions or the report. A
 * key press belongs to the dialog on top only, which the overlay stack in
 * overlay.ts handles (Escape, the focus trap). An action taken in the top
 * dialog (a Try link in Help that loads an example) also has to clear the
 * dialogs under it, which belong to other components: that is this event.
 */
import { useEffect } from 'react';

export const CLOSE_DIALOGS_EVENT = 'smithonline:close-dialogs';

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
