/**
 * Adversarial QA round 2 (0.6.0): saved laminates storage (smithonline.laminates.v1).
 */
import { describe, expect, it, vi } from 'vitest';

const memory = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => memory.get(k) ?? null,
  setItem: (k: string, v: string) => void memory.set(k, v),
  removeItem: (k: string) => void memory.delete(k),
  clear: () => memory.clear(),
});

const lam = await import('../src/store/useLaminates');

describe('saved laminates storage (smithonline.laminates.v1)', () => {
  it('a laminate whose stored stackup the model cannot use is dropped, not renamed FR-4', () => {
    const stored = [
      {
        id: 'a',
        label: 'My RO3003',
        stackup: { h: -1, er: 3, tanD: 0.001, fRef: 10e9, t: 35e-6, roughness: 1e-6 },
      },
    ];
    const list = lam.parseLaminates(JSON.stringify(stored));
    // useLaminates.ts: "each with a name and a stackup the model can use; others dropped".
    expect(list.map((l) => [l.label, l.stackup.h, l.stackup.er])).toEqual([]);
  });

  it('hostile shapes never throw and never exceed the cap', () => {
    const many = '[' + '{"label":"a","stackup":{}},'.repeat(10000) + '{"label":"z","stackup":{}}]';
    for (const text of [
      'null',
      '{}',
      '"x"',
      '[1,2,3]',
      '[{"label":{"a":1},"stackup":{}}]',
      '{"__proto__":[]}',
      'not json',
      many,
    ]) {
      expect(() => lam.parseLaminates(text)).not.toThrow();
      expect(lam.parseLaminates(text).length).toBeLessThanOrEqual(lam.MAX_LAMINATES);
    }
  });
});
