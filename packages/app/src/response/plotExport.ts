/**
 * Export of one plot (docs/10 section 4.4): PNG and SVG of what the plot
 * shows (its zoom), CSV of its data over the full range. File names are
 * `{design}_{panel}.{ext}`, such as `antenna_vswr.png`.
 */
import { download } from '../lib/export';
import type { PlotAxis, PlotSeries } from './Plot';
import { plotSvg, SVG_H, SVG_W, type PlotPicture } from './plotSvg';

export type PlotFormat = 'png' | 'svg' | 'csv';

/** The PNG is the SVG drawn at twice its size on white: 1600 x 900 pixels. */
export const PLOT_PNG_SCALE = 2;

const safe = (s: string): string =>
  s
    .trim()
    .replace(/[^\w.-]+/g, '_')
    .replace(/^_+|_+$/g, '');

/** "antenna_vswr": the design's name and the panel's, safe for a file name. */
export function plotFileBase(designName: string, panel: string): string {
  return `${safe(designName) || 'design'}_${safe(panel.toLowerCase()) || 'plot'}`;
}

/** "antenna, 2026-10-27": the footer line of a picture. */
export function plotFooter(designName: string, date: Date = new Date()): string {
  const d = date.toISOString().slice(0, 10);
  return `${designName.trim() || 'Untitled design'}, ${d}, SmithChart.Online`;
}

/**
 * A text field. A name that starts like a formula (= + - @, a tab or a carriage return) gets a
 * leading apostrophe, so a spreadsheet shows it as text and never runs it: a curve's name can
 * come from a design or a share link someone else made. Quoted when it holds a comma, a quote or
 * a line break.
 */
function field(s: string): string {
  const text = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** A frequency in full precision; empty for no value. */
function num(v: number | null | undefined): string {
  return v === null || v === undefined || !Number.isFinite(v) ? '' : String(v);
}

/**
 * A plotted value to 6 significant digits, the same for live and stored curves (stored curves
 * are kept to 5), and more than a plot can show; empty for no value.
 */
function val(v: number | null | undefined): string {
  return v === null || v === undefined || !Number.isFinite(v)
    ? ''
    : String(Number(v.toPrecision(6)));
}

/** The column header of a series: its label and the unit of its axis ("|S21| dB", "VSWR"). */
export function columnName(s: PlotSeries, left: PlotAxis, right: PlotAxis | undefined): string {
  const axis = s.scale === 'd' && right ? right : left;
  const unit = axis.exportUnit ?? axis.unit ?? '';
  return unit && !s.label.endsWith(unit) ? `${s.label} ${unit}` : s.label;
}

/**
 * The plotted data over the full range: frequency in Hz, then one column per
 * curve. Measured dots, at their own frequencies, follow in a second block
 * after an empty line.
 */
export function plotCsv(
  xs: readonly number[],
  series: readonly PlotSeries[],
  left: PlotAxis,
  right?: PlotAxis,
): string {
  const lines = (set: readonly PlotSeries[], onlyFilled: boolean): string[] => {
    if (set.length === 0) return [];
    const out = [
      ['Frequency Hz', ...set.map((s) => columnName(s, left, right))].map(field).join(','),
    ];
    xs.forEach((f, i) => {
      const values = set.map((s) => s.values[i]);
      if (onlyFilled && values.every((v) => v === null || v === undefined || !Number.isFinite(v))) {
        return;
      }
      out.push([num(f), ...values.map(val)].join(','));
    });
    return out;
  };
  const curves = lines(
    series.filter((s) => !s.points),
    false,
  );
  const dots = lines(
    series.filter((s) => s.points),
    true,
  );
  return [...curves, ...(curves.length && dots.length ? [''] : []), ...dots].join('\r\n') + '\r\n';
}

/** Draw an SVG document on a white canvas and encode it as PNG. */
export async function svgToPng(svg: string, scale: number = PLOT_PNG_SCALE): Promise<Blob> {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(SVG_W * scale);
    canvas.height = Math.round(SVG_H * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas is not available');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!png) throw new Error('the browser could not encode the image');
    return png;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Save the plot in a format; resolves with the file name. */
export async function exportPlot(
  format: PlotFormat,
  base: string,
  picture: PlotPicture,
): Promise<string> {
  const name = `${base}.${format}`;
  if (format === 'csv') {
    const text = plotCsv(picture.xs, picture.series, picture.left, picture.right);
    download(name, new Blob([text], { type: 'text/csv' }));
  } else if (format === 'svg') {
    download(name, new Blob([plotSvg(picture)], { type: 'image/svg+xml' }));
  } else {
    download(name, await svgToPng(plotSvg(picture)));
  }
  return name;
}
