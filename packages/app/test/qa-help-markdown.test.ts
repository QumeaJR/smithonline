/**
 * QA round for the in-app help, markdown reader and help keys. Expected values are
 * worked out from the reader's documented behaviour (the header comment of
 * markdown.ts) and from the Markdown rules, not taken from running the code.
 */
import { describe, expect, it } from 'vitest';
import { isHelpKey, isTextEditing } from '../src/lib/helpKey';
import {
  headingsOf,
  inlineText,
  parseInline,
  parseMarkdown,
  safeHref,
  slug,
  type Block,
  type Inline,
} from '../src/lib/markdown';

const kinds = (parts: readonly Inline[]): string[] => parts.map((p) => p.kind);

describe('markdown blocks: empty and one element', () => {
  it('reads nothing from an empty or blank source', () => {
    expect(parseMarkdown('')).toEqual([]);
    expect(parseMarkdown('\n\n   \n\t\n')).toEqual([]);
  });

  it('reads one bullet as a one-item unordered list', () => {
    const [b, ...rest] = parseMarkdown('- a');
    expect(rest).toHaveLength(0);
    expect(b?.kind === 'list' && b.ordered).toBe(false);
    expect(b?.kind === 'list' && b.items.length).toBe(1);
  });

  it('reads + bullets, and numbers ended by a closing parenthesis, as lists', () => {
    const plus = parseMarkdown('+ a\n+ b')[0];
    expect(plus?.kind === 'list' && plus.ordered).toBe(false);
    const paren = parseMarkdown('1) a\n2) b')[0];
    expect(paren?.kind === 'list' && paren.ordered).toBe(true);
    expect(paren?.kind === 'list' && paren.items.map(inlineText)).toEqual(['a', 'b']);
  });

  it('keeps a continuation over several indented lines in one item', () => {
    const b = parseMarkdown('- a\n  b\n  c')[0];
    expect(b?.kind === 'list' && b.items.map(inlineText)).toEqual(['a b c']);
  });

  it('a heading ends a list and the next bullet starts a new one', () => {
    expect(parseMarkdown('- a\n# H\n- b').map((b) => b.kind)).toEqual(['list', 'heading', 'list']);
  });

  it('an ordered list followed by a bullet is two lists, in that order', () => {
    const blocks = parseMarkdown('1. a\n- b');
    expect(blocks.map((b) => (b.kind === 'list' ? b.ordered : null))).toEqual([true, false]);
  });

  it('an indented line with no list above it is paragraph text, trimmed', () => {
    const blocks = parseMarkdown('a\n   b');
    expect(blocks).toHaveLength(1);
    const p = blocks[0] as Block;
    expect(p.kind === 'paragraph' && inlineText(p.children)).toBe('a b');
    const alone = parseMarkdown('    only')[0] as Block;
    expect(alone.kind === 'paragraph' && inlineText(alone.children)).toBe('only');
  });

  it('a line that is not indented after a list item starts a paragraph', () => {
    expect(parseMarkdown('- a\nb').map((b) => b.kind)).toEqual(['list', 'paragraph']);
  });

  it('splits on a bare CR (old Mac) as well as CRLF', () => {
    expect(parseMarkdown('# a\r# b').map((b) => b.kind)).toEqual(['heading', 'heading']);
  });
});

describe('markdown headings', () => {
  it('reads levels 1 to 6 and treats seven hashes or a missing space as text', () => {
    const levels = parseMarkdown('# a\n\n###### f')
      .filter((b) => b.kind === 'heading')
      .map((b) => (b.kind === 'heading' ? b.level : 0));
    expect(levels).toEqual([1, 6]);
    expect(parseMarkdown('####### seven')[0]?.kind).toBe('paragraph');
    expect(parseMarkdown('#nospace')[0]?.kind).toBe('paragraph');
  });

  it('takes the text and id of a heading from its inline content, marks removed', () => {
    const h = parseMarkdown('## **Bold** `code`')[0];
    expect(h?.kind).toBe('heading');
    if (h?.kind !== 'heading') return;
    expect(h.text).toBe('Bold code');
    expect(h.id).toBe('bold-code');
    expect(kinds(h.children)).toEqual(['bold', 'text', 'code']);
  });

  it('numbers repeated ids -2, -3 in document order', () => {
    const ids = parseMarkdown('## A\n## A\n## A')
      .filter((b) => b.kind === 'heading')
      .map((b) => (b.kind === 'heading' ? b.id : ''));
    expect(ids).toEqual(['a', 'a-2', 'a-3']);
  });

  it('headingsOf defaults to levels 1 and 2 and returns [] for no blocks', () => {
    const blocks = parseMarkdown('# a\n## b\n### c');
    expect(headingsOf(blocks).map((h) => h.text)).toEqual(['a', 'b']);
    expect(headingsOf([])).toEqual([]);
    expect(headingsOf(blocks, 0)).toEqual([]);
  });

  it('slug drops the section number, trims separators and falls back to "section"', () => {
    expect(slug('  Hello,  World! ')).toBe('hello-world');
    expect(slug('12.')).toBe('section');
    expect(slug('')).toBe('section');
    expect(slug('10. Settings, keyboard and examples')).toBe('settings-keyboard-and-examples');
  });

  it('slug keeps a decimal number in a title: "1.5 GHz" is "1-5-ghz", not "5-ghz"', () => {
    // Only a section number "1. " is dropped; "1.5" is a value.
    expect(slug('1.5 GHz band')).toBe('1-5-ghz-band');
  });
});

describe('markdown inline marks', () => {
  it('reads code at the very end and unclosed or empty code as text', () => {
    expect(parseInline('`a`')).toEqual([{ kind: 'code', text: 'a' }]);
    expect(parseInline('``')).toEqual([{ kind: 'text', text: '``' }]);
    expect(inlineText(parseInline('x `y'))).toBe('x `y');
  });

  it('escapes: the listed characters lose their meaning, others keep the backslash', () => {
    expect(inlineText(parseInline('\\# \\_ \\( \\)'))).toBe('# _ ( )');
    expect(inlineText(parseInline('\\q'))).toBe('\\q');
    expect(inlineText(parseInline('end\\'))).toBe('end\\');
    expect(kinds(parseInline('\\`not code`'))).toEqual(['text']);
  });

  it('a link needs a label and a target without spaces, else it stays text', () => {
    expect(kinds(parseInline('[](x)'))).toEqual(['text']);
    expect(inlineText(parseInline('[a](b'))).toBe('[a](b');
    expect(inlineText(parseInline('[a]( b)'))).toBe('[a]( b)');
    expect(inlineText(parseInline('[a](b c)'))).toBe('[a](b c)');
  });

  it('keeps links to #, mailto: and the guide actions; drops script schemes in any case', () => {
    for (const href of ['#x', 'mailto:a@b.c', 'tour:l-network']) {
      expect(parseInline(`[t](${href})`)[0], href).toMatchObject({ kind: 'link', href });
    }
    for (const href of ['javascript:x', 'JaVaScRiPt:x', 'vbscript:x', 'data:text/html,x']) {
      const parts = parseInline(`[t](${href})`);
      expect(kinds(parts), href).toEqual(['text']);
      expect(inlineText(parts), href).toBe('t');
    }
  });

  it('nests: bold in a link label, a link in bold, italic in bold', () => {
    const a = parseInline('[**a**](#x)')[0];
    expect(a?.kind === 'link' && kinds(a.children)).toEqual(['bold']);
    const b = parseInline('**[a](https://x.y)**')[0];
    expect(b?.kind === 'bold' && kinds(b.children)).toEqual(['link']);
    const c = parseInline('**a *b* c**')[0];
    expect(c?.kind === 'bold' && kinds(c.children)).toEqual(['text', 'italic', 'text']);
  });

  it('reads *a*b*c* as italic, text, italic', () => {
    expect(kinds(parseInline('*a*b*c*'))).toEqual(['italic', 'text', 'italic']);
  });

  it('a multiplication with spaces is not emphasis: "2 * 3 * 4" stays literal', () => {
    // CommonMark: an asterisk followed by white space cannot open emphasis.
    const parts = parseInline('2 * 3 * 4');
    expect(parts.some((p) => p.kind === 'italic')).toBe(false);
    expect(inlineText(parts)).toBe('2 * 3 * 4');
  });

  it('empty emphasis markers stay text', () => {
    expect(inlineText(parseInline('****'))).toBe('****');
    expect(kinds(parseInline('****'))).toEqual(['text']);
  });
});

describe('safeHref', () => {
  it('is case-insensitive, trims, and refuses other schemes', () => {
    expect(safeHref('HTTPS://x.y')).toBe(true);
    expect(safeHref('  https://x.y')).toBe(true);
    expect(safeHref('TOUR:a')).toBe(true);
    expect(safeHref('ftp://x')).toBe(false);
    expect(safeHref('http:/x')).toBe(false);
    expect(safeHref('')).toBe(false);
    expect(safeHref('x.html')).toBe(false);
  });

  it('refuses a protocol-relative target, which leaves the site', () => {
    // "//evil.example" is an absolute URL on another host; the dialog renders it without target=_blank.
    expect(safeHref('//evil.example/x')).toBe(false);
  });
});

describe('help key, branches not reached by help.test.ts', () => {
  const ev = (key: string, target: object | null = null, mods: object = {}) => ({
    key,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    target,
    ...mods,
  });

  it('F1 is refused with Meta or Alt as well as Ctrl, and allowed with Shift', () => {
    expect(isHelpKey(ev('F1', null, { metaKey: true }))).toBe(false);
    expect(isHelpKey(ev('F1', null, { altKey: true }))).toBe(false);
    expect(isHelpKey(ev('F1', null, { shiftKey: true }))).toBe(true);
  });

  it('? is refused with Meta or Alt', () => {
    expect(isHelpKey(ev('?', null, { metaKey: true }))).toBe(false);
    expect(isHelpKey(ev('?', null, { altKey: true }))).toBe(false);
  });

  it('? in every non-text input type still opens the help; in every text type it does not', () => {
    for (const type of [
      'checkbox',
      'radio',
      'range',
      'button',
      'submit',
      'file',
      'color',
      'RANGE',
    ]) {
      expect(isHelpKey(ev('?', { tagName: 'INPUT', type })), type).toBe(true);
    }
    for (const type of ['text', 'number', 'search', 'email', 'password', 'url', 'tel', 'date']) {
      expect(isHelpKey(ev('?', { tagName: 'INPUT', type })), type).toBe(false);
    }
  });

  it('isTextEditing: textarea and contenteditable, with or without a tag name', () => {
    expect(isTextEditing({ tagName: 'TEXTAREA' })).toBe(true);
    expect(isTextEditing({ isContentEditable: true })).toBe(true);
    expect(isTextEditing({})).toBe(false);
    expect(isTextEditing({ tagName: 'BUTTON' })).toBe(false);
  });

  it('a held F1 (auto-repeat) must not toggle the dialog on every repeat', () => {
    // App.tsx toggles on each keydown; the browser repeats keydown about every 30 ms while held,
    // so the dialog flickers and ends open or shut at random. isHelpKey ignores `repeat`.
    expect(isHelpKey({ ...ev('F1'), repeat: true } as never)).toBe(false);
  });
});
