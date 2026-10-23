/**
 * The in-app help: the guide loads from docs/, the small Markdown reader, the
 * store the Help button and the F1 key open the dialog through, and the tooltips.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { GUIDE, GUIDE_SECTIONS, GUIDE_SOURCE } from '../src/lib/guide';
import { isHelpKey, isTextEditing } from '../src/lib/helpKey';
import {
  headingsOf,
  inlineText,
  parseInline,
  parseMarkdown,
  safeHref,
  slug,
} from '../src/lib/markdown';
import { TIPS } from '../src/lib/tips';
import { useHelp } from '../src/store/useHelp';

afterEach(() => useHelp.getState().closeHelp());

describe('the user guide in the app', () => {
  it('is loaded from docs/06-user-guide.md and starts with its title', () => {
    expect(GUIDE_SOURCE.startsWith('# Smith Online user guide')).toBe(true);
    const first = GUIDE[0];
    expect(first?.kind === 'heading' && first.level === 1).toBe(true);
  });

  it('finds every numbered section heading of the file', () => {
    const inFile = [...GUIDE_SOURCE.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
    expect(inFile.length).toBeGreaterThanOrEqual(11);
    expect(GUIDE_SECTIONS.map((h) => h.text)).toEqual(inFile);
    expect(GUIDE_SECTIONS.map((h) => h.text)).toContain('10. Settings, keyboard and examples');
    expect(new Set(GUIDE_SECTIONS.map((h) => h.id)).size).toBe(GUIDE_SECTIONS.length);
  });

  it('names the Help entry and its keys in the settings and keyboard section', () => {
    const at = GUIDE_SOURCE.indexOf('## 10.');
    const section = GUIDE_SOURCE.slice(at, GUIDE_SOURCE.indexOf('## 11.'));
    expect(section).toMatch(/\bHelp\b/);
    expect(section).toContain('F1');
  });
});

describe('markdown reader', () => {
  it('reads headings with levels and unique ids', () => {
    const blocks = parseMarkdown('# Title\n\n## 1. Layout\n\ntext\n\n## 2. Layout\n\n### Deep');
    const hs = headingsOf(blocks, 3);
    expect(hs.map((h) => [h.level, h.text])).toEqual([
      [1, 'Title'],
      [2, '1. Layout'],
      [2, '2. Layout'],
      [3, 'Deep'],
    ]);
    expect(hs[1]?.id).toBe('layout');
    expect(hs[2]?.id).toBe('layout-2');
    expect(headingsOf(blocks, 2)).toHaveLength(3);
  });

  it('reads bullet and numbered lists, with continuation lines and a break between kinds', () => {
    const blocks = parseMarkdown('- one\n- two\n  continues\n\n1. first\n2. second\n- back');
    expect(blocks.map((b) => b.kind)).toEqual(['list', 'list', 'list']);
    const [bullets, numbered] = blocks;
    expect(bullets?.kind === 'list' && bullets.ordered).toBe(false);
    expect(bullets?.kind === 'list' && bullets.items.map(inlineText)).toEqual([
      'one',
      'two continues',
    ]);
    expect(numbered?.kind === 'list' && numbered.ordered).toBe(true);
  });

  it('joins the lines of a paragraph and splits on a blank line; accepts CRLF', () => {
    const blocks = parseMarkdown('a\r\nb\r\n\r\nc');
    expect(blocks.map((b) => (b.kind === 'paragraph' ? inlineText(b.children) : '?'))).toEqual([
      'a b',
      'c',
    ]);
  });

  it('reads inline code, bold, italic and links', () => {
    const parts = parseInline(
      'Use `3n9` and **bold** and *slanted* or [the site](https://example.com).',
    );
    expect(parts.map((p) => p.kind)).toEqual([
      'text',
      'code',
      'text',
      'bold',
      'text',
      'italic',
      'text',
      'link',
      'text',
    ]);
    expect(parts[1]).toEqual({ kind: 'code', text: '3n9' });
    const link = parts[7];
    expect(link?.kind === 'link' && link.href).toBe('https://example.com');
    expect(inlineText(parts)).toBe('Use 3n9 and bold and slanted or the site.');
  });

  it('keeps marks inside code literal and unclosed marks as text', () => {
    expect(parseInline('`**not bold**`')).toEqual([{ kind: 'code', text: '**not bold**' }]);
    expect(inlineText(parseInline('a * b and `c'))).toBe('a * b and `c');
    expect(inlineText(parseInline('2 \\* 3'))).toBe('2 * 3');
  });

  it('drops the target of a link that is not http, mailto, a section or a path', () => {
    expect(safeHref('https://example.com')).toBe(true);
    expect(safeHref('#section')).toBe(true);
    expect(safeHref('javascript:alert(1)')).toBe(false);
    expect(safeHref('data:text/html,x')).toBe(false);
    const parts = parseInline('[click](javascript:alert)');
    expect(parts.some((p) => p.kind === 'link')).toBe(false);
    expect(inlineText(parts)).toBe('click');
  });

  it('makes a slug without the section number', () => {
    expect(slug('3. Building the network')).toBe('building-the-network');
    expect(slug('***')).toBe('section');
  });

  it('reads the whole guide into headings, paragraphs and lists without leftovers', () => {
    const kinds = new Set(GUIDE.map((b) => b.kind));
    expect([...kinds].sort()).toEqual(['heading', 'list', 'paragraph']);
    const text = GUIDE.map((b) =>
      b.kind === 'list' ? b.items.map(inlineText).join('\n') : inlineText(b.children),
    ).join('\n');
    expect(text).not.toMatch(/\*\*|^#|`/m);
  });
});

describe('help dialog state', () => {
  it('opens, closes and toggles', () => {
    expect(useHelp.getState().open).toBe(false);
    useHelp.getState().openHelp();
    expect(useHelp.getState().open).toBe(true);
    useHelp.getState().closeHelp();
    expect(useHelp.getState().open).toBe(false);
    useHelp.getState().toggleHelp();
    expect(useHelp.getState().open).toBe(true);
    useHelp.getState().toggleHelp();
    expect(useHelp.getState().open).toBe(false);
  });

  it('opens at a section and forgets it on close', () => {
    useHelp.getState().openHelp('matching');
    expect(useHelp.getState()).toMatchObject({ open: true, section: 'matching' });
    expect(GUIDE_SECTIONS.map((s) => s.id)).toContain('matching');
    useHelp.getState().closeHelp();
    expect(useHelp.getState().section).toBeNull();
  });
});

describe('help keys', () => {
  const key = (k: string, target: object | null = null, mods: object = {}) => ({
    key: k,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    target,
    ...mods,
  });

  it('opens on F1 anywhere, also in a text field, but not with a modifier', () => {
    expect(isHelpKey(key('F1'))).toBe(true);
    expect(isHelpKey(key('F1', { tagName: 'INPUT', type: 'text' }))).toBe(true);
    expect(isHelpKey(key('F1', null, { ctrlKey: true }))).toBe(false);
  });

  it('opens on ? only when nothing is being typed into', () => {
    expect(isHelpKey(key('?'))).toBe(true);
    expect(isHelpKey(key('?', { tagName: 'BODY' }))).toBe(true);
    expect(isHelpKey(key('?', { tagName: 'INPUT', type: 'range' }))).toBe(true);
    expect(isHelpKey(key('?', { tagName: 'INPUT', type: 'text' }))).toBe(false);
    expect(isHelpKey(key('?', { tagName: 'INPUT' }))).toBe(false);
    expect(isHelpKey(key('?', { tagName: 'TEXTAREA' }))).toBe(false);
    expect(isHelpKey(key('?', { tagName: 'DIV', isContentEditable: true }))).toBe(false);
    expect(isHelpKey(key('?', { tagName: 'SELECT' }))).toBe(false);
    expect(isHelpKey(key('?', null, { ctrlKey: true }))).toBe(false);
    expect(isHelpKey(key('h'))).toBe(false);
  });

  it('tells text editing from other focus', () => {
    expect(isTextEditing(null)).toBe(false);
    expect(isTextEditing({ tagName: 'INPUT', type: 'checkbox' })).toBe(false);
    expect(isTextEditing({ tagName: 'INPUT', type: 'search' })).toBe(true);
  });
});

describe('tooltips', () => {
  it('are short single sentences without dashes', () => {
    for (const [name, tip] of Object.entries(TIPS)) {
      expect(tip.length, name).toBeLessThanOrEqual(130);
      expect(tip, name).not.toMatch(/[–—]| - /);
      expect(tip.replace(/\.$/, ''), name).not.toMatch(/\. /);
    }
  });
});
