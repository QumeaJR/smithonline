import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { layoutForWidth } from '../../lib/layout';
import { useCoarsePointer } from '../../lib/pointer';
import { messageIsError } from '../../lib/shellText';
import { UNDO_MESSAGE_MS, useDesignStore, type MessageExtras } from '../../store/useDesignStore';
import { Button, IconButton } from './Button';
import { IconClose } from './icons';

/** How long a toast shows a plain message on a coarse pointer, ms. */
export const TOAST_MS = 4000;

/** Whether the toast is on show, so the status bar does not repeat its message and buttons. */
const useToastShown = create<{ readonly shown: boolean }>(() => ({ shown: false }));

/**
 * The buttons of the message on show: Undo for UNDO_MESSAGE_MS after a
 * removal, New, an example load or an applied optimizer or snap, and the
 * message's action (such as Scale sweep) while the message stays.
 */
function useMessageButtons(): {
  text: string | null;
  extras: MessageExtras | null;
  undo: boolean;
  action: boolean;
} {
  const text = useDesignStore((s) => s.message);
  const stored = useDesignStore((s) => s.messageExtras);
  const extras = stored && stored.text === text ? stored : null;
  const [expired, setExpired] = useState(0);
  const timed = Boolean(extras?.undo || extras?.action?.timed);
  const serial = timed && extras ? extras.serial : 0;
  useEffect(() => {
    if (!serial) return;
    const timer = setTimeout(() => setExpired(serial), UNDO_MESSAGE_MS);
    return () => clearTimeout(timer);
  }, [serial]);
  const live = expired !== serial;
  return {
    text,
    extras,
    undo: Boolean(extras?.undo) && live,
    action: Boolean(extras?.action) && (!extras?.action?.timed || live),
  };
}

function MessageButtons({
  extras,
  undo,
  action: showAction,
}: {
  extras: MessageExtras | null;
  undo: boolean;
  action: boolean;
}) {
  const action = showAction ? extras?.action : null;
  if (!extras || (!undo && !action)) return null;
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
 * bar cuts it short. On a coarse pointer the toast carries the message and
 * its 44 px buttons: the bar shows the fallback while the toast is up, and
 * never the buttons.
 */
export function StatusMessage({ fallback }: { readonly fallback: string }) {
  const { text, extras, undo, action } = useMessageButtons();
  const coarse = useCoarsePointer();
  const toast = useToastShown((s) => s.shown);
  if (coarse) {
    const shown = toast ? null : text;
    return (
      <span className="muted status-message" title={shown ?? undefined} role="status">
        {shown ?? fallback}
      </span>
    );
  }
  return (
    <>
      <span className="muted status-message" title={text ?? undefined} role="status">
        {text ?? fallback}
      </span>
      <MessageButtons extras={extras} undo={undo} action={action} />
    </>
  );
}

/** The phone's chart view, where the chart's error banner carries an error (ChartChips). */
function errorBannerShown(view: string): boolean {
  return (
    view === 'chart' &&
    typeof window !== 'undefined' &&
    layoutForWidth(window.innerWidth) === 'phone'
  );
}

/**
 * The message as a toast over the bottom of the window on a coarse pointer,
 * where the 28 px status bar has no room for 44 px buttons: at most two lines,
 * for TOAST_MS, or UNDO_MESSAGE_MS when it carries Undo or an action.
 */
export function Toast() {
  const { text, extras, undo, action } = useMessageButtons();
  // The message on show, by a count of the messages seen: every new message shows, the same
  // text a second time too (an export repeated after the first toast went).
  const [shown, setShown] = useState<number | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let seen = 0;
    const off = useDesignStore.subscribe((s, prev) => {
      if (
        s.messageSerial === prev.messageSerial &&
        s.message === prev.message &&
        s.messageExtras === prev.messageExtras
      ) {
        return;
      }
      if (timer !== null) clearTimeout(timer);
      // An error is the phone's banner over the chart until dismissed; it is not repeated here.
      if (!s.message || (errorBannerShown(s.view) && messageIsError(s))) {
        setShown(null);
        return;
      }
      seen += 1;
      setShown(seen);
      const long = s.messageExtras?.text === s.message;
      timer = setTimeout(() => setShown(null), long ? UNDO_MESSAGE_MS : TOAST_MS);
    });
    return () => {
      off();
      if (timer !== null) clearTimeout(timer);
    };
  }, []);
  const up = shown !== null && Boolean(text);
  useEffect(() => {
    useToastShown.setState({ shown: up });
  }, [up]);
  useEffect(() => () => useToastShown.setState({ shown: false }), []);
  if (!up) return null;
  return (
    <div key={shown} className="toast" role="status">
      <span className="toast-text">{text}</span>
      <MessageButtons extras={extras} undo={undo} action={action} />
      <IconButton
        size="sm"
        label="Dismiss the message"
        icon={<IconClose size={14} />}
        onClick={() => setShown(null)}
      />
    </div>
  );
}
