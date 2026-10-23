/**
 * Round 3 adversarial fuzz for markdown.ts: invariants over random strings.
 */
import { describe, expect, it } from 'vitest';
import { inlineText, parseInline, safeHref, type Inline } from '../src/lib/markdown';

const BS = String.fromCharCode(92);

function rng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

interface Seen {
  nested: boolean;
  hrefs: string[];
  empty: boolean;
  text: string;
}
function walk(parts: readonly Inline[], inLink: boolean, out: Seen): void {
  for (const p of parts) {
    if (p.kind === 'text' || p.kind === 'code') {
      out.text += p.text;
      if (p.text === '') out.empty = true;
    } else if (p.kind === 'link') {
      if (inLink) out.nested = true;
      out.hrefs.push(p.href);
      walk(p.children, true, out);
    } else walk(p.children, inLink, out);
  }
}
const scan = (s: string): Seen => {
  const out: Seen = { nested: false, hrefs: [], empty: false, text: '' };
  walk(parseInline(s), false, out);
  return out;
};

/** The characters that marks and escapes may consume; everything else must survive. */
const MARKSET = new Set(['*', BS, String.fromCharCode(96), '[', ']', '(', ')']);
const sortChars = (s: string): string =>
  [...s]
    .filter((c) => !MARKSET.has(c))
    .sort()
    .join('');

const ALPHABET = [
  '[',
  '](#h)',
  '](tour:t)',
  '](javascript:x)',
  '`',
  '*',
  '**',
  '***',
  BS,
  ' ',
  ' ',
  'a',
  'b',
  '1',
  '.',
];

function gen(rnd: () => number, maxTokens: number, alphabet = ALPHABET): string {
  const len = 1 + Math.floor(rnd() * maxTokens);
  let s = '';
  for (let k = 0; k < len; k += 1) s += alphabet[Math.floor(rnd() * alphabet.length)];
  return s;
}

describe('invariants on random input', () => {
  it('never throws, never nests links, every href safe, no empty text nodes', () => {
    const rnd = rng(7);
    for (let n = 0; n < 30000; n += 1) {
      const s = gen(rnd, 18);
      const out = scan(s);
      expect(out.nested, JSON.stringify(s)).toBe(false);
      for (const h of out.hrefs) expect(safeHref(h), JSON.stringify(s)).toBe(true);
      expect(out.empty, JSON.stringify(s)).toBe(false);
    }
  });

  it('no letter, digit, space or dot is lost or invented (link targets removed from the input)', () => {
    const rnd = rng(99);
    const bad: string[] = [];
    for (let n = 0; n < 30000; n += 1) {
      const s = gen(rnd, 18);
      if (s.includes('javascript')) continue; // an unsafe link drops its target on purpose
      const out = scan(s);
      let input = s;
      for (const h of out.hrefs) input = input.replace(`](${h})`, '');
      if (sortChars(input) !== sortChars(out.text) && bad.length < 10) bad.push(JSON.stringify(s));
    }
    expect(bad).toEqual([]);
  });

  it('inlineText is a subsequence of the input when there are no links', () => {
    const rnd = rng(5);
    const alpha = ['`', '*', '**', '***', BS, ' ', 'a', 'b'];
    const bad: string[] = [];
    for (let n = 0; n < 30000; n += 1) {
      const s = gen(rnd, 16, alpha);
      const t = inlineText(parseInline(s));
      let i = 0;
      for (const c of t) {
        const at = s.indexOf(c, i);
        if (at < 0) {
          bad.push(JSON.stringify(s));
          break;
        }
        i = at + 1;
      }
    }
    expect(bad.slice(0, 5)).toEqual([]);
  });

  it('a pair of marks around one word always emphasises it: *w*, **w**, ***w***', () => {
    for (const w of ['a', 'ab', 'x1', 'S11']) {
      const i = parseInline(`*${w}*`);
      expect(i.length).toBe(1);
      expect(i[0]?.kind).toBe('italic');
      const b = parseInline(`**${w}**`);
      expect(b.length).toBe(1);
      expect(b[0]?.kind).toBe('bold');
      expect(parseInline(`***${w}***`)[0]?.kind).toBe('bold');
    }
  });
});

describe('invariants on longer random input', () => {
  it('60 tokens: same invariants, and each parse stays under 50 ms', () => {
    const rnd = rng(2024);
    const worst = { ms: 0, s: '' };
    for (let n = 0; n < 8000; n += 1) {
      const s = gen(
        rnd,
        60,
        ALPHABET.filter((t) => t !== '***'),
      );
      const t = performance.now();
      const out = scan(s);
      const ms = performance.now() - t;
      if (ms > worst.ms) {
        worst.ms = ms;
        worst.s = s;
      }

      for (const h of out.hrefs) expect(safeHref(h), JSON.stringify(s)).toBe(true);
      if (!s.includes('javascript')) {
        let input = s;
        for (const h of out.hrefs) input = input.replace(`](${h})`, '');
        expect(sortChars(out.text), JSON.stringify(s)).toBe(sortChars(input));
      }
    }
    expect(worst.ms, JSON.stringify(worst.s)).toBeLessThan(50);
  });
});

describe('nested links at length', () => {
  it('60 tokens never produce a link inside a link', () => {
    const rnd = rng(2024);
    const bad: string[] = [];
    for (let n = 0; n < 8000; n += 1) {
      const s = gen(rnd, 60);
      if (scan(s).nested) bad.push(s);
    }
    expect(bad.length, JSON.stringify(bad.sort((a, b) => a.length - b.length)[0])).toBe(0);
  });
});
