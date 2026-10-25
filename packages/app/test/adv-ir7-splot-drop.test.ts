/**
 * Adversarial, phase 6 S-Plot drop (openSPlotFiles): no files, a directory, 50 files, a
 * 50 MB file, a binary file, mixed valid and invalid. Each test asserts the correct
 * behaviour; a failure is a defect.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { emptyDesign } from '../src/lib/design';
import { openSPlotFiles } from '../src/lib/splotActions';
import { useDesignStore } from '../src/store/useDesignStore';
import { useSPlotStore } from '../src/store/useSPlotStore';

const fixture = (name: string): string =>
  readFileSync(join(__dirname, '..', '..', 'core', 'test', 'fixtures', 'sparams', name), 'utf8');
const D = () => useDesignStore.getState();
const S = () => useSPlotStore.getState();

beforeEach(() => {
  D().init(emptyDesign());
  D().setMessage(null);
  useSPlotStore.setState({ files: [], activeId: null });
});

describe('openSPlotFiles', () => {
  it('no files and an empty list do nothing', async () => {
    await openSPlotFiles(null);
    await openSPlotFiles([]);
    expect(S().files).toHaveLength(0);
    expect(D().message).toBeNull();
  });

  it('a directory (a File whose text() rejects) says why and loads nothing', async () => {
    const dir = new File([], 'measurements');
    Object.defineProperty(dir, 'text', {
      value: () =>
        Promise.reject(
          new DOMException('A requested file or directory could not be found', 'NotFoundError'),
        ),
    });
    await openSPlotFiles([dir]);
    expect(S().files).toHaveLength(0);
    expect(D().message).toMatch(/^Could not open measurements: /);
    expect(D().messageError).toBe(true);
  });

  it('a binary file under .s2p is refused with a reason', async () => {
    const bytes = new Uint8Array(4096);
    for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 7919 + 13) & 0xff;
    await openSPlotFiles([new File([bytes], 'photo.s2p')]);
    expect(S().files).toHaveLength(0);
    expect(D().messageError).toBe(true);
  });

  it('a PNG dropped on the view (no accept filter on drop) is refused', async () => {
    await openSPlotFiles([
      new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], 'icon.png'),
    ]);
    expect(S().files).toHaveLength(0);
    expect(D().messageError).toBe(true);
  });

  it('mixed: a bad file first and a good one after: the bad one still says why', async () => {
    await openSPlotFiles([
      new File(['not a touchstone file at all'], 'broken.s2p'),
      new File([fixture('amp-synthetic.s2p')], 'amp.s2p'),
    ]);
    expect(S().files).toHaveLength(1);
    // The user must be able to see that broken.s2p failed.
    expect(D().message ?? '').toMatch(/broken\.s2p/);
  });

  it('50 files all load, one entry each', async () => {
    const text = fixture('dipole-synthetic.s1p');
    const files = Array.from({ length: 50 }, (_, i) => new File([text], `d${i}.s1p`));
    await openSPlotFiles(files);
    expect(S().files).toHaveLength(50);
    expect(new Set(S().files.map((f) => f.id)).size).toBe(50);
  });

  it('a 50 MB Touchstone file loads within 10 s', async () => {
    const lines: string[] = ['# HZ S RI R 50'];
    let bytes = 0;
    let f = 1e6;
    while (bytes < 50 * 1024 * 1024) {
      const l = `${f} 0.1 0.2 0.9 -0.1 0.01 0.02 0.3 -0.4`;
      lines.push(l);
      bytes += l.length + 1;
      f += 1;
    }
    const t0 = performance.now();
    await openSPlotFiles([new File([lines.join('\n')], 'big.s2p')]);
    const ms = performance.now() - t0;
    console.log(`50 MB: ${lines.length - 1} points in ${ms.toFixed(0)} ms`);
    expect(S().files).toHaveLength(1);
    expect(ms).toBeLessThan(10000);
  }, 120000);

  it('a 50 MB binary .txt is refused within 10 s', async () => {
    const bytes = new Uint8Array(50 * 1024 * 1024);
    let x = 12345;
    for (let i = 0; i < bytes.length; i++) {
      x = (x * 1103515245 + 12345) >>> 0;
      bytes[i] = x >>> 24;
    }
    const t0 = performance.now();
    await openSPlotFiles([new File([bytes], 'dump.txt')]);
    const ms = performance.now() - t0;
    console.log(`50 MB binary: ${ms.toFixed(0)} ms, message ${D().message?.slice(0, 120)}`);
    expect(S().files).toHaveLength(0);
    expect(ms).toBeLessThan(10000);
  }, 120000);
});
