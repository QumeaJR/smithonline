import {
  bomCsv,
  bomRows,
  type Element,
  type LadderResult,
  type Realization,
} from '@smithonline/core';
import { datapointLabel } from './format';

function download(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Run `fn` with the light theme forced on the document, so computed colours
 * read inside it are the ones for paper; the previous theme is put back.
 */
export function withLightTheme<T>(fn: () => T): T {
  const root = document.documentElement;
  const previous = root.getAttribute('data-theme');
  root.setAttribute('data-theme', 'light');
  try {
    return fn();
  } finally {
    if (previous === null) root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', previous);
  }
}

/** A copy of the SVG with its CSS colours and fonts written as attributes, so it renders anywhere. */
export function resolvedSvgClone(svg: SVGSVGElement): SVGSVGElement {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const sources = svg.querySelectorAll<SVGElement>('*');
  const targets = clone.querySelectorAll<SVGElement>('*');
  const PROPS = [
    'fill',
    'stroke',
    'stroke-width',
    'stroke-dasharray',
    'opacity',
    'font-family',
    'font-size',
    'font-weight',
    // Label halos are a stroke painted under the glyphs; without this the stroke covers them.
    'paint-order',
    'stroke-linejoin',
  ];
  sources.forEach((src, i) => {
    const dst = targets[i];
    if (!dst) return;
    const cs = getComputedStyle(src);
    for (const p of PROPS) {
      const v = cs.getPropertyValue(p);
      if (v && v !== 'none' && !dst.hasAttribute(p)) dst.setAttribute(p, v);
      if (p === 'fill' && v === 'none') dst.setAttribute('fill', 'none');
    }
    dst.removeAttribute('class');
    dst.removeAttribute('style');
  });
  clone.removeAttribute('class');
  return clone;
}

/** Serialize the chart with its CSS colours resolved, so the file renders anywhere. */
export function exportSvg(svg: SVGSVGElement, name: string): void {
  const clone = resolvedSvgClone(svg);
  clone.setAttribute('width', '800');
  clone.setAttribute('height', '800');
  const text = `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(clone)}`;
  download(`${name}.svg`, new Blob([text], { type: 'image/svg+xml' }));
}

/** Pixels per SVG unit of the PNG export: the 800 unit chart becomes 1600 pixels. */
export const PNG_SCALE = 2;

/**
 * Render the chart as a PNG at twice the size of the SVG export, drawn on a
 * white page in the light theme (as the report does), so it can be pasted
 * into a document or a chat without a viewer for SVG.
 */
export async function exportPng(
  svg: SVGSVGElement,
  name: string,
  scale: number = PNG_SCALE,
): Promise<void> {
  const clone = withLightTheme(() => resolvedSvgClone(svg));
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', '800');
  clone.setAttribute('height', '800');
  const url = URL.createObjectURL(
    new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml' }),
  );
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(800 * scale);
    canvas.height = Math.round(800 * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas is not available');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!png) throw new Error('the browser could not encode the image');
    download(`${name}.png`, png);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Datapoints as CSV, with the original's column spirit: label, R, X, |Gamma|, angle, VSWR, RL, Q. */
export function exportCsv(result: LadderResult, name: string): void {
  const rows = [
    [
      'Point',
      'R[Ohm]',
      'X[Ohm]',
      '|Gamma|',
      'Gamma angle[deg]',
      'VSWR',
      'RL[dB]',
      'Q',
      'Frequency[Hz]',
    ],
  ];
  result.datapoints.forEach((z, i) => {
    const info = result.info[i];
    if (!info) return;
    rows.push([
      datapointLabel(i),
      z.re.toPrecision(10),
      z.im.toPrecision(10),
      info.gammaMag.toPrecision(8),
      info.gammaAngleDeg.toPrecision(8),
      String(info.vswr),
      String(info.returnLossDb),
      String(info.q),
      String(result.frequency),
    ]);
  });
  const text = rows.map((r) => r.join(';')).join('\n');
  download(`${name}.csv`, new Blob([text], { type: 'text/csv' }));
}

export function exportJson(value: unknown, name: string): void {
  download(
    `${name}.json`,
    new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }),
  );
}

/** Download plain text under the given file name. */
export function exportText(fileName: string, text: string, type = 'text/plain'): void {
  download(fileName, new Blob([text], { type }));
}

/** Bill of materials of the realized network as CSV, one row per part. */
export function exportBom(
  realization: Realization,
  name: string,
  nameOf: (el: Element, index: number) => string,
): void {
  download(
    `${name}_bom.csv`,
    new Blob([bomCsv(bomRows(realization, nameOf))], { type: 'text/csv' }),
  );
}
