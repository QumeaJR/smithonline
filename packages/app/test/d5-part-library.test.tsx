// @vitest-environment jsdom
/**
 * Phase D5 in the app: the part library (its store, the browser store's
 * checks, the dialog), library parts in the network (card, share link, .json
 * file, autosave), Realize from the part library, and the exports. The parts
 * are the synthetic examples, made from equivalent circuits; no vendor data.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  bomCsv,
  bomRows,
  complex,
  isApproximatePart,
  SYNTHETIC_PARTS,
  syntheticPart,
  withoutData,
  type LibraryPart,
} from '@smithonline/core';
import { PartLibraryDialog } from '../src/components/PartLibraryDialog';
import { RealizeControls } from '../src/components/RealizeControls';
import { DESIGN_STORAGE_KEY, readSavedDesign } from '../src/lib/autosave';
import { emptyDesign, identify, type Design, type DesignElement } from '../src/lib/design';
import { addReportText, attachLibraryData, partCardInfo } from '../src/lib/parts';
import { memoryPartStore, storedPartOf } from '../src/lib/partStore';
import { effectiveElements, realizeDesign, realizedText } from '../src/lib/realize';
import { decodeDesign, elementsOf, encodeDesign } from '../src/lib/share';
import { designToS2p, designToSpice } from '../src/lib/simexport';
import { useDesignStore } from '../src/store/useDesignStore';
import { syntheticLibraryParts, usePartLibrary } from '../src/store/usePartLibrary';

const here = dirname(fileURLToPath(import.meta.url));
const partFile = (name: string): string =>
  readFileSync(resolve(here, '../../core/test/fixtures/parts', `${name}.s2p`), 'utf8');
const part = (name: string): LibraryPart => {
  const spec = SYNTHETIC_PARTS.find((p) => p.name === name);
  if (!spec) throw new Error(name);
  return syntheticPart(spec);
};

beforeAll(() => {
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
});
beforeEach(async () => {
  localStorage.clear();
  useDesignStore.getState().init(emptyDesign());
  useDesignStore.getState().setMessage(null);
  usePartLibrary.setState({ parts: [], open: false });
  await usePartLibrary.getState().init(memoryPartStore());
});
afterEach(() => cleanup());

function designWith(elements: Parameters<typeof identify>[0], patch: Partial<Design> = {}): Design {
  return { ...emptyDesign(), load: complex(10, 0), ...patch, elements: identify(elements) };
}

describe('the part library store', () => {
  it('reads part files, reports what it could not read, and replaces a part of the same name', async () => {
    const report = await usePartLibrary.getState().addFiles([
      { name: 'SYNTH-C0402-10P.s2p', text: partFile('SYNTH-C0402-10P') },
      { name: 'SYNTH-L0402-10N.s2p', text: partFile('SYNTH-L0402-10N') },
      { name: 'broken.s2p', text: '# MHZ S MA R 50\nnot numbers\n' },
      { name: 'one-port.s1p', text: '# MHZ S MA R 50\n1 0.5 0\n2 0.5 0\n' },
    ]);
    expect(report.added).toEqual(['SYNTH-C0402-10P', 'SYNTH-L0402-10N']);
    expect(report.failed.map((f) => f.fileName)).toEqual(['broken.s2p', 'one-port.s1p']);
    expect(addReportText(report)).toMatch(/^Added 2 parts; 2 files could not be read: broken\.s2p/);
    const again = await usePartLibrary
      .getState()
      .addFiles([{ name: 'SYNTH-C0402-10P.s2p', text: partFile('SYNTH-C0402-10P') }]);
    expect(again.replaced).toEqual(['SYNTH-C0402-10P']);
    expect(usePartLibrary.getState().parts).toHaveLength(2);
  });

  it('keeps the library across a restart of the store, and removes a part', async () => {
    const store = memoryPartStore();
    await usePartLibrary.getState().init(store);
    await usePartLibrary.getState().addParts(syntheticLibraryParts());
    usePartLibrary.setState({ parts: [] });
    await usePartLibrary.getState().init(store);
    expect(usePartLibrary.getState().parts).toHaveLength(SYNTHETIC_PARTS.length);
    const key = usePartLibrary.getState().parts[0]!.key;
    await usePartLibrary.getState().remove(key);
    await usePartLibrary.getState().init(store);
    expect(usePartLibrary.getState().parts.map((p) => p.key)).not.toContain(key);
  });

  it('refuses a fixture the data cannot be read in, and a rename onto another part', async () => {
    await usePartLibrary.getState().addParts(syntheticLibraryParts());
    const parts = usePartLibrary.getState().parts;
    const l10 = parts.find((p) => p.part.partNumber === 'SYNTH-L0402-10N')!;
    expect(await usePartLibrary.getState().setFixture(l10.key, 'shunt')).toMatch(
      /measured to ground/,
    );
    const c10 = parts.find((p) => p.part.partNumber === 'SYNTH-C0402-10P')!;
    expect(
      await usePartLibrary
        .getState()
        .rename(c10.key, { manufacturer: l10.part.manufacturer, partNumber: 'SYNTH-L0402-10N' }),
    ).toMatch(/already in the library/);
    expect(
      await usePartLibrary
        .getState()
        .rename(c10.key, { manufacturer: 'Me', partNumber: 'MY-CAP-10P' }),
    ).toBeNull();
    expect(usePartLibrary.getState().parts.some((p) => p.key === 'me|my-cap-10p')).toBe(true);
  });

  it('skips stored records that are not parts (hostile or damaged browser storage)', async () => {
    const good = { key: 'x', part: part('SYNTH-C0402-2P2'), fileName: 'a.s2p', added: 1 };
    const store = memoryPartStore([
      good,
      { key: 'bad1', part: { ...part('SYNTH-C0402-2P2'), circuit: null } },
      { key: 'bad2', part: 'GRM' },
      null,
      { key: 'bad3', part: { ...part('SYNTH-C0402-2P2'), data: { f: [1], s: [] } } },
    ]);
    const loaded = await store.loadAll();
    expect(loaded.parts).toHaveLength(1);
    expect(loaded.skipped).toBe(4);
    expect(
      storedPartOf({ part: withoutData(part('SYNTH-L0402-4N7')), fileName: 7 })?.fileName,
    ).toBe('');
  });
});

describe('library parts in a design', () => {
  it('a share link carries names and the fitted circuit, not the data; the .json file carries the data in full', () => {
    const p = part('SYNTH-C0402-10P');
    const d = designWith([{ kind: 'part', orientation: 'shunt', part: p }]);
    const link = decodeDesign(encodeDesign(d));
    const linked = link?.elements[0];
    expect(linked?.kind).toBe('part');
    if (linked?.kind === 'part') {
      expect(linked.part.partNumber).toBe('SYNTH-C0402-10P');
      expect(isApproximatePart(linked.part)).toBe(true);
    }
    const file = decodeDesign(encodeDesign(d, { partData: true }));
    const filed = file?.elements[0];
    if (filed?.kind !== 'part') throw new Error('expected a part');
    // Full precision: the data is not rounded to the link's six digits.
    expect(filed.part.data).toEqual(p.data);
    expect(encodeDesign(d).length).toBeLessThan(2000);
  });

  it('a part that came without its data takes it from the library', () => {
    const p = part('SYNTH-C0402-10P');
    const elements = identify([{ kind: 'part', orientation: 'series', part: withoutData(p) }]);
    const attached = attachLibraryData(elements, [p]);
    const el = attached?.[0];
    expect(el?.kind === 'part' && el.part.data).toEqual(p.data);
    expect(attachLibraryData(elements, [part('SYNTH-C0402-2P2')])).toBeNull();
    // A part with data keeps its own copy.
    expect(
      attachLibraryData(identify([{ kind: 'part', orientation: 'series', part: p }]), [p]),
    ).toBeNull();
  });

  it('refuses a link or file whose part is hostile, and never blanks: the decoder returns null', () => {
    const base = encodeDesign(
      designWith([{ kind: 'part', orientation: 'series', part: part('SYNTH-C0402-10P') }]),
    );
    const raw = JSON.parse(atob(base.replace(/-/g, '+').replace(/_/g, '/'))) as {
      elements: unknown[];
    };
    const hostile = [
      { kind: 'part', orientation: 'series', part: { partNumber: 'X' } },
      { kind: 'part', orientation: 'sideways', part: withoutData(part('SYNTH-C0402-10P')) },
      {
        kind: 'part',
        orientation: 'series',
        part: withoutData(part('SYNTH-C0402-10P')),
        board: { via: 1 },
      },
      {
        kind: 'part',
        orientation: 'series',
        part: { ...withoutData(part('SYNTH-C0402-10P')), range: [5, 1] },
      },
    ];
    for (const h of hostile) {
      expect(elementsOf([h]), JSON.stringify(h).slice(0, 80)).toBeNull();
      const text = btoa(JSON.stringify({ ...raw, elements: [h] }));
      expect(
        decodeDesign(text.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')),
      ).toBeNull();
    }
  });

  it('the autosave keeps the part data and checks it on the way back', () => {
    const p = part('SYNTH-L0402-4N7');
    localStorage.setItem(
      DESIGN_STORAGE_KEY,
      JSON.stringify(designWith([{ kind: 'part', orientation: 'series', part: p }])),
    );
    const saved = readSavedDesign();
    const el = saved?.elements[0];
    expect(el?.kind === 'part' && el.part.data).toEqual(p.data);
    localStorage.setItem(
      DESIGN_STORAGE_KEY,
      JSON.stringify(
        designWith([
          {
            kind: 'part',
            orientation: 'series',
            part: { ...p, type: 'R' } as unknown as LibraryPart,
          },
        ]),
      ),
    );
    expect(readSavedDesign()).toBeNull();
  });

  it('the card says the effective value and Q at f, the SRF, and flags range, fallback and placement', () => {
    const p = part('SYNTH-C0402-10P');
    const at1g = partCardInfo({ kind: 'part', orientation: 'series', part: p }, 1e9);
    expect(at1g.atF).toMatch(/^C eff 11\.\d+ pF, Q [\d.]+ at 1 GHz$/);
    expect(at1g.srf).toBe('SRF 2.582 GHz');
    expect(at1g.warnings).toEqual([]);
    const outside = partCardInfo({ kind: 'part', orientation: 'series', part: p }, 20e9);
    expect(outside.outOfRange).toBe(true);
    expect(outside.warnings[0]).toMatch(/No value at 20 GHz: above the part's data/);
    const bare = partCardInfo({ kind: 'part', orientation: 'shunt', part: withoutData(p) }, 1e9);
    expect(bare.warnings.join(' ')).toMatch(/Approximate: the fitted equivalent circuit/);
    const shunt = partCardInfo({ kind: 'part', orientation: 'shunt', part: p }, 1e9);
    expect(shunt.warnings.join(' ')).toMatch(/measured in series/);
    const above = partCardInfo({ kind: 'part', orientation: 'series', part: p }, 4e9);
    expect(above.atF).toMatch(/above its resonance/);
  });
});

describe('Realize from the part library', () => {
  it('replaces each L and C by a library part and the BOM lists manufacturer and part number', async () => {
    await usePartLibrary.getState().addParts(syntheticLibraryParts());
    const d = designWith(
      [
        { kind: 'L', orientation: 'series', value: 3.18e-9 },
        { kind: 'C', orientation: 'shunt', value: 12.7e-12 },
      ],
      { realize: { enabled: true, series: 'library', stockText: '', scope: 'all' } },
    );
    const r = realizeDesign(d, effectiveElements(d));
    expect(r?.ladder.elements.map((e) => e.kind)).toEqual(['part', 'part']);
    expect(realizedText(r!.elements[1]!, r!.sourceLabel)).toMatch(
      /^SYNTH-C0402-[\w-]+: [\d.]+ pF effective \([+-][\d.]+ %\)$/,
    );
    const csv = bomCsv(bomRows(r!));
    expect(csv).toMatch(/Synthetic \(not a real part\);SYNTH-L0402-/);
    expect(csv).toMatch(/Synthetic \(not a real part\);SYNTH-C0402-/);
  });

  it('the Realize controls offer the part library and say what it holds', async () => {
    useDesignStore.getState().setRealize({ enabled: true, series: 'library' });
    render(<RealizeControls />);
    expect(screen.getByText(/The part library is empty/)).toBeTruthy();
    await act(async () => {
      await usePartLibrary.getState().addParts(syntheticLibraryParts());
    });
    expect(screen.getByText(/10 parts in the library/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Part library/ }));
    expect(usePartLibrary.getState().open).toBe(true);
  });
});

describe('the exports', () => {
  it('SPICE writes library parts as fitted circuits; the .s2p says it holds measured data and refuses a range past the data', () => {
    const d = designWith([{ kind: 'part', orientation: 'series', part: part('SYNTH-C0402-10P') }], {
      frequency: 1e9,
    });
    expect(designToSpice(d, null)).toMatch(
      /fitted equivalent circuits, not their measured S-parameters/,
    );
    expect(designToS2p(d, null)).toMatch(/! Library parts: from their measured S-parameters/);
    const wide = { ...d, sweep: { ...d.sweep, enabled: true, start: 1e6, stop: 1e9, points: 11 } };
    expect(() => designToS2p(wide, null)).toThrow(/has data from 10 MHz to 10 GHz/);
  });
});

describe('the Part library dialog', () => {
  it('adds the synthetic examples, lists them, adds one to the network in shunt and removes one', async () => {
    render(<PartLibraryDialog onClose={() => undefined} />);
    expect(screen.getByText(/No parts yet/)).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Add synthetic examples/ }));
      await Promise.resolve();
    });
    const row = screen.getByText('SYNTH-C0402-10P').closest('tr') as HTMLElement;
    expect(within(row).getByText('10 pF')).toBeTruthy();
    expect(within(row).getByText('2.582 GHz')).toBeTruthy();
    expect(within(row).getByText('10 MHz to 10 GHz')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Add SYNTH-C0402-10P in shunt' }));
    const els = useDesignStore.getState().design.elements as readonly DesignElement[];
    expect(els).toHaveLength(1);
    expect(els[0]?.kind === 'part' && els[0].orientation).toBe('shunt');
    expect(useDesignStore.getState().message).toBe('Added Shunt C part 1: SYNTH-C0402-10P');
    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'Remove SYNTH-C0402-10P from the library' }),
      );
      await Promise.resolve();
    });
    expect(screen.queryByText('SYNTH-C0402-10P')).toBeNull();
    // The design keeps its own copy.
    expect(useDesignStore.getState().design.elements).toHaveLength(1);
  });

  it('links each manufacturer’s download page and says the files stay in the browser', () => {
    render(<PartLibraryDialog onClose={() => undefined} />);
    // Each link is named by maker and product line and says it opens a new tab (QA D5).
    for (const name of ['Murata', 'Coilcraft', 'Johanson Technology', 'KEMET', 'TDK']) {
      expect(
        screen.getAllByRole('link', { name: new RegExp(`^${name} .*opens in a new tab.$`) }).length,
      ).toBeGreaterThan(0);
    }
    const names = screen.getAllByRole('link').map((a) => a.getAttribute('aria-label'));
    expect(new Set(names).size).toBe(names.length);
    expect(screen.getByText(/never sent anywhere/)).toBeTruthy();
  });

  it('loads files through the file picker and reports failures', async () => {
    render(<PartLibraryDialog onClose={() => undefined} />);
    const input = screen.getByLabelText('Part files') as HTMLInputElement;
    const files = [
      new File([partFile('SYNTH-L0402-4N7')], 'SYNTH-L0402-4N7.s2p'),
      new File(['nonsense'], 'bad.s2p'),
    ];
    await act(async () => {
      fireEvent.change(input, { target: { files } });
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(screen.getByText('SYNTH-L0402-4N7')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toMatch(
      /Added 1 part; 1 file could not be read: bad\.s2p/,
    );
  });
});

describe('a library part in the running app', () => {
  it('shows its card with the part number, the effective value and the SRF', async () => {
    useDesignStore.getState().loadDesign(
      designWith([{ kind: 'part', orientation: 'series', part: part('SYNTH-L0402-10N') }], {
        frequency: 1e9,
      }),
      'x',
    );
    const { App } = await import('../src/App');
    render(<App />);
    expect(screen.getAllByText('SYNTH-L0402-10N').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/^L eff 1\d\.\d+ nH, Q [\d.]+ at 1 GHz$/).length).toBeGreaterThan(0);
    expect(screen.getAllByText('SRF 5.628 GHz').length).toBeGreaterThan(0);
  });
});
