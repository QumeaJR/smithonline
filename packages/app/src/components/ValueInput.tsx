import { formatEngineering, tryParseEngineering } from '@smithonline/core';
import { useEffect, useState } from 'react';

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
}

/**
 * A text field that shows a formatted value (`16.03 nH`) and accepts
 * engineering notation on input (`16n`, `3n9`, `0.25`). Commits on Enter or
 * blur, Escape reverts.
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
}: ValueInputProps) {
  const formatted = formatEngineering(value, { unit, digits, prefixes: !plain });
  // While editing, `draft` holds the typed text; otherwise the formatted value is shown.
  const [draft, setDraft] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    if (!invalid) return;
    const t = setTimeout(() => setInvalid(false), 800);
    return () => clearTimeout(t);
  }, [invalid]);

  const commit = (): void => {
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
      className={`value-input ${invalid ? 'invalid' : ''} ${className}`}
      style={width ? { width } : undefined}
      type="text"
      inputMode="decimal"
      spellCheck={false}
      value={draft ?? formatted}
      title={title}
      aria-label={ariaLabel}
      onFocus={(e) => {
        setDraft(formatted);
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
  );
}
