import { describe, expect, it } from 'vitest';
import { cabs, complex } from '../src/index';

describe('complex', () => {
  it('computes the magnitude of 3 + 4j', () => {
    expect(cabs(complex(3, 4))).toBe(5);
  });

  it('defaults the imaginary part to zero', () => {
    expect(complex(2)).toEqual({ re: 2, im: 0 });
  });
});
