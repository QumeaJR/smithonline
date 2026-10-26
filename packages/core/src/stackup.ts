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
  '1 oz (35 µm) copper. The data sheet gives no roughness; 3.2 µm RMS is the value Rogers ' +
  'publication 92-243 ("Copper foils for high frequency circuit materials", table 1) gives for ' +
  'standard 1 oz electrodeposited foil, taken here as an assumption for the HTE foil of FR-4.';

const ROGERS_RO4000 =
  'Rogers RO4000 data sheet (RO4003C and RO4350B): design Dk 3.55 (RO4003C) and 3.66 (RO4350B), ' +
  'the values Rogers recommends for circuit design (differential phase length method, 8 to 40 GHz); ' +
  'Df 0.0027 and 0.0037 at 10 GHz. 1 oz (35 µm) electrodeposited copper with 3.2 µm RMS ' +
  'roughness on the treated side (Rogers publication 92-243, table 1; LoPro foil is 0.9 µm).';

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

/**
 * The range of each number of a stackup the model accepts, inclusive. The
 * height and the copper stay within what a board can be, er and tanD within
 * the Build > Board fields. The reference frequency has its own rule: it
 * lies strictly inside the Djordjevic-Sarkar band (DS_F_LOW < fRef <
 * DS_F_HIGH); outside it the model's eps_d and eps_inf blow up (fRef 1 Hz
 * gives eps' near -900 at 1 GHz on FR-4).
 */
export const STACKUP_LIMITS = {
  h: { min: 1e-6, max: 0.1 },
  er: { min: 1.0001, max: 100 },
  tanD: { min: 0, max: 0.5 },
  t: { min: 0, max: 1e-3 },
  roughness: { min: 0, max: 100e-6 },
  rho: { min: 1e-9, max: 1e-4 },
} as const;

/** Longest stackup name kept, characters; a longer one is cut. */
export const STACKUP_NAME_MAX = 80;

/** Highest frequency at which a stackup's permittivity must stay physical (eps' >= 1), Hz. */
export const DS_CHECK_F_MAX = 110e9;

/** Why a stackup cannot be used: the number at fault and a reason that reads after its value. */
export interface StackupProblem {
  readonly field: 'h' | 'er' | 'tanD' | 'fRef' | 't' | 'roughness' | 'rho';
  readonly reason: string;
}

const inRange = (v: number, r: { readonly min: number; readonly max: number }): boolean =>
  Number.isFinite(v) && v >= r.min && v <= r.max;

/** True when fRef lies strictly inside the Djordjevic-Sarkar band. */
export function isDsReference(fRef: number): boolean {
  return Number.isFinite(fRef) && fRef > DS_F_LOW && fRef < DS_F_HIGH;
}

/**
 * The lowest real permittivity of the Djordjevic-Sarkar model from 1 Hz to
 * DS_CHECK_F_MAX. eps' falls monotonically with frequency (a sum of Debye
 * relaxations), so it is the value at the top; the decades below are taken
 * as well so that a rounding in the logarithm cannot hide a dip.
 */
export function dsLowestPermittivity(er: number, tanD: number, fRef: number): number {
  let lowest = Infinity;
  for (const f of [1, 1e3, 1e6, 1e9, 1e10, 1e11, DS_CHECK_F_MAX]) {
    lowest = Math.min(lowest, djordjevicSarkar(er, tanD, fRef, f).er.re);
  }
  return lowest;
}

/** True when er, tanD and fRef give a physical Djordjevic-Sarkar permittivity up to 110 GHz. */
function dsPhysical(er: number, tanD: number, fRef: number): boolean {
  return tanD === 0 || dsLowestPermittivity(er, tanD, fRef) >= 1;
}

const LIMIT_TEXT: Record<keyof typeof STACKUP_LIMITS, string> = {
  h: '1 µm to 100 mm',
  er: '1.0001 to 100',
  tanD: '0 to 0.5',
  t: '0 to 1 mm',
  roughness: '0 to 100 µm',
  rho: '1e-9 to 1e-4 Ω m',
};

/**
 * The first number of the stackup the model cannot use, with the reason, or
 * null when the stackup is usable: a number missing, not finite or outside
 * STACKUP_LIMITS, a reference frequency outside the Djordjevic-Sarkar band,
 * or an er, tanD and fRef whose eps'(f) falls below 1 (below vacuum)
 * somewhere from 1 Hz to 110 GHz, which a high loss tangent on a low er does
 * (tanD 0.3 on er 4.17 at 1 GHz: eps' 0.50 at 100 GHz).
 */
export function stackupProblem(s: Stackup): StackupProblem | null {
  const L = STACKUP_LIMITS;
  const out = (field: keyof typeof STACKUP_LIMITS): StackupProblem => ({
    field,
    reason: `is outside ${LIMIT_TEXT[field]}`,
  });
  if (!inRange(s.h, L.h)) return out('h');
  if (!inRange(s.er, L.er)) return out('er');
  if (!inRange(s.tanD, L.tanD)) return out('tanD');
  if (!isDsReference(s.fRef)) {
    return {
      field: 'fRef',
      reason: 'is not between 1 kHz and 1 THz, the band of the Djordjevic-Sarkar model',
    };
  }
  if (!inRange(s.t, L.t)) return out('t');
  if (!inRange(s.roughness, L.roughness)) return out('roughness');
  if (s.rho !== undefined && !inRange(s.rho, L.rho)) return out('rho');
  if (!dsPhysical(s.er, s.tanD, s.fRef)) {
    return {
      field: 'tanD',
      reason:
        'makes the permittivity fall below 1 (below vacuum) by 110 GHz in the Djordjevic-Sarkar ' +
        'model; lower the loss tangent or raise εr',
    };
  }
  return null;
}

/**
 * True when every number of the stackup is usable by the model (see
 * stackupProblem): in range, the reference frequency inside the
 * Djordjevic-Sarkar band, and a permittivity that stays at or above 1 up to
 * 110 GHz.
 */
export function isUsableStackup(s: Stackup): boolean {
  return stackupProblem(s) === null;
}

/**
 * A stackup from stored or typed data: each number that is missing, not
 * finite or out of range replaced by the fallback's, and, when er, tanD and
 * fRef together are unphysical, all three taken from the fallback. A name
 * that is not a string is dropped, one longer than STACKUP_NAME_MAX cut.
 */
export function normalizeStackup(raw: unknown, fallback: Stackup = DEFAULT_STACKUP): Stackup {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const L = STACKUP_LIMITS;
  const num = (v: unknown, d: number, ok: (x: number) => boolean): number =>
    typeof v === 'number' && Number.isFinite(v) && ok(v) ? v : d;
  let out: Stackup = {
    h: num(r.h, fallback.h, (x) => inRange(x, L.h)),
    er: num(r.er, fallback.er, (x) => inRange(x, L.er)),
    tanD: num(r.tanD, fallback.tanD, (x) => inRange(x, L.tanD)),
    fRef: num(r.fRef, fallback.fRef, isDsReference),
    t: num(r.t, fallback.t, (x) => inRange(x, L.t)),
    roughness: num(r.roughness, fallback.roughness, (x) => inRange(x, L.roughness)),
  };
  if (!dsPhysical(out.er, out.tanD, out.fRef)) {
    out = { ...out, er: fallback.er, tanD: fallback.tanD, fRef: fallback.fRef };
  }
  const rho =
    r.rho === undefined
      ? COPPER_RESISTIVITY
      : num(r.rho, fallback.rho ?? COPPER_RESISTIVITY, (x) => inRange(x, L.rho));
  const name = typeof r.name === 'string' ? r.name.slice(0, STACKUP_NAME_MAX) : undefined;
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

/**
 * The stackup's dielectric at frequency f. A stackup whose er, tanD and fRef
 * the model cannot use (see stackupProblem) is read as lossless with er at
 * every frequency, so a hand-built element never turns into NaN; the
 * application refuses such a stackup at every entry (the fields, files, share
 * links, stored settings), so it never evaluates one.
 */
export function stackupDielectric(s: Stackup, f: number): Dielectric {
  const usable =
    isDsReference(s.fRef) &&
    s.tanD >= 0 &&
    s.tanD <= STACKUP_LIMITS.tanD.max &&
    dsPhysical(s.er, s.tanD, s.fRef);
  if (!usable) return { er: complex(s.er, 0), tanD: 0 };
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

/**
 * A short name: the preset the numbers match, else the stackup's own name,
 * else "custom stackup". A name that is a preset's label counts only while
 * the numbers are that preset's: a design made before a preset changed, or a
 * link, must not show a preset name on other numbers.
 */
export function stackupLabel(s: Stackup): string {
  const preset = stackupPreset(s);
  if (preset) return preset.label;
  if (s.name !== undefined && !STACKUP_PRESETS.some((p) => p.label === s.name)) return s.name;
  return 'custom stackup';
}
