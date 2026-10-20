/**
 * Share links: the design as compact JSON in the URL fragment, base64url
 * encoded so it survives every chat client and spreadsheet.
 */
import type { Element } from '@smithonline/core';
import { DEFAULT_SWEEP, identify, type Design } from './design';

const ELEMENT_KINDS = new Set([
  'R',
  'L',
  'C',
  'RLC',
  'transformer',
  'line',
  'openStub',
  'shortStub',
]);

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Six significant figures are plenty for a shared design and keep the link short. */
function round(v: number): number {
  return Number(v.toPrecision(6));
}

function roundDeep<T>(value: T): T {
  if (typeof value === 'number') return round(value) as T;
  if (Array.isArray(value)) return value.map(roundDeep) as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v !== undefined) out[k] = roundDeep(v);
    }
    return out as T;
  }
  return value;
}

export function encodeDesign(design: Design): string {
  const json = JSON.stringify({ v: 1, ...roundDeep(design) });
  return toBase64Url(new TextEncoder().encode(json));
}

function isElement(value: unknown): value is Element {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { kind?: unknown }).kind === 'string' &&
    ELEMENT_KINDS.has((value as { kind: string }).kind)
  );
}

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Decode a share link payload. Returns null when it is not a design. */
export function decodeDesign(text: string): Design | null {
  try {
    const json = new TextDecoder().decode(fromBase64Url(text));
    const raw = JSON.parse(json) as Record<string, unknown>;
    if (!Array.isArray(raw.elements) || !raw.elements.every(isElement)) return null;
    const load = raw.load as { re?: unknown; im?: unknown } | undefined;
    const sweep = (raw.sweep ?? {}) as Record<string, unknown>;
    return {
      name: typeof raw.name === 'string' ? raw.name : 'Shared design',
      z0: num(raw.z0, 50),
      frequency: num(raw.frequency, 1e9),
      load: { re: num(load?.re, 50), im: num(load?.im, 0) },
      elements: identify(raw.elements),
      vswrCircles: Array.isArray(raw.vswrCircles)
        ? raw.vswrCircles.filter((v) => typeof v === 'number')
        : [],
      qContours: Array.isArray(raw.qContours)
        ? raw.qContours.filter((v) => typeof v === 'number')
        : [],
      sweep: {
        enabled: sweep.enabled === true,
        start: num(sweep.start, DEFAULT_SWEEP.start),
        stop: num(sweep.stop, DEFAULT_SWEEP.stop),
        points: num(sweep.points, DEFAULT_SWEEP.points),
      },
    };
  } catch {
    return null;
  }
}

/** The design currently encoded in the page URL, if any. */
export function designFromLocation(hash: string): Design | null {
  const m = /^#d=([A-Za-z0-9_-]+)$/.exec(hash);
  return m?.[1] ? decodeDesign(m[1]) : null;
}

export function shareUrl(design: Design, base: string): string {
  return `${base}#d=${encodeDesign(design)}`;
}
