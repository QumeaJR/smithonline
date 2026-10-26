/**
 * Store the current curves as a named overlay and list the stored ones with a
 * legend swatch and a remove button each.
 */
import type { Response } from '@smithonline/core';
import { useState } from 'react';
import { MAX_OVERLAYS } from '../lib/overlays';
import { nextOverlayColor, useOverlays } from '../store/useOverlays';
import { useDesignStore } from '../store/useDesignStore';
import { IconClose } from '../components/ui/icons';

interface OverlayBarProps {
  /** The live response; null when the sweep range is unusable. */
  readonly response: Response | null;
}

export function OverlayBar({ response }: OverlayBarProps) {
  const overlays = useOverlays((s) => s.overlays);
  const unsaved = useOverlays((s) => s.unsaved);
  const { store, remove, clear } = useOverlays.getState();
  const designName = useDesignStore((s) => s.design.name);
  const [name, setName] = useState('');
  const [color, setColor] = useState<string | null>(null);

  const next = nextOverlayColor(overlays);
  const full = overlays.length >= MAX_OVERLAYS;
  const put = (): void => {
    if (!response || full) return;
    const label = name.trim() || `${designName || 'Design'} ${overlays.length + 1}`;
    if (store(label, color ?? next, response)) {
      setName('');
      setColor(null);
      useDesignStore.getState().setMessage(`Stored the curves as "${label}"`);
    }
  };

  return (
    <div className="overlay-bar">
      <input
        type="text"
        className="overlay-name"
        value={name}
        placeholder="Name of the stored curves"
        aria-label="Name of the stored curves"
        maxLength={40}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') put();
        }}
      />
      <input
        type="color"
        value={color ?? next}
        aria-label="Colour of the stored curves"
        onChange={(e) => setColor(e.target.value)}
      />
      <button
        className="btn"
        onClick={put}
        disabled={!response || full}
        title={
          full
            ? `All ${MAX_OVERLAYS} slots are used; remove one first`
            : 'Keep a dashed copy to compare against'
        }
      >
        Store curves
      </button>
      <span className="muted small">
        {overlays.length} of {MAX_OVERLAYS}
        {unsaved ? ', not kept after closing (browser storage is blocked or full)' : ''}
      </span>
      <ul className="overlay-legend">
        {overlays.map((o) => (
          <li key={o.id}>
            <span className="sw" style={{ background: o.color }} />
            {o.name}
            <button
              type="button"
              className="btn icon sm"
              onClick={() => remove(o.id)}
              aria-label={`Remove stored curves ${o.name}`}
              title="Remove"
            >
              <IconClose size={13} />
            </button>
          </li>
        ))}
        {overlays.length > 1 && (
          <li>
            <button className="btn sm" onClick={clear}>
              Remove all
            </button>
          </li>
        )}
      </ul>
    </div>
  );
}
