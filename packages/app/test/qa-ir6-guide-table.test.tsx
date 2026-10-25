// @vitest-environment jsdom
/**
 * QA, redesign phase 5: the Markdown pipe table (lib/markdown.ts), its
 * rendering in the Help dialog (components/HelpDialog.tsx), and the guide's
 * chart gestures table (docs/06-user-guide.md section 3) against the
 * constants of chart/gestures.ts and the spec (docs/07 section 6).
 */
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  COARSE_MARKER_PX,
  HALF_MAX,
  HALF_MIN,
  HIT_RADIUS_PX,
  LONG_PRESS_MS,
  LONG_PRESS_SLOP,
} from '../src/chart/gestures';
import { HelpDialog } from '../src/components/HelpDialog';
import { GUIDE, GUIDE_SOURCE } from '../src/lib/guide';
import { inlineText, parseMarkdown, type Block } from '../src/lib/markdown';

const tableOf = (src: string): Extract<Block, { kind: 'table' }> | undefined =>
  parseMarkdown(src).find((b): b is Extract<Block, { kind: 'table' }> => b.kind === 'table');
const cells = (t: Extract<Block, { kind: 'table' }>): string[][] =>
  t.rows.map((r) => r.map((c) => inlineText(c)));

describe('pipe table parsing', () => {
  it('pads a short row to the header width and keeps the cells past it (no text is lost)', () => {
    // Corrected in the phase 5 QA fixes: the reader keeps a long row's extra cells (the
    // adversarial ragged-row case asks that no text is dropped silently).
    const t = tableOf('| A | B | C |\n|---|---|---|\n| 1 |\n| 1 | 2 | 3 | 4 |');
    expect(t && cells(t)).toEqual([
      ['1', '', ''],
      ['1', '2', '3', '4'],
    ]);
  });

  it('reads alignment colons and a rule without blanks', () => {
    expect(tableOf('| A | B | C |\n|:---|:---:|---:|\n| x | y | z |')?.rows).toHaveLength(1);
    expect(tableOf('|A|B|\n|-|-|\n|x|y|')?.head.map((c) => inlineText(c))).toEqual(['A', 'B']);
  });

  it('a header and rule without rows is a table with no rows', () => {
    const t = tableOf('| A | B |\n|---|---|');
    expect(t?.rows).toEqual([]);
  });

  it('CRLF line endings and a table at the end of the text without a blank line', () => {
    const t = tableOf('Intro\r\n| A | B |\r\n|---|---|\r\n| 1 | 2 |');
    expect(t && cells(t)).toEqual([['1', '2']]);
    expect(parseMarkdown('Intro\r\n| A | B |\r\n|---|---|\r\n| 1 | 2 |')[0]?.kind).toBe(
      'paragraph',
    );
  });

  it('a lone pipe is text, and pipe lines indented under a list item continue the item', () => {
    expect(parseMarkdown('|')[0]?.kind).toBe('paragraph');
    const blocks = parseMarkdown('- item\n  | A | B |\n  |---|---|');
    expect(blocks.map((b) => b.kind)).toEqual(['list']);
  });

  it('an escaped pipe in a cell is a literal pipe, not a cell boundary', () => {
    // GitHub's pipe tables: "\|" inside a cell is a "|" in the text.
    const t = tableOf('| Key | Meaning |\n|---|---|\n| a \\| b | either |');
    expect(t && cells(t)).toEqual([['a | b', 'either']]);
  });
});

describe('the Help dialog renders the gestures table', () => {
  beforeEach(() => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('a table with column headers Gesture, Mouse, Touch and nine rows of three cells', () => {
    render(<HelpDialog onClose={() => undefined} />);
    const tables = document.querySelectorAll('.help-body .table-scroll.help-table > table');
    expect(tables).toHaveLength(1);
    const table = tables[0] as HTMLTableElement;
    const heads = [...table.querySelectorAll('thead th')];
    expect(heads.map((h) => h.textContent)).toEqual(['Gesture', 'Mouse', 'Touch']);
    expect(heads.every((h) => h.getAttribute('scope') === 'col')).toBe(true);
    const rows = [...table.querySelectorAll('tbody tr')];
    expect(rows.map((r) => r.querySelector('td')?.textContent)).toEqual([
      'Pan',
      'Zoom',
      'Fit',
      'Readout',
      'Drag a point',
      'Place an armed part',
      'Suggestions',
      'Context menu',
      'Select a point',
    ]);
    expect(rows.every((r) => r.querySelectorAll('td').length === 3)).toBe(true);
  });

  it('no raw pipe row is left in the rendered guide', () => {
    render(<HelpDialog onClose={() => undefined} />);
    const paragraphs = [...document.querySelectorAll('.help-body p, .help-body li')];
    expect(paragraphs.filter((p) => /^\s*\|/.test(p.textContent ?? ''))).toEqual([]);
  });
});

describe('the guide gestures table is true to the code', () => {
  const table = GUIDE.find((b): b is Extract<Block, { kind: 'table' }> => b.kind === 'table');
  const row = (name: string): string[] => {
    const r = table?.rows.find((x) => inlineText(x[0] ?? []) === name);
    return r ? r.map((c) => inlineText(c)) : [];
  };

  it('the long press time, its slop, the halo and the marker size match the constants', () => {
    expect(row('Context menu')[2]).toContain(`long press (${LONG_PRESS_MS} ms)`);
    expect(row('Drag a point')[2]).toContain(`within ${HIT_RADIUS_PX} px`);
    expect(GUIDE_SOURCE).toContain(`moving more than ${LONG_PRESS_SLOP} px`);
    expect(GUIDE_SOURCE).toContain(`markers are ${COARSE_MARKER_PX} px across`);
    expect(GUIDE_SOURCE).toContain(`from ${HALF_MIN} to ${HALF_MAX}`);
  });

  it('every row of the spec table (docs/07 section 6) has a row in the guide', () => {
    for (const name of [
      'Pan',
      'Zoom',
      'Fit',
      'Readout',
      'Drag a point',
      'Place an armed part',
      'Suggestions',
      'Context menu',
    ]) {
      expect(row(name), name).toHaveLength(3);
    }
    expect(row('Select a point')).toHaveLength(3);
  });

  it('the touch suggestions are on a marker only, empty chart through the menu', () => {
    expect(row('Suggestions')[2]).toMatch(/double tap a marker/);
    expect(row('Suggestions')[2]).toMatch(/Suggest a match to here/);
  });
});
