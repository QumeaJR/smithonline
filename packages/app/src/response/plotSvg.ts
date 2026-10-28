/**
 * One response plot as an SVG drawing (docs/10 section 4.4): 800 x 450 user
 * units in the light theme, text as text, the axes with ticks chosen for the
 * drawing's own size, each curve as a polyline (dots for measured points,
 * dashes kept), the limit areas, the VSWR band, the markers, the design
 * frequency and a legend that wraps so every curve is named. The PNG export
 * draws this same picture on a canvas.
 */
import { formatEngineering } from '@smithonline/core';
import type { Range } from '../lib/plotZoom';
import type { PlotAxis, PlotLimit, PlotSeries, VswrBand } from './Plot';

export interface PlotPicture {
  readonly title: string;
  readonly xs: readonly number[];
  readonly series: readonly PlotSeries[];
  readonly left: PlotAxis;
  readonly right?: PlotAxis | undefined;
  readonly logX: boolean;
  /** The ranges on show (the zoom). */
  readonly xRange: Range;
  readonly yRange: Range;
  readonly dRange?: Range | undefined;
  readonly markers: readonly number[];
  readonly limits?: readonly PlotLimit[] | undefined;
  readonly vswrBand?: VswrBand | undefined;
  readonly designFrequency: number;
  readonly spanGaps?: boolean | undefined;
  /** The design name and the date, under the plot. */
  readonly footer: string;
}

export const SVG_W = 800;
export const SVG_H = 450;

/** The light theme's colours, as the chart's paper exports use them. */
const INK = {
  text: '#1b1f24',
  muted: '#5a6472',
  grid: '#dde2e7',
  axis: '#9aa4ae',
  marker: '#0b6bcb',
  danger: '#d6336c',
  band: '#2f9e44',
  paper: '#ffffff',
};

/** Text for the document: markup escaped, and the control characters XML does not allow dropped. */
const esc = (s: string): string =>
  s
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/**
 * A range the drawing can divide by: finite, increasing, and not of zero height (the group delay
 * of an empty network is 0 everywhere); a flat one is widened about its value.
 */
export function drawableRange(r: Range, log = false): Range {
  let [a, b] = r;
  if (!Number.isFinite(a) || !Number.isFinite(b)) {
    a = Number.isFinite(a) ? a : Number.isFinite(b) ? b : 0;
    b = a;
  }
  if (a > b) [a, b] = [b, a];
  if (log) {
    if (!(a > 0)) a = b > 0 ? b / 10 : 1;
    if (!(b > a)) b = a * 10;
    return [a, b];
  }
  if (b - a > Math.abs(a) * 1e-12) return [a, b];
  const pad = Math.abs(a) > 0 ? Math.abs(a) * 0.1 : 1;
  return [a - pad, b + pad];
}

/** Numbers in the drawing: two decimals at most, never exponent notation. */
const n = (v: number): string => {
  if (Number.isNaN(v)) return '0';
  const c = Math.max(-1e5, Math.min(1e5, v));
  return String(Math.round(c * 100) / 100);
};

/** 1, 2 and 5 times a power of ten, about `count` of them over the range. */
export function niceTicks(lo: number, hi: number, count = 6): number[] {
  if (!(hi > lo) || !Number.isFinite(lo) || !Number.isFinite(hi)) return [];
  const raw = (hi - lo) / Math.max(1, count);
  const p = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((k) => k * p).find((s) => s >= raw) ?? 10 * p;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) {
    out.push(Math.abs(v) < step * 1e-9 ? 0 : Number(v.toPrecision(12)));
  }
  return out;
}

/** The 1, 2, 5 ticks of a log axis inside the range. */
export function logTicks(lo: number, hi: number): number[] {
  if (!(lo > 0) || !(hi > lo)) return [];
  const out: number[] = [];
  for (let d = Math.floor(Math.log10(lo)); d <= Math.ceil(Math.log10(hi)); d++) {
    for (const m of [1, 2, 5]) {
      const v = m * 10 ** d;
      if (v >= lo * (1 - 1e-9) && v <= hi * (1 + 1e-9)) out.push(Number(v.toPrecision(12)));
    }
  }
  return out;
}

const dashOf = (s: PlotSeries): string | null => (s.dash ? s.dash.join(' ') : null);

const inside = (r: Range) => (v: number) => v >= r[0] && v <= r[1];

/** Legend rows at most; a longer list ends with "and N more". */
const LEGEND_ROWS = 6;
const LEGEND_ROW_H = 16;

interface LegendEntry {
  readonly series: PlotSeries;
  readonly text: string;
  readonly x: number;
  readonly row: number;
}

/** The legend's entries, wrapped into rows so every curve drawn is named. */
function legendLayout(
  series: readonly PlotSeries[],
  left: number,
): {
  entries: LegendEntry[];
  rows: number;
  more: number;
} {
  const maxChars = Math.floor((SVG_W - left - 10 - 36) / 6.2);
  const entries: LegendEntry[] = [];
  const seen = new Set<string>();
  let at = left;
  let row = 0;
  let more = 0;
  for (const s of series) {
    if (seen.has(s.label)) continue;
    seen.add(s.label);
    const text = s.label.length > maxChars ? `${s.label.slice(0, maxChars - 1)}…` : s.label;
    const width = 22 + text.length * 6.2 + 14;
    if (at > left && at + width > SVG_W - 10) {
      row += 1;
      at = left;
    }
    if (row >= LEGEND_ROWS) {
      more += 1;
      continue;
    }
    entries.push({ series: s, text, x: at, row });
    at += width;
  }
  return { entries, rows: Math.min(row, LEGEND_ROWS - 1) + 1, more };
}

/** Ticks for a length of the drawing: about one per 60 units up, one per 100 across. */
function ticksFor(r: Range, length: number, across: boolean, log = false): number[] {
  const count = Math.max(3, Math.round(length / (across ? 100 : 60)));
  if (log) {
    const t = logTicks(r[0], r[1]);
    if (t.length >= 3) return t;
  }
  return niceTicks(r[0], r[1], count);
}

/** The plot as an SVG document. */
export function plotSvg(p: PlotPicture): string {
  const left = 70;
  const legend = legendLayout(p.series, left);
  const top = 58 + (legend.rows - 1) * LEGEND_ROW_H;
  const bottom = SVG_H - 52;
  const right = SVG_W - (p.right ? 70 : 28);
  const w = right - left;
  const h = bottom - top;
  const xRange = drawableRange(p.xRange, p.logX);
  const yRange = drawableRange(p.yRange);
  const dRange = p.dRange ? drawableRange(p.dRange) : undefined;
  const [x0, x1] = xRange;
  const lx = (v: number): number => (p.logX ? Math.log10(v) : v);
  const X = (f: number): number => left + ((lx(f) - lx(x0)) / (lx(x1) - lx(x0))) * w;
  const yOf =
    (r: Range) =>
    (v: number): number =>
      bottom - ((v - r[0]) / (r[1] - r[0])) * h;
  const Y = yOf(yRange);
  const D = dRange ? yOf(dRange) : Y;
  const yOn = (scale: 'y' | 'd' | undefined): ((v: number) => number) =>
    scale === 'd' && dRange ? D : Y;
  const inX = inside(xRange);

  const out: string[] = [];
  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${SVG_W}" height="${SVG_H}" viewBox="0 0 ${SVG_W} ${SVG_H}" font-family="system-ui, -apple-system, Segoe UI, sans-serif">`,
  );
  out.push(`<title>${esc(p.title)}</title>`);
  out.push(`<rect width="${SVG_W}" height="${SVG_H}" fill="${INK.paper}"/>`);
  out.push(
    `<defs><clipPath id="plot-area"><rect x="${left}" y="${top}" width="${w}" height="${h}"/></clipPath></defs>`,
  );
  out.push(
    `<text x="${left}" y="24" font-size="15" font-weight="600" fill="${INK.text}">${esc(p.title)}</text>`,
  );

  // The legend: one entry per curve, in rows.
  for (const e of legend.entries) {
    const s = e.series;
    const y = 40 + e.row * LEGEND_ROW_H;
    if (s.points) {
      out.push(`<circle cx="${n(e.x + 8)}" cy="${y}" r="3" fill="${esc(s.color)}"/>`);
    } else {
      const d = dashOf(s);
      out.push(
        `<line x1="${n(e.x)}" y1="${y}" x2="${n(e.x + 16)}" y2="${y}" stroke="${esc(s.color)}" stroke-width="2"${d ? ` stroke-dasharray="${d}"` : ''}/>`,
      );
    }
    out.push(
      `<text x="${n(e.x + 21)}" y="${y + 4}" font-size="11" fill="${INK.text}">${esc(e.text)}</text>`,
    );
  }
  if (legend.more > 0) {
    out.push(
      `<text x="${SVG_W - 10}" y="${40 + (legend.rows - 1) * LEGEND_ROW_H + 4}" font-size="11" text-anchor="end" fill="${INK.muted}">and ${legend.more} more</text>`,
    );
  }

  // Grid and ticks, chosen for the drawing's size.
  const xTicks = ticksFor(xRange, w, true, p.logX).filter(inX);
  const yTicks = ticksFor(yRange, h, false).filter(inside(yRange));
  const fx = (v: number): string => formatEngineering(v, { unit: 'Hz', digits: 3 });
  out.push(`<g stroke="${INK.grid}" stroke-width="1">`);
  for (const t of xTicks) {
    out.push(`<line x1="${n(X(t))}" y1="${top}" x2="${n(X(t))}" y2="${bottom}"/>`);
  }
  for (const t of yTicks) {
    out.push(`<line x1="${left}" y1="${n(Y(t))}" x2="${right}" y2="${n(Y(t))}"/>`);
  }
  out.push('</g>');
  out.push(
    `<rect x="${left}" y="${top}" width="${w}" height="${h}" fill="none" stroke="${INK.axis}" stroke-width="1"/>`,
  );
  out.push(`<g font-size="11" fill="${INK.muted}">`);
  for (const t of xTicks) {
    out.push(`<text x="${n(X(t))}" y="${bottom + 16}" text-anchor="middle">${esc(fx(t))}</text>`);
  }
  for (const t of yTicks) {
    out.push(
      `<text x="${left - 6}" y="${n(Y(t) + 4)}" text-anchor="end">${esc(p.left.format(t))}</text>`,
    );
  }
  if (p.right && dRange) {
    const dTicks = ticksFor(dRange, h, false).filter(inside(dRange));
    for (const t of dTicks) {
      out.push(`<text x="${right + 6}" y="${n(D(t) + 4)}">${esc(p.right.format(t))}</text>`);
    }
  }
  out.push('</g>');

  out.push(`<g clip-path="url(#plot-area)">`);
  // The usable band and the VSWR limit, under the curves.
  if (p.vswrBand) {
    const { band, limit } = p.vswrBand;
    if (band) {
      const a = Math.max(band.low, x0);
      const b = Math.min(band.high, x1);
      if (b > a) {
        out.push(
          `<rect x="${n(X(a))}" y="${top}" width="${n(X(b) - X(a))}" height="${h}" fill="${INK.band}" fill-opacity="0.16"/>`,
        );
      }
    }
    if (inside(yRange)(limit)) {
      out.push(
        `<line x1="${left}" y1="${n(Y(limit))}" x2="${right}" y2="${n(Y(limit))}" stroke="${INK.band}" stroke-dasharray="4 3"/>`,
      );
    }
  }
  for (const l of p.limits ?? []) {
    const yy = yOn(l.scale);
    const a = X(Math.min(l.f1, l.f2));
    const b = X(Math.max(l.f1, l.f2));
    const y = yy(l.value);
    const y1 = l.kind === 'max' ? top : y;
    const y2 = l.kind === 'max' ? y : bottom;
    out.push(
      `<rect x="${n(a)}" y="${n(Math.min(y1, y2))}" width="${n(b - a)}" height="${n(Math.abs(y2 - y1))}" fill="${INK.danger}" fill-opacity="${l.violated ? 0.28 : 0.13}"/>`,
    );
    out.push(
      `<line x1="${n(a)}" y1="${n(y)}" x2="${n(b)}" y2="${n(y)}" stroke="${INK.danger}" stroke-width="1.5"/>`,
    );
  }
  // The curves.
  for (const s of p.series) {
    const yy = yOn(s.scale);
    const runs: [number, number][][] = [];
    let run: [number, number][] = [];
    p.xs.forEach((f, i) => {
      const v = s.values[i];
      if (v === null || v === undefined || !Number.isFinite(v) || !Number.isFinite(f)) {
        if (!p.spanGaps && run.length) {
          runs.push(run);
          run = [];
        }
        return;
      }
      run.push([X(f), yy(v)]);
    });
    if (run.length) runs.push(run);
    if (s.points) {
      out.push(`<g fill="${esc(s.color)}">`);
      for (const r of runs) {
        for (const [x, y] of r) out.push(`<circle cx="${n(x)}" cy="${n(y)}" r="2.5"/>`);
      }
      out.push('</g>');
      continue;
    }
    const d = dashOf(s);
    for (const r of runs) {
      if (r.length < 2) continue;
      const points = r.map(([x, y]) => `${n(x)},${n(y)}`).join(' ');
      out.push(
        `<polyline fill="none" stroke="${esc(s.color)}" stroke-width="${s.width ?? 1.5}" stroke-linejoin="round"${d ? ` stroke-dasharray="${d}"` : ''} points="${points}"/>`,
      );
    }
  }
  // The design frequency and the markers, on top.
  if (p.designFrequency > 0 && inX(p.designFrequency)) {
    const x = n(X(p.designFrequency));
    out.push(
      `<line x1="${x}" y1="${top}" x2="${x}" y2="${bottom}" stroke="${INK.muted}" stroke-dasharray="2 3"/>`,
    );
  }
  p.markers.forEach((f, i) => {
    if (!inX(f)) return;
    const x = X(f);
    out.push(
      `<line x1="${n(x)}" y1="${top}" x2="${n(x)}" y2="${bottom}" stroke="${INK.marker}" stroke-dasharray="5 3"/>`,
    );
    out.push(
      `<text x="${n(x + 3)}" y="${top + 12}" font-size="11" fill="${INK.marker}">M${i + 1}</text>`,
    );
  });
  out.push('</g>');
  out.push(
    `<text x="${left}" y="${SVG_H - 12}" font-size="11" fill="${INK.muted}">${esc(p.footer)}</text>`,
  );
  out.push('</svg>');
  return out.join('\n');
}
