/** Colours for element loci and ladder badges, handed out when an element is created. */
export const ARC_COLORS = ['#d6336c', '#1c7ed6', '#2f9e44', '#f08c00', '#7048e8', '#0ca678'];

/** The palette in use; the settings dialog replaces it, elements already made keep their colour. */
let palette: readonly string[] = ARC_COLORS;

export function setPalette(colors: readonly string[]): void {
  palette = colors.length > 0 ? colors : ARC_COLORS;
}

/** The least-used colour among the existing elements, so a new element stands out. */
export function nextColor(existing: ReadonlyArray<{ readonly color: string }>): string {
  const counts = palette.map((c) => existing.filter((e) => e.color === c).length);
  const min = Math.min(...counts);
  return palette[counts.indexOf(min)] ?? palette[0]!;
}

/** Colour by position, for designs loaded from files that carry no colours. */
export function colorByIndex(index: number): string {
  return palette[index % palette.length]!;
}

/** Dark text on a light fill: near black, readable on every palette colour that needs it. */
export const DARK_ON_COLOR = '#1a1a1a';

/** WCAG relative luminance of `#rgb` or `#rrggbb`; null for any other colour text. */
function luminance(color: string): number | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return null;
  const hex = m[1]!.length === 3 ? [...m[1]!].map((c) => c + c).join('') : m[1]!;
  const channel = (i: number): number => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
}

/**
 * The text colour for a badge filled with `color`: white or near black, whichever has the
 * higher contrast (`#f08c00` takes dark text, 8.5:1, where white has 2.5:1). White for a
 * colour that is not a hex value (a CSS variable), whose caller sets the text itself.
 */
export function textOnColor(color: string): string {
  const l = luminance(color);
  if (l === null) return '#fff';
  const dark = luminance(DARK_ON_COLOR) ?? 0;
  const onWhite = 1.05 / (l + 0.05);
  const onDark = (l + 0.05) / (dark + 0.05);
  return onDark > onWhite ? DARK_ON_COLOR : '#fff';
}
