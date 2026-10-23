import { resolvedSvgClone, withLightTheme } from './export';

/** Side of the copied image in pixels. */
const PNG_SIZE = 1600;

/** The chart as a PNG blob: its SVG with colours resolved under the light theme, drawn on a white canvas. */
export async function chartPng(svg: SVGSVGElement, size = PNG_SIZE): Promise<Blob> {
  const clone = withLightTheme(() => resolvedSvgClone(svg));
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', String(size));
  clone.setAttribute('height', String(size));
  for (const a of ['style', 'x', 'y']) clone.removeAttribute(a);
  const markup = new XMLSerializer().serializeToString(clone);
  const url = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('The browser gave no canvas to draw on');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size, size);
    ctx.drawImage(img, 0, 0, size, size);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('The canvas gave no image'))),
        'image/png',
      ),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Put the chart on the clipboard as a PNG image. Rejects with a readable reason. */
export async function copyChartImage(svg: SVGSVGElement): Promise<void> {
  if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) {
    throw new Error('this browser cannot copy images (use Chart as SVG instead)');
  }
  // The item takes the promise so the click's permission is still valid when the image is ready.
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': chartPng(svg) })]);
}

/** Put text on the clipboard. Rejects with a readable reason. */
export async function copyText(text: string): Promise<void> {
  if (!navigator.clipboard?.writeText) {
    throw new Error('this page has no clipboard access (it needs https or localhost)');
  }
  await navigator.clipboard.writeText(text);
}

/** The reason of a failed copy for the status line. */
export function copyFailure(err: unknown): string {
  const reason = err instanceof Error ? err.message : String(err);
  return /denied|NotAllowed/i.test(reason)
    ? 'the browser refused clipboard access; allow it for this site and try again'
    : reason;
}
