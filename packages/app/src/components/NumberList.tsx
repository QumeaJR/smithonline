import { formatEngineering, parseFieldValue } from '@smithonline/core';
import { useEffect, useState } from 'react';
import { clearRefusal, parseRefusal, sayRefusal } from '../lib/refusal';
import { Button } from './ui/Button';
import { IconClose } from './ui/icons';

export interface NumberListProps {
  readonly label: string;
  /** One entry of the list, for the Add and Remove buttons: `VSWR circle`. Default: the label without its plural s. */
  readonly itemName?: string;
  readonly values: readonly number[];
  /** Values must be strictly above this. */
  readonly min: number;
  readonly swatch: string;
  readonly placeholder: string;
  /** Unit text after each value on its chip (` dB`); typed after a number it is accepted. */
  readonly unit?: string;
  readonly disabled?: boolean;
  readonly onChange: (values: readonly number[]) => void;
}

/**
 * A value as the list shows it in a message: in dB without a prefix (`0.5 dB`, as the chips
 * read, never `500 mdB`), otherwise with an SI prefix.
 */
function shownValue(value: number, unit: string): string {
  const prefixes = !/^dB/.test(unit);
  return formatEngineering(value, { unit, prefixes });
}

/**
 * A labelled list of numbers with an input to add one and a chip per value to
 * remove it. A typed value is refused as a ValueInput refuses one (not a
 * number, a foreign unit, not above the minimum), with the same status message;
 * the refused text stays in the box to be corrected.
 */
export function NumberList({
  label,
  itemName = label.replace(/s$/, ''),
  values,
  min,
  swatch,
  placeholder,
  unit = '',
  disabled = false,
  onChange,
}: NumberListProps) {
  const [text, setText] = useState('');
  const [flash, setFlash] = useState(0);
  const invalid = flash > 0;
  const fieldUnit = unit.trim();

  useEffect(() => {
    if (flash === 0) return;
    const t = setTimeout(() => setFlash(0), 800);
    return () => clearTimeout(t);
  }, [flash]);

  const refuse = (reason: string): void => {
    setFlash((n) => n + 1);
    sayRefusal(label, text, reason);
  };

  const add = (): void => {
    if (text.trim() === '') return;
    const parsed = parseFieldValue(text, [fieldUnit]);
    if (!parsed.ok) {
      refuse(parseRefusal(parsed, text, fieldUnit));
      return;
    }
    if (!(parsed.value > min)) {
      refuse(`is not above the minimum ${shownValue(min, fieldUnit)}`);
      return;
    }
    clearRefusal();
    if (!values.includes(parsed.value)) {
      onChange([...values, parsed.value].sort((a, b) => a - b));
    }
    setText('');
  };

  return (
    <div className={`number-list ${disabled ? 'disabled' : ''}`}>
      <div className="row">
        <span className="sw" style={{ background: swatch }} />
        <span className="name">{label}</span>
        <input
          type="text"
          className={`value-input ${invalid ? 'invalid' : ''}`}
          style={{ width: '4.5em' }}
          value={text}
          placeholder={placeholder}
          disabled={disabled}
          aria-label={`Add ${label}`}
          aria-invalid={invalid || undefined}
          data-editing={text !== '' ? '' : undefined}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              if (e.nativeEvent.isComposing || e.keyCode === 229) return;
              add();
            }
            if (e.key === 'Escape' && text !== '') {
              e.stopPropagation();
              setText('');
              clearRefusal(label);
            }
          }}
        />
        <Button size="sm" onClick={add} disabled={disabled} aria-label={`Add ${itemName}`}>
          Add
        </Button>
      </div>
      <div className="chips">
        {values.map((v) => (
          <span key={v} className="chip mono">
            {v}
            {unit}
            <button
              type="button"
              aria-label={`Remove ${itemName} ${v}${unit}`}
              title={`Remove ${itemName} ${v}${unit}`}
              onClick={() => onChange(values.filter((x) => x !== v))}
            >
              <IconClose size={11} />
            </button>
          </span>
        ))}
      </div>
    </div>
  );
}
