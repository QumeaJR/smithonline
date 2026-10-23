/**
 * QA round 1 (distributed synthesis), adversary: the store and file paths the
 * new tools feed. `appendAsTool` below does what a click does, through the
 * helpers in lib/distributed.ts.
 */
import {
  cabs,
  cadd,
  cdiv,
  complex,
  csub,
  designStubFilter,
  ladderAbcd,
  multisectionTransformer,
  throughAbcd,
  transmissionS21,
} from '@smithonline/core';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { beforeEach, describe, expect, it } from 'vitest';
import { StubFilterTool, TransformerTool } from '../src/components/DistributedTools';
import { designFromXmlsc, emptyDesign, type Design } from '../src/lib/design';
import { appendDistributed, atDesignFrequency, type Distributed } from '../src/lib/distributed';
import { designSweep, designToXmlsc } from '../src/lib/files';
import { decodeDesign, encodeDesign } from '../src/lib/share';
import { useDesignStore } from '../src/store/useDesignStore';

/** What a click does: the tool's elements at the design frequency, appended by the real helper. */
function appendAsTool(elements: readonly Distributed[], start: number, stop: number): string {
  const f = useDesignStore.getState().design.frequency;
  return appendDistributed(atDesignFrequency(elements, f), start, stop);
}

const gamma = (d: Design, f: number): number => {
  const z = throughAbcd(ladderAbcd(d.elements, f), d.load);
  return cabs(cdiv(csub(z, complex(d.z0)), cadd(z, complex(d.z0))));
};
const lossDb = (d: Design, f: number): number =>
  -transmissionS21(ladderAbcd(d.elements, f), d.load, d.z0).db;

beforeEach(() => {
  useDesignStore.getState().init({ ...emptyDesign(), load: complex(200, 0) });
});

describe('adv: elements whose refFrequency is not the design frequency', () => {
  it('a transformer added at f0 = 2 GHz (design at 1 GHz) is stored at the design frequency, centred at 2 GHz', () => {
    const t = multisectionTransformer(50, 200, 2, {
      type: 'chebyshev',
      frequency: 2e9,
      gammaMax: 0.05,
    });
    appendAsTool(t.elements, 0.5e9, 3.5e9);
    const d = useDesignStore.getState().design;
    // Like every line in the app: refFrequency is the design frequency, the length is in
    // wavelengths there (a quarter wave at 2 GHz is an eighth at 1 GHz).
    for (const el of d.elements) {
      expect((el as { refFrequency?: number }).refFrequency).toBe(1e9);
      expect((el as { length: number }).length).toBeCloseTo(0.125, 12);
    }
    expect(gamma(d, 2e9)).toBeCloseTo(t.centreGamma, 9);
  });

  it('a frequency change then treats the filter like every other line: electrical length kept', () => {
    // The store's rule (useDesignStore setFrequency): lines and stubs keep their electrical
    // length at the new design frequency. A 2 GHz cutoff designed at f = 1 GHz moves to 1.8 GHz
    // when f becomes 0.9 GHz, exactly as a hand-placed stub would.
    useDesignStore.getState().init({ ...emptyDesign() });
    const f = designStubFilter({
      kind: 'lowpass',
      response: 'butterworth',
      order: 3,
      cutoff: 2e9,
      z0: 50,
    });
    appendAsTool(f.elements, 1e8, 6e9);
    expect(lossDb(useDesignStore.getState().design, 2e9)).toBeCloseTo(10 * Math.log10(2), 9);
    useDesignStore.getState().setFrequency(0.9e9);
    expect(lossDb(useDesignStore.getState().design, 1.8e9)).toBeCloseTo(10 * Math.log10(2), 9);
  });

  it('.xmlsc save and reopen keeps a transformer designed at f0 = 2 GHz (design at 1 GHz)', () => {
    const t = multisectionTransformer(50, 200, 2, {
      type: 'binomial',
      frequency: 2e9,
      gammaMax: 0.05,
    });
    appendAsTool(t.elements, 0.5e9, 3.5e9);
    const d = useDesignStore.getState().design;
    const back = designFromXmlsc(designToXmlsc(d), 'x');
    expect(gamma(back, 2e9)).toBeCloseTo(gamma(d, 2e9), 4);
  });

  it('the share link keeps it (control)', () => {
    const t = multisectionTransformer(50, 200, 2, {
      type: 'binomial',
      frequency: 2e9,
      gammaMax: 0.05,
    });
    appendAsTool(t.elements, 0.5e9, 3.5e9);
    const d = useDesignStore.getState().design;
    const back = decodeDesign(encodeDesign(d)) as Design;
    expect(gamma(back, 2e9)).toBeCloseTo(gamma(d, 2e9), 4);
  });
});

describe('adv: hostile but accepted inputs', () => {
  it('f0 = 1.7e308 Hz (the ValueInput accepts any finite value >= 1): the sweep the tool sets stays finite', () => {
    const t = multisectionTransformer(50, 200, 1, {
      type: 'binomial',
      frequency: 1.7e308,
      gammaMax: 0.05,
    });
    appendAsTool(t.elements, 1.7e308 * 0.25, 1.7e308 * 1.75);
    const d = useDesignStore.getState().design;
    expect(() => designSweep(d)).not.toThrow();
    expect(Number.isFinite(d.sweep.stop)).toBe(true);
    expect(d.elements.length).toBe(1);
  });

  it('target R 1e308 with Zin 1e-17 ohm: no NaN or 0 ohm lines, a RangeError the tool shows as no transformer', () => {
    const zl = 1e-17;
    const zs = 1e308;
    for (let n = 1; n <= 6; n++) {
      let z: readonly number[] = [];
      try {
        z = multisectionTransformer(zs, zl, n, {
          type: 'chebyshev',
          frequency: 1e9,
          gammaMax: 0.05,
        }).impedances;
      } catch (e) {
        expect(e).toBeInstanceOf(RangeError);
      }
      expect(z.every((x) => Number.isFinite(x) && x > 0)).toBe(true);
    }
    useDesignStore
      .getState()
      .init({ ...emptyDesign(), load: complex(zl, 0), target: complex(zs, 0) });
    const html = renderToString(
      createElement(TransformerTool, {
        zin: complex(zl, 0),
        target: complex(zs, 0),
        onPreview: () => {},
        onClose: () => {},
      }),
    );
    expect(html).toContain('No transformer for these impedances.');
  });
});

describe('adv: render with hostile state (renderToString)', () => {
  const noop = (): void => {};
  const cases: [string, { re: number; im: number }, { re: number; im: number }][] = [
    ['Zin 0', complex(0, 0), complex(50, 0)],
    ['Zin negative R', complex(-10, 5), complex(50, 0)],
    ['Zin NaN', complex(NaN, NaN), complex(50, 0)],
    ['Zin Infinity', complex(Infinity, 0), complex(50, 0)],
    ['Zin 1e-300', complex(1e-300, 0), complex(50, 0)],
    ['Zin = target', complex(50, 0), complex(50, 0)],
  ];
  for (const [name, zin, target] of cases)
    it(`TransformerTool and StubFilterTool render with ${name}`, () => {
      expect(() =>
        renderToString(
          createElement(TransformerTool, { zin, target, onPreview: noop, onClose: noop }),
        ),
      ).not.toThrow();
      expect(() =>
        renderToString(
          createElement(StubFilterTool, { zin, target, onPreview: noop, onClose: noop }),
        ),
      ).not.toThrow();
    });
  it('render with design frequency 1e-300 Hz and z0 1e-300 ohm', () => {
    useDesignStore.getState().init({ ...emptyDesign({ frequency: 1e-300, z0: 1e-300 }) });
    const zin = complex(1e-300, 0);
    expect(() =>
      renderToString(
        createElement(TransformerTool, {
          zin,
          target: complex(50, 0),
          onPreview: noop,
          onClose: noop,
        }),
      ),
    ).not.toThrow();
    expect(() =>
      renderToString(
        createElement(StubFilterTool, { zin, target: zin, onPreview: noop, onClose: noop }),
      ),
    ).not.toThrow();
  });
});

describe('adv: undo and sweep modes around append', () => {
  it('one undo removes the whole filter and switches the sweep back off', () => {
    useDesignStore
      .getState()
      .init({ ...emptyDesign(), sweep: { ...emptyDesign().sweep, enabled: false } });
    const before = useDesignStore.getState().design;
    const f = designStubFilter({
      kind: 'lowpass',
      response: 'chebyshev',
      order: 9,
      rippleDb: 0.5,
      cutoff: 1e9,
      z0: 50,
    });
    appendAsTool(f.elements, 5e7, 3e9);
    expect(useDesignStore.getState().design.elements).toHaveLength(17);
    useDesignStore.getState().undo();
    const d = useDesignStore.getState().design;
    expect(d.elements).toHaveLength(0);
    expect(d.sweep).toEqual(before.sweep);
    useDesignStore.getState().redo();
    expect(useDesignStore.getState().design.elements).toHaveLength(17);
  });
  it('sweep off with two user datapoints: the click that says "sweep set to ..." gives a frequency sweep', () => {
    useDesignStore
      .getState()
      .init({ ...emptyDesign(), sweep: { ...emptyDesign().sweep, enabled: false } });
    useDesignStore.getState().addDatapoint({ frequency: 2e9, z: complex(30, 10) });
    const f = designStubFilter({
      kind: 'lowpass',
      response: 'butterworth',
      order: 3,
      cutoff: 1e9,
      z0: 50,
    });
    const set = appendAsTool(f.elements, 5e7, 3e9);
    const pts = designSweep(useDesignStore.getState().design) ?? [];
    expect(set).toContain('switched to a frequency sweep');
    expect(pts.length).toBeGreaterThanOrEqual(201);
  });
});
