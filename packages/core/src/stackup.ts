/**
 * The board stackup: the dielectric between a microstrip and its ground plane
 * and the copper on top of it.
 *
 * The permittivity and loss tangent are given at one reference frequency, as
 * a laminate datasheet quotes them, and carried to every other frequency by
 * the Djordjevic-Sarkar wideband Debye model:
 *
 *   eps(f) = eps_inf + eps_d ln((f_high + j f) / (f_low + j f))
 *
 * with eps_d and eps_inf chosen so that eps(fRef) = er (1 - j tanD). It is a
 * continuous distribution of Debye relaxations with time constants spread
 * evenly on a log scale between 1 / (2 pi f_high) and 1 / (2 pi f_low), so it
 * is causal (its real and imaginary parts obey the Kramers-Kronig relations),
 * the real part falls slowly with frequency and the loss tangent is nearly
 * constant between f_low and f_high, which is how glass-epoxy and hydrocarbon
 * ceramic laminates behave.
 *
 * Sources: A. R. Djordjevic, R. M. Biljic, V. D. Likar-Smiljanic and
 * T. K. Sarkar, "Wideband frequency-domain characterization of FR-4 and
 * time-domain causality", IEEE Trans. EMC 43 (4), 2001, pp. 662-667; the
 * same model as C. Svensson and G. E. Dermer, "Time domain modeling of lossy
 * interconnects", IEEE Trans. Adv. Packaging 24 (2), 2001, pp. 191-196. The
 * form with f_low, f_high and the reference frequency is the one scikit-rf's
 * MLine uses (diel = 'djordjevicsvensson'), with the same defaults
 * f_low = 1 kHz and f_high = 1 THz.
 *
 * Lengths in metres, frequencies in hertz.
 */
import { cadd, cdiv, clog, cscale, complex, type Complex } from './complex.js';

/** Lower corner of the Djordjevic-Sarkar relaxation band, Hz. */
export const DS_F_LOW = 1e3;
/** Upper corner of the Djordjevic-Sarkar relaxation band, Hz. */
export const DS_F_HIGH = 1e12;

/**
 * Resistivity of annealed copper, ohm m: the International Annealed Copper
 * Standard, 1/58 ohm mm^2/m (IEC 60028). Electrodeposited foil is within a
 * few percent of it.
 */
export const COPPER_RESISTIVITY = 1.7241e-8;

/** A board stackup as the microstrip model reads it. */
export interface Stackup {
  /** Dielectric height between the top copper and the ground plane, m. */
  readonly h: number;
  /** Relative permittivity at fRef. */
  readonly er: number;
  /** Loss tangent at fRef. */
  readonly tanD: number;
  /** Frequency at which er and tanD are given, Hz. */
  readonly fRef: number;
  /** Copper thickness, m; 0 treats the strip as an infinitely thin perfect conductor (no conductor loss). */
  readonly t: number;
  /** RMS surface roughness of the copper on the dielectric side, m. */
  readonly roughness: number;
  /** Copper resistivity, ohm m; default COPPER_RESISTIVITY. */
  readonly rho?: number;
  /** A name for display, such as the preset it came from. */
  readonly name?: string;
}

export interface StackupPreset {
  readonly id: string;
  readonly label: string;
  readonly stackup: Stackup;
  /** Where every number comes from. */
  readonly source: string;
}

const ISOLA_370HR =
  'Isola 370HR data sheet, revision C, 15 April 2021: Dk 4.17 and Df 0.0161 at 1 GHz ' +
  '(Bereskin stripline, IPC-TM-650 2.5.5.9; the laminate values depend on the resin content). ' +
  '1 oz (35 um) copper. The data sheet gives no roughness; 3.2 um RMS is the value Rogers ' +
  'publication 92-243 ("Copper foils for high frequency circuit materials", table 1) gives for ' +
  'standard 1 oz electrodeposited foil, taken here as an assumption for the HTE foil of FR-4.';

const ROGERS_RO4000 =
  'Rogers RO4000 data sheet (RO4003C and RO4350B): design Dk 3.55 (RO4003C) and 3.66 (RO4350B), ' +
  'the values Rogers recommends for circuit design (differential phase length method, 8 to 40 GHz); ' +
  'Df 0.0027 and 0.0037 at 10 GHz. 1 oz (35 um) electrodeposited copper with 3.2 um RMS ' +
  'roughness on the treated side (Rogers publication 92-243, table 1; LoPro foil is 0.9 um).';

/** Laminates for a one-click start. */
export const STACKUP_PRESETS: readonly StackupPreset[] = [
  {
    id: 'fr4-1.6',
    label: 'FR-4, 1.6 mm',
    stackup: {
      h: 1.6e-3,
      er: 4.17,
      tanD: 0.0161,
      fRef: 1e9,
      t: 35e-6,
      roughness: 3.2e-6,
      name: 'FR-4, 1.6 mm',
    },
    source: ISOLA_370HR,
  },
  {
    id: 'fr4-0.8',
    label: 'FR-4, 0.8 mm',
    stackup: {
      h: 0.8e-3,
      er: 4.17,
      tanD: 0.0161,
      fRef: 1e9,
      t: 35e-6,
      roughness: 3.2e-6,
      name: 'FR-4, 0.8 mm',
    },
    source: ISOLA_370HR,
  },
  {
    id: 'ro4003c-0.508',
    label: 'RO4003C, 0.508 mm',
    stackup: {
      h: 0.508e-3,
      er: 3.55,
      tanD: 0.0027,
      fRef: 10e9,
      t: 35e-6,
      roughness: 3.2e-6,
      name: 'RO4003C, 0.508 mm',
    },
    source: ROGERS_RO4000,
  },
  {
    id: 'ro4350b-0.762',
    label: 'RO4350B, 0.762 mm',
    stackup: {
      h: 0.762e-3,
      er: 3.66,
      tanD: 0.0037,
      fRef: 10e9,
      t: 35e-6,
      roughness: 3.2e-6,
      name: 'RO4350B, 0.762 mm',
    },
    source: ROGERS_RO4000,
  },
];

/** The stackup a new board starts with: FR-4, 1.6 mm. */
export const DEFAULT_STACKUP: Stackup = (STACKUP_PRESETS[0] as StackupPreset).stackup;

/** The preset whose numbers the stackup holds, if any. */
export function stackupPreset(s: Stackup): StackupPreset | undefined {
  return STACKUP_PRESETS.find(
    (p) =>
      p.stackup.h === s.h &&
      p.stackup.er === s.er &&
      p.stackup.tanD === s.tanD &&
      p.stackup.fRef === s.fRef &&
      p.stackup.t === s.t &&
      p.stackup.roughness === s.roughness &&
      (s.rho === undefined || s.rho === COPPER_RESISTIVITY),
  );
}

/** True when every number of the stackup is usable by the model. */
export function isUsableStackup(s: Stackup): boolean {
  const pos = (v: number): boolean => Number.isFinite(v) && v > 0;
  const nonNeg = (v: number): boolean => Number.isFinite(v) && v >= 0;
  return (
    pos(s.h) &&
    Number.isFinite(s.er) &&
    s.er > 1 &&
    nonNeg(s.tanD) &&
    s.tanD < 1 &&
    pos(s.fRef) &&
    nonNeg(s.t) &&
    nonNeg(s.roughness) &&
    (s.rho === undefined || pos(s.rho))
  );
}

/** A stackup from stored or typed data, each unusable number replaced by the default's. */
export function normalizeStackup(raw: unknown, fallback: Stackup = DEFAULT_STACKUP): Stackup {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const num = (v: unknown, d: number, ok: (x: number) => boolean): number =>
    typeof v === 'number' && Number.isFinite(v) && ok(v) ? v : d;
  const out: Stackup = {
    h: num(r.h, fallback.h, (x) => x > 0),
    er: num(r.er, fallback.er, (x) => x > 1),
    tanD: num(r.tanD, fallback.tanD, (x) => x >= 0 && x < 1),
    fRef: num(r.fRef, fallback.fRef, (x) => x > 0),
    t: num(r.t, fallback.t, (x) => x >= 0),
    roughness: num(r.roughness, fallback.roughness, (x) => x >= 0),
  };
  const rho = num(r.rho, COPPER_RESISTIVITY, (x) => x > 0);
  const name = typeof r.name === 'string' && r.name.length <= 80 ? r.name : undefined;
  return {
    ...out,
    ...(rho !== COPPER_RESISTIVITY ? { rho } : {}),
    ...(name !== undefined ? { name } : {}),
  };
}

/** Complex relative permittivity eps' - j eps'' and loss tangent at frequency f. */
export interface Dielectric {
  /** eps' - j eps'' (the imaginary part is negative for a lossy dielectric). */
  readonly er: Complex;
  /** eps'' / eps'. */
  readonly tanD: number;
}

/**
 * The Djordjevic-Sarkar permittivity at frequency f (f >= 0) of a dielectric
 * with relative permittivity er and loss tangent tanD at fRef. A lossless
 * dielectric (tanD = 0) is er at every frequency.
 */
export function djordjevicSarkar(
  er: number,
  tanD: number,
  fRef: number,
  f: number,
  fLow = DS_F_LOW,
  fHigh = DS_F_HIGH,
): Dielectric {
  if (!(tanD > 0)) return { er: complex(er, 0), tanD: 0 };
  // k = ln((fHigh + j fRef) / (fLow + j fRef)); its imaginary part is negative.
  const k = clog(cdiv(complex(fHigh, fRef), complex(fLow, fRef)));
  const epsD = (-tanD * er) / k.im;
  const epsInf = er * (1 + (tanD * k.re) / k.im);
  const fd = clog(cdiv(complex(fHigh, f), complex(fLow, f)));
  const eps = cadd(complex(epsInf, 0), cscale(fd, epsD));
  return { er: eps, tanD: -eps.im / eps.re };
}

/** The stackup's dielectric at frequency f. */
export function stackupDielectric(s: Stackup, f: number): Dielectric {
  return djordjevicSarkar(s.er, s.tanD, s.fRef, f);
}

/** True when two stackups hold the same numbers (the name aside). */
export function sameStackupNumbers(a: Stackup, b: Stackup): boolean {
  return (
    a.h === b.h &&
    a.er === b.er &&
    a.tanD === b.tanD &&
    a.fRef === b.fRef &&
    a.t === b.t &&
    a.roughness === b.roughness &&
    (a.rho ?? COPPER_RESISTIVITY) === (b.rho ?? COPPER_RESISTIVITY)
  );
}

/** A short name: the stackup's own, the preset it matches, or "custom stackup". */
export function stackupLabel(s: Stackup): string {
  return s.name ?? stackupPreset(s)?.label ?? 'custom stackup';
}
