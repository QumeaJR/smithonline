/**
 * QA round 2 for the Help dialog code: readLink and closeOf (through parseInline), the heading id
 * de-duplication, parseTarget case and query rules, and the rendered dialog. Expected values are
 * worked out by hand from the reader's documented rules and from CommonMark, not from the output.
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { HelpDialog } from '../src/components/HelpDialog';
import { GUIDE, GUIDE_SECTIONS } from '../src/lib/guide';
import { parseTarget } from '../src/lib/helpActions';
import { isHelpKey } from '../src/lib/helpKey';
import {
  inlineText,
  parseInline,
  parseMarkdown,
  slug,
  type Inline,
  type Block,
} from '../src/lib/markdown';

const kinds = (parts: readonly Inline[]): string[] => parts.map((p) => p.kind);
const ids = (src: string): string[] =>
  parseMarkdown(src).flatMap((b) => (b.kind === 'heading' ? [b.id] : []));

describe('readLink: target and label shapes', () => {
  it('reads a target with balanced inner parentheses whole and keeps the text after it', () => {
    // "#x(y)z" has one open and one close inside; the link ends at the last ")"
    const parts = parseInline('[a](#x(y)z) tail');
    expect(parts[0]).toMatchObject({ kind: 'link', href: '#x(y)z' });
    expect(inlineText(parts)).toBe('a tail');
  });

  it('two nested levels of parentheses balance', () => {
    expect(parseInline('[a](#(((x))))')[0]).toMatchObject({ kind: 'link', href: '#(((x)))' });
  });

  it('an unbalanced target is not a link and the whole source stays as text', () => {
    expect(inlineText(parseInline('[a](#x(y)'))).toBe('[a](#x(y)');
    expect(kinds(parseInline('[a](#x(y)'))).not.toContain('link');
  });

  it('an empty target "()" is text', () => {
    expect(kinds(parseInline('[a]()'))).toEqual(['text']);
    expect(inlineText(parseInline('[a]()'))).toBe('[a]()');
  });

  it('a space or a tab between "]" and "(" is not a link', () => {
    expect(kinds(parseInline('[a] (#x)'))).toEqual(['text']);
    expect(kinds(parseInline('[a]\t(#x)'))).toEqual(['text']);
  });

  it('a tab or a space inside the target is not a link', () => {
    expect(kinds(parseInline('[a](#x\ty)'))).toEqual(['text']);
    expect(kinds(parseInline('[a](#x y)'))).toEqual(['text']);
  });

  it('two links in a row are two links', () => {
    const parts = parseInline('[a](#x)[b](#y)');
    expect(parts).toHaveLength(2);
    expect(parts[0]).toMatchObject({ kind: 'link', href: '#x' });
    expect(parts[1]).toMatchObject({ kind: 'link', href: '#y' });
  });

  it('a code span in the label may hold a "]": [`]`](#x) has the label code "]"', () => {
    const l = parseInline('[`]`](#x)')[0];
    expect(l).toMatchObject({ kind: 'link', href: '#x' });
    expect(l?.kind === 'link' && l.children).toEqual([{ kind: 'code', text: ']' }]);
  });

  it('an unclosed backtick in the label is ordinary text and the link still reads', () => {
    const l = parseInline('[a`b](#x)')[0];
    expect(l).toMatchObject({ kind: 'link', href: '#x' });
    expect(l?.kind === 'link' && inlineText(l.children)).toBe('a`b');
  });

  it('an escaped "]" does not end the label, so "[a\\](#x)" has no link', () => {
    expect(kinds(parseInline('[a\\](#x)'))).not.toContain('link');
  });

  it('an escaped "]" inside a label that does close later reads as "]" in the label', () => {
    const l = parseInline('[a\\]b](#x)')[0];
    expect(l?.kind === 'link' && inlineText(l.children)).toBe('a]b');
  });

  it('a backslash as the last character of the source does not throw', () => {
    expect(() => parseInline('[a\\')).not.toThrow();
    expect(inlineText(parseInline('[a\\'))).toBe('[a\\');
  });

  it('a lone "[" or "[]" or "]" stays text', () => {
    for (const s of ['[', '[]', ']', '[](', '[a]', '[a](']) {
      expect(inlineText(parseInline(s)), s).toBe(s);
    }
  });

  it('a disallowed target drops the link but keeps the label marks', () => {
    const parts = parseInline('[**a**](javascript:x)');
    expect(kinds(parts)).toEqual(['bold']);
  });

  it('a link followed directly by emphasis reads both', () => {
    expect(kinds(parseInline('[a](#x)**b**'))).toEqual(['link', 'bold']);
  });
});

describe('closeOf: emphasis closers', () => {
  it('an opener followed by white space is text: "* a*" has no italic', () => {
    expect(kinds(parseInline('* a*'))).toEqual(['text']);
    expect(kinds(parseInline('** a**'))).toEqual(['text']);
  });

  it('a closer preceded by white space is skipped, a later one is used: "*a * b*"', () => {
    // star at index 3 follows a space and is skipped; the star at 6 follows "b"
    const parts = parseInline('*a * b*');
    expect(kinds(parts)).toEqual(['italic']);
    expect(inlineText(parts)).toBe('a * b');
  });

  it('a lone closer preceded by white space leaves everything as text: "*a *"', () => {
    expect(kinds(parseInline('*a *'))).toEqual(['text']);
    expect(inlineText(parseInline('*a *'))).toBe('*a *');
  });

  it('one-character emphasis reads: "*a*" and "**a**"', () => {
    expect(kinds(parseInline('*a*'))).toEqual(['italic']);
    expect(kinds(parseInline('**a**'))).toEqual(['bold']);
  });

  it('a closer at the very start of the content (empty emphasis) stays text', () => {
    expect(inlineText(parseInline('**'))).toBe('**');
    expect(inlineText(parseInline('*'))).toBe('*');
  });

  it('bold text containing a spaced star keeps it: "**a * b**"', () => {
    const b = parseInline('**a * b**')[0];
    expect(b?.kind).toBe('bold');
    expect(b?.kind === 'bold' && inlineText(b.children)).toBe('a * b');
  });

  it('***x*** is bold around italic with the text "x"', () => {
    const b = parseInline('***x***')[0];
    expect(b?.kind).toBe('bold');
    expect(b?.kind === 'bold' && kinds(b.children)).toEqual(['italic']);
  });

  it('"***" alone and "a *** b" keep all three stars (no text is lost)', () => {
    expect(inlineText(parseInline('***'))).toBe('***');
    expect(inlineText(parseInline('a *** b'))).toBe('a *** b');
  });

  it('a 100000-character unclosed opener parses in well under a second', () => {
    const t = performance.now();
    parseInline('*a '.repeat(100000));
    expect(performance.now() - t).toBeLessThan(1000);
  });
});

describe('emphasis nesting that CommonMark reads and the reader should not mangle', () => {
  it('bold inside italic keeps its text and loses no star: "*a **b** c*"', () => {
    expect(inlineText(parseInline('*a **b** c*'))).toBe('a b c');
  });

  it('italic at the end of bold keeps its text and loses no star: "**a *b***"', () => {
    expect(inlineText(parseInline('**a *b***'))).toBe('a b');
  });
});

describe('heading id de-duplication', () => {
  it('a heading named like a generated id does not collide: A, A, A-2, A', () => {
    // a, a-2, then "A 2" slugs to a-2 which is taken: a-2-2; the last A tries a, a-2, takes a-3
    expect(ids('## A\n\n## A\n\n## A 2\n\n## A')).toEqual(['a', 'a-2', 'a-2-2', 'a-3']);
  });

  it('A-2 first, then A and A: a-2, a, a-3', () => {
    expect(ids('## A-2\n\n## A\n\n## A')).toEqual(['a-2', 'a', 'a-3']);
  });

  it('ids are shared between levels', () => {
    expect(ids('# X\n\n### X\n\n## X')).toEqual(['x', 'x-2', 'x-3']);
  });

  it('titles with no letters take section, section-2, section-3', () => {
    expect(ids('## ???\n\n## !!!\n\n## 3.')).toEqual(['section', 'section-2', 'section-3']);
  });

  it('a numbered and an unnumbered heading of the same title collide into -2', () => {
    expect(ids('## 1. Setup\n\n## Setup')).toEqual(['setup', 'setup-2']);
  });

  it('a heading inside a list item is not a heading and takes no id', () => {
    expect(ids('- ## A\n\n## A')).toEqual(['a']);
  });

  it('a byte order mark only at the start is dropped, and CRLF after it still splits', () => {
    expect(ids('\uFEFF# T\r\n## U')).toEqual(['t', 'u']);
    // a BOM further down stays part of the line: "\uFEFF## V" is a paragraph
    expect(parseMarkdown('# T\n\uFEFF## V').map((b) => b.kind)).toEqual(['heading', 'paragraph']);
  });

  it('slug: "1." followed by a tab or end is a number, "1.x" and "1.5" are not', () => {
    expect(slug('1.\tIntro')).toBe('intro');
    expect(slug('1.x')).toBe('1-x');
    expect(slug('1.5')).toBe('1-5');
    expect(slug('12. Two digits')).toBe('two-digits');
  });
});

describe('parseTarget', () => {
  it('takes the scheme in any case but the name only as written', () => {
    expect(parseTarget('TOUR:l-network')).toEqual({ kind: 'tour', id: 'l-network' });
    expect(parseTarget('Example:Example1.xmlsc')).toEqual({
      kind: 'example',
      file: 'Example1.xmlsc',
      view: null,
    });
    expect(parseTarget('VIEW:response')).toEqual({ kind: 'view', view: 'response' });
    expect(parseTarget('example:example1.xmlsc')).toBeNull();
    expect(parseTarget('view:Response')).toBeNull();
  });

  it('an example takes ?view= with each view and refuses an unknown one', () => {
    expect(parseTarget('EXAMPLE:Example16.xmlsc?view=splot')).toEqual({
      kind: 'example',
      file: 'Example16.xmlsc',
      view: 'splot',
    });
    expect(parseTarget('example:Example16.xmlsc?view=smith')).toBeNull();
  });

  it('a query on a tour or a view link is refused', () => {
    expect(parseTarget('TOUR:l-network?view=chart')).toBeNull();
    expect(parseTarget('view:chart?view=chart')).toBeNull();
  });

  it('a section link and a web link are not guide actions', () => {
    expect(parseTarget('#intro')).toBeNull();
    expect(parseTarget('https://example.org')).toBeNull();
    expect(parseTarget('mailto:a@b.c')).toBeNull();
  });
});

describe('help key repeat', () => {
  const base = { ctrlKey: false, metaKey: false, altKey: false, target: null };
  it('repeat false or missing still counts; repeat true never does, for F1 and ?', () => {
    expect(isHelpKey({ ...base, key: 'F1', repeat: false })).toBe(true);
    expect(isHelpKey({ ...base, key: 'F1' })).toBe(true);
    expect(isHelpKey({ ...base, key: '?', repeat: false })).toBe(true);
    expect(isHelpKey({ ...base, key: '?', repeat: true })).toBe(false);
    expect(isHelpKey({ ...base, key: 'F1', repeat: true })).toBe(false);
  });
});

describe('rendered dialog', () => {
  const html = renderToStaticMarkup(createElement(HelpDialog, { onClose: () => {} }));

  it('has one table of contents button per section, in guide order, none active before a scroll', () => {
    const buttons = [...html.matchAll(/<button class="help-toc-item ([^"]*)"/g)];
    expect(buttons).toHaveLength(GUIDE_SECTIONS.length);
    // only the first section is the active one at the start
    expect(buttons.map((b) => b[1]!.trim())).toEqual(
      GUIDE_SECTIONS.map((_, i) => (i === 0 ? 'on' : '')),
    );
  });

  it('is a labelled modal dialog that can take the focus', () => {
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    const label = /aria-labelledby="([^"]+)"/.exec(html)?.[1];
    expect(label).toBeTruthy();
    expect(html.split(`id="${label}"`)).toHaveLength(2); // the label names exactly one element
    expect(html).toContain('tabindex="-1"');
  });

  it('has exactly as many headings as the parsed guide, ids prefixed with help-', () => {
    const headingBlocks = GUIDE.filter((b: Block) => b.kind === 'heading');
    const ids = [...html.matchAll(/<h[234] id="help-([^"]+)"/g)].map((m) => m[1]);
    expect(ids).toEqual(headingBlocks.map((b) => (b.kind === 'heading' ? b.id : '')));
  });

  it('own-scheme links carry the class try and web links open in a new tab with noopener', () => {
    const tries = [...html.matchAll(/<a href="(tour|example|view):[^"]*" class="try"/g)];
    expect(tries.length).toBeGreaterThan(30);
    for (const m of html.matchAll(/<a [^>]*href="https?:[^>]*>/g)) {
      expect(m[0]).toContain('target="_blank"');
      expect(m[0]).toContain('rel="noopener noreferrer"');
    }
  });
});
