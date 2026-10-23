import { afterEach, describe, expect, it, vi } from 'vitest';

const KEY = 'smithonline.substrate.v1';

/** Load a fresh copy of the store with `raw` in localStorage (undefined: nothing stored). */
async function freshStore(raw: string | null | 'throw') {
  vi.resetModules();
  const written: Record<string, string> = {};
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => {
      if (raw === 'throw') throw new Error('denied');
      return k === KEY ? raw : null;
    },
    setItem: (k: string, v: string) => {
      if (raw === 'throw') throw new Error('full');
      written[k] = v;
    },
  });
  const mod = await import('../src/store/useSubstrateStore');
  return { ...mod, written };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('qa substrate store: loading persisted settings', () => {
  it('nothing stored gives the FR-4 defaults', async () => {
    const { useSubstrateStore, DEFAULT_SUBSTRATE } = await freshStore(null);
    expect(useSubstrateStore.getState().substrate).toEqual(DEFAULT_SUBSTRATE);
    expect(DEFAULT_SUBSTRATE).toMatchObject({ er: 4.3, h: 1.6e-3, t: 35e-6 });
  });

  it('corrupt JSON, the JSON null and a throwing storage give the defaults', async () => {
    for (const raw of ['{not json', 'null', 'throw'] as const) {
      const { useSubstrateStore, DEFAULT_SUBSTRATE } = await freshStore(raw);
      expect(useSubstrateStore.getState().substrate).toEqual(DEFAULT_SUBSTRATE);
    }
  });

  it('out-of-range numbers fall back per field: er 0.5, h 0, t -1, wrong types, NaN as null', async () => {
    const raw = JSON.stringify({
      medium: 'coax',
      er: 0.5,
      h: 0,
      t: -1,
      coaxEr: '2',
      coaxGiven: 'inner',
      coaxDiameter: null,
    });
    const { useSubstrateStore, DEFAULT_SUBSTRATE: d } = await freshStore(raw);
    expect(useSubstrateStore.getState().substrate).toEqual({
      medium: 'coax',
      er: d.er,
      h: d.h,
      t: d.t,
      coaxEr: d.coaxEr,
      coaxGiven: 'inner',
      coaxDiameter: d.coaxDiameter,
    });
  });

  it('boundary values are kept: er 1, h 1e-9, t 0', async () => {
    const raw = JSON.stringify({ er: 1, h: 1e-9, t: 0, coaxEr: 1, coaxDiameter: 1e-9 });
    const { useSubstrateStore } = await freshStore(raw);
    expect(useSubstrateStore.getState().substrate).toMatchObject({
      er: 1,
      h: 1e-9,
      t: 0,
      coaxEr: 1,
      coaxDiameter: 1e-9,
    });
  });

  it('unknown medium and given values map to microstrip and outer', async () => {
    const { useSubstrateStore } = await freshStore(
      JSON.stringify({ medium: 'stripline', coaxGiven: 'x' }),
    );
    expect(useSubstrateStore.getState().substrate).toMatchObject({
      medium: 'microstrip',
      coaxGiven: 'outer',
    });
  });

  it('setSubstrate merges the patch and persists the whole object; a failing storage does not throw', async () => {
    const a = await freshStore(null);
    a.useSubstrateStore.getState().setSubstrate({ er: 9.8 });
    expect(a.useSubstrateStore.getState().substrate.er).toBe(9.8);
    expect(a.useSubstrateStore.getState().substrate.h).toBe(1.6e-3);
    expect(JSON.parse(a.written[KEY] as string)).toMatchObject({ er: 9.8, h: 1.6e-3 });
    const b = await freshStore('throw');
    expect(() => b.useSubstrateStore.getState().setSubstrate({ er: 2 })).not.toThrow();
    expect(b.useSubstrateStore.getState().substrate.er).toBe(2);
  });

  it('presets are consistent with the defaults', async () => {
    const { SUBSTRATE_PRESETS, DEFAULT_SUBSTRATE } = await freshStore(null);
    expect(
      SUBSTRATE_PRESETS.some((p) => p.er === DEFAULT_SUBSTRATE.er && p.h === DEFAULT_SUBSTRATE.h),
    ).toBe(true);
  });
});
