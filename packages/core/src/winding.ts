/**
 * Inductor winding calculators: how many turns, and how much wire.
 *
 * Air-core single-layer solenoid by Wheeler's formula (public, 1928):
 *
 *     L [uH] = D^2 N^2 / (18 D + 40 l)        D and l in inches
 *
 * with D the mean diameter of the winding and l its length. It is good to
 * about 1 % for l > 0.4 D; a short fat coil is off by more and the result
 * says so. A toroid follows L = AL N^2 with the AL value of the core (the
 * catalogue gives nH per turn squared).
 *
 * The built-in core table lists a few common Amidon-style iron powder (T)
 * and ferrite (FT) cores. AL has a tolerance of 5 to 25 percent, and the
 * numbers here were written from memory of the public data sheets, not
 * copied from them: check the data sheet of the actual core before winding,
 * and edit or extend the table.
 */

const INCH = 0.0254;

export interface SolenoidInput {
  /** Wanted inductance, H. */
  readonly inductance: number;
  /** Mean diameter of the winding (centre of the wire to centre of the wire), m. */
  readonly diameter: number;
  /** Length of the winding, m. Either this or `pitch`. */
  readonly length?: number;
  /** Distance from turn to turn, m (the wire diameter for a close winding). Used when `length` is absent. */
  readonly pitch?: number;
  /** Extra wire for the two leads, m. Default 0. */
  readonly leads?: number;
}

export interface SolenoidResult {
  /** The turns that give exactly the wanted inductance. */
  readonly exactTurns: number;
  /** The whole number of turns to wind, nearest to the exact one. */
  readonly turns: number;
  /** Winding length used for the rounded turns, m. */
  readonly length: number;
  /** Inductance of the rounded winding, H. */
  readonly inductance: number;
  /** Wire for the turns plus the leads, m. */
  readonly wireLength: number;
  /** Length over diameter of the winding. */
  readonly lengthToDiameter: number;
  /** Set when the formula is outside its stated accuracy. */
  readonly warning?: string;
}

/** Inductance of an air-core single-layer solenoid by Wheeler's formula, H. */
export function solenoidInductance(turns: number, diameter: number, length: number): number {
  const d = diameter / INCH;
  const l = length / INCH;
  return (1e-6 * d * d * turns * turns) / (18 * d + 40 * l);
}

/** Turns of the single-layer solenoid for a length, fractional. */
function turnsForLength(inductance: number, diameter: number, length: number): number {
  const d = diameter / INCH;
  const l = length / INCH;
  return Math.sqrt((inductance * 1e6 * (18 * d + 40 * l)) / (d * d));
}

/** Turns for a pitch (the length grows with the turns): the positive root of D^2 N^2 - 40 p L N - 18 D L = 0. */
function turnsForPitch(inductance: number, diameter: number, pitch: number): number {
  const d = diameter / INCH;
  const p = pitch / INCH;
  const L = inductance * 1e6;
  return (40 * p * L + Math.sqrt((40 * p * L) ** 2 + 72 * d ** 3 * L)) / (2 * d * d);
}

/**
 * Turns and wire for an air-core single-layer solenoid. With a length given
 * the turns are spaced evenly over it; with a pitch given the length follows
 * from the turns. Returns null for input that cannot be wound (a
 * non-positive inductance, diameter, length or pitch).
 */
export function solenoidTurns(input: SolenoidInput): SolenoidResult | null {
  const { inductance, diameter } = input;
  const positive = (v: number | undefined): v is number =>
    v !== undefined && Number.isFinite(v) && v > 0;
  if (!positive(inductance) || !positive(diameter)) return null;
  const byLength = positive(input.length);
  if (!byLength && !positive(input.pitch)) return null;

  const exact = byLength
    ? turnsForLength(inductance, diameter, input.length as number)
    : turnsForPitch(inductance, diameter, input.pitch as number);
  const turns = Math.max(1, Math.round(exact));
  const length = byLength ? (input.length as number) : turns * (input.pitch as number);
  const achieved = solenoidInductance(turns, diameter, length);
  const ratio = length / diameter;
  const leads = Math.max(0, input.leads ?? 0);
  return {
    exactTurns: exact,
    turns,
    length,
    inductance: achieved,
    wireLength: turns * Math.PI * diameter + leads,
    lengthToDiameter: ratio,
    ...(ratio < 0.4
      ? {
          warning:
            'Length under 0.4 of the diameter: Wheeler’s formula is then only good to a few percent.',
        }
      : {}),
  };
}

/** A toroidal core: the AL value and the size, as a user can edit them. */
export interface ToroidCore {
  readonly name: string;
  /** nH per turn squared. */
  readonly al: number;
  /** Outer diameter, mm. */
  readonly od: number;
  /** Inner diameter, mm. */
  readonly id: number;
  /** Height, mm. */
  readonly height: number;
}

/**
 * Common Amidon-style cores: iron powder -2 (red, low permeability, RF
 * power) and -6 (yellow), ferrite -43 and -61. Sizes in mm from the inch
 * dimensions; coating is not subtracted. Check before use.
 */
export const TOROID_CORES: readonly ToroidCore[] = [
  { name: 'T37-2', al: 4.0, od: 9.53, id: 5.21, height: 3.25 },
  { name: 'T50-2', al: 4.9, od: 12.7, id: 7.7, height: 4.83 },
  { name: 'T68-2', al: 5.7, od: 17.5, id: 9.4, height: 4.83 },
  { name: 'T80-2', al: 5.5, od: 20.2, id: 12.6, height: 6.35 },
  { name: 'T106-2', al: 13.5, od: 26.9, id: 14.5, height: 11.1 },
  { name: 'T200-2', al: 12.0, od: 50.8, id: 31.8, height: 14.0 },
  { name: 'T37-6', al: 3.0, od: 9.53, id: 5.21, height: 3.25 },
  { name: 'T50-6', al: 4.0, od: 12.7, id: 7.7, height: 4.83 },
  { name: 'T68-6', al: 4.7, od: 17.5, id: 9.4, height: 4.83 },
  { name: 'T106-6', al: 11.6, od: 26.9, id: 14.5, height: 11.1 },
  { name: 'FT37-43', al: 420, od: 9.5, id: 4.75, height: 3.18 },
  { name: 'FT50-43', al: 523, od: 12.7, id: 7.14, height: 4.75 },
  { name: 'FT82-43', al: 557, od: 20.95, id: 13.2, height: 6.35 },
  { name: 'FT50-61', al: 68, od: 12.7, id: 7.14, height: 4.75 },
];

export interface ToroidInput {
  /** Wanted inductance, H. */
  readonly inductance: number;
  /** AL value, nH per turn squared. */
  readonly al: number;
  /** Mean length of one turn, m; when absent the wire length is not computed. */
  readonly turnLength?: number;
  /** Extra wire for the two leads, m. Default 0. */
  readonly leads?: number;
}

export interface ToroidResult {
  readonly exactTurns: number;
  readonly turns: number;
  /** Inductance of the rounded winding, H. */
  readonly inductance: number;
  /** Wire for the turns plus the leads, m; null without a turn length. */
  readonly wireLength: number | null;
}

/** Turns N = sqrt(L / AL) on a toroid, rounded to whole turns (a pass through the hole is one turn). */
export function toroidTurns(input: ToroidInput): ToroidResult | null {
  const { inductance, al } = input;
  if (!(inductance > 0) || !(al > 0) || !Number.isFinite(inductance) || !Number.isFinite(al)) {
    return null;
  }
  const alH = al * 1e-9;
  const exact = Math.sqrt(inductance / alH);
  const turns = Math.max(1, Math.round(exact));
  const leads = Math.max(0, input.leads ?? 0);
  return {
    exactTurns: exact,
    turns,
    inductance: alH * turns * turns,
    wireLength:
      input.turnLength !== undefined && input.turnLength > 0
        ? turns * input.turnLength + leads
        : null,
  };
}

/** Mean length of one turn around the core's cross-section, m: twice the height plus twice the wall width. */
export function toroidTurnLength(core: Pick<ToroidCore, 'od' | 'id' | 'height'>): number {
  return (2 * core.height + (core.od - core.id)) * 1e-3;
}
