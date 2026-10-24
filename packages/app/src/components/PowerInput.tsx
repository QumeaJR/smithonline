import { formatEngineering, tryParseEngineering, wattToDbm } from '@smithonline/core';
import { useEffect, useRef, useState } from 'react';
import { powerToWatt, stressSettings } from '../lib/stress';
import { useDesignStore } from '../store/useDesignStore';

/** Unit texts a typed power may carry, by the chosen unit. */
const UNITS: Readonly<Record<'W' | 'dBm', readonly string[]>> = {
  W: ['', 'w'],
  dBm: ['', 'dbm'],
};

/**
 * Source power for the stress columns, next to the design frequency. Typed in
 * watts or dBm; empty or 0 switches the stress off. The design keeps watts.
 * One box like a Field: the number and its unit select read as one value,
 * `P [1 W]`. Enter commits in place, Escape reverts, only typed text commits.
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

  const refuse = (reason: string): void => {
    setFlash((n) => n + 1);
    useDesignStore.getState().setMessage(`P${reason}`);
  };

  const commit = (): void => {
    if (typed.current === null) return;
    const text = typed.current.trim();
    edit(null);
    if (text === '') {
      if (stress.power !== 0) setStress({ power: 0 });
      return;
    }
    const parsed = tryParseEngineering(text);
    if (!parsed || !UNITS[stress.unit].includes(parsed.unit.toLowerCase())) {
      refuse(': not a number');
      return;
    }
    const watt = powerToWatt(parsed.value, stress.unit);
    if (watt === null) {
      refuse(' must not be negative');
      return;
    }
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
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => edit(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              commit();
              e.currentTarget.select();
            }
            if (e.key === 'Escape') {
              edit(null);
              e.currentTarget.blur();
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
