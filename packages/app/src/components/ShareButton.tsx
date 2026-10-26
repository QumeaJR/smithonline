import { useEffect, useRef, useState } from 'react';
import { TIPS } from '../lib/tips';
import { Button } from './ui/Button';
import { IconCheck } from './ui/icons';

/** How long the Share button shows "Copied" once the link is on the clipboard, ms. */
export const COPIED_MS = 1500;

export interface ShareButtonProps {
  /** Copies a link that holds the design; true once it is on the clipboard. */
  readonly onShare: () => Promise<boolean>;
}

/**
 * The header's Share button (docs/07 section 7, phase 6): a check and
 * "Copied" for 1.5 s once the link is on the clipboard. Where the clipboard
 * refuses, the status line says the link is in the address bar instead.
 */
export function ShareButton({ onShare }: ShareButtonProps) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );
  const share = async (): Promise<void> => {
    const ok = await onShare();
    if (!ok) return;
    if (timer.current !== null) clearTimeout(timer.current);
    setCopied(true);
    timer.current = setTimeout(() => {
      timer.current = null;
      setCopied(false);
    }, COPIED_MS);
  };
  return (
    <Button
      onClick={() => void share()}
      title={TIPS.share}
      aria-label="Share link"
      className={copied ? 'copied share-button' : 'share-button'}
    >
      {/* The button keeps the width of "Copied" in both states (index.css), so the header
          does not shift when the label changes. */}
      <span className="share-label">
        {copied ? (
          <>
            <IconCheck size={14} />
            Copied
          </>
        ) : (
          'Share'
        )}
      </span>
    </Button>
  );
}
