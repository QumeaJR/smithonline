// @vitest-environment jsdom
/**
 * Adversarial QA, local projects (docs/11) round 1: Duplicate of a project with a long name.
 * The correct behaviour is a free name at once; the defect is an endless loop (the tab hangs).
 */
import { describe, expect, it } from 'vitest';
import { copyName } from '../src/store/useProjects';

describe('Duplicate of a long name', () => {
  it('a 200-character name gets a copy name (the rename field allows 200)', () => {
    const name = 'N'.repeat(200);
    expect(copyName(name, [name])).not.toBe(name);
  });
});
