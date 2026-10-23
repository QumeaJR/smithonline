/** QA round 2 follow-ups: corrected id reuse test, the clamped message through removeDatapoint, and the no-op re-read. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cabs, complex, readTouchstone } from '@smithonline/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { emptyDesign } from '../src/lib/design';
import { designSweep } from '../src/lib/files';
import { decodeDesign } from '../src/lib/share';
import { useDesignStore } from '../src/store/useDesignStore';

const store = useDesignStore;
const amp = readTouchstone(
  readFileSync(
    join(__dirname, '..', '..', 'core', 'test', 'fixtures', 'sparams', 'amp-synthetic.s2p'),
    'utf8',
  ),
  2,
);
const fLo = amp.points[0]!.frequency;
const fHi = amp.points[amp.points.length - 1]!.frequency;
const fMid = (fLo + fHi) / 2;

beforeEach(() => {
  store.getState().init(emptyDesign());
  store.setState({ twoPortFiles: {}, message: null });
});

describe('adv r2b: deviceFollows', () => {
  it('file id reuse: a design undone to the first instance keeps following it after a start change', () => {
    const s = store.getState();
    s.init({ ...emptyDesign(), frequency: fLo });
    s.importTwoPort(amp, 'amp-synthetic.s2p');
    const firstId = store.getState().design.twoPort!.source!.fileId!;
    const scaled = {
      ...amp,
      points: amp.points.map((p) => ({ ...p, s: p.s.map((c) => complex(c.re * 0.5, c.im * 0.5)) })),
    };
    s.importTwoPort(scaled, 'amp-synthetic.s2p');
    const secondId = store.getState().design.twoPort!.source!.fileId!;
    expect(secondId).not.toBe(firstId);
    s.undo();
    expect(store.getState().design.twoPort!.source!.fileId).toBe(firstId);
    s.addDatapoint({ frequency: fMid, z: complex(30, 10) });
    s.setStartDatapoint(1);
    const tp = store.getState().design.twoPort!;
    expect(tp.source!.fileId).toBe(firstId);
    // unscaled data: |s21| of the full file, not half
    const direct = store.getState().twoPortFiles[firstId]!.data;
    expect(direct).toBe(amp);
    expect(cabs(tp.s.s21)).toBeGreaterThan(1);
  });

  it('the clamped warning survives the start-change status line', () => {
    const s = store.getState();
    s.init({ ...emptyDesign(), frequency: fLo });
    s.importTwoPort(amp, 'amp-synthetic.s2p');
    s.addDatapoint({ frequency: fLo / 4, z: complex(30, 10) });
    s.setStartDatapoint(1);
    expect(store.getState().design.twoPort!.source!.clamped).toBe(true);
    expect(store.getState().message).toMatch(/outside the file/);
  });

  it('a stale "outside the file" message is cleared when removeDatapoint lands inside again', () => {
    const s = store.getState();
    s.init({ ...emptyDesign(), frequency: fLo / 4 });
    s.importTwoPort(amp, 'amp-synthetic.s2p'); // clamped at import
    expect(store.getState().message).toMatch(/outside the file/);
    s.addDatapoint({ frequency: fMid, z: complex(30, 10) });
    s.removeDatapoint(0); // start removed, DP2 (inside) takes over
    const d = store.getState().design;
    expect(d.frequency).toBe(fMid);
    expect(d.twoPort!.source!.clamped).toBe(false);
    expect(store.getState().message ?? '').not.toMatch(/outside the file/);
  });

  it('a hostile link with 200000 sweep loads: time for one designSweep', () => {
    const loads = Array.from({ length: 200000 }, (_, i) => ({
      frequency: 1e6 * (i + 1),
      z: { re: 20 + (i % 50), im: -10 },
    }));
    const d = decodeDesign(
      Buffer.from(
        JSON.stringify({
          elements: [
            { kind: 'L', orientation: 'series', value: 5e-9 },
            { kind: 'C', orientation: 'shunt', value: 3e-12 },
          ],
          load: { re: 50, im: 0 },
          sweep: { enabled: true, loads },
        }),
        'utf8',
      ).toString('base64url'),
    )!;
    const t0 = performance.now();
    const pts = designSweep(d);
    const dt = performance.now() - t0;
    // The link codec caps sweep loads at 2001, like sweep points.
    expect(pts).toHaveLength(2001);
    expect(dt).toBeLessThan(1000);
  });
});
