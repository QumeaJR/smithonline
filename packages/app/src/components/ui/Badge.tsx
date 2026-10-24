import type { CSSProperties, ReactNode } from 'react';

export type BadgeTone = 'neutral' | 'accent' | 'danger' | 'success' | 'warning';

export interface BadgeProps {
  readonly children: ReactNode;
  readonly tone?: BadgeTone;
  /** A fill of its own, such as an element colour; the text turns white. */
  readonly color?: string;
  readonly className?: string;
  readonly title?: string;
  readonly style?: CSSProperties;
}

/** A small rounded label: element numbers, counts, states. */
export function Badge({ children, tone = 'neutral', color, className, title, style }: BadgeProps) {
  return (
    <span
      className={['badge', color ? 'filled' : tone, className].filter(Boolean).join(' ')}
      style={color ? { background: color, ...style } : style}
      title={title}
    >
      {children}
    </span>
  );
}
