import type { LadderResult } from '@smithonline/core';
import { datapointLabel } from './format';

function download(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Serialize the chart with its CSS colours resolved, so the file renders anywhere. */
export function exportSvg(svg: SVGSVGElement, name: string): void {
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
  clone.setAttribute('width', '800');
  clone.setAttribute('height', '800');
  const text = `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(clone)}`;
  download(`${name}.svg`, new Blob([text], { type: 'image/svg+xml' }));
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
