import type { ReactNode } from 'react';

/**
 * The inline SVG icon set: 16 unit grid, stroked in the current text colour.
 * Icons are decoration; the button that holds one carries the accessible name.
 */
export interface IconProps {
  /** Rendered size in px; the default follows the font (1.15em). */
  readonly size?: number | string;
  readonly className?: string;
}

function Svg({ size, className, children }: IconProps & { readonly children: ReactNode }) {
  const s = size ?? '1.15em';
  return (
    <svg
      className={`icon ${className ?? ''}`}
      width={s}
      height={s}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

/** A gear of eight teeth around a hole, computed once. */
const GEAR = (() => {
  const pt = (r: number, deg: number): string => {
    const a = (deg * Math.PI) / 180;
    return `${(8 + r * Math.cos(a)).toFixed(2)} ${(8 + r * Math.sin(a)).toFixed(2)}`;
  };
  const parts: string[] = [];
  for (let i = 0; i < 8; i++) {
    const a = i * 45;
    parts.push(pt(5, a - 16), pt(6.9, a - 9), pt(6.9, a + 9), pt(5, a + 16));
  }
  return `M${parts.join('L')}Z`;
})();

export const IconClose = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 4l8 8M12 4l-8 8" />
  </Svg>
);

export const IconChevronDown = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 6l4 4 4-4" />
  </Svg>
);

export const IconChevronRight = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 4l4 4-4 4" />
  </Svg>
);

export const IconArrowUp = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8 13V3M4 7l4-4 4 4" />
  </Svg>
);

export const IconArrowDown = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8 3v10M4 9l4 4 4-4" />
  </Svg>
);

export const IconArrowRight = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 8h10M9 4l4 4-4 4" />
  </Svg>
);

export const IconUndo = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 3L2.5 6.5 6 10M2.5 6.5H10a3.5 3.5 0 0 1 0 7H7" />
  </Svg>
);

export const IconRedo = (p: IconProps) => (
  <Svg {...p}>
    <path d="M10 3l3.5 3.5L10 10M13.5 6.5H6a3.5 3.5 0 0 0 0 7h3" />
  </Svg>
);

export const IconSettings = (p: IconProps) => (
  <Svg {...p}>
    <path d={GEAR} strokeWidth={1.3} />
    <circle cx={8} cy={8} r={2} strokeWidth={1.3} />
  </Svg>
);

export const IconHelp = (p: IconProps) => (
  <Svg {...p}>
    <circle cx={8} cy={8} r={6.25} />
    <path d="M6.2 6.3a1.9 1.9 0 0 1 3.7.5c0 1.3-1.9 1.5-1.9 2.8" />
    <circle cx={8} cy={11.6} r={0.4} fill="currentColor" />
  </Svg>
);

export const IconSun = (p: IconProps) => (
  <Svg {...p}>
    <circle cx={8} cy={8} r={2.8} />
    <path d="M8 1.5v1.6M8 12.9v1.6M1.5 8h1.6M12.9 8h1.6M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M3.4 12.6l1.1-1.1M11.5 4.5l1.1-1.1" />
  </Svg>
);

export const IconMoon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M13 9.6A5.5 5.5 0 1 1 6.4 3a4.4 4.4 0 0 0 6.6 6.6z" />
  </Svg>
);

/** Auto theme: half light, half dark. */
export const IconThemeAuto = (p: IconProps) => (
  <Svg {...p}>
    <circle cx={8} cy={8} r={6} />
    <path d="M8 2a6 6 0 0 1 0 12z" fill="currentColor" stroke="none" />
  </Svg>
);

export const IconLock = (p: IconProps) => (
  <Svg {...p}>
    <rect x={3.5} y={7} width={9} height={6.5} rx={1.5} />
    <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
  </Svg>
);

export const IconUnlock = (p: IconProps) => (
  <Svg {...p}>
    <rect x={3.5} y={7} width={9} height={6.5} rx={1.5} />
    <path d="M5.5 7V5a2.5 2.5 0 0 1 4.8-1" />
  </Svg>
);

/** Three dots in a row: the overflow menu of a ladder card. */
export const IconMore = (p: IconProps) => (
  <Svg {...p}>
    <g fill="currentColor" stroke="none">
      <circle cx={3.5} cy={8} r={1.3} />
      <circle cx={8} cy={8} r={1.3} />
      <circle cx={12.5} cy={8} r={1.3} />
    </g>
  </Svg>
);

/** Two columns of dots: the drag handle of a ladder card. */
export const IconGrip = (p: IconProps) => (
  <Svg {...p}>
    <g fill="currentColor" stroke="none">
      <circle cx={6} cy={4} r={1.1} />
      <circle cx={10} cy={4} r={1.1} />
      <circle cx={6} cy={8} r={1.1} />
      <circle cx={10} cy={8} r={1.1} />
      <circle cx={6} cy={12} r={1.1} />
      <circle cx={10} cy={12} r={1.1} />
    </g>
  </Svg>
);

/** A chevron pointing left: the back button of a panel pushed into the phone's sheet. */
export const IconChevronLeft = (p: IconProps) => (
  <Svg {...p}>
    <path d="M10 3.5 5.5 8l4.5 4.5" />
  </Svg>
);

/** Three lines: the More button of the phone's top bar. */
export const IconMenu = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2.5 4h11M2.5 8h11M2.5 12h11" />
  </Svg>
);

/** A circle with an arc through it: the grid button on the phone's chart. */
export const IconGrid = (p: IconProps) => (
  <Svg {...p}>
    <circle cx={8} cy={8} r={6} />
    <path d="M2 8h12M14 8a3 3 0 0 0-6 0a3 3 0 0 0 6 0" />
  </Svg>
);
