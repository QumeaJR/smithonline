/**
 * QA, redesign phase 6: the Undo and Redo names of the store setters the phase 6 tests do not
 * reach (datapoints, reorder, device, package, lock, Realize, losses, the sweep with a label,
 * a transient run with commit(label), refused and no-op steps), and the example link of the
 * user guide, whose Undo should name the example as its message does.
 *
 * Expected values come from the commit message of 8299eb3 ("every store setter carries a quiet
 * name for Undo and Redo", "a change that changes nothing says nothing") and from the comment
 * on update() in useDesignStore.ts ("a no-op ... leaves history alone").
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { complex, polarDeg, readTouchstone } from '@smithonline/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { emptyDesign, identify, type Design } from '../src/lib/design';
import { runTarget } from '../src/lib/helpActions';
import { useDesignStore } from '../src/store/useDesignStore';

const D = () => useDesignStore.getState();

const twoParts = (): Design => ({
  ...emptyDesign(),
  elements: identify([
    { kind: 'L', orientation: 'series', value: 10e-9 },
    { kind: 'C', orientation: 'shunt', value: 2e-12 },
  ]),
});

const MANUAL = {
  s11: polarDeg(0.5, -120),
  s12: polarDeg(0.05, 50),
  s21: polarDeg(3, 80),
  s22: polarDeg(0.4, -40),
};

beforeEach(() => {
  D().init(emptyDesign());
  useDesignStore.setState({ twoPortFiles: {} });
  D().setMessage(null);
});

/** Undo and Redo both name the step with `label`. */
function expectNamed(label: string): void {
  D().undo();
  expect(D().message).toBe(`Undo: ${label}`);
  D().redo();
  expect(D().message).toBe(`Redo: ${label}`);
}

describe('qa: datapoint setters name their step', () => {
  it('addDatapoint names the step with its message', () => {
    D().addDatapoint({ frequency: 2e9, z: complex(30, 10) });
    const shown = D().message ?? '';
    expect(shown).toMatch(/^Added DP2: /);
    expectNamed(shown);
  });

  it('removeDatapoint names the step and offers the inline Undo', () => {
    D().addDatapoint({ frequency: 2e9, z: complex(30, 10) });
    D().removeDatapoint(1);
    expect(D().message).toBe('Removed DP2.');
    expect(D().messageExtras?.undo).toBe(true);
    expectNamed('Removed DP2.');
  });

  it('removing the last datapoint is refused: no step, no Undo button', () => {
    D().removeDatapoint(0);
    expect(D().past).toHaveLength(0);
    expect(D().messageExtras).toBeNull();
  });

  it('setStartDatapoint names its step for Undo and Redo', () => {
    D().addDatapoint({ frequency: 2e9, z: complex(30, 10) });
    D().setStartDatapoint(1);
    const shown = D().message ?? '';
    expect(shown).toMatch(/^The network starts at DP2; design frequency is now /);
    D().undo();
    // Every other setter names its step; this one says only "Undo".
    expect(D().message).toBe(`Undo: ${shown}`);
  });
});

describe('qa: element setters name their step', () => {
  it('reorderElement names the move; out of range and same place record nothing', () => {
    D().init(twoParts());
    D().reorderElement(0, 0);
    D().reorderElement(-1, 1);
    D().reorderElement(0, 2);
    expect(D().past).toHaveLength(0);
    D().reorderElement(0, 1);
    expect(D().message).toBe('Moved Series L 1 to position 2');
    expectNamed('Moved Series L 1 to position 2');
  });

  it('setPackage null names the removal; toggleLock twice says Unlocked', () => {
    D().init(twoParts());
    D().setPackage(0, '0402');
    D().setPackage(0, null);
    expectNamed('Removed the package of Series L 1');
    D().toggleLock(1);
    D().toggleLock(1);
    expectNamed('Unlocked Shunt C 2');
  });

  it('removing a package that is not there leaves history alone', () => {
    D().init(twoParts());
    D().setPackage(0, null);
    expect(D().past).toHaveLength(0);
  });

  it('setting the package a part already has leaves history alone', () => {
    D().init(twoParts());
    D().setPackage(0, '0603');
    D().setPackage(0, '0603');
    expect(D().past).toHaveLength(1);
  });

  it('a sweep patch with the values the sweep has leaves history alone', () => {
    const { points } = D().design.sweep;
    D().setSweep({ points });
    expect(D().past).toHaveLength(0);
  });

  it('a lock on an index past the end leaves history alone', () => {
    D().init(twoParts());
    D().toggleLock(7);
    expect(D().past).toHaveLength(0);
  });
});

describe('qa: settings and device setters name their step', () => {
  it('setRealize and setLosses with more than the switch say Changed', () => {
    D().setRealize({ series: 'E12' });
    expectNamed('Changed the Realize settings');
    D().setLosses({ inductorQ: 40 });
    expectNamed('Changed the loss settings');
    D().setRealize({ enabled: true });
    D().setRealize({ enabled: false });
    expectNamed('Realize off');
  });

  it('setSweep off says Sweep off; a label wins over the quiet name', () => {
    D().setSweep({ enabled: true });
    D().setSweep({ enabled: false });
    expectNamed('Sweep off');
    D().setSweep({ start: 1e8, stop: 3e9 }, 'Sweep range set by hand');
    expect(D().message).toBe('Sweep range set by hand');
    expectNamed('Sweep range set by hand');
  });

  it('setTwoPort by hand and back to none', () => {
    D().setTwoPort({ s: MANUAL, noise: null });
    expectNamed('Changed the two-port device');
    D().setTwoPort(null);
    expectNamed('Removed the two-port device');
  });

  it('importTwoPort names the step after the file', () => {
    const amp = readTouchstone(
      readFileSync(
        join(__dirname, '..', '..', 'core', 'test', 'fixtures', 'sparams', 'amp-synthetic.s2p'),
        'utf8',
      ),
      2,
    );
    D().importTwoPort(amp, 'amp-synthetic.s2p');
    expect(D().message).toBe('Device filled from amp-synthetic.s2p');
    expectNamed('Device filled from amp-synthetic.s2p');
  });

  it('updateFollowingDevice without a label is quiet and Undo names it', () => {
    D().updateFollowingDevice((d) => ({ ...d, load: complex(10, 5) }));
    expect(D().message).toBeNull();
    expectNamed('Changed the load and frequency');
  });
});

describe('qa: transient runs, refused and no-op steps', () => {
  it('a transient load drag ended by commit(label) is one step named by the label', () => {
    D().setLoad(complex(30, 0), true);
    D().setLoad(complex(35, 0), true);
    D().setLoad(complex(40, 0), true);
    D().commit('Moved DP1 to 40 Ω');
    expect(D().past).toHaveLength(1);
    expect(D().message).toBe('Moved DP1 to 40 Ω');
    expectNamed('Moved DP1 to 40 Ω');
  });

  it('a transient run ended by commit() without a label keeps the quiet name of its last change', () => {
    D().setLoad(complex(30, 0), true);
    D().setLoad(complex(40, 0), true);
    D().commit();
    expect(D().message).toBeNull();
    // fmtComplex(40 + j0, 1) is "40.0 + j0.0", as in the ir7 setLoad case.
    expectNamed('Changed the load to 40.0 + j0.0 Ω');
  });

  it('commit(label) without a transient run says nothing', () => {
    D().commit('Nothing moved');
    expect(D().message).toBeNull();
    expect(D().past).toHaveLength(0);
  });

  it('a step the design cannot take is refused: a message, no step, no Undo button', () => {
    D().step('Negative f', (d) => ({ ...d, frequency: -1 }), { undo: true });
    expect(D().message).toMatch(/^Refused: /);
    expect(D().past).toHaveLength(0);
    expect(D().messageExtras).toBeNull();
  });

  it('a load without a label offers no inline Undo and Undo says only Undo', () => {
    D().loadDesign(twoParts());
    expect(D().message).toBeNull();
    expect(D().messageExtras).toBeNull();
    D().undo();
    expect(D().message).toBe('Undo');
  });

  it('replaceDesign keeps the name of the step it replaces', () => {
    D().loadDesign(twoParts(), 'Loaded A');
    D().replaceDesign({ ...twoParts(), name: 'B' });
    expect(D().future).toHaveLength(0);
    expectNamed('Loaded A');
  });
});

describe('qa: the example link of the user guide', () => {
  it('Undo names the example as the message does ("Loaded Example 5")', () => {
    const note = runTarget({ kind: 'example', file: 'Example5.xmlsc', view: null });
    expect(note).toBe('Loaded Example 5. Undo brings your previous design back.');
    D().undo();
    // The Examples menu names the same step "Loaded Example 5" (Header.tsx).
    expect(D().message).toBe('Undo: Loaded Example 5');
  });
});
