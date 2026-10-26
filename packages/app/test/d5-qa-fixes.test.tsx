// @vitest-environment jsdom
/**
 * Phase D5 (real parts), fixes of QA round 1 in the app: no NaN on screen and
 * the status line naming a part outside its data, the checks before a share
 * link's part takes the library's data, what the sender and the recipient of
 * a link are told, the realized line of a placed part, the part library
 * dialog (Undo of a removal, focus, Remove all, feedback, links, help), the
 * library limit for the examples, and the export and report texts.
 */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  complex,
  libraryPartFromData,
  logFrequencies,
  partDataFromCircuit,
  realizeLadder,
  SYNTHETIC_PARTS,
  syntheticPart,
  withoutData,
  type LibraryPart,
} from '@smithonline/core';

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

import { PartLibraryDialog } from '../src/components/PartLibraryDialog';
import { emptyDesign, identify, type Design, type DesignElement } from '../src/lib/design';
import { fmtComplex, fmtNum } from '../src/lib/format';
import { GUIDE } from '../src/lib/guide';
import {
  attachLibraryData,
  libraryAttachProblems,
  libraryPartsLine,
  linkPartsNote,
  partCardInfo,
  partRangeNote,
  shareLinkPartsWarning,
  sweepRangeNote,
} from '../src/lib/parts';
import { memoryPartStore } from '../src/lib/partStore';
import { effectiveElements, realizeDesign, realizedText } from '../src/lib/realize';
import { partRangeRefusal } from '../src/lib/simexport';
import { useDesignStore } from '../src/store/useDesignStore';
import {
  MAX_LIBRARY_PARTS,
  syntheticLibraryParts,
  usePartLibrary,
} from '../src/store/usePartLibrary';

const D = () => useDesignStore.getState();
const synth = (name: string): LibraryPart => {
  const spec = SYNTHETIC_PARTS.find((p) => p.name === name);
  if (!spec) throw new Error(name);
  return syntheticPart(spec);
};
const named = (p: LibraryPart, partNumber: string): LibraryPart => ({
  ...p,
  manufacturer: 'Acme',
  partNumber,
});
function designWith(elements: Parameters<typeof identify>[0], patch: Partial<Design> = {}): Design {
  return { ...emptyDesign(), load: complex(10, 5), ...patch, elements: identify(elements) };
}

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
  D().init(emptyDesign());
  D().setMessage(null);
  usePartLibrary.setState({ parts: [], open: false });
  await usePartLibrary.getState().init(memoryPartStore());
});
afterEach(() => cleanup());

describe('no NaN on screen', () => {
  it('formats a node without a value as "no value" and the dot', () => {
    expect(fmtComplex({ re: NaN, im: NaN })).toBe('no value');
    expect(fmtNum(NaN)).toBe('·');
    expect(fmtNum(Infinity)).toBe('∞');
  });

  it('the status line names the part and its data range when f is past it', async () => {
    D().loadDesign(
      designWith([{ kind: 'part', orientation: 'series', part: synth('SYNTH-C0402-10P') }]),
      'x',
    );
    const { App } = await import('../src/App');
    render(<App />);
    act(() => D().setFrequency(20e9));
    expect(D().message).toMatch(
      /^No value at 20 GHz: SYNTH-C0402-10P \(element 1, Synthetic \(not a real part\)\) has data from 10 MHz to 10 GHz/,
    );
    expect(D().messageError).toBe(true);
  });

  it('notes and their texts', () => {
    const els = [
      { kind: 'part' as const, orientation: 'series' as const, part: synth('SYNTH-C0402-10P') },
    ];
    expect(partRangeNote(els, 1e9)).toBeNull();
    expect(sweepRangeNote(els, 1e6, 20e9)).toMatch(
      /^The sweep has no value below 10 MHz and above 10 GHz: SYNTH-C0402-10P \(element 1, /,
    );
    expect(sweepRangeNote(els, 1e8, 1e9)).toBeNull();
  });
});

describe('a share link part meets the library part of the same name', () => {
  const linkC = named(withoutData(synth('SYNTH-C0402-10P')), 'X1');
  const el = (part: LibraryPart): DesignElement =>
    ({ id: 'e1', kind: 'part', orientation: 'shunt', part }) as DesignElement;

  it('takes the data when type and value agree', () => {
    const out = attachLibraryData([el(linkC)], [named(synth('SYNTH-C0402-10P'), 'X1')]);
    expect(out?.[0]?.kind === 'part' && out[0].part.data !== undefined).toBe(true);
  });

  it('refuses another type and another value, and says why on the card', () => {
    for (const other of [synth('SYNTH-L0402-10N'), synth('SYNTH-C0402-2P2')]) {
      const lib = [named(other, 'X1')];
      expect(attachLibraryData([el(linkC)], lib)).toBeNull();
      const problems = libraryAttachProblems([el(linkC)], lib);
      expect(problems).toHaveLength(1);
      const info = partCardInfo(
        { kind: 'part', orientation: 'shunt', part: linkC },
        1e9,
        problems[0]?.reason,
      );
      expect(info.warnings.join(' ')).toMatch(/not the library part of the same name/);
    }
  });

  it('the recipient is told what became of the parts', () => {
    const lib = [named(synth('SYNTH-C0402-10P'), 'X1')];
    const els = [el(linkC), el(named(withoutData(synth('SYNTH-L0402-10N')), 'Y2'))];
    expect(linkPartsNote(els, lib, { fromLibrary: true, missing: 1 })).toBe(
      'The link holds 2 library parts as fitted circuits; 1 took the measured data from your part library; 1 stays approximate until its .s2p file is in your part library. Realize uses your part library: 1 L or C has no part there and stays ideal.',
    );
    expect(linkPartsNote([], lib, { fromLibrary: false, missing: 0 })).toBeNull();
  });

  it('the sender is told that parts travel as fitted circuits', () => {
    expect(shareLinkPartsWarning([{ kind: 'part' }], false)).toMatch(
      /fitted circuits \(approximate\).*Save as Smith Online \(\.json\)/,
    );
    expect(shareLinkPartsWarning([{ kind: 'L' }], true)).toMatch(/recipient's own library/);
    expect(shareLinkPartsWarning([{ kind: 'L' }], false)).toBeNull();
  });
});

describe('the card and the realized line', () => {
  it('data that is not passive is flagged, never "lossless"', () => {
    const p = libraryPartFromData(
      partDataFromCircuit(
        { type: 'C', c: 10e-12, esl: 0.38e-9, esr: -0.02 },
        'series',
        logFrequencies(10e6, 10e9, 101),
      ),
      { manufacturer: 'M', partNumber: 'NOISY' },
    );
    const info = partCardInfo({ kind: 'part', orientation: 'series', part: p }, 1e9);
    expect(info.atF).toMatch(/not passive/);
    expect(info.atF).not.toMatch(/lossless/);
    expect(info.warnings.join(' ')).toMatch(/^Not passive at 1 GHz/);
  });

  it('a placed part says as measured only when it is', () => {
    const p = synth('SYNTH-C0402-10P');
    const text = (part: LibraryPart, orientation: 'series' | 'shunt'): string => {
      const r = realizeLadder(
        {
          z0: 50,
          frequency: 1e9,
          load: complex(10, 0),
          elements: [{ kind: 'part', orientation, part }],
        },
        { source: { kind: 'series', series: 'E24' }, scope: 'all' },
      );
      return realizedText(r.elements[0]!, r.sourceLabel);
    };
    expect(text(p, 'series')).toBe('library part, as measured');
    expect(text(p, 'shunt')).toBe(
      'library part, measured in series but placed to ground (approximate)',
    );
    expect(text(withoutData(p), 'series')).toBe('library part, fitted circuit (approximate)');
  });

  it('an L or C the library has nothing for says so', () => {
    const r = realizeLadder(
      {
        z0: 50,
        frequency: 1e9,
        load: complex(10, 0),
        elements: [{ kind: 'C', orientation: 'shunt', value: 3e-12 }],
      },
      { source: { kind: 'library', parts: [] }, scope: 'all' },
    );
    expect(realizedText(r.elements[0]!, r.sourceLabel)).toBe('no library part, stays ideal');
  });

  it('the report line lists library parts, measured or approximate', () => {
    const els = [
      { kind: 'part' as const, orientation: 'series' as const, part: synth('SYNTH-C0402-10P') },
      { kind: 'L' as const, orientation: 'shunt' as const, value: 1e-9 },
      {
        kind: 'part' as const,
        orientation: 'series' as const,
        part: named(withoutData(synth('SYNTH-L0402-10N')), 'X1'),
      },
    ];
    expect(libraryPartsLine(els)).toBe(
      'Library parts: 1 Synthetic (not a real part) SYNTH-C0402-10P (measured data), 3 Acme X1 (fitted circuit, approximate)',
    );
  });
});

describe('the .s2p range refusal', () => {
  const p: LibraryPart = {
    manufacturer: 'QA',
    partNumber: 'R1',
    type: 'C',
    range: [1e8, 1e9],
    circuit: { type: 'C', c: 1e-12, esl: 0, esr: 0.1 },
  };
  const els = [{ kind: 'part' as const, orientation: 'shunt' as const, part: p }];
  it('names the export range and the fix with the sweep off', () => {
    expect(partRangeRefusal(els, [0.5e9, 2e9], false)).toMatch(
      /0\.5 f to 2 f with the sweep off .*turn on a frequency sweep inside the data/,
    );
    expect(partRangeRefusal(els, [0.5e9, 2e9], true)).toMatch(/narrow the sweep to that range/);
  });
});

describe('the library limit for the examples', () => {
  it('addParts reports what the limit left out', async () => {
    await usePartLibrary.getState().addParts(syntheticLibraryParts());
    const spare = Array.from({ length: MAX_LIBRARY_PARTS - 15 }, (_, i) => ({
      part: named(withoutData(synth('SYNTH-C0402-1P0')), `P${i}`),
      fileName: `P${i}.s2p`,
    }));
    const r = await usePartLibrary.getState().addParts(spare);
    expect(r).toEqual({ added: MAX_LIBRARY_PARTS - 15, skipped: 0 });
    const more = await usePartLibrary.getState().addParts(
      Array.from({ length: 8 }, (_, i) => ({
        part: named(withoutData(synth('SYNTH-C0402-1P0')), `Q${i}`),
        fileName: `Q${i}.s2p`,
      })),
    );
    expect(more).toEqual({ added: 5, skipped: 3 });
    expect(usePartLibrary.getState().parts).toHaveLength(MAX_LIBRARY_PARTS);
  });
});

describe('the part library dialog', () => {
  it('focuses Load first, and the help link opens at the part library', () => {
    render(<PartLibraryDialog onClose={() => undefined} />);
    expect(document.activeElement?.textContent).toMatch(/^Load \.s2p files/);
    expect(GUIDE.some((b) => b.kind === 'heading' && b.id === 'part-library')).toBe(true);
  });

  it('Remove offers Undo, moves the focus to the next row and says Realize changes', async () => {
    await usePartLibrary.getState().addParts(syntheticLibraryParts());
    D().loadDesign(
      designWith([{ kind: 'C', orientation: 'shunt', value: 10e-12 }], {
        frequency: 1e9,
        realize: { enabled: true, series: 'library', stockText: '', scope: 'all' },
      }),
      'x',
    );
    const r = realizeDesign(D().design, effectiveElements(D().design));
    const chosen = r?.elements[0]?.realized;
    const used = chosen?.kind === 'part' ? chosen.part.partNumber : '';
    expect(used).toMatch(/^SYNTH-C0402-/);
    render(<PartLibraryDialog onClose={() => undefined} />);
    const status = screen.getByRole('status');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: `Remove ${used} from the library` }));
    });
    expect(status.textContent).toMatch(new RegExp(`^Removed ${used} from the library`));
    expect(status.textContent).toMatch(/Realize used it: the realized network and the BOM change/);
    const next = usePartLibrary.getState().parts.find((p) => p.part.partNumber > used);
    expect(document.activeElement?.getAttribute('aria-label')).toBe(
      `Remove ${next?.part.partNumber} from the library`,
    );
    await act(async () => {
      fireEvent.click(within(status).getByRole('button', { name: 'Undo' }));
    });
    expect(usePartLibrary.getState().parts.some((p) => p.part.partNumber === used)).toBe(true);
  });

  it('Remove all asks first, and Undo puts every part back', async () => {
    await usePartLibrary.getState().addParts(syntheticLibraryParts());
    render(<PartLibraryDialog onClose={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove all…' }));
    expect(screen.getByRole('alert').textContent).toBe('Remove all 10 parts from the library?');
    expect(usePartLibrary.getState().parts).toHaveLength(10);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Remove all' }));
    });
    expect(usePartLibrary.getState().parts).toHaveLength(0);
    await act(async () => {
      fireEvent.click(within(screen.getByRole('status')).getByRole('button', { name: 'Undo' }));
    });
    expect(usePartLibrary.getState().parts).toHaveLength(10);
  });

  it('adding a part says so inside the dialog', async () => {
    await usePartLibrary.getState().addParts(syntheticLibraryParts());
    render(<PartLibraryDialog onClose={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add SYNTH-L0402-10N in shunt' }));
    expect(screen.getByRole('status').textContent).toMatch(
      /^Added Shunt L part 1: SYNTH-L0402-10N, to ground, at the source end/,
    );
    expect(D().design.elements).toHaveLength(1);
  });
});
