/**
 * One response plot as an SVG drawing (docs/10 section 4.4): 800 x 450 user
 * units in the light theme, text as text, the axes with the ticks of the
 * plot on screen, each curve as a polyline (dots for measured points, dashes
 * kept), the limit areas, the VSWR band, the markers, the design frequency
 * and the legend. The PNG export draws this same picture on a canvas.
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
  /** The ticks of the plot on screen, where it has drawn them. */
  readonly xTicks?: readonly number[] | undefined;
  readonly yTicks?: readonly number[] | undefined;
  readonly dTicks?: readonly number[] | undefined;
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

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Numbers in the drawing: two decimals at most, never exponent notation. */
const n = (v: number): string => {
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

/** The plot as an SVG document. */
export function plotSvg(p: PlotPicture): string {
  const top = 58;
  const bottom = SVG_H - 52;
  const left = 70;
  const right = SVG_W - (p.right ? 70 : 28);
  const w = right - left;
  const h = bottom - top;
  const [x0, x1] = p.xRange;
  const lx = (v: number): number => (p.logX ? Math.log10(v) : v);
  const X = (f: number): number => left + ((lx(f) - lx(x0)) / (lx(x1) - lx(x0))) * w;
  const yOf =
    (r: Range) =>
    (v: number): number =>
      bottom - ((v - r[0]) / (r[1] - r[0])) * h;
  const Y = yOf(p.yRange);
  const D = p.dRange ? yOf(p.dRange) : Y;
  const yOn = (scale: 'y' | 'd' | undefined): ((v: number) => number) =>
    scale === 'd' && p.dRange ? D : Y;
  const inX = inside(p.xRange);

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

  // The legend row: one entry per curve, as many as fit.
  let at = left;
  const seen = new Set<string>();
  for (const s of p.series) {
    if (seen.has(s.label)) continue;
    seen.add(s.label);
    const width = 22 + s.label.length * 6.2 + 14;
    if (at + width > SVG_W - 10) break;
    if (s.points) {
      out.push(`<circle cx="${n(at + 8)}" cy="40" r="3" fill="${esc(s.color)}"/>`);
    } else {
      const d = dashOf(s);
      out.push(
        `<line x1="${n(at)}" y1="40" x2="${n(at + 16)}" y2="40" stroke="${esc(s.color)}" stroke-width="2"${d ? ` stroke-dasharray="${d}"` : ''}/>`,
      );
    }
    out.push(
      `<text x="${n(at + 21)}" y="44" font-size="11" fill="${INK.text}">${esc(s.label)}</text>`,
    );
    at += width;
  }

  // Grid and ticks.
  const xTicks = (
    p.xTicks?.length ? p.xTicks : p.logX ? logTicks(x0, x1) : niceTicks(x0, x1, 7)
  ).filter(inX);
  const yTicks = (p.yTicks?.length ? p.yTicks : niceTicks(p.yRange[0], p.yRange[1], 5)).filter(
    inside(p.yRange),
  );
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
  if (p.right && p.dRange) {
    const dTicks = (p.dTicks?.length ? p.dTicks : niceTicks(p.dRange[0], p.dRange[1], 5)).filter(
      inside(p.dRange),
    );
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
    if (inside(p.yRange)(limit)) {
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
