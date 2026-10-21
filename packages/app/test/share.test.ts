import { describe, expect, it } from 'vitest';
import { emptyDesign, identify, type Design } from '../src/lib/design';
import { decodeDesign, designFromLocation, encodeDesign, shareUrl } from '../src/lib/share';

const sample: Design = {
  ...emptyDesign(),
  name: 'Example 5',
  frequency: 450e6,
  load: { re: 20, im: -12 },
  target: { re: 75, im: -5 },
  elements: identify([
    { kind: 'L', orientation: 'shunt', value: 1.6033386409903585e-8 },
    { kind: 'C', orientation: 'series', value: 2.1835513398047903e-11, q: 50 },
    { kind: 'line', z0: 50, length: 0.2081, refFrequency: 450e6, er: 1, alphaDbPerM: 0 },
    { kind: 'RLC', orientation: 'shunt', connection: 'series', r: 5, l: 1e-8, c: 1e-12 },
    { kind: 'transformer', n: 2 },
  ]),
  qContours: [0.6],
  vswrCircles: [1.5],
  sweep: { enabled: true, start: 100e6, stop: 1e9, points: 91 },
};

describe('share link codec', () => {
  it('round-trips a design to six significant figures', () => {
    const decoded = decodeDesign(encodeDesign(sample));
    expect(decoded).not.toBeNull();
    expect(decoded?.name).toBe('Example 5');
    expect(decoded?.load).toEqual({ re: 20, im: -12 });
    expect(decoded?.target).toEqual({ re: 75, im: -5 });
    expect(decodeDesign(encodeDesign(emptyDesign()))?.target).toBeNull();
    expect(decoded?.elements).toHaveLength(5);
    expect(decoded?.elements[0]).toEqual({
      kind: 'L',
      orientation: 'shunt',
      value: 1.60334e-8,
      id: sample.elements[0]!.id,
      color: sample.elements[0]!.color,
    });
    expect(decoded?.elements[1]).toMatchObject({ kind: 'C', q: 50 });
    expect(decoded?.elements[4]).toMatchObject({ kind: 'transformer', n: 2 });
    // Colours and ids travel with the link so a shared design looks the same.
    expect(decoded?.elements.map((e) => e.color)).toEqual(sample.elements.map((e) => e.color));
    expect(decoded?.qContours).toEqual([0.6]);
    expect(decoded?.sweep).toEqual(sample.sweep);
  });

  it('produces a URL-safe payload', () => {
    const text = encodeDesign(sample);
    expect(text).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(shareUrl(sample, 'https://example.test/smith/')).toBe(
      `https://example.test/smith/#d=${text}`,
    );
    expect(designFromLocation(`#d=${text}`)?.name).toBe('Example 5');
    expect(designFromLocation('#other')).toBeNull();
    expect(designFromLocation('')).toBeNull();
  });

  it('rejects payloads that are not designs', () => {
    expect(decodeDesign('not base64!')).toBeNull();
    expect(decodeDesign(btoa('{"hello":1}'))).toBeNull();
    expect(decodeDesign(btoa('{"elements":[{"kind":"warp"}]}'))).toBeNull();
    expect(decodeDesign(btoa('[]'))).toBeNull();
  });

  it('assigns ids and colours to elements from an old payload', () => {
    const old = decodeDesign(btoa('{"elements":[{"kind":"R","orientation":"series","value":5}]}'));
    expect(old?.elements[0]).toMatchObject({ kind: 'R', value: 5 });
    expect(old?.elements[0]?.id).toMatch(/^[a-z0-9]+$/);
    expect(old?.elements[0]?.color).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('fills in defaults for missing optional fields', () => {
    const minimal = decodeDesign(btoa('{"elements":[]}'));
    expect(minimal).toMatchObject({
      z0: 50,
      frequency: 1e9,
      load: { re: 50, im: 0 },
      sweep: { enabled: false },
    });
  });
});
