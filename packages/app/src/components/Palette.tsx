import { PALETTE, type PaletteEntry } from '../lib/elements';

interface PaletteProps {
  /** The entry armed for placement on the chart, if any. */
  readonly armed: PaletteEntry | null;
  readonly onPick: (entry: PaletteEntry) => void;
}

export function Palette({ armed, onPick }: PaletteProps) {
  return (
    <div className="palette" role="toolbar" aria-label="Add element">
      {PALETTE.map((p) => (
        <button
          key={p.id}
          className={armed?.id === p.id ? 'on' : ''}
          aria-pressed={armed?.id === p.id}
          onClick={() => onPick(p)}
          title={
            armed?.id === p.id
              ? `Click again to add the ${p.label} at its default value, or click the chart to place it`
              : `${p.label}: click, then click on the chart where it should lead`
          }
        >
          <svg viewBox="0 0 30 20" aria-hidden="true">
            <path d={p.icon} />
          </svg>
          {p.label}
        </button>
      ))}
    </div>
  );
}
