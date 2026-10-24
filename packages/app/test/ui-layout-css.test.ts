/**
 * Static checks of the layout rules from QA round 1 on the interaction
 * redesign. jsdom has no layout, so `scrollWidth` cannot show an overflow;
 * these read the rules in index.css that keep the page inside the screen.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(__dirname, '../src/index.css'), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
);

/** The declarations of every top-level rule whose selector list contains `selector` exactly. */
function rule(selector: string): string {
  const out: string[] = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = m[1]!.split(',').map((s) => s.trim().replace(/\s+/g, ' '));
    if (selectors.includes(selector)) out.push(m[2]!);
  }
  return out.join(';').replace(/\s+/g, ' ');
}

describe('phone 390 px: the chart toolbar never widens the page', () => {
  it('the toolbar is bounded by the chart area and stacks the legend under the controls', () => {
    const toolbar = rule('.toolbar');
    expect(toolbar).toMatch(/max-width: calc\(100% - 28px\)/);
    expect(toolbar).toMatch(/flex-direction: column/);
    expect(rule('.toolbar-row')).toMatch(/flex-wrap: wrap/);
  });

  it('the legend wraps its entries and stays inside the toolbar', () => {
    const legend = rule('.chart-legend');
    expect(legend).toMatch(/flex-wrap: wrap/);
    expect(legend).toMatch(/max-width: 100%/);
    expect(legend).not.toMatch(/margin-left/);
  });
});

describe('1024 x 768: narrow asides wrap instead of clipping or squeezing', () => {
  it('the palette fills at most four columns of at least 56 px', () => {
    expect(rule('.palette')).toMatch(
      /grid-template-columns: repeat\(auto-fill, minmax\(max\(56px, calc\(\(100% - 18px\) \/ 4\)\), 1fr\)\)/,
    );
  });

  it('datapoint fields keep their digits width and wrap (no flex: 1 1 0 on them)', () => {
    expect(rule('.datapoints-card .dp-add .ui-field')).toMatch(/flex: 1 0 auto/);
    expect(rule('.datapoints-card .dp-fields .ui-field')).toMatch(/flex: 1 0 auto/);
    expect(rule('.datapoints-card .dp-fields')).toMatch(/flex-wrap: wrap/);
    expect(css).not.toMatch(/\.dp-add \.ui-field[^{]*\{[^}]*flex: 1 1 0/);
  });
});

describe('controls', () => {
  it('a wrapping segmented control is a grid of equal columns', () => {
    const wrap = rule('.segmented.wrap');
    expect(wrap).toMatch(/display: grid/);
    expect(wrap).toMatch(/repeat\(auto-fit, minmax\(/);
  });

  it('table rows are 24 px on a fine pointer', () => {
    expect(rule('.dp-table tbody tr')).toMatch(/height: 24px/);
  });

  it('selects, loose value inputs and small segments get the 22 px floor', () => {
    expect(rule('select')).toMatch(/min-height: var\(--control-h-sm\)/);
    expect(rule('.value-input:not(.in-field)')).toMatch(/min-height: var\(--control-h-sm\)/);
    expect(rule('.segmented.sm .segmented-option')).toMatch(/min-height: var\(--control-h-sm\)/);
    expect(rule('.chip button')).toMatch(/min-height: var\(--control-h-sm\)/);
  });

  it('the field ring sits on the box through :focus-within, not :has()', () => {
    expect(rule('.ui-field-box:focus-within')).toMatch(/outline: 2px solid var\(--focus-ring\)/);
    expect(css).not.toMatch(/\.ui-field-box:has\(\.value-input:focus-visible\)/);
  });

  it('only the help text, a scroll region, keeps outline: none outside the field box', () => {
    const rules = [...css.matchAll(/([^{}]+)\{([^{}]*outline: none[^{}]*)\}/g)].map((m) =>
      m[1]!.trim().replace(/\s+/g, ' '),
    );
    for (const sel of rules) expect(sel, sel).toMatch(/help-body|\.ui-field-box/);
  });
});
