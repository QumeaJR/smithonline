import { complex, type Complex } from '@smithonline/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { emptyDesign, type Design } from '../src/lib/design';
import { stubLength, stubLineLength, TOURS, type Tour } from '../src/lib/tours';
import { useDesignStore } from '../src/store/useDesignStore';
import { useTourStore } from '../src/store/useTourStore';

const designs = useDesignStore;
const tours = useTourStore;
const TWO_PI = 2 * Math.PI;

/**
 * What TourPanel closes the tour on. HEAD: history shorter than the length at the start.
 * Later versions: the design before the tour is back on screen. True means "the tour would close".
 */
function tourWouldClose(): boolean {
  const s = tours.getState() as unknown as { base?: number; origin?: Design | null };
  if (typeof s.base === 'number') return designs.getState().past.length < s.base;
  return designs.getState().design === s.origin;
}

/** Normalized Re(Y) after a line of electrical length l (wavelengths) on z: hand transmission-line formula. */
function reYAfterLine(z: Complex, z0: number, l: number): number {
  const t = Math.tan(TWO_PI * l);
  // zin = z0 (zL + j z0 t) / (z0 + j zL t)
  const nr = z.re;
  const ni = z.im + z0 * t;
  const dr = z0 - z.im * t;
  const di = z.re * t;
  // Y = (z0 + j zL t) / (z0 (zL + j z0 t)) -> Re = (dr nr + di ni) / (z0 (nr^2 + ni^2))
  return ((dr * nr + di * ni) / (z0 * (nr * nr + ni * ni))) * z0;
}

/** The user scales the value of the first part, a series L or C. */
function nudge(factor: number): void {
  const el = designs.getState().design.elements[0];
  if (el?.kind !== 'L' && el?.kind !== 'C') throw new Error('expected an L or C first');
  designs.getState().updateElement(0, { ...el, value: el.value * factor });
}

describe('qa tours: helper maths by hand', () => {
  it('stubLineLength(100 ohm) = atan(sqrt 2) / 2 pi = 0.152044 wavelengths', () => {
    expect(stubLineLength(complex(100, 0), 50)).toBeCloseTo(Math.atan(Math.SQRT2) / TWO_PI, 9);
  });

  it('stubLineLength(25 ohm) = atan(1 / sqrt 2) / 2 pi = 0.097957 wavelengths', () => {
    expect(stubLineLength(complex(25, 0), 50)).toBeCloseTo(Math.atan(1 / Math.SQRT2) / TWO_PI, 9);
  });

  it('stubLineLength(120 + j70, 50): tan = (70 + sqrt 23520) / 70, 0.2018 wavelengths', () => {
    // root^2 = 120 * (70^2 + 70^2) / 50 = 23520
    const t = (70 + Math.sqrt(23520)) / 70;
    expect(stubLineLength(complex(120, 70), 50)).toBeCloseTo(Math.atan(t) / TWO_PI, 9);
    expect(stubLineLength(complex(120, 70), 50)).toBeCloseTo(0.2018, 3);
  });

  it('r = z0 with x > 0: the quarter wave line (Y = zL / z0^2, Re = 1/z0) is the shortest', () => {
    // 50 + j50: quarter wave gives Y = (50 + j50) / 2500, Re(Y) = 1/50 at 0.25 wavelengths;
    // the other solution tan = -x / (2 z0) is at 0.426 wavelengths.
    expect(reYAfterLine(complex(50, 50), 50, 0.25)).toBeCloseTo(1, 12);
    expect(stubLineLength(complex(50, 50), 50)).toBeCloseTo(0.25, 9);
  });

  it('r = z0 with x < 0: shortest is atan(0.5) / 2 pi = 0.07379, not the quarter wave', () => {
    expect(stubLineLength(complex(50, -50), 50)).toBeCloseTo(Math.atan(0.5) / TWO_PI, 9);
  });

  it('every returned line length puts Re(Y) at 1/z0 and nothing shorter does (scan)', () => {
    const loads = [
      complex(120, 70),
      complex(30, -40),
      complex(10, 5),
      complex(200, -150),
      complex(50, 30),
      complex(50, -30),
      complex(50, 100),
      complex(100, 0),
      complex(25, 0),
    ];
    for (const z of loads) {
      const l = stubLineLength(z, 50) as number;
      expect(l).not.toBeNull();
      expect(reYAfterLine(z, 50, l)).toBeCloseTo(1, 9);
      // No shorter solution: scan 0 < l' < l and require Re(Y) != 1 by a margin at every sample
      // that is not within one scan step of the answer.
      const n = 20000;
      for (let i = 1; i < n; i++) {
        const lp = (l * i) / n;
        if (l - lp < 2e-4) break;
        expect(Math.abs(reYAfterLine(z, 50, lp) - 1)).toBeGreaterThan(1e-5);
      }
    }
  });

  it('stubLength: open and shorted differ by a quarter wave modulo a half wave', () => {
    const z = complex(20, -35);
    const open = stubLength(z, 50, 'openStub') as number;
    const short = stubLength(z, 50, 'shortStub') as number;
    const diff = (((open - short) % 0.5) + 0.5) % 0.5;
    expect(diff).toBeCloseTo(0.25, 9);
    expect(open).toBeGreaterThan(0);
    expect(open).toBeLessThan(0.5);
  });

  it('stubLength is null when the susceptance is zero (a pure resistance)', () => {
    expect(stubLength(complex(50, 0), 50, 'openStub')).toBeNull();
    expect(stubLength(complex(50, 0), 50, 'shortStub')).toBeNull();
  });

  it('stubLineLength is null for z0 <= 0, NaN and negative resistance', () => {
    expect(stubLineLength(complex(20, 10), 0)).toBeNull();
    expect(stubLineLength(complex(20, 10), -50)).toBeNull();
    expect(stubLineLength(complex(NaN, 10), 50)).toBeNull();
    expect(stubLineLength(complex(-5, 10), 50)).toBeNull();
  });
});

describe('qa tours: L-network tour values by hand', () => {
  it('20 + j30 ohm at 150 MHz: series C of 192.74 pF (X = -5.505), then shunt C of 25.99 pF', () => {
    const t = TOURS.find((x) => x.id === 'l-network') as Tour;
    const d0 = t.start();
    const d1 = (t.steps[1] as Tour['steps'][number]).apply(d0);
    const d2 = (t.steps[2] as Tour['steps'][number]).apply(d1);
    const w = TWO_PI * 150e6;
    // X = -30 + sqrt(20 * 30) = -5.5051 ohm: the shorter of -5.505 and -54.495
    const x = -(30 - Math.sqrt(600));
    const first = d2.elements[0];
    expect(first).toMatchObject({ kind: 'C', orientation: 'series' });
    expect((first as { value: number }).value).toBeCloseTo(-1 / (w * x), 15);
    expect((first as { value: number }).value).toBeCloseTo(192.74e-12, 14);
    // after: z = 20 + j24.495, y = (20 - j24.495) / 1000, shunt susceptance +0.024495 S
    const second = d2.elements[1];
    expect(second).toMatchObject({ kind: 'C', orientation: 'shunt' });
    expect((second as { value: number }).value).toBeCloseTo(Math.sqrt(600) / 1000 / w, 15);
    expect((second as { value: number }).value).toBeCloseTo(25.99e-12, 14);
  });
});

describe('qa tours: store behaviour when the user acts mid-tour', () => {
  beforeEach(() => {
    designs.getState().init({ ...emptyDesign(), name: 'Mine', load: complex(77, 7) });
    tours.getState().close();
  });

  it('undo of a user edit during a tour returns to the tour design and keeps the tour open', () => {
    tours.getState().start('l-network');
    tours.getState().next();
    const step1 = designs.getState().design;
    nudge(2);
    designs.getState().undo();
    expect(designs.getState().design).toBe(step1);
    expect(tourWouldClose()).toBe(false);
    expect(tours.getState().tour).not.toBeNull();
  });

  it('loading another design while a tour runs ends the tour (nothing left to narrate)', () => {
    tours.getState().start('l-network');
    tours.getState().next();
    designs.getState().loadDesign({ ...emptyDesign(), name: 'Opened file' });
    expect(tours.getState().tour).toBeNull();
  });

  it('New design while a tour runs ends the tour', () => {
    tours.getState().start('single-stub');
    designs.getState().newDesign();
    expect(tours.getState().tour).toBeNull();
  });

  it('Next after the user added a part of their own does not narrate it as the tour part', () => {
    tours.getState().start('l-network');
    designs.getState().addElement({ kind: 'L', orientation: 'series', value: 1e-9 });
    tours.getState().next();
    // The tour is on its step 1 with the user's 1 nH at index 0: the design is not the
    // tour design any more, so the narration must not claim it added that part.
    const d = designs.getState().design;
    const t = tours.getState().tour as Tour;
    const text = (t.steps[1] as Tour['steps'][number]).narrate(d).join(' ');
    expect(text).not.toContain('Added a series inductor of 1 nH');
  });

  it('a step applied after the user deleted the first part leaves the design as it is and does not crash', () => {
    tours.getState().start('l-network');
    tours.getState().next();
    designs.getState().removeElement(0);
    const before = designs.getState().design;
    tours.getState().next(); // step 2: closing part needs elements[0]
    expect(designs.getState().design.elements).toHaveLength(before.elements.length);
    expect(tours.getState().step).toBe(2);
  });

  it.fails('Back then Undo leaves design and tour step consistent', () => {
    tours.getState().start('l-network');
    tours.getState().next();
    nudge(1.01); // user edit at step 1
    tours.getState().back(); // step 0, design = tour start (no parts)
    expect(designs.getState().design.elements).toHaveLength(0);
    designs.getState().undo(); // pops the user's edit entry
    // At step 0 the tour design has no parts; undo must not bring a step 1 design back under step 0.
    expect(tours.getState().step === 0 ? designs.getState().design.elements.length : 0).toBe(0);
  });

  it('Next clears the redo stack so Redo cannot rewind a step the tour has passed', () => {
    tours.getState().start('l-network');
    tours.getState().next();
    nudge(1.01);
    designs.getState().undo(); // redo stack now holds the edited step 1 design
    tours.getState().next(); // step 2
    expect(designs.getState().future).toHaveLength(0);
  });

  it('with a full undo history (100 entries) an edit and its undo do not close the tour', () => {
    for (let i = 0; i < 105; i++) designs.getState().setName(`n${i}`);
    expect(designs.getState().past.length).toBe(100);
    tours.getState().start('l-network');
    tours.getState().next();
    const step1 = designs.getState().design;
    nudge(2);
    designs.getState().undo();
    expect(designs.getState().design).toBe(step1);
    // Here the design on screen is still the tour's, so the tour must stay open.
    expect(tourWouldClose()).toBe(false);
  });

  it('starting a second tour replaces the first and one undo returns to the first tour design', () => {
    tours.getState().start('l-network');
    tours.getState().next();
    const during = designs.getState().design;
    tours.getState().start('single-stub');
    expect(tours.getState().step).toBe(0);
    expect(tours.getState().tour?.id).toBe('single-stub');
    designs.getState().undo();
    expect(designs.getState().design).toBe(during);
  });

  it('frequency change mid-tour keeps lines at their electrical length for the next stub step', () => {
    tours.getState().start('single-stub');
    tours.getState().next(); // line added
    designs.getState().setFrequency(2e9);
    const line = designs.getState().design.elements[0];
    expect(line?.kind === 'line' ? line.refFrequency : 0).toBe(2e9);
    tours.getState().next(); // stub computed from the line's zin at 2 GHz
    expect(designs.getState().design.elements).toHaveLength(2);
  });
});
