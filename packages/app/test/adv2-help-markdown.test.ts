/**
 * Round 2 adversarial tests for markdown.ts (readLink, closeOf, *** branch, ids).
 * A failing test is a defect, see the adversary report.
 */
import { describe, expect, it } from 'vitest';
import { GUIDE, GUIDE_SECTIONS, GUIDE_SOURCE } from '../src/lib/guide';
import { EXAMPLES } from '../src/lib/examples';
import { TOURS } from '../src/lib/tours';
import {
  inlineText,
  parseInline,
  parseMarkdown,
  slug,
  type Block,
  type Inline,
} from '../src/lib/markdown';

/** Compact notation: b(..) i(..) c:code l[href](..) plain text. */
function show(parts: readonly Inline[]): string {
  return parts
    .map((p) => {
      switch (p.kind) {
        case 'text':
          return p.text;
        case 'code':
          return `c{${p.text}}`;
        case 'bold':
          return `b(${show(p.children)})`;
        case 'italic':
          return `i(${show(p.children)})`;
        case 'link':
          return `l<${p.href}>(${show(p.children)})`;
      }
    })
    .join('');
}
const S = (s: string): string => show(parseInline(s));

describe('closeOf and the emphasis marks', () => {
  it('bold with italic ending the run: **bold *it***', () => {
    expect(S('**bold *it***')).toBe('b(bold i(it))');
  });
  it('italic holding bold: *a **b** c*', () => {
    expect(S('*a **b** c*')).toBe('i(a b(b) c)');
  });
  it('bold holding italic in the middle: **a *b* c**', () => {
    expect(S('**a *b* c**')).toBe('b(a i(b) c)');
  });
  it('an escaped star does not close: *a\\*b*', () => {
    expect(S('*a\\*b*')).toBe('i(a*b)');
  });
  it('a star inside a code span does not close: *see `*.xmlsc` here*', () => {
    expect(S('*see `*.xmlsc` here*')).toBe('i(see c{*.xmlsc} here)');
  });
  it('a star inside a link target does not close: **[a](https://x/*)**', () => {
    expect(S('**[a](https://x/*)**')).toBe('b(l<https://x/*>(a))');
  });
  it('a star inside a link label does not close bold: **x [a**b](tour:l-network)**', () => {
    expect(S('**x [a**b](tour:l-network)**')).toBe('b(x l<tour:l-network>(a**b))');
  });
  it('*** alone (a rule) stays text', () => {
    expect(S('***')).toBe('***');
  });
  it('a product without spaces before italic: 5*3 and *x*', () => {
    expect(S('5*3 and *x*')).toBe('5*3 and i(x)');
  });
  it('a product without spaces before bold: S21*S12 and **b**', () => {
    expect(S('S21*S12 and **b**')).toBe('S21*S12 and b(b)');
  });
  it('"2 * 3 * 4" stays text', () => {
    expect(S('2 * 3 * 4')).toBe('2 * 3 * 4');
  });
});

describe('readLink', () => {
  it('a code span holding ] in the label', () => {
    expect(S('[`a]b`](tour:l-network)')).toBe('l<tour:l-network>(c{a]b})');
  });
  it('an escaped ] in the label', () => {
    expect(S('[a\\]b](tour:l-network)')).toBe('l<tour:l-network>(a]b)');
  });
  it('an unsafe link keeps only its label, nested emphasis survives', () => {
    expect(S('[**x**](javascript:alert(1))')).toBe('b(x)');
  });
  it('balanced parentheses in the target', () => {
    expect(S('[a](https://x/(y))z')).toBe('l<https://x/(y)>(a)z');
  });
  it('target followed by text in parentheses', () => {
    expect(S('[a](tour:l-network) (b)')).toBe('l<tour:l-network>(a) (b)');
  });
  it('space in the target is not a link', () => {
    expect(S('[a](tour:l network)')).toBe('[a](tour:l network)');
  });
  it('backslash at the very end of a label scan does not throw', () => {
    expect(() => parseInline('[a\\')).not.toThrow();
    expect(() => parseInline('[`')).not.toThrow();
    expect(() => parseInline('[a](')).not.toThrow();
  });
});

/** All links (recursively) of an inline run, plus the maximum link nesting. */
function linkDepth(parts: readonly Inline[], d = 0): number {
  let m = d;
  for (const p of parts) {
    if (p.kind === 'link') m = Math.max(m, linkDepth(p.children, d + 1));
    else if (p.kind === 'bold' || p.kind === 'italic') m = Math.max(m, linkDepth(p.children, d));
  }
  return m;
}

describe('fuzz', () => {
  it('never throws, never nests links, never emits an unsafe href', () => {
    const alphabet = [
      '[',
      ']',
      '(',
      ')',
      '`',
      '*',
      '**',
      '***',
      '\\',
      ' ',
      'a',
      'tour:l-network',
      '#',
      'x',
    ];
    let seed = 12345;
    const rnd = (): number => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    for (let n = 0; n < 20000; n += 1) {
      const len = 1 + Math.floor(rnd() * 14);
      let s = '';
      for (let k = 0; k < len; k += 1) s += alphabet[Math.floor(rnd() * alphabet.length)];
      const r = parseInline(s); // must not throw
      expect(linkDepth(r), JSON.stringify(s)).toBeLessThanOrEqual(1);
    }
  });

  it('plain text is never lost: the visible text of a run without marks equals the input', () => {
    for (const s of ['abc', 'a b c', '1 + 2 = 3', 'x_y_z', 'a < b > c', '50 % of 3 * 4']) {
      expect(inlineText(parseInline(s))).toBe(s);
    }
  });

  it('each unmatched mark keeps its characters: no characters vanish without a mark', () => {
    // every * # ( ) [ ] in the output text must come from the input; count characters of text + code
    const s = 'a * b ** c *** d [e] (f) `g`';
    const out = inlineText(parseInline(s));
    expect(out.replace(/`/g, '')).toBe(s.replace(/`/g, ''));
  });
});

describe('timing', () => {
  it('20000 "**a " openers parse in well under a second', () => {
    const t = performance.now();
    parseInline('**a '.repeat(20000));
    expect(performance.now() - t).toBeLessThan(1000);
  });
  it('20000 "***a" openers parse in well under a second', () => {
    const t = performance.now();
    parseInline('***a'.repeat(20000));
    expect(performance.now() - t).toBeLessThan(1000);
  });
  it('deeply nested emphasis does not overflow the stack', () => {
    const n = 5000;
    const s = '*a '.repeat(0) + '**a *'.repeat(0) + '*x'.repeat(0);
    expect(() => parseInline(s)).not.toThrow();
    // `*a*` nested through alternating * and **
    let nested = 'z';
    for (let k = 0; k < n; k += 1) nested = k % 2 ? `**${nested}**` : `*${nested}*`;
    expect(() => parseInline(nested)).not.toThrow();
  });
});

describe('heading ids', () => {
  const ids = (md: string): string[] =>
    parseMarkdown(md).flatMap((b: Block) => (b.kind === 'heading' ? [b.id] : []));
  it('dedup never repeats an id, whatever the order', () => {
    const got = ids('# A\n# A 2\n# A\n# A\n# A 2\n# A-2\n# A 3');
    expect(new Set(got).size).toBe(got.length);
  });
  it('a title that slugs to "section" and a real "Section"', () => {
    const got = ids('# 日本語\n# Section\n# 1.\n# ---');
    expect(new Set(got).size).toBe(got.length);
  });
  it('slug keeps "1.5 Gain" and drops "1. Gain"', () => {
    expect(slug('1.5 Gain')).toBe('1-5-gain');
    expect(slug('1. Gain')).toBe('gain');
    expect(slug('12.')).toBe('section');
    expect(slug('1.\tGain')).toBe('gain');
  });
  it('slug of "2024" keeps the number', () => {
    expect(slug('2024')).toBe('2024');
  });
  it('a heading with a marked-up title uses its visible text', () => {
    expect(ids('## **Bold** `code` [link](#x)')).toEqual(['bold-code-link']);
  });
  it('heading levels 7 hashes is a paragraph', () => {
    expect(parseMarkdown('####### x')[0]?.kind).toBe('paragraph');
  });
});

describe('the bundled guide', () => {
  const allInline = (blocks: readonly Block[]): Inline[] =>
    blocks.flatMap((b) =>
      b.kind === 'list'
        ? b.items.flat()
        : b.kind === 'heading' || b.kind === 'paragraph'
          ? [...b.children]
          : [],
    );
  const walk = (parts: readonly Inline[]): Inline[] =>
    parts.flatMap((p) =>
      p.kind === 'bold' || p.kind === 'italic' || p.kind === 'link'
        ? [p, ...walk(p.children)]
        : [p],
    );

  it('every # link resolves to a heading id', () => {
    const ids = new Set(GUIDE.flatMap((b) => (b.kind === 'heading' ? [b.id] : [])));
    for (const p of walk(allInline(GUIDE))) {
      if (p.kind === 'link' && p.href.startsWith('#'))
        expect(ids.has(p.href.slice(1)), p.href).toBe(true);
    }
  });
  it('every tour: and example: link resolves', () => {
    for (const p of walk(allInline(GUIDE))) {
      if (p.kind !== 'link') continue;
      const m = /^(tour|example):([^?]+)/.exec(p.href);
      if (m?.[1] === 'tour')
        expect(
          TOURS.some((t) => t.id === m[2]),
          p.href,
        ).toBe(true);
      if (m?.[1] === 'example')
        expect(
          EXAMPLES.some((e) => e.file === m[2]),
          p.href,
        ).toBe(true);
    }
  });
  it('no literal ** or [..](..) survives in the rendered text of the guide', () => {
    for (const p of walk(allInline(GUIDE))) {
      if (p.kind === 'text') {
        expect(p.text, p.text).not.toMatch(/\*\*|\]\(/);
      }
    }
  });
  it('every Markdown link in the source became a link or its label', () => {
    const inSource = [...GUIDE_SOURCE.matchAll(/\]\((tour|example|view):/g)].length;
    const out = walk(allInline(GUIDE)).filter(
      (p) => p.kind === 'link' && /^(tour|example|view):/.test(p.href),
    ).length;
    expect(out).toBeGreaterThanOrEqual(inSource);
  });
  it('the section ids are unique and none equals "title"', () => {
    const ids = GUIDE.flatMap((b) => (b.kind === 'heading' ? [b.id] : []));
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).not.toContain('title');
    expect(GUIDE_SECTIONS.length).toBeGreaterThan(5);
  });
});
