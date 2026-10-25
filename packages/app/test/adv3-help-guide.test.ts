/**
 * Round 3: the bundled guide still renders cleanly under the rewritten reader.
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { HelpDialog } from '../src/components/HelpDialog';
import { GUIDE, GUIDE_SOURCE, INDEX_SOURCE } from '../src/lib/guide';
import { inlineText, parseMarkdown, type Block, type Inline } from '../src/lib/markdown';

const BS = String.fromCharCode(92);
const walk = (parts: readonly Inline[]): Inline[] =>
  parts.flatMap((p) =>
    p.kind === 'bold' || p.kind === 'italic' || p.kind === 'link' ? [p, ...walk(p.children)] : [p],
  );
const inlines = (blocks: readonly Block[]): Inline[] =>
  blocks.flatMap((b) =>
    b.kind === 'list'
      ? b.items.flat()
      : b.kind === 'table'
        ? [...b.head.flat(), ...b.rows.flat(2)]
        : [...b.children],
  );

describe('the bundled guide', () => {
  it('no text node holds a star, backslash, bracket pair or backtick', () => {
    for (const p of walk(inlines(GUIDE))) {
      if (p.kind === 'text') {
        expect(p.text, p.text).not.toMatch(/[*[\]`]/);
        expect(p.text.includes(BS), p.text).toBe(false);
      }
    }
  });
  it('no heading text holds a star', () => {
    for (const b of GUIDE) if (b.kind === 'heading') expect(b.text).not.toContain('*');
  });
  it('every ** pair outside code in the source became one bold node', () => {
    const src = `${GUIDE_SOURCE}\n\n${INDEX_SOURCE}`;
    // drop code spans, count ** marks; each bold node uses two
    const marks = [...src.replace(/`[^`]*`/g, '').matchAll(/\*\*/g)].length;
    const bolds = walk(inlines(GUIDE)).filter((p) => p.kind === 'bold').length;
    expect(bolds * 2).toBe(marks);
  });
  it('the guide has no italic and no *** run, so the new branches are not exercised by it', () => {
    expect(GUIDE_SOURCE).not.toMatch(/\*\*\*/);
    expect(walk(inlines(GUIDE)).filter((p) => p.kind === 'italic').length).toBe(0);
  });
  it('the longest emphasised run in the guide is far below the 64 step budget', () => {
    const lens = walk(inlines(GUIDE))
      .filter((p) => p.kind === 'bold')
      .map((p) => (p.kind === 'bold' ? inlineText(p.children).length : 0));
    expect(Math.max(...lens)).toBeLessThan(40);
  });
  it('parsing the whole guide takes under 100 ms', () => {
    const t = performance.now();
    parseMarkdown(`${GUIDE_SOURCE}\n\n${INDEX_SOURCE}`);
    expect(performance.now() - t).toBeLessThan(100);
  });
  it('the rendered dialog has no stray star in its text', () => {
    const html = renderToStaticMarkup(createElement(HelpDialog, { onClose: () => {} }));
    const text = html.replace(/<[^>]+>/g, ' ');
    expect(text).not.toContain('*');
  });
});
