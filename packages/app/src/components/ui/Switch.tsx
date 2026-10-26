import { useId, type ReactNode } from 'react';

export interface SwitchProps {
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
  /** The visible label; clicking it toggles the switch too. */
  readonly children?: ReactNode;
  /** Needed when there is no visible label. */
  readonly ariaLabel?: string;
  readonly title?: string;
  readonly disabled?: boolean;
  readonly className?: string;
  /** A guided workflow's anchor (docs/09). */
  readonly tour?: string;
}

/**
 * An on/off switch for a mode (Realize, Losses, the sweep, datapoint input).
 * A real checkbox with role="switch", so Space toggles it and forms and
 * assistive technology treat it as one; lists of options keep checkboxes.
 * 28 x 16 px on a fine pointer, 44 x 26 px on a coarse one, with a 44 px hit area.
 */
export function Switch({
  checked,
  onChange,
  children,
  ariaLabel,
  title,
  disabled = false,
  className,
  tour,
}: SwitchProps) {
  // Named by its visible label, never by its value ("on") or its tooltip.
  const labelId = useId();
  const labelled = ariaLabel === undefined && children !== undefined;
  return (
    <label
      className={['switch-row', disabled ? 'disabled' : '', className].filter(Boolean).join(' ')}
      title={title}
      data-tour={tour}
    >
      <input
        type="checkbox"
        role="switch"
        className="switch"
        checked={checked}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-labelledby={labelled ? labelId : undefined}
        onChange={(e) => onChange(e.target.checked)}
      />
      {children !== undefined && (
        <span className="switch-label" id={labelId}>
          {children}
        </span>
      )}
    </label>
  );
}
