import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(join(__dirname, '../src/index.css'), 'utf8');

describe('Settings on a phone', () => {
  it('the settings grid becomes one column below 520 px', () => {
    const block =
      /@media \(max-width: 520px\) \{\s*\.settings-grid \{\s*grid-template-columns: minmax\(0, 1fr\);/;
    expect(css).toMatch(block);
  });
});
