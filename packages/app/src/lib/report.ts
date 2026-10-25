/**
 * The report: chart, schematic, datapoint table and circle list on one page,
 * as a single SVG file or as a print page. This is the original's print
 * dialog. The composition works on strings so it is testable in Node; only
 * `svgPiece`, `exportReport` and `printReport` touch the DOM.
 */
import type { LadderResult } from '@smithonline/core';
import { designCircles } from './circles';
import type { Design } from './design';
import { exportText, resolvedSvgClone, withLightTheme } from './export';
import { datapointLabel, fmtComplex, fmtDb, fmtDeg, fmtFrequency, fmtNum } from './format';

export interface ReportSelection {
  readonly chart: boolean;
  readonly schematic: boolean;
  readonly datapoints: boolean;
  readonly circles: boolean;
}

export interface ReportTable {
  readonly title: string;
  readonly header: readonly string[];
  readonly rows: readonly (readonly string[])[];
  /** One line under the table. */
  readonly note?: string;
  /** Further notes under it, one per line (the layout assumptions of the network as built). */
  readonly notes?: readonly string[];
}

/** A serialized SVG without x, y, width and height, so the report can place it. */
export interface SvgPiece {
  readonly markup: string;
  /** Width over height of its viewBox. */
  readonly aspect: number;
  /** Width of its viewBox, the natural width in px. */
  readonly width?: number;
}

export interface ReportParts {
  readonly title: string;
  readonly subtitle: string;
  readonly chart: SvgPiece | null;
  readonly schematic: SvgPiece | null;
  /** The ideal datapoints, and the realized ones when Realize is on. */
  readonly datapoints: readonly ReportTable[];
  readonly circles: ReportTable;
}

/** The datapoint table of a ladder result, as the right panel shows it. */
export function datapointTable(
  result: LadderResult,
  title = 'Datapoints',
  dp: { readonly count: number; readonly slot: number } = { count: 1, slot: 0 },
): ReportTable {
  return {
    title: `${title} at ${fmtFrequency(result.frequency)}`,
    header: ['Point', 'Z (Ω)', '|Γ|', '∠Γ', 'VSWR', 'RL (dB)', 'Q'],
    rows: result.info.map((info, i) => [
      datapointLabel(i, dp.count, dp.slot),
      fmtComplex(info.z),
      fmtNum(info.gammaMag, 3),
      fmtDeg(info.gammaAngleDeg),
      fmtNum(info.vswr, 3),
      Number.isFinite(info.returnLossDb) ? fmtNum(info.returnLossDb, 1) : '∞',
      fmtNum(info.q, 2),
    ]),
    note: `S21 into the load ${fmtDb(result.s21.db, 3)}, loaded Q ${fmtNum(result.loadedQ, 2)}, Zin ${fmtComplex(result.zin)} Ω`,
  };
}

/** Every circle and contour the chart draws: VSWR circles, Q contours and the device circles. */
export function circleTable(design: Design): ReportTable {
  const rows: string[][] = [];
  for (const v of design.vswrCircles) {
    if (!(v >= 1)) continue;
    rows.push(['VSWR circle', fmtNum(v, 3), '0.000 + j0.000', fmtNum((v - 1) / (v + 1), 4), '']);
  }
  for (const q of design.qContours) {
    if (!(q > 0)) continue;
    rows.push([
      'Q contour',
      fmtNum(q, 3),
      `0.000 ± j${fmtNum(1 / q, 3)}`,
      fmtNum(Math.sqrt(1 + 1 / (q * q)), 4),
      'two arcs through the open and short circuit points',
    ]);
  }
  for (const c of designCircles(design)) {
    const kind =
      c.kind === 'stability' ? 'Stability' : c.kind === 'gain' ? 'Gain circle' : 'Noise circle';
    rows.push([
      kind,
      c.label,
      fmtComplex(c.circle.center, 4),
      fmtNum(c.circle.radius, 4),
      c.kind === 'stability' ? `stable ${c.stableInside ? 'inside' : 'outside'}` : '',
    ]);
  }
  return {
    title: 'Circles and contours',
    header: ['Kind', 'Value', 'Centre (Γ)', 'Radius', 'Note'],
    rows,
    ...(rows.length === 0 ? { note: 'No circles or contours are set.' } : {}),
  };
}

/** The aspect ratio and markup of a live SVG with its colours resolved under the light theme. */
export function svgPiece(svg: SVGSVGElement): SvgPiece {
  const clone = withLightTheme(() => resolvedSvgClone(svg));
  for (const a of ['width', 'height', 'x', 'y', 'style']) clone.removeAttribute(a);
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  const vb = (clone.getAttribute('viewBox') ?? '').split(/[\s,]+/).map(Number);
  const w = vb[2];
  const h = vb[3];
  const aspect = w !== undefined && h !== undefined && w > 0 && h > 0 ? w / h : 1;
  return {
    markup: new XMLSerializer().serializeToString(clone),
    aspect,
    ...(w !== undefined && w > 0 ? { width: w } : {}),
  };
}

/** A table as text for the clipboard: tab separated, one row per line, ready to paste into a sheet. */
export function tableText(t: ReportTable): string {
  return [t.header, ...t.rows].map((r) => r.join('\t')).join('\n');
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Pad the columns of a table to equal width, for monospace text rows. */
function padColumns(table: ReportTable): string[] {
  const all = [table.header, ...table.rows];
  const widths = table.header.map((_, c) => Math.max(...all.map((r) => [...(r[c] ?? '')].length)));
  const pad = (s: string, w: number): string => s + ' '.repeat(Math.max(0, w - [...s].length));
  return all.map((r) =>
    r
      .map((cell, c) => pad(cell, widths[c] ?? 0))
      .join('  ')
      .trimEnd(),
  );
}

/** Place a piece at x, y with the given width; its height follows from the aspect ratio. */
function placed(piece: SvgPiece, x: number, y: number, width: number): string {
  const height = width / piece.aspect;
  return piece.markup.replace(
    /^<svg\b/,
    `<svg x="${x}" y="${y.toFixed(1)}" width="${width}" height="${height.toFixed(1)}"`,
  );
}

const PAGE_W = 800;
const MARGIN = 28;
const LINE = 15;
/**
 * Characters of an 11 px sans-serif note line that fit the page between the margins: about
 * 5.6 px per character on average, so 744 px take some 130; 120 leaves room for wide letters.
 */
const NOTE_CHARS = 120;

/** A text broken at spaces into lines of at most `max` characters (a longer word stands alone). */
export function wrapText(text: string, max: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (line && line.length + 1 + word.length > max) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines;
}
const FONT = 'font-family="system-ui, -apple-system, \'Segoe UI\', Roboto, sans-serif"';
const MONO = 'font-family="ui-monospace, Consolas, \'SF Mono\', monospace"';
const TEXT = '#1b1f24';
const MUTED = '#5f6b7a';

/** One SVG file: title, chart, schematic, then the tables as text rows. */
export function reportSvg(parts: ReportParts, sel: ReportSelection): string {
  const body: string[] = [];
  const inner = PAGE_W - 2 * MARGIN;
  let y = MARGIN + 18;
  body.push(
    `<text x="${MARGIN}" y="${y}" ${FONT} font-size="18" font-weight="700" fill="${TEXT}">${escapeXml(parts.title)}</text>`,
  );
  y += 18;
  body.push(
    `<text x="${MARGIN}" y="${y}" ${FONT} font-size="12" fill="${MUTED}">${escapeXml(parts.subtitle)}</text>`,
  );
  y += 16;
  if (sel.chart && parts.chart) {
    const w = Math.min(inner, 640);
    body.push(placed(parts.chart, (PAGE_W - w) / 2, y, w));
    y += w / parts.chart.aspect + 12;
  }
  if (sel.schematic && parts.schematic) {
    const natural = parts.schematic.width ?? 84 * parts.schematic.aspect;
    const w = Math.min(inner, Math.max(natural, Math.min(inner, natural * 1.5)));
    body.push(placed(parts.schematic, (PAGE_W - w) / 2, y, w));
    y += w / parts.schematic.aspect + 12;
  }
  const tables: ReportTable[] = [];
  if (sel.datapoints) tables.push(...parts.datapoints);
  if (sel.circles) tables.push(parts.circles);
  for (const t of tables) {
    y += 10;
    body.push(
      `<text x="${MARGIN}" y="${y}" ${FONT} font-size="13" font-weight="600" fill="${TEXT}">${escapeXml(t.title)}</text>`,
    );
    y += LINE + 2;
    padColumns(t).forEach((line, i) => {
      body.push(
        `<text x="${MARGIN}" y="${y}" xml:space="preserve" ${MONO} font-size="11" fill="${i === 0 ? MUTED : TEXT}">${escapeXml(line)}</text>`,
      );
      y += LINE;
    });
    // The note and each further note on lines of their own, wrapped to the page width.
    for (const note of [t.note, ...(t.notes ?? [])]) {
      if (!note) continue;
      for (const line of wrapText(note, NOTE_CHARS)) {
        body.push(
          `<text x="${MARGIN}" y="${y}" ${FONT} font-size="11" fill="${MUTED}">${escapeXml(line)}</text>`,
        );
        y += LINE;
      }
    }
  }
  const height = Math.ceil(y + MARGIN);
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" width="${PAGE_W}" height="${height}" viewBox="0 0 ${PAGE_W} ${height}">`,
    `<rect width="${PAGE_W}" height="${height}" fill="#ffffff"/>`,
    ...body,
    '</svg>',
  ].join('\n');
}

function fitted(piece: SvgPiece, maxWidth: string): string {
  return piece.markup.replace(
    /^<svg\b/,
    `<svg style="display:block;margin:0 auto;width:100%;max-width:${maxWidth};height:auto"`,
  );
}

function htmlTable(t: ReportTable): string {
  const cells = (r: readonly string[], tag: 'th' | 'td'): string =>
    r.map((c) => `<${tag}>${escapeXml(c)}</${tag}>`).join('');
  return [
    `<h2>${escapeXml(t.title)}</h2>`,
    '<table>',
    `<thead><tr>${cells(t.header, 'th')}</tr></thead>`,
    `<tbody>${t.rows.map((r) => `<tr>${cells(r, 'td')}</tr>`).join('')}</tbody>`,
    '</table>',
    t.note ? `<p class="note">${escapeXml(t.note)}</p>` : '',
    ...(t.notes ?? []).map((n) => `<p class="note">${escapeXml(n)}</p>`),
  ].join('\n');
}

/** A self-contained print page with the same selection; it opens the print dialog on load. */
export function reportHtml(parts: ReportParts, sel: ReportSelection): string {
  const sections: string[] = [];
  if (sel.chart && parts.chart)
    sections.push(`<div class="chart">${fitted(parts.chart, '150mm')}</div>`);
  if (sel.schematic && parts.schematic) {
    const px = Math.round(
      Math.min(680, (parts.schematic.width ?? 84 * parts.schematic.aspect) * 1.5),
    );
    sections.push(`<div class="schematic">${fitted(parts.schematic, `${px}px`)}</div>`);
  }
  if (sel.datapoints) for (const t of parts.datapoints) sections.push(htmlTable(t));
  if (sel.circles) sections.push(htmlTable(parts.circles));
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeXml(parts.title)}</title>
<style>
  body { font: 12px/1.4 system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; color: ${TEXT}; background: #fff; margin: 14mm; }
  h1 { font-size: 18px; margin: 0 0 2px; }
  .sub { color: ${MUTED}; margin: 0 0 12px; }
  .chart, .schematic { margin: 6px 0; break-inside: avoid; }
  h2 { font-size: 13px; margin: 14px 0 4px; break-after: avoid; }
  table { border-collapse: collapse; font: 11px ui-monospace, Consolas, 'SF Mono', monospace; }
  th, td { padding: 2px 10px 2px 0; border-bottom: 1px solid #d9dde3; text-align: left; white-space: nowrap; }
  th { color: ${MUTED}; font-weight: 600; }
  .note { color: ${MUTED}; margin: 4px 0 0; }
  .no-print { position: fixed; top: 8px; right: 8px; font: inherit; padding: 6px 12px; }
  @media print { .no-print { display: none; } @page { margin: 12mm; } }
</style>
</head>
<body>
<button class="no-print" onclick="window.print()">Print</button>
<h1>${escapeXml(parts.title)}</h1>
<p class="sub">${escapeXml(parts.subtitle)}</p>
${sections.join('\n')}
<script>addEventListener('load', function () { setTimeout(function () { window.print(); }, 150); });</script>
</body>
</html>
`;
}

/** Download the report as one SVG file. */
export function exportReport(parts: ReportParts, sel: ReportSelection, name: string): void {
  exportText(`${name}-report.svg`, reportSvg(parts, sel), 'image/svg+xml');
}

/**
 * Print the report. The page opens in a new tab when the browser allows it;
 * when the pop-up is blocked, a hidden iframe loads the same page and its
 * load script opens the print dialog in place.
 */
export function printReport(parts: ReportParts, sel: ReportSelection): 'tab' | 'inline' {
  const html = reportHtml(parts, sel);
  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const w = window.open(url, '_blank');
  if (w) {
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return 'tab';
  }
  URL.revokeObjectURL(url);
  const frame = document.createElement('iframe');
  frame.className = 'print-frame';
  frame.setAttribute('aria-hidden', 'true');
  frame.title = 'Report print page';
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0';
  frame.onload = () => {
    frame.contentWindow?.addEventListener('afterprint', () => frame.remove());
    setTimeout(() => frame.remove(), 300_000);
  };
  frame.srcdoc = html;
  document.body.appendChild(frame);
  return 'inline';
}
