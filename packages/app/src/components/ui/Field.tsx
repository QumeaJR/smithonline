import { formatEngineering } from '@smithonline/core';
import type { ReactNode } from 'react';
import { ValueInput, type ValueInputProps } from '../ValueInput';

export interface FieldProps extends Omit<ValueInputProps, 'unitOutside' | 'className'> {
  /** The visible label before the box; leave it out when the context names the value. */
  readonly label?: ReactNode;
  /**
   * Text after the number for a plain value (`dB`, `%`, `°`): shown only, not
   * parsed. An engineering `unit` is shown there by itself.
   */
  readonly suffix?: string;
  readonly className?: string;
  /** Class of the input, such as `default-q`. */
  readonly inputClassName?: string | undefined;
}

/**
 * Label, value and unit in one box. The input is a ValueInput (engineering
 * notation, Enter commits, Escape reverts, the invalid flash); its width
 * follows the number of digits unless a width is given. The unit sits in the
 * box after the number, so `16.03 n` and `H` read as `16.03 nH`.
 */
export function Field({
  label,
  suffix,
  className,
  inputClassName,
  title,
  width,
  ...input
}: FieldProps) {
  const unit = input.unit ?? '';
  const digits = input.digits ?? 4;
  const shown = unit || suffix || '';
  // No SI prefix in front of the unit ("50 Ω"): the unit keeps a space from the number.
  const spaced =
    suffix !== undefined ||
    (unit !== '' &&
      formatEngineering(input.value, { unit, digits, prefixes: !input.plain }).endsWith(
        ` ${unit}`,
      ));
  // Sign, digits, decimal point, space and prefix in a monospaced font.
  const inputWidth = width ?? `calc(${digits + 4}ch + 8px)`;
  return (
    <label className={['ui-field', className].filter(Boolean).join(' ')} title={title}>
      {label !== undefined && <span className="ui-field-label">{label}</span>}
      <span className="ui-field-box">
        <ValueInput
          {...input}
          {...(suffix !== undefined ? { acceptUnit: suffix } : {})}
          {...(input.name === undefined && typeof label === 'string' ? { name: label } : {})}
          unitOutside={unit !== ''}
          className={['in-field', inputClassName].filter(Boolean).join(' ')}
          width={inputWidth}
        />
        {shown && (
          <span className={spaced ? 'ui-field-unit spaced' : 'ui-field-unit'} aria-hidden="true">
            {shown}
          </span>
        )}
      </span>
    </label>
  );
}
