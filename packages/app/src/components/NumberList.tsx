import { tryParseEngineering } from '@smithonline/core';
import { useState } from 'react';

export interface NumberListProps {
  readonly label: string;
  readonly values: readonly number[];
  /** Values must be strictly above this. */
  readonly min: number;
  readonly swatch: string;
  readonly placeholder: string;
  readonly unit?: string;
  readonly disabled?: boolean;
  readonly onChange: (values: readonly number[]) => void;
}

/** A labelled list of numbers with an input to add one and a chip per value to remove it. */
export function NumberList({
  label,
  values,
  min,
  swatch,
  placeholder,
  unit = '',
  disabled = false,
  onChange,
}: NumberListProps) {
  const [text, setText] = useState('');
  const add = (): void => {
    const parsed = tryParseEngineering(text);
    if (parsed && parsed.value > min && !values.includes(parsed.value)) {
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
          className="value-input"
          style={{ width: '4.5em' }}
          value={text}
          placeholder={placeholder}
          disabled={disabled}
          aria-label={`Add ${label}`}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
        />
        <button className="btn tiny" onClick={add} disabled={disabled}>
          Add
        </button>
      </div>
      <div className="chips">
        {values.map((v) => (
          <span key={v} className="chip mono">
            {v}
            {unit}
            <button
              aria-label={`Remove ${v}`}
              onClick={() => onChange(values.filter((x) => x !== v))}
            >
              &#215;
            </button>
          </span>
        ))}
      </div>
    </div>
  );
}
