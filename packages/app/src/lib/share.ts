/**
 * Share links: the design as compact JSON in the URL fragment, base64url
 * encoded so it survives every chat client and spreadsheet.
 */
import {
  E_SERIES,
  isPackageId,
  REALIZE_SCOPES,
  type Element,
  type SweepLoad,
} from '@smithonline/core';
import {
  DEFAULT_LOSSES,
  DEFAULT_REALIZE,
  DEFAULT_SWEEP,
  identify,
  type Design,
  type GainCircleSpec,
  type LossSettings,
  type RealizeSettings,
  type TwoPort,
  type TwoPortSource,
} from './design';
import { limitsOf, stressPatch, tolerancePatch } from './build';
import { MAX_DATAPOINTS } from './datapoints';

function realizeOf(value: unknown): RealizeSettings {
  const raw = (value ?? {}) as Record<string, unknown>;
  const series = raw.series;
  return {
    enabled: raw.enabled === true,
    series:
      series === 'stock' || (E_SERIES as readonly unknown[]).includes(series)
        ? (series as RealizeSettings['series'])
        : DEFAULT_REALIZE.series,
    stockText: typeof raw.stockText === 'string' ? raw.stockText : '',
    scope: (REALIZE_SCOPES as readonly unknown[]).includes(raw.scope)
      ? (raw.scope as RealizeSettings['scope'])
      : DEFAULT_REALIZE.scope,
  };
}

function lossesOf(value: unknown): LossSettings {
  const raw = (value ?? {}) as Record<string, unknown>;
  return {
    enabled: raw.enabled === true,
    inductorQ: num(raw.inductorQ, DEFAULT_LOSSES.inductorQ),
    capacitorQ: num(raw.capacitorQ, DEFAULT_LOSSES.capacitorQ),
  };
}

const GAIN_CIRCLE_TYPES = new Set(['available', 'operating', 'unilateralSource', 'unilateralLoad']);

function cx(value: unknown): { re: number; im: number } | null {
  const v = value as { re?: unknown; im?: unknown } | null;
  if (!v || !Number.isFinite(v.re) || !Number.isFinite(v.im)) return null;
  return { re: v.re as number, im: v.im as number };
}

function twoPortOf(value: unknown): TwoPort | null {
  const raw = value as {
    s?: Record<string, unknown>;
    noise?: Record<string, unknown>;
    source?: unknown;
  } | null;
  if (!raw || !raw.s) return null;
  const s11 = cx(raw.s.s11);
  const s12 = cx(raw.s.s12);
  const s21 = cx(raw.s.s21);
  const s22 = cx(raw.s.s22);
  if (!s11 || !s12 || !s21 || !s22) return null;
  const n = raw.noise;
  const gammaOpt = n ? cx(n.gammaOpt) : null;
  const noise =
    n && gammaOpt && finite(n.nfMinDb) && finite(n.rn)
      ? { nfMinDb: n.nfMinDb, gammaOpt, rn: n.rn }
      : null;
  const source = sourceOf(raw.source);
  return source
    ? { s: { s11, s12, s21, s22 }, noise, source }
    : { s: { s11, s12, s21, s22 }, noise };
}

function sourceOf(value: unknown): TwoPortSource | null {
  const v = value as Record<string, unknown> | null | undefined;
  if (!v || typeof v.fileName !== 'string' || typeof v.frequency !== 'number') return null;
  const covers = numbers(v.covers);
  if (covers.length !== 2 || (covers[0] as number) > (covers[1] as number)) return null;
  if (!Number.isFinite(v.frequency) || (v.frequency as number) <= 0) return null;
  return {
    fileName: v.fileName,
    frequency: v.frequency as number,
    covers: [covers[0] as number, covers[1] as number],
    clamped: v.clamped === true,
    ...(typeof v.fileId === 'string' ? { fileId: v.fileId } : {}),
  };
}

/** Sweep loads from a link are capped like sweep points: a longer list is a hostile link. */
const MAX_SWEEP_LOADS = 2001;

function loadsOf(value: unknown): SweepLoad[] {
  if (!Array.isArray(value)) return [];
  const out: SweepLoad[] = [];
  for (const item of value) {
    if (out.length >= MAX_SWEEP_LOADS) break;
    const l = item as { frequency?: unknown; z?: unknown } | null;
    const z = l ? cx(l.z) : null;
    if (l && z && positive(l.frequency)) out.push({ frequency: l.frequency, z });
  }
  return out;
}

function gainCirclesOf(value: unknown): GainCircleSpec[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (g): g is GainCircleSpec =>
      typeof g === 'object' &&
      g !== null &&
      GAIN_CIRCLE_TYPES.has((g as { type?: string }).type ?? '') &&
      finite((g as { gainDb?: unknown }).gainDb),
  );
}

function numbers(value: unknown): number[] {
  return Array.isArray(value)
    ? value.filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
    : [];
}

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

function finite(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}
function positive(v: unknown): v is number {
  return finite(v) && v > 0;
}
const optional = (v: unknown, ok: (x: unknown) => boolean): boolean => v === undefined || ok(v);

/** An element with every field its kind needs, in range; a link cannot carry anything else. */
function isElement(value: unknown): value is Element {
  if (typeof value !== 'object' || value === null) return false;
  const e = value as Record<string, unknown>;
  if (typeof e.kind !== 'string' || !ELEMENT_KINDS.has(e.kind)) return false;
  const orientation = e.orientation === 'series' || e.orientation === 'shunt';
  switch (e.kind) {
    case 'R':
      return orientation && finite(e.value) && e.value >= 0;
    case 'L':
    case 'C':
      // The package is a name the table resolves; parasitics are derived and never travel.
      return (
        orientation &&
        finite(e.value) &&
        e.value >= 0 &&
        optional(e.q, finite) &&
        optional(e.package, isPackageId) &&
        e.parasitics === undefined
      );
    case 'RLC':
      return (
        orientation &&
        (e.connection === 'series' || e.connection === 'parallel') &&
        optional(e.r, finite) &&
        optional(e.l, finite) &&
        optional(e.c, finite)
      );
    case 'transformer':
      return positive(e.n);
    case 'line':
      return (
        positive(e.z0) &&
        finite(e.length) &&
        optional(e.refFrequency, positive) &&
        optional(e.er, (v) => positive(v) && (v as number) >= 1) &&
        optional(e.alphaDbPerM, finite)
      );
    case 'openStub':
    case 'shortStub':
      return positive(e.z0) && finite(e.length) && optional(e.refFrequency, positive);
    default:
      return false;
  }
}

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function sweepOf(sweep: Record<string, unknown>): Design['sweep'] {
  const base = {
    enabled: sweep.enabled === true,
    start: positive(sweep.start) ? sweep.start : DEFAULT_SWEEP.start,
    stop: positive(sweep.stop) ? sweep.stop : DEFAULT_SWEEP.stop,
    points: Math.min(2001, Math.max(2, Math.round(num(sweep.points, DEFAULT_SWEEP.points)))),
  };
  const loads = loadsOf(sweep.loads);
  if (loads.length === 0) return base;
  return {
    ...base,
    loads,
    ...(typeof sweep.loadsName === 'string' ? { loadsName: sweep.loadsName.slice(0, 200) } : {}),
    ...(sweep.mode === 'frequency' || sweep.mode === 'datapoints' ? { mode: sweep.mode } : {}),
  };
}

/** The other user datapoints and the start's place; both absent for a single load. */
function datapointsOf(raw: Record<string, unknown>): Pick<Design, 'datapoints' | 'startSlot'> {
  const others = loadsOf(raw.datapoints).slice(0, MAX_DATAPOINTS - 1);
  if (others.length === 0) return {};
  const slot = Math.trunc(num(raw.startSlot, 0));
  return { datapoints: others, startSlot: Math.min(Math.max(slot, 0), others.length) };
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
      name: typeof raw.name === 'string' ? raw.name.slice(0, 200) : 'Shared design',
      z0: positive(raw.z0) ? raw.z0 : 50,
      frequency: positive(raw.frequency) ? raw.frequency : 1e9,
      load: { re: num(load?.re, 50), im: num(load?.im, 0) },
      ...datapointsOf(raw),
      target: cx(raw.target),
      elements: identify(raw.elements),
      vswrCircles: numbers(raw.vswrCircles),
      qContours: numbers(raw.qContours),
      sweep: sweepOf(sweep),
      twoPort: twoPortOf(raw.twoPort),
      showStability: raw.showStability === true,
      gainCircles: gainCirclesOf(raw.gainCircles),
      noiseCircles: numbers(raw.noiseCircles),
      realize: realizeOf(raw.realize),
      losses: lossesOf(raw.losses),
      ...(limitsOf(raw.limits).length > 0 ? { limits: limitsOf(raw.limits) } : {}),
      ...stressPatch(raw.stress),
      ...tolerancePatch(raw.tolerance),
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
