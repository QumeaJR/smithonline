import { create } from 'zustand';
import { IconButton } from '../components/ui/Button';
import { IconClose } from '../components/ui/icons';
import { messageIsError } from '../lib/shellText';
import { useDesignStore } from '../store/useDesignStore';

/** The message serial whose error was dismissed: it stays dismissed across the views. */
const useDismissed = create<{ serial: number }>(() => ({ serial: -1 }));

/**
 * The phone's error banner (docs/07 section 4, Status): an error or refusal stays until it is
 * dismissed, over the top of the chart (`chart`) or under the top bar of the Response and
 * S-Plot pages (`page`), where a toast would pass in 4 s. No toast repeats it.
 */
export function ErrorBanner({ place }: { readonly place: 'chart' | 'page' }) {
  const message = useDesignStore((s) => s.message);
  const serial = useDesignStore((s) => s.messageSerial);
  const isError = useDesignStore(messageIsError);
  const dismissed = useDismissed((s) => s.serial);
  if (!isError || !message || dismissed === serial) return null;
  return (
    <div className={place === 'chart' ? 'chart-error' : 'chart-error page-error'} role="alert">
      <span>{message}</span>
      <IconButton
        size="sm"
        icon={<IconClose size={14} />}
        label="Dismiss the error"
        onClick={() => useDismissed.setState({ serial })}
      />
    </div>
  );
}
