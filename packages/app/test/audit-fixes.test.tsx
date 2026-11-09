// @vitest-environment jsdom
/** Regression tests for the 2026-11 repo audit: hostile colours, pasted links, odd autosave fields. */
import { act } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { complex } from '@smithonline/core';
import { emptyDesign, identify } from '../src/lib/design';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { designFromJsonFile, readAutosaveObject } from '../src/lib/share';
import { readImportText } from '../src/lib/projectStore';

vi.mock('uplot', () => {
  class FakePlot {
    static pxRatio = 1;
    over = document.createElement('div');
    cursor = {};
    setCursor(): void {}
    posToIdx(): number {
      return 0;
    }
    setData(): void {}
    setSize(): void {}
    redraw(): void {}
    destroy(): void {}
  }
  return { default: FakePlot };
});
vi.mock('uplot/dist/uPlot.min.css', () => ({}));

afterEach(() => {
  vi.restoreAllMocks();
  history.replaceState(null, '', '/');
});

describe('element colours from a link or file', () => {
  it('keeps a hex colour and replaces anything else, such as url(...)', () => {
    const [hex, url, named] = identify([
      { kind: 'C', orientation: 'shunt', value: 1e-12, color: '#12abEF' },
      { kind: 'C', orientation: 'shunt', value: 1e-12, color: 'url(https://evil.example/p.png)' },
      { kind: 'C', orientation: 'shunt', value: 1e-12, color: 'red' },
    ] as never);
    expect(hex?.color).toBe('#12abEF');
    expect(url?.color).toMatch(/^#[0-9a-f]+$/i);
    expect(named?.color).toMatch(/^#[0-9a-f]+$/i);
  });
});

describe('an autosave-shaped file with fields of the wrong type', () => {
  it('opens with defaults for those fields instead of passing them on', () => {
    const read = readAutosaveObject({
      ...emptyDesign(),
      name: 42,
      frequency: 'GHz',
      z0: -5,
    });
    expect('value' in read && read.value).toMatchObject({
      name: 'Untitled',
      frequency: 1e9,
      z0: 50,
    });
  });
});

describe('files saved by 0.10.0 keep opening (the format identifier never changes)', () => {
  const fixture = (name: string): string =>
    readFileSync(resolve(__dirname, 'fixtures', name), 'utf8');

  it('File, Open reads the design file', () => {
    const read = designFromJsonFile(fixture('design-0.10.0.json'));
    expect('value' in read && read.value).toMatchObject({
      name: 'Fixture 0.10.0',
      load: { re: 12.5, im: -20 },
    });
  });

  it('Projects imports the design file and the Export all file', () => {
    for (const name of ['design-0.10.0.json', 'projects-0.10.0.json']) {
      const read = readImportText(fixture(name), name);
      expect('entries' in read && read.entries.map((e) => [e.name, e.readable])).toEqual([
        ['Fixture 0.10.0', true],
      ]);
    }
  });
});

describe('a link pasted into the running app', () => {
  it('keeps the design this tab shows, not the autosave another tab wrote', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
    }));
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
      },
    );
    localStorage.clear();
    sessionStorage.clear();
    vi.resetModules();
    document.body.innerHTML = '<div id="root"></div>';
    await act(async () => {
      await import('../src/main');
    });
    const { useDesignStore: store } = await import('../src/store/useDesignStore');
    const { encodeDesign } = await import('../src/lib/share');
    const { ownBuild } = await import('../src/lib/designBuild');
    const { autosaveBackups, readBackup } = await import('../src/lib/autosave');
    const fresh = await import('../src/lib/design');
    act(() => store.getState().setName('Tab A work'));
    act(() =>
      store.getState().addElement({ kind: 'L', orientation: 'series', value: 6.8e-9 }, 'Added L'),
    );
    // Another tab writes its own design into the one autosave.
    localStorage.setItem(
      'smithonline.design.v1',
      JSON.stringify(ownBuild({ ...fresh.emptyDesign(), name: 'Tab B work' })),
    );
    const linked = ownBuild({
      ...fresh.emptyDesign(),
      name: 'Pasted link',
      load: complex(10, 5),
      elements: fresh.identify([{ kind: 'C', orientation: 'shunt', value: 3.3e-12 }]),
    });
    await act(async () => {
      location.hash = `#d=${encodeDesign(linked)}`;
      window.dispatchEvent(new HashChangeEvent('hashchange'));
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(store.getState().design.name).toBe('Pasted link');
    const kept = autosaveBackups()
      .filter((b) => b.kind === 'replaced')
      .map((b) => readBackup(b.key) ?? '')
      .join('\n');
    expect(kept).toContain('Tab A work');
    expect(kept).not.toContain('Tab B work');
  });
});
