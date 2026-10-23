import {
  cabs,
  cargDeg,
  complex,
  gammaToZ,
  polarDeg,
  yToZ,
  zToGamma,
  zToY,
} from '@smithonline/core';
import type { Complex } from '@smithonline/core';

/** How the load is typed: impedance R + jX, admittance G + jB, or reflection coefficient. */
export type LoadForm = 'z' | 'y' | 'gamma';

export interface FormField {
  readonly label: string;
  /** Unit shown next to the field; empty for plain numbers. */
  readonly unit: string;
  /** Smallest accepted value. */
  readonly min?: number;
  readonly aria: string;
}

export const LOAD_FORMS: Readonly<
  Record<LoadForm, { readonly name: string; readonly fields: readonly [FormField, FormField] }>
> = {
  z: {
    name: 'R + jX',
    fields: [
      { label: 'R', unit: 'Ω', aria: 'Load resistance' },
      { label: 'X', unit: 'Ω', aria: 'Load reactance' },
    ],
  },
  y: {
    name: 'G + jB (mS)',
    fields: [
      { label: 'G', unit: 'mS', aria: 'Load conductance in millisiemens' },
      { label: 'B', unit: 'mS', aria: 'Load susceptance in millisiemens' },
    ],
  },
  gamma: {
    name: '|Γ| ∠ angle',
    fields: [
      { label: '|Γ|', unit: '', min: 0, aria: 'Reflection coefficient magnitude' },
      { label: '∠', unit: '°', aria: 'Reflection coefficient angle in degrees' },
    ],
  },
};

/** The two numbers the chosen form shows for an impedance. NaN where the form has no finite value. */
export function loadToFields(form: LoadForm, z: Complex, z0: number): [number, number] {
  switch (form) {
    case 'z':
      return [z.re, z.im];
    case 'y': {
      const y = zToY(z);
      return [y.re * 1e3, y.im * 1e3];
    }
    case 'gamma': {
      const g = zToGamma(z, z0);
      return [cabs(g), cargDeg(g)];
    }
  }
}

/**
 * The impedance two typed numbers stand for, or null when it has none: a
 * zero admittance is an open circuit and |Gamma| = 1 at angle 0 is too, and
 * neither is a load the chart can hold. A negative |Gamma| is refused.
 */
export function loadFromFields(form: LoadForm, a: number, b: number, z0: number): Complex | null {
  let z: Complex;
  switch (form) {
    case 'z':
      z = complex(a, b);
      break;
    case 'y':
      // The complex division clamps a zero divisor instead of overflowing, so open circuits are caught here.
      if (a === 0 && b === 0) return null;
      z = yToZ(complex(a * 1e-3, b * 1e-3));
      break;
    case 'gamma': {
      if (a < 0) return null;
      const g = polarDeg(a, b);
      if (Math.hypot(1 - g.re, g.im) < 1e-12) return null;
      z = gammaToZ(g, z0);
      break;
    }
  }
  return Number.isFinite(z.re) && Number.isFinite(z.im) ? z : null;
}
