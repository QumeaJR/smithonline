// Generates the SmithChart.Online brand assets in packages/app/public: the mark, the adaptive
// favicon, the horizontal logos with the wordmark as outlines, and the PNG app icons.
//
// The mark is a Smith chart with a real L-network match: the load z = 0.15 + j0.35 moves along
// its constant-resistance circle (a series capacitor) to the unit-conductance circle, then along
// that circle (a shunt inductor) into the centre, the matched point. Both arcs are exact.
//
// Needs opentype.js and @fontsource/inter (SIL Open Font License 1.1).
// Install the first two anywhere and point BRAND_TOOLS at that folder:
//   npm install opentype.js@1.3.4 @fontsource/inter@5.1.0   (in a scratch folder)
//   BRAND_TOOLS=<that folder>/node_modules node scripts/brand.mjs
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ARC1,
  ARC2,
  C,
  DOT_R,
  GRADIENT,
  GRID_W,
  LIGHT,
  MX,
  MY,
  R,
  RING_W,
  SX,
  SY,
  TRACE_W,
} from './icons.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const tools = process.env.BRAND_TOOLS;
if (!tools)
  throw new Error(
    'Set BRAND_TOOLS to a node_modules folder with opentype.js and @fontsource/inter',
  );
const toolRequire = createRequire(join(tools, 'x.js'));
const opentype = toolRequire('opentype.js');

const pub = join(root, 'packages', 'app', 'public');
const brandDir = join(pub, 'brand');
mkdirSync(brandDir, { recursive: true });

/* ------------------------------------------------------------ geometry */

// Chart centre C and radius R in a 128 box, the load SX, SY, the turn MX, MY and the two arcs,
// shared with the PNG icons.
const f = (v) => +v.toFixed(2);

// Series C: along the r circle down the left side (screen counter-clockwise, sweep 0); shunt L:
// along the g = 1 circle (centre at gamma -0.5, radius R / 2) into the centre (sweep 0).
const trace = `M${f(SX)} ${f(SY)} A${f(ARC1.r)} ${f(ARC1.r)} 0 0 0 ${f(MX)} ${f(MY)} A${ARC2.r} ${ARC2.r} 0 0 0 ${C} ${C}`;

// Constant-resistance circles (r) and reactance arcs (x) of the grid.
const rCircles = (rs) =>
  rs
    .map((r) => `<circle cx="${f(C + R * (r / (1 + r)))}" cy="${C}" r="${f(R / (1 + r))}"/>`)
    .join('');
const xArcs = (xs) =>
  xs
    .flatMap((x) => [
      `<circle cx="${C + R}" cy="${f(C - R / x)}" r="${f(R / x)}"/>`,
      `<circle cx="${C + R}" cy="${f(C + R / x)}" r="${f(R / x)}"/>`,
    ])
    .join('');

const THEMES = {
  light: {
    ...LIGHT,
    word: '#172D41',
    tld: '#47718A',
  },
  dark: {
    ring: '#87E5F5',
    grid: '#5B8DAA',
    gridOpacity: 0.47,
    dotEdge: '#071824',
    word: '#EFF8FF',
    tld: '#A4C6D6',
  },
};

/** The mark in a 128 box. `id` keeps ids unique when several marks share a page. */
function mark(theme, id, { detail = 'full', traceWidth = 6.2 } = {}) {
  const t = THEMES[theme];
  const grid =
    detail === 'full'
      ? `<path d="M${C - R} ${C} H${C + R}"/>${rCircles([0.5, 1, 2, 5])}${xArcs([0.5, 1, 2])}`
      : `<path d="M${C - R} ${C} H${C + R}"/>${rCircles([1])}${xArcs([1])}`;
  return (
    `<defs><clipPath id="${id}c"><circle cx="${C}" cy="${C}" r="${R}"/></clipPath>` +
    `<linearGradient id="${id}g" x1="22" y1="28" x2="112" y2="104" gradientUnits="userSpaceOnUse">` +
    GRADIENT.map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`).join('') +
    `</linearGradient></defs>` +
    `<circle cx="${C}" cy="${C}" r="${R}" fill="none" stroke="${t.ring}" stroke-width="${detail === 'full' ? 2.8 : RING_W}"/>` +
    `<g clip-path="url(#${id}c)" fill="none" stroke="${t.grid}" stroke-width="${detail === 'full' ? 1.35 : GRID_W}" opacity="${t.gridOpacity}">${grid}</g>` +
    `<path d="${trace}" fill="none" stroke="url(#${id}g)" stroke-width="${traceWidth}" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<circle cx="${f(SX)}" cy="${f(SY)}" r="${detail === 'full' ? 5.5 : DOT_R}" fill="${GRADIENT[0][1]}" stroke="${t.dotEdge}" stroke-width="2"/>` +
    `<circle cx="${C}" cy="${C}" r="${detail === 'full' ? 4.5 : DOT_R}" fill="${GRADIENT[2][1]}" stroke="${t.dotEdge}" stroke-width="2"/>`
  );
}

const TITLE = 'SmithChart.Online';
const svg = (w, h, body, label) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${label}"><title>${TITLE}</title>${body}</svg>\n`;

/* ------------------------------------------------------------ wordmark */

const fontPath = join(tools, '@fontsource', 'inter', 'files', 'inter-latin-600-normal.woff');
const fontBytes = readFileSync(fontPath);
const font = opentype.parse(
  fontBytes.buffer.slice(fontBytes.byteOffset, fontBytes.byteOffset + fontBytes.byteLength),
);
/** Outlines of `text` at `size`, starting at x, baseline y, with letter spacing in px. */
function outline(text, x, y, size, spacing) {
  let cursor = x;
  let d = '';
  for (const glyph of font.stringToGlyphs(text)) {
    d += glyph.getPath(cursor, y, size).toPathData(2);
    cursor += (glyph.advanceWidth / font.unitsPerEm) * size + spacing;
  }
  return { d, end: cursor - spacing };
}
const word = outline('SmithChart', 143, 80, 44, -1.2);
const tld = outline('.Online', word.end + 1, 80, 44, -1.2);
const logoWidth = Math.ceil(tld.end + 14);

/* ------------------------------------------------------------ files */

const write = (name, text) => {
  writeFileSync(join(pub, name), text);
  console.log('wrote', name);
};

for (const theme of ['light', 'dark']) {
  const t = THEMES[theme];
  write(`brand/mark-${theme}.svg`, svg(128, 128, mark(theme, `m${theme}`), `${TITLE} mark`));
  write(
    `brand/logo-horizontal-${theme}.svg`,
    svg(
      logoWidth,
      128,
      mark(theme, `l${theme}`) +
        `<path d="${word.d}" fill="${t.word}"/><path d="${tld.d}" fill="${t.tld}"/>`,
      `${TITLE} logo`,
    ),
  );
}

// The favicon: the simple mark (thick enough for 16 to 32 px), light or dark by the browser.
const favicon =
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><title>${TITLE}</title>` +
  `<style>.d{display:none}@media (prefers-color-scheme: dark){.l{display:none}.d{display:inline}}</style>` +
  `<g class="l">${mark('light', 'fl', { detail: 'simple', traceWidth: TRACE_W })}</g>` +
  `<g class="d">${mark('dark', 'fd', { detail: 'simple', traceWidth: TRACE_W })}</g></svg>\n`;
write('favicon.svg', favicon);

// The PNG app icons come from scripts/icons.mjs (no rasterizer needed, the same bytes every run).
