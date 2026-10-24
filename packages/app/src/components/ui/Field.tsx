import { formatEngineering, prefixCollides } from '@smithonline/core';
import { isValidElement, type ReactNode } from 'react';
import { ValueInput, type ValueInputProps } from '../ValueInput';

export interface FieldProps extends Omit<ValueInputProps, 'unitOutside' | 'className'> {
  /** The visible label before the box; leave it out when the context names the value. */
  readonly label?: ReactNode;
  /**
   * Text after the number for a plain value (`dB`, `%`, `°`): shown beside the
   * box and accepted when typed after the number. An engineering `unit` is
   * shown there by itself.
   */
  readonly suffix?: string;
  readonly className?: string;
  /** Class of the input, such as `default-q`. */
  readonly inputClassName?: string | undefined;
}

/** The text of a label given as markup (`ε<sub>r</sub>` reads `εr`), for the status message. */
function textOf(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children);
  return '';
}

/**
 * Label, value and unit in one box. The input is a ValueInput (engineering
 * notation, Enter commits, Escape reverts, the invalid flash); its width
 * follows the number of digits unless a width is given. The unit sits in the
 * box after the number, so `16.03 n` and `H` read as `16.03 nH`. The metre
 * stays inside the input (`1.6 mm`): beside the box, `1.6 m` and `m` would read
 * `1.6 m` typed back as 1.6 metres; so does a unit after a prefix that is its own
 * letter in another case (`2 fF`, `2 aA`).
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
  // A unit that is also a prefix letter cannot stand apart from the prefix in the input, nor
  // can a unit after a prefix that is its own letter in another case (`2 fF`: `2 f` beside `F`
  // would read back as ambiguous).
  const outside =
    unit !== '' && unit !== 'm' && (input.plain || !prefixCollides(input.value, unit, digits));
  const shown = outside ? unit : (suffix ?? '');
  // No SI prefix in front of the unit ("50 Ω"): the unit keeps a space from the number.
  const spaced =
    suffix !== undefined ||
    (outside &&
      formatEngineering(input.value, { unit, digits, prefixes: !input.plain }).endsWith(
        ` ${unit}`,
      ));
  // Sign, digits, decimal point, space and prefix in a monospaced font, and a unit kept inside.
  const inputWidth = width ?? `calc(${digits + 4 + (outside ? 0 : unit.length)}ch + 8px)`;
  // The status message names the field: the given name, a text label, the aria label, or
  // the text of a label given as markup.
  const labelText = textOf(label).trim();
  const name =
    input.name ??
    (typeof label === 'string' ? label : undefined) ??
    input.ariaLabel ??
    (labelText !== '' ? labelText : undefined);
  return (
    <label className={['ui-field', className].filter(Boolean).join(' ')} title={title}>
      {label !== undefined && <span className="ui-field-label">{label}</span>}
      <span className="ui-field-box">
        <ValueInput
          {...input}
          {...(suffix !== undefined ? { acceptUnit: suffix } : {})}
          {...(name !== undefined ? { name } : {})}
          unitOutside={outside}
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
