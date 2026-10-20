import { PALETTE } from '../lib/elements';
import { useDesignStore } from '../store/useDesignStore';

export function Palette() {
  const z0 = useDesignStore((s) => s.design.z0);
  const frequency = useDesignStore((s) => s.design.frequency);
  const addElement = useDesignStore((s) => s.addElement);
  return (
    <div className="palette" role="toolbar" aria-label="Add element">
      {PALETTE.map((p) => (
        <button
          key={p.id}
          onClick={() => addElement(p.make(z0, frequency))}
          title={`Add ${p.label.toLowerCase()} at the source end`}
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
