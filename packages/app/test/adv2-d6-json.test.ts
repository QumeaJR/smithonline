// @vitest-environment jsdom
/**
 * Adversarial QA, D6 round 2: every .json writer keeps the measurement, round trips are byte
 * stable, and the point rule holds for hostile rows (open, repeated, segmented, near-open).
 */
import { act } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { compareWithDesign } from '../src/lib/boardFit';
import { readImportFile } from '../src/lib/import';
import { boardReflections } from '../src/lib/measuredBoard';
import { readAutosaveText } from '../src/lib/autosave';
import { decodeDesign, designFileText, designFromJsonFile, encodeDesign } from '../src/lib/share';
import { measureStart } from '../src/lib/workflows';
import { useDesignStore } from '../src/store/useDesignStore';
import type { Design } from '../src/lib/design';

const D = () => useDesignStore.getState();
beforeEach(() => {
  localStorage.clear();
  D().init(measureStart());
});
const read = (text: string): Design => {
  const r = designFromJsonFile(text);
  if (!('value' in r)) throw new Error(r.problem);
  return r.value;
};

function hostileFile(): string {
  const lines = ['! segmented sweep, open row, near-open rows', '# GHZ S RI R 50'];
  for (let i = 0; i < 101; i++)
    lines.push(`${(0.7 + i * 0.003).toFixed(3)} 0.2 ${(-0.1 + i * 0.001).toFixed(4)}`);
  // segment 2 repeats the joint at 1.0 GHz with a different value
  lines.push('1.0 0.25 -0.05');
  for (let i = 1; i < 100; i++)
    lines.push(`${(1.0 + i * 0.003).toFixed(3)} 0.3 ${(i * 0.001).toFixed(4)}`);
  lines.push('1.3 1 0'); // open
  lines.push('1.301 0.99999999999 1e-12'); // near open
  lines.push('1.302 1.002 0.001'); // |S11| > 1 (noise on a reflective point)
  return lines.join('\n');
}

describe('.json round trip of a compared measurement', () => {
  it('Compare, File Save, File Open, File Save: byte stable, every point kept', () => {
    let ok = false;
    act(() => {
      ok = compareWithDesign(readImportFile('seg.s1p', hostileFile()));
    });
    expect(ok).toBe(true);
    const d = D().design;
    const n = d.measurement?.points.length ?? 0;
    const t1 = designFileText(d);
    const d2 = read(t1);
    expect(d2.measurement?.points.length).toBe(n);
    expect(d2.measurement).toEqual(d.measurement);
    const t2 = designFileText(d2);
    expect(t2).toBe(t1);
    // the autosave copy too
    const a = readAutosaveText(JSON.stringify(d));
    expect('value' in a && a.value.measurement).toEqual(d.measurement);
    // the reflections the fit sees are the same
    expect(boardReflections(d2)).toEqual(boardReflections(d));
  });

  it('a link of a 150-point hostile measurement keeps every point (rounded to 6 figures)', () => {
    const lines = hostileFile().split(String.fromCharCode(10));
    lines.splice(60, 53);
    act(() => {
      compareWithDesign(readImportFile('seg.s1p', lines.join(String.fromCharCode(10))));
    });
    expect(D().design.measurement?.points.length).toBeLessThanOrEqual(201);
    const d = D().design;
    const back = decodeDesign(encodeDesign(d));
    expect(back?.measurement?.points.length).toBe(d.measurement?.points.length);
  });

  it('a narrow-band measurement (crystal-like, 1 kHz steps at 1 GHz) survives a share link', () => {
    const lines = ['# HZ S RI R 50'];
    for (let i = 0; i < 101; i++)
      lines.push(`${1e9 + i * 1000} 0.2 ${(-0.1 + i * 0.002).toFixed(4)}`);
    act(() => {
      compareWithDesign(readImportFile('narrow.s1p', lines.join('\n')));
    });
    const d = D().design;
    expect(d.measurement?.points.length).toBe(101);
    const back = decodeDesign(encodeDesign(d));
    expect(back?.measurement?.points.length).toBe(101);
  });
});
