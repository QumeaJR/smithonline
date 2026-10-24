import { useRef, useState } from 'react';
import { DesignFields } from '../components/DesignFields';
import { Sheet } from '../components/ui/Sheet';
import { designChipText } from '../lib/shellText';
import { useDesignStore } from '../store/useDesignStore';

/**
 * The design chip at the top left of the phone's chart: f, Z0 and the power
 * at a glance; a tap opens a sheet with the design name, f, power and Z0.
 */
export function DesignChip() {
  const design = useDesignStore((s) => s.design);
  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  const text = designChipText(design);
  return (
    <>
      <button
        ref={opener}
        type="button"
        className="chart-chip design-chip mono"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Design: ${text}. Edit name, frequency, power and Z0`}
        onClick={() => setOpen(!open)}
      >
        {text}
      </button>
      {open && (
        <Sheet
          title="Design"
          onClose={() => setOpen(false)}
          className="design-sheet"
          closeLabel="Close Design"
          inside={[opener]}
          returnTo={() => opener.current}
          // A focused field would raise the keyboard over the sheet before the user asks for it.
          initialFocus={() => null}
        >
          <div className="design-fields">
            <DesignFields />
          </div>
        </Sheet>
      )}
    </>
  );
}
