/** QA round 3: hostile inputs against the round 2 option line and cleanName fixes. */
import { describe, expect, it } from 'vitest';
import { readTouchstone, TouchstoneError } from '../src/io/touchstone.js';
import { cleanName } from '../src/io/spice-model.js';
import { writeNetlist } from '../src/io/netlist.js';

const body = '1 0.5 10 0.1 20 0.1 30 0.5 40\n2 0.5 10 0.1 20 0.1 30 0.5 40\n';
const read = (opt: string) => readTouchstone(opt + '\n' + body, 2);

describe('adv r3: readOptionLine', () => {
  it('R followed by a non-number is refused', () => {
    expect(() => read('# GHZ S MA R abc')).toThrow(TouchstoneError);
  });
  it('two R values are refused', () => {
    expect(() => read('# GHZ S MA R 50 R 75')).toThrow(TouchstoneError);
  });
  it('a lone number token is refused', () => {
    expect(() => read('# GHZ S MA 75')).toThrow(TouchstoneError);
  });
  it('S2P before the format is refused', () => {
    expect(() => read('# S2P GHZ S MA R 50')).toThrow(TouchstoneError);
  });
});

describe('adv r3: cleanName', () => {
  it('a name of only CR LF is empty', () => {
    expect(cleanName('\r\n\r\n')).toBe('');
  });
  it('strips every line terminator: LS, PS, NEL, VT, FF', () => {
    for (const ch of [
      String.fromCharCode(0x2028),
      String.fromCharCode(0x2029),
      '\u0085',
      '\u000b',
      '\u000c',
    ]) {
      const out = cleanName('a' + ch + 'b');
      console.log('U+' + ch.charCodeAt(0).toString(16).padStart(4, '0'), '->', JSON.stringify(out));
      expect(out).not.toContain(ch);
    }
  });
  it('strips NUL', () => {
    expect(cleanName('a\u0000b')).not.toContain('\u0000');
  });
  it('a name of only terminators and NUL is empty', () => {
    expect(cleanName(String.fromCharCode(0x2028) + '\u0000' + String.fromCharCode(0x2029))).toBe(
      '',
    );
  });
  it('netlist comment holds no U+2028 or NUL from the name', () => {
    const text = writeNetlist(
      { z0: 50, frequency: 1e9, load: { re: 50, im: 0 }, elements: [] },
      { name: 'x' + String.fromCharCode(0x2028) + '! CKT\u0000y' },
    );
    expect(text).not.toContain(String.fromCharCode(0x2028));
    expect(text).not.toContain('\u0000');
  });
});
