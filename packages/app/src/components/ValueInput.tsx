import { formatEngineering, tryParseEngineering } from '@smithonline/core';
import { useEffect, useRef, useState } from 'react';

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

/**
 * A text field that shows a formatted value (`16.03 nH`) and accepts
 * engineering notation on input (`16n`, `3n9`, `0.25`). Commits on Enter or
 * blur, Escape reverts; a value it cannot read, or one below `min`, flashes
 * the field and keeps the old value.
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
  id,
}: ValueInputProps) {
  const formatted = formatValue(value, unit, digits, plain, unitOutside);
  // While editing, `draft` holds the typed text; otherwise the formatted value is shown.
  const [draft, setDraft] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  // Escape blurs the field to leave it; the blur that follows must not commit the typed text.
  const reverting = useRef(false);

  useEffect(() => {
    if (!invalid) return;
    const t = setTimeout(() => setInvalid(false), 800);
    return () => clearTimeout(t);
  }, [invalid]);

  const commit = (): void => {
    if (reverting.current) {
      reverting.current = false;
      setDraft(null);
      return;
    }
    if (draft === null) return;
    setDraft(null);
    const parsed = tryParseEngineering(draft);
    if (!parsed || (min !== undefined && parsed.value < min)) {
      setInvalid(true);
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
      inputMode="decimal"
      enterKeyHint="done"
      autoComplete="off"
      autoCorrect="off"
      autoCapitalize="off"
      spellCheck={false}
      value={draft ?? formatted}
      title={title}
      aria-label={ariaLabel}
      aria-invalid={invalid || undefined}
      onFocus={(e) => {
        setDraft(formatted);
        e.currentTarget.select();
      }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') {
          reverting.current = true;
          setDraft(null);
          e.currentTarget.blur();
          reverting.current = false;
        }
      }}
    />
  );
}
