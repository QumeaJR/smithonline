/**
 * Tuning by dragging: the inverse of one element. Given the node before an
 * element and the point its node was dragged to, which value puts it there?
 *
 * A part can only move its node along its own locus, so the drag is read as
 * "the point on my locus nearest here": a series part reads only the series
 * reactance (or resistance) it has to add, a shunt part only the susceptance
 * (or conductance), a line only the rotation angle, a transformer only the
 * resistance ratio. RLC blocks have no single value to solve for and return null.
 *
 * Portions derived from QuickSmith-Web, copyright 2017 Nathan Iyer, MIT license
 * (engine.js tuneTo, commit ca1b69e612f3e7c753591e2a09c38e19110136ef),
 * extended with lines, stubs and the transformer.
 */
import { carg, cinv, type Complex } from './complex.js';
import { zToGamma } from './conversions.js';
import type { Element } from './elements.js';

/** Parts stay positive; dragging past the end pins the value here. */
export const TUNE_FLOOR = 1e-6;

/** Normalize an angle in radians to [0, 2 pi). */
function wrap(angle: number): number {
  const t = angle % (2 * Math.PI);
  return t < 0 ? t + 2 * Math.PI : t;
}

/**
 * The element with the value that moves `before` as close as possible to
 * `target` at frequency f, or null when the element cannot be tuned this way.
 */
export function tuneElement<T extends Element>(
  el: T,
  before: Complex,
  target: Complex,
  f: number,
): T | null {
  const w = 2 * Math.PI * f;
  switch (el.kind) {
    case 'R': {
      if (el.orientation === 'series') {
        return { ...el, value: Math.max(target.re - before.re, TUNE_FLOOR) };
      }
      const g = cinv(target).re - cinv(before).re;
      return { ...el, value: 1 / Math.max(g, TUNE_FLOOR) };
    }
    case 'L': {
      if (el.orientation === 'series') {
        return { ...el, value: Math.max(target.im - before.im, TUNE_FLOOR) / w };
      }
      const b = cinv(target).im - cinv(before).im;
      return { ...el, value: 1 / (w * Math.max(-b, TUNE_FLOOR)) };
    }
    case 'C': {
      if (el.orientation === 'series') {
        return { ...el, value: 1 / (w * Math.max(before.im - target.im, TUNE_FLOOR)) };
      }
      const b = cinv(target).im - cinv(before).im;
      return { ...el, value: Math.max(b, TUNE_FLOOR) / w };
    }
    case 'transformer': {
      if (!(before.re > 0) || !(target.re > 0)) return null;
      return { ...el, n: Math.sqrt(target.re / before.re) };
    }
    case 'line': {
      // A lossless line rotates Gamma (referenced to its own Z0) clockwise by 2 beta l.
      const gb = zToGamma(before, el.z0);
      const gt = zToGamma(target, el.z0);
      const rotation = wrap(carg(gb) - carg(gt));
      return { ...el, length: lengthFromRadians(el, rotation / 2, f) };
    }
    case 'openStub': {
      // Y = j Y0 tan(bl): the stub adds the susceptance the drag asks for.
      const b = cinv(target).im - cinv(before).im;
      const bl = wrap(Math.atan(b * el.z0));
      return { ...el, length: lengthFromRadians(el, bl > Math.PI ? bl - Math.PI : bl, f) };
    }
    case 'shortStub': {
      // Y = -j Y0 cot(bl): tan(bl) = -1 / (B Z0).
      const b = cinv(target).im - cinv(before).im;
      const safe = Math.abs(b) < TUNE_FLOOR ? (b < 0 ? -TUNE_FLOOR : TUNE_FLOOR) : b;
      const bl = wrap(Math.atan(-1 / (safe * el.z0)));
      return { ...el, length: lengthFromRadians(el, bl > Math.PI ? bl - Math.PI : bl, f) };
    }
    case 'RLC':
      return null;
  }
}

/** Electrical length in wavelengths at the element's reference frequency from radians at f. */
function lengthFromRadians(el: { refFrequency?: number }, radians: number, f: number): number {
  const scale = el.refFrequency === undefined ? 1 : el.refFrequency / f;
  return Math.max((radians / (2 * Math.PI)) * scale, TUNE_FLOOR);
}

/** Whether dragging the node after this element can change its value. */
export function isTunable(el: Element): boolean {
  return el.kind !== 'RLC';
}
