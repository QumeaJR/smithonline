import {
  cabs,
  complex,
  evaluateLadder,
  gammaToZ,
  noiseFigureDb,
  zToGamma,
  type Complex,
} from '@smithonline/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { emptyDesign, targetOf, type Design } from '../src/lib/design';
import { designLadder } from '../src/lib/realize';
import { availableGain, stubLength, stubLineLength, TOURS, type Tour } from '../src/lib/tours';
import { useDesignStore } from '../src/store/useDesignStore';
import { useTourStore } from '../src/store/useTourStore';

/** Every design a tour passes through, from the start design to the last step. */
function walk(tour: Tour, start: Design = tour.start()): Design[] {
  const designs: Design[] = [start];
  for (const step of tour.steps.slice(1)) {
    designs.push(step.apply(designs[designs.length - 1] as Design));
  }
  return designs;
}

const zin = (d: Design): Complex =>
  evaluateLadder(designLadder(d, d.elements), { arcSteps: 0 }).zin;

const tour = (id: string): Tour => TOURS.find((t) => t.id === id) as Tour;

describe('tours: the three lessons build real designs', () => {
  it('there are ten tours with distinct ids', () => {
    expect(TOURS.map((t) => t.id)).toEqual([
      'l-network',
      'single-stub',
      'lna-input',
      'band-optimizer',
      'broadband',
      'realize',
      'packages',
      'pa-output',
      'pi-t',
      'quarter-wave',
    ]);
    expect(new Set(TOURS.map((t) => t.id)).size).toBe(TOURS.length);
  });

  it('the L-network tour ends at Z0', () => {
    const last = walk(tour('l-network')).at(-1) as Design;
    expect(last.elements).toHaveLength(2);
    expect(cabs(zToGamma(zin(last), last.z0))).toBeLessThan(1e-9);
    expect(last.sweep.enabled).toBe(true);
  });

  it('the single stub tour ends at Z0 with a line and the shorter stub', () => {
    const last = walk(tour('single-stub')).at(-1) as Design;
    const [line, stub] = last.elements;
    expect(line?.kind).toBe('line');
    expect(['openStub', 'shortStub']).toContain(stub?.kind);
    // A quarter wave separates the two kinds, so the shorter one is below that.
    expect((stub as { length: number }).length).toBeLessThan(0.25);
    expect(cabs(zToGamma(zin(last), last.z0))).toBeLessThan(1e-9);
  });

  it('the LNA tour lands on the noise-optimal impedance', () => {
    const last = walk(tour('lna-input')).at(-1) as Design;
    expect(last.elements).toHaveLength(2);
    const opt = gammaToZ(last.twoPort?.noise?.gammaOpt as Complex, last.z0);
    const z = zin(last);
    expect(Math.abs(z.re - opt.re)).toBeLessThan(1e-6);
    expect(Math.abs(z.im - opt.im)).toBeLessThan(1e-6);
    expect(targetOf(last)).toEqual(opt);
    expect(last.showStability).toBe(true);
    expect(last.noiseCircles).toHaveLength(3);
    expect(last.gainCircles).toHaveLength(1);
  });

  for (const t of TOURS) {
    it(`${t.id}: every step narrates, with no placeholder or non-finite numbers`, () => {
      const designs = walk(t);
      expect(designs).toHaveLength(t.steps.length);
      t.steps.forEach((step, i) => {
        const text = step.narrate(designs[i] as Design).join('\n');
        expect(text.length).toBeGreaterThan(60);
        expect(text).not.toMatch(/NaN|undefined|Infinity|\[object/);
        // The house style has no en or em dashes.
        expect(text).not.toMatch(/[–—]/);
      });
    });

    it(`${t.id}: a design with the parts removed gets a notice, not a crash`, () => {
      const designs = walk(t);
      for (let i = 1; i < t.steps.length; i++) {
        const stripped = { ...(designs[i] as Design), elements: [] };
        const text = (t.steps[i] as Tour['steps'][number]).narrate(stripped).join(' ');
        expect(text.length).toBeGreaterThan(0);
        expect(text).not.toMatch(/NaN|undefined/);
      }
    });
  }

  it('narrated numbers are computed: changing the load changes the story and the result', () => {
    const t = tour('l-network');
    const a = walk(t);
    const b = walk(t, { ...t.start(), load: complex(15, -25) });
    const s0a = (t.steps[0] as Tour['steps'][number]).narrate(a[0] as Design).join(' ');
    const s0b = (t.steps[0] as Tour['steps'][number]).narrate(b[0] as Design).join(' ');
    expect(s0b).not.toBe(s0a);
    expect(s0b).toContain('15.0 - j25.0');
    expect(cabs(zToGamma(zin(b.at(-1) as Design), 50))).toBeLessThan(1e-9);
    const s2a = (t.steps[2] as Tour['steps'][number]).narrate(a[2] as Design).join(' ');
    const s2b = (t.steps[2] as Tour['steps'][number]).narrate(b[2] as Design).join(' ');
    expect(s2b).not.toBe(s2a);
  });

  it('the L-network narration quotes the point and the admittance the evaluation gives', () => {
    const t = tour('l-network');
    const d = walk(t)[1] as Design;
    const r = evaluateLadder(designLadder(d, d.elements), { arcSteps: 0 });
    const text = (t.steps[1] as Tour['steps'][number]).narrate(d).join(' ');
    expect(text).toContain((r.datapoints[1] as Complex).im.toFixed(1));
    expect(text).toContain(`${((r.info[1]?.y.re ?? 0) * 1e3).toFixed(1)} mS`);
  });
});

describe('tours: helpers', () => {
  it('single stub: a line and a stub put a range of loads on Z0', () => {
    const z0 = 50;
    const loads = [
      complex(120, 70),
      complex(30, -40),
      complex(10, 5),
      complex(200, -150),
      complex(50, 30),
    ];
    for (const load of loads) {
      const l = stubLineLength(load, z0);
      expect(l).not.toBeNull();
      const d1: Design = {
        ...emptyDesign(),
        frequency: 1e9,
        load,
        elements: [
          {
            kind: 'line',
            z0,
            length: l as number,
            refFrequency: 1e9,
            er: 1,
            id: 'a',
            color: '#000',
          },
        ],
      };
      const z1 = zin(d1);
      for (const kind of ['openStub', 'shortStub'] as const) {
        const sl = stubLength(z1, z0, kind);
        expect(sl).not.toBeNull();
        const d2: Design = {
          ...d1,
          elements: [
            ...d1.elements,
            { kind, z0, length: sl as number, refFrequency: 1e9, id: 'b', color: '#000' },
          ],
        };
        expect(cabs(zToGamma(zin(d2), z0))).toBeLessThan(1e-9);
      }
    }
  });

  it('stub line length is null for a load without resistance', () => {
    expect(stubLineLength(complex(0, 20), 50)).toBeNull();
  });

  it('available gain with a matched source is |S21|^2 / (1 - |Gout|^2) with Gout = S22 + ...', () => {
    const s = tour('lna-input').start().twoPort?.s;
    if (!s) throw new Error('the LNA tour has no device');
    // For a source at Gs = 0, Gout = S22 and Ga = |S21|^2 / (1 - |S22|^2).
    expect(availableGain(s, complex(0, 0))).toBeCloseTo(
      cabs(s.s21) ** 2 / (1 - cabs(s.s22) ** 2),
      10,
    );
  });

  it('the LNA noise figure at the target is NFmin', () => {
    const last = walk(tour('lna-input')).at(-1) as Design;
    const noise = last.twoPort?.noise;
    if (!noise) throw new Error('the LNA tour has no noise data');
    const nf = noiseFigureDb(noise, zToGamma(zin(last), last.z0));
    expect(nf).toBeCloseTo(noise.nfMinDb, 6);
  });
});

describe('tours in the store: one tour is one undo', () => {
  beforeEach(() => {
    useDesignStore.getState().init({ ...emptyDesign(), name: 'Mine', load: complex(77, 7) });
    useTourStore.getState().close();
  });

  it('start, next through every step, then one undo restores the previous design', () => {
    const mine = useDesignStore.getState().design;
    const pastBefore = useDesignStore.getState().past.length;
    useTourStore.getState().start('l-network');
    expect(useDesignStore.getState().design.name).toBe('Tour: L-network match');
    expect(useDesignStore.getState().past.length).toBe(pastBefore + 1);
    const t = useTourStore.getState().tour as Tour;
    for (let i = 1; i < t.steps.length; i++) useTourStore.getState().next();
    expect(useTourStore.getState().step).toBe(t.steps.length - 1);
    expect(useDesignStore.getState().design.elements).toHaveLength(2);
    // Still one history entry for the whole tour.
    expect(useDesignStore.getState().past.length).toBe(pastBefore + 1);
    useDesignStore.getState().undo();
    expect(useDesignStore.getState().design).toBe(mine);
    // Redo brings the finished tour back in one step.
    useDesignStore.getState().redo();
    expect(useDesignStore.getState().design.elements).toHaveLength(2);
  });

  it('Back restores the design of the previous step', () => {
    useTourStore.getState().start('single-stub');
    const atStart = useDesignStore.getState().design;
    useTourStore.getState().next();
    const afterOne = useDesignStore.getState().design;
    expect(afterOne.elements).toHaveLength(1);
    useTourStore.getState().next();
    expect(useDesignStore.getState().design.elements).toHaveLength(2);
    useTourStore.getState().back();
    expect(useDesignStore.getState().design).toBe(afterOne);
    useTourStore.getState().back();
    expect(useDesignStore.getState().design).toBe(atStart);
    // Back at the first step does nothing.
    useTourStore.getState().back();
    expect(useTourStore.getState().step).toBe(0);
    expect(useDesignStore.getState().design).toBe(atStart);
  });

  it('Next at the last step does nothing; close leaves the design in place', () => {
    useTourStore.getState().start('lna-input');
    const t = useTourStore.getState().tour as Tour;
    for (let i = 0; i < t.steps.length + 3; i++) useTourStore.getState().next();
    expect(useTourStore.getState().step).toBe(t.steps.length - 1);
    const design = useDesignStore.getState().design;
    useTourStore.getState().close();
    expect(useTourStore.getState().tour).toBeNull();
    expect(useDesignStore.getState().design).toBe(design);
  });

  it('an unknown tour id does nothing', () => {
    const before = useDesignStore.getState().design;
    useTourStore.getState().start('nope');
    expect(useTourStore.getState().tour).toBeNull();
    expect(useDesignStore.getState().design).toBe(before);
  });

  it('Next carries on from edits made during the tour', () => {
    useTourStore.getState().start('l-network');
    useTourStore.getState().next();
    // The user nudges the first part; the closing part is computed from what is there.
    const first = useDesignStore.getState().design.elements[0];
    if (first?.kind !== 'C' && first?.kind !== 'L') throw new Error('expected a series L or C');
    useDesignStore.getState().updateElement(0, { ...first, value: first.value * 1.01 });
    useTourStore.getState().next();
    const last = useDesignStore.getState().design;
    expect(last.elements).toHaveLength(2);
    // One shunt part cannot undo a nudge of the series part, but it still lands close.
    expect(cabs(zToGamma(zin(last), last.z0))).toBeLessThan(0.01);
  });
});
