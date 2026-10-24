import { formatEngineering, parseFieldValue, wattToDbm } from '@smithonline/core';
import { useEffect, useRef, useState } from 'react';
import { clearRefusal, parseRefusal, sayRefusal } from '../lib/refusal';
import { powerToWatt, stressSettings } from '../lib/stress';
import { useDesignStore } from '../store/useDesignStore';

/**
 * Source power for the stress columns, next to the design frequency. Typed in
 * watts or dBm; an empty field switches the stress off, and so does 0 in watts
 * (0 dBm is 1 mW). The design keeps watts. One box like a Field: the number and
 * its unit select read as one value, `P [1 W]`. Enter commits in place, Escape
 * reverts and keeps the focus, only typed text commits; a refused entry is
 * reported as a ValueInput reports it.
 */
export function PowerInput() {
  const stress = useDesignStore((s) => stressSettings(s.design));
  const setStress = useDesignStore((s) => s.setStress);
  const [draft, setDraft] = useState<string | null>(null);
  // The typed text read synchronously: Escape clears it before the blur that follows runs.
  const typed = useRef<string | null>(null);
  const [flash, setFlash] = useState(0);
  const invalid = flash > 0;

  useEffect(() => {
    if (flash === 0) return;
    const t = setTimeout(() => setFlash(0), 800);
    return () => clearTimeout(t);
  }, [flash]);

  const shown =
    stress.power > 0
      ? stress.unit === 'dBm'
        ? String(Number(wattToDbm(stress.power).toPrecision(5)))
        : formatEngineering(stress.power, { digits: 4 })
      : '';

  const edit = (text: string | null): void => {
    typed.current = text;
    setDraft(text);
  };

  const refuse = (text: string, reason: string, keep: boolean): void => {
    setFlash((n) => n + 1);
    sayRefusal('P', text, reason);
    // Enter keeps the refused text in the field to be corrected; leaving the field drops it.
    if (!keep) edit(null);
  };

  /** Commit the typed text; `keep` leaves a refused text in the field (Enter). */
  const commit = (keep: boolean): void => {
    if (typed.current === null) return;
    const text = typed.current.trim();
    // Typed back to what the field shows: nothing changed.
    if (text !== '' && text === shown) {
      edit(null);
      return;
    }
    if (text === '') {
      edit(null);
      clearRefusal();
      if (stress.power !== 0) setStress({ power: 0 });
      return;
    }
    const parsed = parseFieldValue(text, [stress.unit]);
    if (!parsed.ok) {
      refuse(text, parseRefusal(parsed.reason, text, parsed.unit, stress.unit), keep);
      return;
    }
    const watt = powerToWatt(parsed.value, stress.unit);
    if (watt === null) {
      refuse(text, 'is below the minimum 0 W', keep);
      return;
    }
    edit(null);
    clearRefusal();
    if (watt !== stress.power) setStress({ power: watt });
  };

  return (
    <label
      className="ui-field field power-field"
      title="Available power of the Z0 source. The ladder cards and the bill of materials then show the peak voltage across and the RMS current through each part. Empty switches it off."
    >
      <span className="ui-field-label">P</span>
      <span className="ui-field-box">
        <input
          className={`value-input in-field ${invalid ? 'invalid' : ''}`}
          style={{ width: 'calc(8ch + 8px)' }}
          type="text"
          inputMode="text"
          enterKeyHint="done"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          placeholder="off"
          value={draft ?? shown}
          aria-label="Source power"
          aria-invalid={invalid || undefined}
          data-editing={draft !== null ? '' : undefined}
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => edit(e.target.value)}
          onBlur={() => commit(false)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              // The Enter that confirms an IME composition belongs to the composition.
              if (e.nativeEvent.isComposing || e.keyCode === 229) return;
              commit(true);
              e.currentTarget.select();
            }
            if (e.key === 'Escape' && typed.current !== null) {
              // The first Escape reverts and keeps the focus; a second one goes on.
              e.stopPropagation();
              edit(null);
              e.currentTarget.select();
            }
          }}
        />
        <select
          className="ui-field-select"
          value={stress.unit}
          aria-label="Power unit"
          onChange={(e) => setStress({ unit: e.target.value as 'W' | 'dBm' })}
        >
          <option value="W">W</option>
          <option value="dBm">dBm</option>
        </select>
      </span>
    </label>
  );
}
