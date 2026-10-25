import { useState } from 'react';
import { PALETTE, type PaletteEntry } from '../lib/elements';
import { useCoarsePointer } from '../lib/pointer';
import { pointerHints } from '../lib/tips';
import { IconChevronDown } from './ui/icons';

interface PaletteProps {
  /** The entry armed for placement on the chart, if any. */
  readonly armed: PaletteEntry | null;
  readonly onPick: (entry: PaletteEntry) => void;
  /**
   * The phone's form: a disclosure "Add part" with two rows of six tiles,
   * open when the ladder is empty and collapsed to the first row otherwise.
   */
  readonly disclosure?: boolean;
  /** The ladder is empty: the disclosure starts open. */
  readonly empty?: boolean;
}

/** Tiles in one row of the phone's palette. */
const ROW = 6;

export function Palette({ armed, onPick, disclosure = false, empty = false }: PaletteProps) {
  const hints = pointerHints(useCoarsePointer());
  const [open, setOpen] = useState<boolean | null>(null);
  const expanded = open ?? empty;
  const entries = disclosure && !expanded ? PALETTE.slice(0, ROW) : PALETTE;
  const tiles = (
    <div
      className={`palette${disclosure ? ' palette-phone' : ''}`}
      role="toolbar"
      aria-label="Add element"
    >
      {entries.map((p) => (
        <button
          key={p.id}
          className={armed?.id === p.id ? 'on' : ''}
          aria-pressed={armed?.id === p.id}
          onClick={() => onPick(p)}
          title={armed?.id === p.id ? hints.paletteArmed(p.label) : hints.paletteTile(p.label)}
        >
          <svg viewBox="0 0 30 20" aria-hidden="true">
            <path d={p.icon} />
          </svg>
          {p.label}
        </button>
      ))}
    </div>
  );
  if (!disclosure) return tiles;
  return (
    <div className="palette-disclosure">
      <button
        type="button"
        className="disclosure-head"
        aria-expanded={expanded}
        onClick={() => setOpen(!expanded)}
      >
        <span>Add part</span>
        <span className="muted small">
          {expanded ? `all ${PALETTE.length}` : `${ROW} of ${PALETTE.length}`}
        </span>
        <IconChevronDown size={16} className={expanded ? 'flip' : ''} />
      </button>
      {tiles}
    </div>
  );
}
