// @vitest-environment jsdom
/**
 * Redesign phase 7, cleanup: no removed alias is referenced anywhere in src/, the duplicated
 * rules are one, the small button has one class, the PNG export and the report still render
 * on white in dark mode, and the web app manifest is valid with its icons in place.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { exportPng, PNG_SCALE } from '../src/lib/export';
import { svgPiece } from '../src/lib/report';

const root = resolve(__dirname, '..');
const read = (p: string): string => readFileSync(join(root, p), 'utf8');

/** Every source file under src/ with its text. */
function sources(dir = 'src'): { readonly path: string; readonly text: string }[] {
  const out: { path: string; text: string }[] = [];
  for (const name of readdirSync(join(root, dir))) {
    const p = `${dir}/${name}`;
    if (statSync(join(root, p)).isDirectory()) out.push(...sources(p));
    else if (/\.(tsx?|css)$/.test(name)) out.push({ path: p, text: read(p) });
  }
  return out;
}

const ALIASES = ['bg', 'panel', 'border', 'text', 'muted', 'font', 'mono'];

describe('the token aliases are gone', () => {
  const files = sources();

  it('reads the whole source tree', () => {
    expect(files.some((f) => f.path === 'src/index.css')).toBe(true);
    expect(files.length).toBeGreaterThan(100);
  });

  it.each(ALIASES)('--%s is neither declared nor used in src/', (name) => {
    // The name alone: --panel-h, --text-primary and --font-mono are other tokens.
    const use = new RegExp(`var\\(--${name}[,)]`);
    const decl = new RegExp(`(^|[\\s{;])--${name}\\s*:`, 'm');
    const byName = new RegExp(`['"]--${name}['"]`);
    for (const f of files) {
      expect(use.test(f.text), `${f.path} uses var(--${name})`).toBe(false);
      expect(decl.test(f.text), `${f.path} declares --${name}`).toBe(false);
      expect(byName.test(f.text), `${f.path} reads --${name} by name`).toBe(false);
    }
  });

  it('the chart colour primitives are still declared by name on the light root', () => {
    const css = read('src/index.css');
    const light = /:root \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? '';
    for (const name of [
      'grid-z',
      'grid-y',
      'marker',
      'sweep',
      'vswr',
      'q',
      'stab',
      'gain',
      'noise',
      'mc-cloud',
    ]) {
      expect(light, name).toMatch(new RegExp(`--${name}: #[0-9a-f]{6};`));
    }
  });

  it('.btn.tiny is gone; the small button is .btn.sm', () => {
    for (const f of files) {
      expect(/\.tiny\b|btn tiny/.test(f.text), f.path).toBe(false);
    }
  });

  it('the duplicated chart rules are one rule each', () => {
    const css = read('src/index.css').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const sel of ['.chart-area', '.smith-chart', '.datapoints .dp', 'h2:has(> .toggle)']) {
      const esc = sel.replace(/[.*+?^${}()|[\]\\>]/g, '\\$&');
      const count = css.match(new RegExp(`(^|\\n)${esc} \\{`, 'g'))?.length ?? 0;
      expect(count, sel).toBe(1);
    }
    expect(css).not.toMatch(/start-hint|with-tool/);
  });
});

describe('exports stay white in dark mode', () => {
  let themes: (string | null)[] = [];
  const calls: string[] = [];
  beforeEach(() => {
    themes = [];
    calls.length = 0;
    document.documentElement.setAttribute('data-theme', 'dark');
    const real = window.getComputedStyle.bind(window);
    vi.spyOn(window, 'getComputedStyle').mockImplementation((el: Element) => {
      themes.push(document.documentElement.getAttribute('data-theme'));
      return real(el);
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    document.documentElement.removeAttribute('data-theme');
  });

  const chart = (): SVGSVGElement => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '-1.18 -1.18 2.36 2.36');
    const disk = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    disk.setAttribute('class', 'chart-disk');
    disk.setAttribute('r', '1');
    svg.appendChild(disk);
    document.body.appendChild(svg);
    return svg;
  };

  it('the PNG is drawn on white with the colours read under the light theme', async () => {
    const ctx = {
      fillStyle: '',
      fillRect: vi.fn((...rect: number[]) => calls.push(`fill ${ctx.fillStyle} ${rect.length}`)),
      drawImage: vi.fn(() => calls.push('draw')),
    };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as never);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((cb: BlobCallback) =>
      cb(new Blob(['png'], { type: 'image/png' })),
    );
    HTMLImageElement.prototype.decode = () => Promise.resolve();
    vi.stubGlobal(
      'URL',
      Object.assign(URL, { createObjectURL: () => 'blob:x', revokeObjectURL: () => undefined }),
    );
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

    await exportPng(chart(), 'chart');
    expect(calls).toEqual(['fill #ffffff 4', 'draw']);
    expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, 800 * PNG_SCALE, 800 * PNG_SCALE);
    expect(themes.length).toBeGreaterThan(0);
    expect(new Set(themes)).toEqual(new Set(['light']));
    // The dark theme is back once the colours are read.
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('the report reads the chart under the light theme and puts dark back', () => {
    const piece = svgPiece(chart());
    expect(piece.markup).toContain('<svg');
    expect(new Set(themes)).toEqual(new Set(['light']));
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('the disc and the report page are white in the light theme the exports use', () => {
    const css = read('src/index.css');
    const light = /:root \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? '';
    expect(light).toMatch(/--surface: #ffffff;/);
    expect(css).toMatch(/\.chart-disk \{\s*fill: var\(--surface\);/);
    expect(read('src/lib/report.ts')).toContain('fill="#ffffff"');
  });
});

describe('web app manifest', () => {
  const manifest = JSON.parse(read('public/manifest.webmanifest')) as {
    name: string;
    short_name: string;
    display: string;
    theme_color: string;
    background_color: string;
    start_url: string;
    icons: { src: string; sizes: string; type: string; purpose?: string }[];
  };
  const css = read('src/index.css');
  const token = (name: string): string =>
    new RegExp(`:root \\{[\\s\\S]*?--${name}: (#[0-9a-f]{6});`).exec(css)?.[1] ?? '';

  it('is valid JSON with the required fields', () => {
    expect(manifest.name).toBe('Smith Online');
    expect(manifest.short_name).toBe('Smith');
    expect(manifest.display).toBe('standalone');
    expect(manifest.start_url).toBe('/');
    expect(manifest.theme_color).toBe(token('canvas'));
    expect(manifest.background_color).toBe(token('canvas'));
  });

  it('lists 192 and 512 px PNG icons that exist and are PNGs of that size', () => {
    const sizes = manifest.icons.map((i) => i.sizes);
    expect(sizes).toEqual(expect.arrayContaining(['192x192', '512x512']));
    for (const icon of manifest.icons) {
      expect(icon.type).toBe('image/png');
      const png = readFileSync(join(root, 'public', icon.src));
      expect(png.subarray(1, 4).toString('ascii')).toBe('PNG');
      const side = Number(icon.sizes.split('x')[0]);
      expect(png.readUInt32BE(16)).toBe(side);
      expect(png.readUInt32BE(20)).toBe(side);
    }
    const apple = readFileSync(join(root, 'public', 'apple-touch-icon.png'));
    expect(apple.readUInt32BE(16)).toBe(180);
  });

  it('index.html links the manifest and the apple-touch-icon with the iOS metas', () => {
    const html = read('index.html');
    expect(html).toContain('<link rel="manifest" href="/manifest.webmanifest" />');
    expect(html).toContain('<link rel="apple-touch-icon" href="/apple-touch-icon.png" />');
    expect(html).toContain('<meta name="apple-mobile-web-app-capable" content="yes" />');
    expect(html).toMatch(
      /<meta name="apple-mobile-web-app-status-bar-style" content="[a-z-]+" \/>/,
    );
  });

  it('there is no service worker', () => {
    expect(sources().some((f) => /serviceWorker\.register/.test(f.text))).toBe(false);
  });
});
