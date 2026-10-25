import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react';

/**
 * Variants of section 4 of the interaction redesign: primary (one per
 * surface), secondary (the default), quiet (menu rows, help links), icon
 * (square, see IconButton), destructive (quiet with danger text). `size="sm"`
 * is the small button of tables, rows and menus (`.btn.sm`). A `pressed`
 * value makes it a toggle with aria-pressed.
 */
export type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'icon' | 'destructive';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: ButtonVariant;
  readonly size?: 'md' | 'sm';
  /** Toggle state: sets aria-pressed and the "on" look. Leave undefined for a plain button. */
  readonly pressed?: boolean;
  readonly ref?: Ref<HTMLButtonElement>;
}

function buttonClass(
  variant: ButtonVariant = 'secondary',
  size: 'md' | 'sm' = 'md',
  pressed?: boolean,
  extra?: string,
): string {
  return [
    'btn',
    variant === 'secondary' ? '' : variant,
    variant === 'destructive' ? 'quiet' : '',
    size === 'sm' ? 'sm' : '',
    pressed ? 'on' : '',
    extra ?? '',
  ]
    .filter(Boolean)
    .join(' ');
}

export function Button({
  variant = 'secondary',
  size = 'md',
  pressed,
  className,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={buttonClass(variant, size, pressed, className)}
      aria-pressed={pressed}
      {...rest}
    />
  );
}

export interface IconButtonProps extends Omit<ButtonProps, 'variant' | 'children'> {
  /** The accessible name, also the tooltip unless a title is given. */
  readonly label: string;
  readonly icon: ReactNode;
}

/** A square button that shows only an icon; the label is its accessible name. */
export function IconButton({ label, icon, title, ...rest }: IconButtonProps) {
  return (
    <Button variant="icon" aria-label={label} title={title ?? label} {...rest}>
      {icon}
    </Button>
  );
}
