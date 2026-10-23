import { formatEngineering, tryParseEngineering, wattToDbm } from '@smithonline/core';
import { useEffect, useState } from 'react';
import { powerToWatt, stressSettings } from '../lib/stress';
import { useDesignStore } from '../store/useDesignStore';

/**
 * Source power for the stress columns, next to the design frequency. Typed in
 * watts or dBm; empty or 0 switches the stress off. The design keeps watts.
 */
export function PowerInput() {
  const stress = useDesignStore((s) => stressSettings(s.design));
  const setStress = useDesignStore((s) => s.setStress);
  const [draft, setDraft] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    if (!invalid) return;
    const t = setTimeout(() => setInvalid(false), 800);
    return () => clearTimeout(t);
  }, [invalid]);

  const shown =
    stress.power > 0
      ? stress.unit === 'dBm'
        ? String(Number(wattToDbm(stress.power).toPrecision(5)))
        : formatEngineering(stress.power, { digits: 4 })
      : '';

  const commit = (): void => {
    if (draft === null) return;
    const text = draft.trim();
    setDraft(null);
    if (text === '') {
      if (stress.power !== 0) setStress({ power: 0 });
      return;
    }
    const parsed = tryParseEngineering(text);
    const watt = parsed ? powerToWatt(parsed.value, stress.unit) : null;
    if (watt === null) {
      setInvalid(true);
      return;
    }
    if (watt !== stress.power) setStress({ power: watt });
  };

  return (
    <label
      className="field"
      title="Available power of the Z0 source. The ladder cards and the bill of materials then show the peak voltage across and the RMS current through each part. Empty switches it off."
    >
      P
      <input
        className={`value-input ${invalid ? 'invalid' : ''}`}
        style={{ width: '5.5em' }}
        type="text"
        inputMode="decimal"
        spellCheck={false}
        placeholder="off"
        value={draft ?? shown}
        aria-label="Source power"
        onFocus={(e) => {
          setDraft(shown);
          e.currentTarget.select();
        }}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') {
            setDraft(null);
            e.currentTarget.blur();
          }
        }}
      />
      <select
        value={stress.unit}
        aria-label="Power unit"
        onChange={(e) => setStress({ unit: e.target.value as 'W' | 'dBm' })}
      >
        <option value="W">W</option>
        <option value="dBm">dBm</option>
      </select>
    </label>
  );
}
