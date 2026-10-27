/**
 * A legend swatch drawn as the curve is: the same stroke, width and dash pattern (an SVG line,
 * so a dash-dot reads as dash-dot and a long dash as a long dash, which CSS borders cannot show).
 * `dot` adds a dot on the line for a curve drawn with a dot per point.
 */
export function LineSwatch({
  color,
  width = 2,
  dash,
  dot = false,
}: {
  readonly color: string;
  readonly width?: number;
  readonly dash?: readonly number[];
  readonly dot?: boolean;
}) {
  return (
    <svg className="sw-line" width="24" height="10" viewBox="0 0 24 10" aria-hidden="true">
      <line
        x1="0"
        y1="5"
        x2="24"
        y2="5"
        stroke={color}
        strokeWidth={width}
        {...(dash ? { strokeDasharray: dash.join(' ') } : {})}
      />
      {dot && <circle cx="12" cy="5" r="3" fill={color} />}
    </svg>
  );
}
