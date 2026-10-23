/**
 * Round 3: runtime of parseInline and parseMarkdown on adversarial 20000-character strings.
 * Every case must stay under one second. A failing case takes as long as the defect costs.
 */
import { describe, expect, it } from 'vitest';
import { parseInline, parseMarkdown } from '../src/lib/markdown';

const BS = String.fromCharCode(92);
const BT = String.fromCharCode(96);
const rep = (unit: string, chars = 20000): string => unit.repeat(Math.ceil(chars / unit.length));

const cases: [string, string][] = [
  ['*a ', rep('*a ')],
  ['**a ', rep('**a ')],
  ['***a ', rep('***a ')],
  ['*** ', rep('*** ')],
  ['*a**b ', rep('*a**b ')],
  [' *', rep(' *')],
  ['*', '*'.repeat(20000)],
  ['**', '**'.repeat(10000)],
  ['*[', rep('*[')],
  ['**[', rep('**[')],
  [' *[', rep(' *[')],
  ['*[a ', rep('*[a ')],
  ['*[a* ', rep('*[a* ')],
  ['*[a](((', rep('*[a](((')],
  ['*[a](', rep('*[a](')],
  ['[a](', rep('[a](')],
  ['[a ', rep('[a ')],
  ['*`a ', rep('*`a ')],
  [`*a ${BT}b* `, rep(`*a ${BT}b* `)],
  ['*a **b `c [d ', rep('*a **b `c [d ')],
  ['*\\', rep('*' + BS)],
  [BS, rep(BS)],
  ['*a *b ', rep('*a *b ')],
  ['*a [b](#h) ', rep('*a [b](#h) ')],
  ['*a [b] ', rep('*a [b] ')],
  ['*[a]', rep('*[a]')],
  [`**${BT}`, rep(`**${BT}`)],
];

describe('parseInline on 20000 characters', () => {
  it.each(cases)('%j repeated', (_name, s) => {
    const t = performance.now();
    parseInline(s);
    expect(performance.now() - t).toBeLessThan(1000);
  });
});

describe('parseMarkdown on adversarial paragraphs', () => {
  it('a 20000 character paragraph of " *[" over many lines', () => {
    const src = Array.from({ length: 710 }, () => ' *[ *[ *[ *[ *[ *[ *[ *[ *[').join('\n');
    const t = performance.now();
    parseMarkdown(src);
    expect(performance.now() - t).toBeLessThan(1000);
  });
  it('a 20000 character heading of "*a "', () => {
    const t = performance.now();
    parseMarkdown(`## ${rep('*a ')}`);
    expect(performance.now() - t).toBeLessThan(1000);
  });
  it('a 20000 character list item of "**a "', () => {
    const t = performance.now();
    parseMarkdown(`- ${rep('**a ')}`);
    expect(performance.now() - t).toBeLessThan(1000);
  });
});
