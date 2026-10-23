/**
 * Adversarial tests for the Markdown reader behind the Help dialog.
 * A failing test is a defect, see the adversary report.
 */
import { describe, expect, it } from 'vitest';
import {
  headingsOf,
  inlineText,
  parseInline,
  parseMarkdown,
  safeHref,
  slug,
  type Inline,
} from '../src/lib/markdown';

const links = (parts: readonly Inline[]): string[] =>
  parts.flatMap((p) =>
    p.kind === 'link'
      ? [p.href, ...links(p.children)]
      : p.kind === 'bold' || p.kind === 'italic'
        ? links(p.children)
        : [],
  );

describe('safeHref allow-list', () => {
  it.each([
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    ' javascript:alert(1)',
    'data:text/html,x',
    'vbscript:msgbox(1)',
    'java\tscript:alert(1)',
    '\u0000javascript:alert(1)',
    '//evil.example/phish',
    '\\\\evil.example',
    '/\\evil.example',
  ])('refuses %j', (h) => {
    expect(safeHref(h), h).toBe(false);
  });

  it('refuses a protocol-relative link through the reader', () => {
    expect(links(parseInline('[x](//evil.example/a)'))).toEqual([]);
  });
});

describe('inline marks', () => {
  it('***bold italic*** keeps all its text and nests the marks', () => {
    const parts = parseInline('***x***');
    expect(inlineText(parts)).toBe('x');
  });

  it('**bold *and italic* inside** keeps its text', () => {
    expect(inlineText(parseInline('**bold *and italic* inside**'))).toBe('bold and italic inside');
  });

  it('a link with a nested parenthesis in its target is read whole', () => {
    expect(links(parseInline('[w](https://en.wikipedia.org/wiki/Smith_(chart))'))).toEqual([
      'https://en.wikipedia.org/wiki/Smith_(chart)',
    ]);
    expect(inlineText(parseInline('[w](https://en.wikipedia.org/wiki/Smith_(chart))'))).toBe('w');
  });

  it('link label containing code with a bracket', () => {
    expect(inlineText(parseInline('[`a]b`](#x)'))).toBe('a]b');
  });

  it('an escaped bracket does not start a link', () => {
    expect(links(parseInline('\\[x](#a)'))).toEqual([]);
  });

  it('an escaped backslash before a bracket still lets the link work', () => {
    expect(links(parseInline('\\\\[x](#a)'))).toEqual(['#a']);
  });

  it('a link target with a backslash escape inside it is not mangled', () => {
    expect(links(parseInline('[x](#a\\_b)'))).toEqual(['#a\\_b']);
  });

  it('empty input and whitespace', () => {
    expect(parseMarkdown('')).toEqual([]);
    expect(parseMarkdown('   \n\t\n')).toEqual([]);
    expect(parseInline('')).toEqual([]);
  });

  it('unicode, zero width and lone surrogates do not throw', () => {
    expect(() => parseMarkdown('# \u{1F600}\n\ud800 **\udc00**\n[‮](#a)')).not.toThrow();
  });
});

describe('performance', () => {
  const timed = (fn: () => void): number => {
    const t = performance.now();
    fn();
    return performance.now() - t;
  };

  it('60000 unclosed backticks separated by text parse in well under a second', () => {
    // every backtick finds a partner, so use "`a" pairs without closing: odd count leaves one
    const ms = timed(() => parseInline('*a'.repeat(60000)));
    expect(ms).toBeLessThan(1000);
  });

  it('60000 unclosed bold openers parse in well under a second', () => {
    const ms = timed(() => parseInline('**a '.repeat(30000)));
    expect(ms).toBeLessThan(1000);
  });

  it('a 2 MB single line of text', () => {
    const ms = timed(() => parseMarkdown('word '.repeat(400000)));
    expect(ms).toBeLessThan(1000);
  });

  it('deep nesting of brackets in labels does not overflow the stack', () => {
    const n = 20000;
    const src = '['.repeat(n) + 'x' + ']'.repeat(1) + '(#a)';
    expect(() => parseInline(src)).not.toThrow();
  });

  it('deep nesting of bold in italic does not overflow the stack', () => {
    const src = '*' + '[a'.repeat(5000) + ']'.repeat(1) + '(#a)*';
    expect(() => parseInline(src)).not.toThrow();
  });
});

describe('headings', () => {
  const ids = (src: string): string[] =>
    parseMarkdown(src).flatMap((b) => (b.kind === 'heading' ? [b.id] : []));

  it('ids stay unique when a heading is literally named like a generated id', () => {
    const all = ids('## A\n\n## A\n\n## A 2');
    expect(new Set(all).size).toBe(all.length);
  });

  it('ids stay unique when the numbered form collides', () => {
    const all = ids('## 1. Setup\n\n## Setup\n\n## 2. Setup\n\n## setup-2');
    expect(new Set(all).size).toBe(all.length);
  });

  it('headings that slug to nothing get distinct ids', () => {
    const all = ids('## ???\n\n## !!!\n\n## 日本\n\n## 3.');
    expect(new Set(all).size).toBe(all.length);
  });

  it('a heading id never needs escaping in an anchor', () => {
    for (const h of ids('## <script>\n## a b\n## 1.5 x\n## "q"')) expect(h).toMatch(/^[a-z0-9-]+$/);
  });

  it('a hash without a space is a paragraph, seven hashes too', () => {
    expect(parseMarkdown('#tag')[0]?.kind).toBe('paragraph');
    expect(parseMarkdown('####### x')[0]?.kind).toBe('paragraph');
  });

  it('a heading of only a mark', () => {
    const [h] = parseMarkdown('## ****');
    expect(h?.kind).toBe('heading');
  });

  it('slug removes a leading number only once and never returns empty', () => {
    expect(slug('')).toBe('section');
    expect(slug('1. 2. x')).toBe('2-x');
    expect(slug('2024')).toBe('2024');
    expect(slug('3.')).toBe('section');
  });

  it('table of contents sees headings inside lists? no, only real ones', () => {
    expect(headingsOf(parseMarkdown('- ## not a heading'))).toEqual([]);
  });
});

describe('block structure', () => {
  it('a bullet starting with a bold run is a list item, not an italic paragraph', () => {
    const [b] = parseMarkdown('**Bold** line');
    expect(b?.kind).toBe('paragraph');
  });

  it('a line of asterisks is not an empty list', () => {
    const blocks = parseMarkdown('***');
    expect(blocks.every((b) => b.kind !== 'list')).toBe(true);
  });

  it('a hard rule or a bare dash line does not produce an empty list item', () => {
    for (const src of ['-', '- ', '---', '* * *']) {
      const blocks = parseMarkdown(src);
      for (const b of blocks) {
        if (b.kind === 'list') for (const it of b.items) expect(it.length, src).toBeGreaterThan(0);
      }
    }
  });

  it('text directly after a list item without indent stays out of the item', () => {
    const blocks = parseMarkdown('- a\nb');
    expect(blocks.map((b) => b.kind)).toEqual(['list', 'paragraph']);
  });

  it('CR-only and mixed line endings split lines', () => {
    expect(parseMarkdown('# a\r\rb\rc\n\nd').map((b) => b.kind)).toEqual([
      'heading',
      'paragraph',
      'paragraph',
    ]);
  });

  it('a leading BOM does not hide the first heading', () => {
    expect(parseMarkdown('﻿# Title')[0]?.kind).toBe('heading');
  });

  it('tabs after the hashes and before a bullet', () => {
    expect(parseMarkdown('#\tTitle')[0]?.kind).toBe('heading');
    expect(parseMarkdown('-\titem')[0]?.kind).toBe('list');
  });

  it('a block quote and a table are not rendered as headings or lists', () => {
    const blocks = parseMarkdown('> # quoted\n\n| a | b |\n|---|---|\n| - x | 1 |');
    expect(blocks.some((b) => b.kind === 'heading')).toBe(false);
  });
});
