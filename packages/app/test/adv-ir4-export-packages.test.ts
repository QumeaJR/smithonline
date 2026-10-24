/** Adversarial: the three network exports of one design with a packaged part. */
import { DEFAULT_PACKAGES } from '@smithonline/core';
import { describe, expect, it } from 'vitest';
import { emptyDesign, identify, type Design } from '../src/lib/design';
import { designToLtspice, designToS2p, designToSpice, PACKAGE_NOTE } from '../src/lib/simexport';

const plain: Design = {
  ...emptyDesign(),
  frequency: 450e6,
  load: { re: 20, im: -12 },
  elements: identify([
    { kind: 'L', orientation: 'shunt', value: 16.03e-9 },
    { kind: 'C', orientation: 'series', value: 21.84e-12 },
  ]),
};
const packaged: Design = {
  ...plain,
  elements: plain.elements.map((el) =>
    el.kind === 'C' ? { ...el, package: '0603' as const } : el,
  ),
};

describe('exports of a design whose C names the 0603 package', () => {
  it('the .s2p changes with the package', () => {
    expect(designToS2p(packaged, null, DEFAULT_PACKAGES)).not.toBe(
      designToS2p(plain, null, DEFAULT_PACKAGES),
    );
  });
  // Corrected in the phase 3 QA fixes: SPICE and LTspice keep the network without parasitics
  // (user guide section 11) and say so in a comment at the top when a part names a package.
  it('SPICE and LTspice say that the package parasitics are left out (the .s2p has them)', () => {
    const strip = (t: string) => t.replace(/^\*.*\n/gm, '');
    expect(designToSpice(packaged, null).split('\n')[1]).toBe(`* ${PACKAGE_NOTE}`);
    expect(designToSpice(plain, null)).not.toContain(PACKAGE_NOTE);
    expect(strip(designToSpice(packaged, null))).toBe(strip(designToSpice(plain, null)));
    const asc = designToLtspice(packaged, null);
    expect(asc).toContain(`;${PACKAGE_NOTE}`);
    expect(designToLtspice(plain, null)).not.toContain(PACKAGE_NOTE);
    const dropNote = (t: string) => t.replace(/^TEXT .*Component package.*\r\n/m, '');
    expect(dropNote(asc)).toBe(designToLtspice(plain, null));
  });
});
