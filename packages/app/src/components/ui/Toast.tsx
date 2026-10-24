import { useEffect, useState } from 'react';
import { UNDO_MESSAGE_MS, useDesignStore, type MessageExtras } from '../../store/useDesignStore';
import { Button, IconButton } from './Button';
import { IconClose } from './icons';

/** How long a toast shows a plain message on a coarse pointer, ms. */
export const TOAST_MS = 4000;

/**
 * The buttons of the message on show: Undo for UNDO_MESSAGE_MS after a
 * removal, New, an example load or an applied optimizer or snap, and the
 * message's action (such as Scale sweep) while the message stays.
 */
function useMessageButtons(): { text: string | null; extras: MessageExtras | null; undo: boolean } {
  const text = useDesignStore((s) => s.message);
  const stored = useDesignStore((s) => s.messageExtras);
  const extras = stored && stored.text === text ? stored : null;
  const [expired, setExpired] = useState(0);
  const serial = extras?.undo ? extras.serial : 0;
  useEffect(() => {
    if (!serial) return;
    const timer = setTimeout(() => setExpired(serial), UNDO_MESSAGE_MS);
    return () => clearTimeout(timer);
  }, [serial]);
  return { text, extras, undo: Boolean(extras?.undo) && expired !== serial };
}

function MessageButtons({ extras, undo }: { extras: MessageExtras | null; undo: boolean }) {
  if (!extras || (!undo && !extras.action)) return null;
  const action = extras.action;
  return (
    <span className="message-actions">
      {undo && (
        <Button
          size="sm"
          variant="quiet"
          className="message-undo"
          onClick={() => useDesignStore.getState().undo()}
          title="Undo this step (Ctrl+Z)"
        >
          Undo
        </Button>
      )}
      {action && (
        <Button size="sm" className="message-action" onClick={() => action.run()}>
          {action.label}
        </Button>
      )}
    </span>
  );
}

/**
 * The message in the status bar with its buttons; the fallback text shows
 * while there is no message. The tooltip holds the whole message when the
 * bar cuts it short.
 */
export function StatusMessage({ fallback }: { readonly fallback: string }) {
  const { text, extras, undo } = useMessageButtons();
  return (
    <>
      <span className="muted status-message" title={text ?? undefined} role="status">
        {text ?? fallback}
      </span>
      <MessageButtons extras={extras} undo={undo} />
    </>
  );
}

/**
 * The message as a toast over the bottom of the window on a coarse pointer,
 * where the 28 px status bar has no room for 44 px buttons: at most two lines,
 * for TOAST_MS, or UNDO_MESSAGE_MS when it carries Undo or an action.
 */
export function Toast() {
  const { text, extras, undo } = useMessageButtons();
  const [shown, setShown] = useState<string | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const off = useDesignStore.subscribe((s, prev) => {
      if (s.message === prev.message && s.messageExtras === prev.messageExtras) return;
      if (timer !== null) clearTimeout(timer);
      if (!s.message) {
        setShown(null);
        return;
      }
      const message = s.message;
      setShown(message);
      const long = s.messageExtras?.text === message;
      timer = setTimeout(() => setShown(null), long ? UNDO_MESSAGE_MS : TOAST_MS);
    });
    return () => {
      off();
      if (timer !== null) clearTimeout(timer);
    };
  }, []);
  if (!shown || shown !== text) return null;
  return (
    <div className="toast" role="status">
      <span className="toast-text">{text}</span>
      <MessageButtons extras={extras} undo={undo} />
      <IconButton
        size="sm"
        label="Dismiss the message"
        icon={<IconClose size={14} />}
        onClick={() => setShown(null)}
      />
    </div>
  );
}
