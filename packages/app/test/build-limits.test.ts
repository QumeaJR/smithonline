import { describe, expect, it } from 'vitest';
import { limitsOf } from '../src/lib/build';
import { emptyDesign } from '../src/lib/design';
import { decodeDesign, encodeDesign } from '../src/lib/share';
import { useDesignStore } from '../src/store/useDesignStore';

describe('limitsOf', () => {
  it('keeps valid areas and drops the rest', () => {
    const out = limitsOf([
      { id: 'a', quantity: 'vswr', f1: 1e9, f2: 2e9, kind: 'max', value: 2 },
      { quantity: 's11Db', f1: 1e9, f2: 2e9, kind: 'max', value: -10 },
      { id: 'c', quantity: 'nope', f1: 1e9, f2: 2e9, kind: 'max', value: 2 },
      { id: 'd', quantity: 'vswr', f1: -1, f2: 2e9, kind: 'max', value: 2 },
      { id: 'e', quantity: 'vswr', f1: 1e9, f2: 2e9, kind: 'above', value: 2 },
      { id: 'f', quantity: 'vswr', f1: 1e9, f2: 2e9, kind: 'min', value: NaN },
      null,
    ]);
    expect(out.map((a) => a.quantity)).toEqual(['vswr', 's11Db']);
    expect(out[1]?.id).toBeTruthy();
  });

  it('is empty for anything that is not a list', () => {
    expect(limitsOf(undefined)).toEqual([]);
    expect(limitsOf({})).toEqual([]);
  });
});

describe('limit areas in the design', () => {
  it('survive a share link and are absent from an old one', () => {
    const d = {
      ...emptyDesign(),
      limits: [
        { id: 'x', quantity: 'vswr' as const, f1: 4e8, f2: 5e8, kind: 'max' as const, value: 1.5 },
      ],
    };
    expect(decodeDesign(encodeDesign(d))?.limits).toEqual(d.limits);
    expect(decodeDesign(encodeDesign(emptyDesign()))?.limits).toBeUndefined();
  });

  it('are set through the store as one history step', () => {
    const store = useDesignStore.getState();
    store.init(emptyDesign());
    store.setLimits([{ id: 'x', quantity: 'vswr', f1: 4e8, f2: 5e8, kind: 'max', value: 1.5 }]);
    expect(useDesignStore.getState().design.limits).toHaveLength(1);
    useDesignStore.getState().undo();
    expect(useDesignStore.getState().design.limits).toBeUndefined();
  });
});
