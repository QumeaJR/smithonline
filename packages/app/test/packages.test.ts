import { DEFAULT_PACKAGES, evaluateLadder, packageById } from '@smithonline/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { emptyDesign, identify, type Design } from '../src/lib/design';
import { packagedElements } from '../src/lib/realize';
import { buildReportParts, packagesNote } from '../src/lib/reportParts';
import { decodeDesign, encodeDesign } from '../src/lib/share';
import { useDesignStore } from '../src/store/useDesignStore';
import { loadPackageTable, usePackages } from '../src/store/usePackages';

const store = useDesignStore;

const design: Design = {
  ...emptyDesign(),
  frequency: 450e6,
  load: { re: 20, im: -12 },
  elements: identify([
    { kind: 'L', orientation: 'shunt', value: 16e-9, package: '0603' },
    { kind: 'C', orientation: 'series', value: 22e-12 },
    { kind: 'line', z0: 50, length: 0.1, refFrequency: 450e6 },
  ]),
};

beforeEach(() => {
  store.getState().init(emptyDesign());
  usePackages.getState().reset();
});

describe('setPackage', () => {
  it('names, changes and removes the package of an L or C as undoable steps', () => {
    const s = store.getState();
    s.addElement({ kind: 'C', orientation: 'series', value: 10e-12 });
    s.addElement({ kind: 'line', z0: 50, length: 0.1 });
    s.setPackage(0, '0402');
    expect(store.getState().design.elements[0]).toMatchObject({ kind: 'C', package: '0402' });
    s.setPackage(0, '0603');
    expect(store.getState().design.elements[0]).toMatchObject({ package: '0603' });
    s.undo();
    expect(store.getState().design.elements[0]).toMatchObject({ package: '0402' });
    s.redo();
    s.setPackage(0, null);
    expect(store.getState().design.elements[0]).not.toHaveProperty('package');
    s.undo();
    expect(store.getState().design.elements[0]).toMatchObject({ package: '0603' });
    // A line has no package; the element is left as it is.
    const line = store.getState().design.elements[1];
    s.setPackage(1, '0402');
    expect(store.getState().design.elements[1]).toBe(line);
  });
});

describe('share link', () => {
  it('carries a known package and refuses an unknown one or derived parasitics', () => {
    const decoded = decodeDesign(encodeDesign(design));
    expect(decoded?.elements[0]).toMatchObject({ kind: 'L', package: '0603' });
    expect(decoded?.elements[1]).not.toHaveProperty('package');
    // An older link without the field decodes as before.
    expect(decodeDesign(encodeDesign(emptyDesign()))).not.toBeNull();
    const tamper = (patch: Record<string, unknown>): string => {
      const json = JSON.parse(
        new TextDecoder().decode(
          Uint8Array.from(atob(encodeDesign(design).replace(/-/g, '+').replace(/_/g, '/')), (c) =>
            c.charCodeAt(0),
          ),
        ),
      ) as { elements: Record<string, unknown>[] };
      json.elements[0] = { ...json.elements[0], ...patch };
      return btoa(JSON.stringify(json)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    };
    expect(decodeDesign(tamper({ package: '0403' }))).toBeNull();
    expect(decodeDesign(tamper({ package: 402 }))).toBeNull();
    expect(decodeDesign(tamper({ parasitics: { esl: 1 } }))).toBeNull();
  });
});

describe('packaged network', () => {
  it('is null without packages and resolves the chosen ones through the table', () => {
    expect(packagedElements(emptyDesign().elements, DEFAULT_PACKAGES)).toBeNull();
    const built = packagedElements(design.elements, DEFAULT_PACKAGES)!;
    expect(built).not.toBeNull();
    const pkg = packageById(DEFAULT_PACKAGES, '0603')!;
    expect(built[0]).toMatchObject({
      id: design.elements[0]!.id,
      color: design.elements[0]!.color,
      parasitics: { cp: pkg.cp, esr: pkg.esr, pad: pkg.pad },
    });
    expect(built[1]).toBe(design.elements[1]);
    expect(built[2]).toBe(design.elements[2]);
    const ideal = evaluateLadder({ ...design, elements: design.elements });
    const asBuilt = evaluateLadder({ ...design, elements: built });
    // The ESR shows up as a real part the ideal shunt inductor does not have.
    expect(asBuilt.zin).not.toEqual(ideal.zin);
    expect(asBuilt.s21.db).toBeLessThan(ideal.s21.db);
  });

  it('the table store edits one number, resets a row, and loads the defaults outside a browser', () => {
    expect(loadPackageTable()).toEqual(DEFAULT_PACKAGES);
    const { setRow, resetRow } = usePackages.getState();
    setRow('0402', { esl: 0.55e-9 });
    expect(packageById(usePackages.getState().table, '0402')).toMatchObject({
      esl: 0.55e-9,
      cp: packageById(DEFAULT_PACKAGES, '0402')!.cp,
      source: packageById(DEFAULT_PACKAGES, '0402')!.source,
    });
    // A negative or non-finite value is not taken.
    setRow('0402', { pad: -1 });
    expect(packageById(usePackages.getState().table, '0402')!.pad).toBe(
      packageById(DEFAULT_PACKAGES, '0402')!.pad,
    );
    resetRow('0402');
    expect(usePackages.getState().table).toEqual(DEFAULT_PACKAGES);
  });
});

describe('report', () => {
  it('adds an "as built" datapoint table that names the packages', () => {
    const result = evaluateLadder({ ...design, elements: design.elements });
    const built = packagedElements(design.elements, DEFAULT_PACKAGES)!;
    const packaged = evaluateLadder({ ...design, elements: built });
    const sel = { chart: false, schematic: false, datapoints: true, circles: true };
    const parts = buildReportParts({
      design,
      result,
      realization: null,
      packaged,
      chart: null,
      schematic: null,
      sel,
    });
    expect(parts.datapoints.map((t) => t.title)).toEqual([
      'Datapoints, ideal values at 450 MHz',
      'Datapoints, as built with packages at 450 MHz',
    ]);
    expect(parts.datapoints[1]!.note).toContain('Packages 1: 0603');
    expect(packagesNote(design.elements)).toBe('Packages 1: 0603');
    expect(packagesNote(emptyDesign().elements)).toBe('');
    const plain = buildReportParts({
      design,
      result,
      realization: null,
      packaged: null,
      chart: null,
      schematic: null,
      sel,
    });
    expect(plain.datapoints.map((t) => t.title)).toEqual(['Datapoints at 450 MHz']);
  });
});
