import { formatEngineering, tryParseEngineering } from '@smithonline/core';
import { useEffect, useRef, useState } from 'react';
import { useDesignStore } from '../store/useDesignStore';

export interface ValueInputProps {
  readonly value: number;
  /** Unit shown after the number and accepted as a suffix when typing, for example `H`. */
  readonly unit?: string;
  readonly digits?: number;
  /** Format without SI prefixes (wavelengths, ratios). */
  readonly plain?: boolean;
  readonly min?: number;
  readonly onCommit: (value: number) => void;
  readonly className?: string;
  readonly title?: string;
  readonly width?: string;
  readonly ariaLabel?: string;
  /**
   * The unit is drawn outside the input (the Field suffix): the text shows the
   * number and its SI prefix only (`16.03 n` beside `H`); typing the unit is still accepted.
   */
  readonly unitOutside?: boolean;
  /** A further unit text accepted after the number, such as a Field's `dB` suffix. */
  readonly acceptUnit?: string;
  /** The short name the status message uses for a refused entry (`f`, `Z0`); else the aria label. */
  readonly name?: string;
  readonly id?: string;
}

/** The text a value shows: `16.03 nH`, or `16.03 n` when the unit sits outside the input. */
function formatValue(
  value: number,
  unit: string,
  digits: number,
  plain: boolean,
  unitOutside: boolean,
): string {
  const full = formatEngineering(value, { unit, digits, prefixes: !plain });
  if (!unitOutside || unit === '' || !full.endsWith(unit)) return full;
  return full.slice(0, -unit.length).trimEnd();
}

/** Whether a typed unit text fits the field: none, the field's unit or the accepted one, any case. */
function unitFits(typed: string, unit: string, accept: string | undefined): boolean {
  if (typed === '') return true;
  const t = typed.toLowerCase();
  if (t === unit.toLowerCase() || (accept !== undefined && t === accept.toLowerCase())) return true;
  return unit === 'Ω' && (t === 'ohm' || t === 'ohms');
}

/** How long a refused entry flashes, counted from the last refusal. */
const FLASH_MS = 800;

/**
 * A text field that shows a formatted value (`16.03 nH`) and accepts
 * engineering notation on input (`16n`, `3n9`, `0.25`). Enter commits and
 * keeps the focus, blur commits, Escape reverts; only text the user typed is
 * committed, so a tab through the field never changes the design. A value it
 * cannot read, one with a foreign unit or one below `min` flashes the field,
 * keeps the old value and says why in the status bar.
 */
export function ValueInput({
  value,
  unit = '',
  digits = 4,
  plain = false,
  min,
  onCommit,
  className = '',
  title,
  width,
  ariaLabel,
  unitOutside = false,
  acceptUnit,
  name,
  id,
}: ValueInputProps) {
  const formatted = formatValue(value, unit, digits, plain, unitOutside);
  // The typed text, or null while the user has not edited: the formatted value is then shown,
  // and follows the store even while the field has the focus.
  const [draft, setDraft] = useState<string | null>(null);
  // The same text read synchronously: Escape clears it before the blur that follows runs.
  const typed = useRef<string | null>(null);
  // Counts refusals; each one restarts the flash.
  const [flash, setFlash] = useState(0);
  const invalid = flash > 0;

  useEffect(() => {
    if (flash === 0) return;
    const t = setTimeout(() => setFlash(0), FLASH_MS);
    return () => clearTimeout(t);
  }, [flash]);

  const edit = (text: string | null): void => {
    typed.current = text;
    setDraft(text);
  };

  const refuse = (reason: string): void => {
    setFlash((n) => n + 1);
    const label = name ?? ariaLabel ?? 'Value';
    useDesignStore.getState().setMessage(`${label}${reason}`);
  };

  const commit = (): void => {
    const text = typed.current;
    if (text === null) return;
    edit(null);
    const parsed = tryParseEngineering(text);
    if (!parsed) {
      refuse(': not a number');
      return;
    }
    if (!unitFits(parsed.unit, unit, acceptUnit)) {
      // "1e" reads as 1 with the unit "e": an unfinished exponent, not a unit.
      refuse(
        /^e$/i.test(parsed.unit)
          ? ': not a number'
          : `: unit ${parsed.unit} does not fit${unit ? ` (${unit})` : ''}`,
      );
      return;
    }
    if (min !== undefined && parsed.value < min) {
      refuse(` must be at least ${formatEngineering(min, { unit, digits, prefixes: !plain })}`);
      return;
    }
    if (parsed.value !== value) onCommit(parsed.value);
  };

  return (
    <input
      id={id}
      className={`value-input ${invalid ? 'invalid' : ''} ${className}`}
      style={width ? { width } : undefined}
      type="text"
      inputMode="text"
      enterKeyHint="done"
      autoComplete="off"
      autoCorrect="off"
      autoCapitalize="off"
      spellCheck={false}
      value={draft ?? formatted}
      title={title}
      aria-label={ariaLabel}
      aria-invalid={invalid || undefined}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => edit(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          // Commit in place: the focus stays, so Tab goes on from here.
          commit();
          e.currentTarget.select();
        }
        if (e.key === 'Escape') {
          edit(null);
          e.currentTarget.blur();
        }
      }}
    />
  );
}
