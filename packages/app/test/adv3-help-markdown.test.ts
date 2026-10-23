/**
 * Round 3 adversarial tests for the rewritten closeOf and the *** branch in markdown.ts.
 * A failing test is a defect, see the adversary report.
 */
import { describe, expect, it } from 'vitest';
import { inlineText, parseInline, type Inline } from '../src/lib/markdown';

const BT = String.fromCharCode(96);

/** Compact notation: b(..) i(..) c{code} l<href>(..) plain text. */
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
const linkDepth = (parts: readonly Inline[], d = 0): number =>
  parts.reduce(
    (m, p) =>
      p.kind === 'link'
        ? Math.max(m, linkDepth(p.children, d + 1), d + 1)
        : p.kind === 'bold' || p.kind === 'italic'
          ? Math.max(m, linkDepth(p.children, d))
          : m,
    d,
  );

describe('links never nest (an anchor inside an anchor is invalid HTML)', () => {
  it('an empty code span in the label: readLink skips it as a span, parseInline does not', () => {
    // [ `` `[x](#)` ](#)  : readLink treats `` as a span and reads on to the first ]
    const s = `[${BT}${BT} ${BT}[x](#)${BT}](#)`;
    expect(linkDepth(parseInline(s)), S(s)).toBeLessThanOrEqual(1);
  });
  it('the same through the *** branch, which ignores code spans: [***`[ ](#)***`](#)', () => {
    const s = `[***${BT}[ ](#)***${BT}](#)`;
    expect(linkDepth(parseInline(s)), S(s)).toBeLessThanOrEqual(1);
  });
});

describe('the *** branch', () => {
  it('does not end inside a code span: ***a `b***c` d***', () => {
    expect(S(`***a ${BT}b***c${BT} d***`)).toBe(`b(i(a c{b***c} d))`);
  });
  it('does not end inside a link target: ***a [b](https://x/***) c***', () => {
    expect(S('***a [b](https://x/***) c***')).toBe('b(i(a l<https://x/***>(b) c))');
  });
  it('does not end on an escaped run: ***a \\*** b***', () => {
    expect(S('***a \\*** b***')).toBe('b(i(a *** b))');
  });
});

describe('budget of 64 steps', () => {
  const x = (n: number): string => 'x'.repeat(n);
  it('an italic run of 63 characters closes (boundary survives)', () => {
    expect(S(`*${x(63)}*`)).toBe(`i(${x(63)})`);
  });
  it('an italic run of 64 plain characters still closes', () => {
    expect(S(`*${x(64)}*`)).toBe(`i(${x(64)})`);
  });
  it('a bold phrase of 80 characters still closes', () => {
    const t = 'Note that the cursor readout shows reflection coefficient and impedance together';
    expect(S(`**${t}**`)).toBe(`b(${t})`);
  });
  it('a long italic sentence still closes', () => {
    const t = 'the load is the termination at the end of the ladder and its value is set in ohms';
    expect(S(`*${t}*`)).toBe(`i(${t})`);
  });
  it('bold with several italic words inside and more than 64 characters', () => {
    const inner = 'a *b* '.repeat(12);
    expect(S(`**${inner}z**`)).toBe(`b(${'a i(b) '.repeat(12)}z)`);
  });
  it('exhaustion is safe: nothing is lost and no mark is invented (survives)', () => {
    const s = `*${'word '.repeat(40)}end*`;
    const out = inlineText(parseInline(s));
    expect(out.replace(/\*/g, '')).toBe(s.replace(/\*/g, ''));
  });
});

describe('nested and adjacent runs', () => {
  it('a *** run closing a nested bold inside italic: *a ***b*** c*', () => {
    expect(inlineText(parseInline('*a ***b*** c*'))).not.toContain('*');
  });
  it('a *** run closing a nested bold inside bold: **a ***b*** c**', () => {
    expect(inlineText(parseInline('**a ***b*** c**'))).not.toContain('*');
  });
});

describe('the word-start rule treats ** like *', () => {
  it('x**2**3 (power notation) stays text, like 5*3', () => {
    expect(S('x**2**3')).toBe('x**2**3');
  });
  it('2**3**4 stays text', () => {
    expect(S('2**3**4')).toBe('2**3**4');
  });
  it('S21**S12** stays text', () => {
    expect(S('S21**S12**')).toBe('S21**S12**');
  });
  it('a***b***c stays text', () => {
    expect(S('a***b***c')).toBe('a***b***c');
  });
  it('a**b stays text (survives)', () => {
    expect(S('a**b')).toBe('a**b');
  });
  it('5*3 and S21*S12 stay text (survives)', () => {
    expect(S('5*3 and S21*S12')).toBe('5*3 and S21*S12');
  });
});

describe('survivors', () => {
  it('a star in a link target inside bold', () => {
    expect(S('**[a](https://x/*)**')).toBe('b(l<https://x/*>(a))');
  });
  it('a star inside a code span inside italic', () => {
    expect(S(`*see ${BT}*.xmlsc${BT} here*`)).toBe('i(see c{*.xmlsc} here)');
  });
  it('closer needs a non-space before it: *a * and **a **', () => {
    expect(S('*a *')).toBe('*a *');
    expect(S('**a **')).toBe('**a **');
  });
  it('an opener followed by space is text: * a*', () => {
    expect(S('* a*')).toBe('* a*');
  });
  it('bold then italic then bold, adjacent', () => {
    expect(S('**a** *b* **c**')).toBe('b(a) i(b) b(c)');
  });
  it('bold holding a link holding a star', () => {
    expect(S('**x [a**b](tour:l-network)**')).toBe('b(x l<tour:l-network>(a**b))');
  });
  it('trailing backslash after a closed run does not throw', () => {
    expect(() => parseInline('***a***\\')).not.toThrow();
    expect(S('**a**\\')).toBe('b(a)\\');
  });
});
