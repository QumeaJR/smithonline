/**
 * S-parameter files re-expressed as Z, Y, H or ABCD parameters and written as
 * Touchstone text (the S-Plot export of Smith V4.1).
 *
 * Touchstone 1 normalizes Z, Y and H data to the `R` of the option line. A
 * normalized export keeps `R z0` and writes z = Z / z0 and so on. An
 * unnormalized export writes ohm and siemens and states `R 1`, which is the
 * only reading of the option line under which those numbers are correct for a
 * reader that follows the specification. ABCD is not a Touchstone 1 keyword;
 * it is written with the letter `A` and the column order A B C D, and a
 * comment line says so.
 */
import {
  convertS,
  supportedParameters,
  NetworkParameterError,
  type NetworkParameter,
} from '../netparams.js';
import {
  writeTouchstone,
  type FrequencyUnit,
  type TouchstoneData,
  type TouchstoneFormat,
  type TouchstonePoint,
} from './touchstone.js';

export interface ConvertedTouchstoneOptions {
  /** Divide by the reference impedance as Touchstone does. Default true. */
  readonly normalized?: boolean;
  readonly format?: TouchstoneFormat;
  /** Default: the unit of the source file. */
  readonly frequencyUnit?: FrequencyUnit;
  readonly digits?: number;
  /** Extra comment lines at the top, without the `!`. */
  readonly comments?: readonly string[];
}

const NAMES: Readonly<Record<NetworkParameter, string>> = {
  S: 'S-parameters',
  Z: 'Z-parameters',
  Y: 'Y-parameters',
  H: 'H-parameters',
  ABCD: 'ABCD parameters',
};

/** The points of `data` converted to `to`, one matrix per frequency. */
export function convertTouchstonePoints(
  data: TouchstoneData,
  to: NetworkParameter,
  normalized = true,
): TouchstonePoint[] {
  if (data.parameter !== 'S') {
    throw new NetworkParameterError(
      `Only S-parameter data can be converted (file holds ${data.parameter})`,
    );
  }
  if (!supportedParameters(data.ports).includes(to)) {
    throw new NetworkParameterError(
      `${NAMES[to]} are defined for two-ports only; this file has ${data.ports} ports`,
    );
  }
  return data.points.map((p) => {
    try {
      return { frequency: p.frequency, s: convertS(p.s, to, data.z0, normalized) };
    } catch (err) {
      if (err instanceof NetworkParameterError) {
        throw new NetworkParameterError(`At ${p.frequency} Hz: ${err.message}`);
      }
      throw err;
    }
  });
}

/**
 * Touchstone text of `data` as `to`. S keeps the noise block of a two-port;
 * the other parameter types drop it (a noise block belongs to S).
 */
export function writeConvertedTouchstone(
  data: TouchstoneData,
  to: NetworkParameter,
  options: ConvertedTouchstoneOptions = {},
): string {
  const normalized = options.normalized ?? true;
  const points = convertTouchstonePoints(data, to, normalized);
  const dimensionless = to === 'S';
  const unnormalized = !normalized && !dimensionless;
  const comments = [
    ...(options.comments ?? []),
    `${NAMES[to]}${
      dimensionless
        ? ''
        : unnormalized
          ? ' in ohm and siemens (unnormalized)'
          : ` normalized to ${data.z0} ohm`
    }`,
    ...(unnormalized
      ? [`reference resistance R 1 on the option line; source Z0 was ${data.z0} ohm`]
      : []),
    ...(to === 'ABCD'
      ? ['chain matrix in the order A B C D; B in ohm and C in siemens when unnormalized']
      : []),
  ];
  return writeTouchstone(
    {
      ports: data.ports,
      z0: unnormalized ? 1 : data.z0,
      points,
      ...(to === 'S' && data.noise.length > 0 ? { noise: data.noise } : {}),
    },
    {
      format: options.format ?? data.format,
      frequencyUnit: options.frequencyUnit ?? data.frequencyUnit,
      parameter: to === 'ABCD' ? 'A' : to,
      comments,
      ...(options.digits === undefined ? {} : { digits: options.digits }),
    },
  );
}
