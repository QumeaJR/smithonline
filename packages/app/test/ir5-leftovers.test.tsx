// @vitest-environment jsdom
/**
 * Phase 4 picks up the leftovers of phase 3: one message for an added match
 * from the suggestions and from Auto match (so Undo names the step), one row
 * per distinct network in Add parts, one ladder count in the Broadband note
 * and its progress, S-Plot snapshot names that keep their number, the Add
 * button's centred label and the overflow sheet's close button named after
 * its title. Also the removal of the phase 3 interim preview behaviour.
 */
import { complex, lMatch, singleMatch, type MatchSolution } from '@smithonline/core';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AutoMatch } from '../src/components/AutoMatch';
import { OverflowMenu } from '../src/components/ui/OverflowMenu';
import { broadbandProgressText } from '../src/lib/broadband';
import { emptyDesign } from '../src/lib/design';
import {
  addedMessage,
  buildable,
  distinctSolutions,
  lSolutions,
  networkSignature,
} from '../src/lib/match';
import { PALETTE } from '../src/lib/elements';
import { splitNameSuffix } from '../src/lib/splotNetwork';
import { useDesignStore } from '../src/store/useDesignStore';

function stubPointer(coarse: boolean): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: coarse && query === '(pointer: coarse)',
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
}

beforeEach(() => {
  useDesignStore.getState().init(emptyDesign());
  useDesignStore.getState().setMessage(null);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('an added match names its step', () => {
  it('addElements with a label: the message, and Undo and Redo repeat it', () => {
    const sol = lSolutions(complex(20, -10), complex(50, 0), 50, 1e9)[0] as MatchSolution;
    const store = useDesignStore.getState();
    store.addElements(sol.elements, addedMessage(sol));
    expect(useDesignStore.getState().message).toBe(addedMessage(sol));
    expect(addedMessage(sol)).toMatch(/^Added .+; Zin = .+ Ω \(Q .+\)$/);
    store.undo();
    expect(useDesignStore.getState().message).toBe(`Undo: ${addedMessage(sol)}`);
    store.redo();
    expect(useDesignStore.getState().message).toBe(`Redo: ${addedMessage(sol)}`);
  });

  it('Auto match Add parts writes the same message as the suggestions', async () => {
    stubPointer(false);
    const zin = complex(20, -10);
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<AutoMatch zin={zin} elements={[]} onPreview={() => undefined} onClose={onClose} />);
    await user.click(screen.getByRole('tab', { name: 'Add parts' }));
    const first = lSolutions(zin, complex(50, 0), 50, 1e9)[0] as MatchSolution;
    const rows = screen.getAllByRole('menuitem');
    await user.click(rows[0] as HTMLElement);
    expect(useDesignStore.getState().message).toBe(addedMessage(first));
    expect(onClose).toHaveBeenCalled();
    useDesignStore.getState().undo();
    expect(useDesignStore.getState().message).toBe(`Undo: ${addedMessage(first)}`);
  });
});

describe('one row per distinct network', () => {
  it('an L-network that collapses to one part is listed once', () => {
    // 50 - j50 to 50: the series-first L needs no shunt part, so it is a single series L,
    // which the single-part search finds too.
    const zin = complex(50, -50);
    const target = complex(50, 0);
    // Without the filter the same series L comes twice: once alone, once from the L.
    const parts = PALETTE.filter((p) => !p.id.includes('RLC')).map((p) => p.make(50, 1e9));
    const raw = buildable(
      [...singleMatch(parts, zin, target, 1e9), ...lMatch(zin, target, 1e9)],
      zin,
      50,
      1e9,
    );
    const rawKeys = raw.map((s) => networkSignature(s.elements));
    expect(new Set(rawKeys).size).toBeLessThan(rawKeys.length);
    const sols = lSolutions(zin, target, 50, 1e9);
    const keys = sols.map((s) => networkSignature(s.elements));
    expect(new Set(keys).size).toBe(keys.length);
    const seriesL = sols.filter(
      (s) =>
        s.elements.length === 1 &&
        s.elements[0]?.kind === 'L' &&
        (s.elements[0] as { orientation: string }).orientation === 'series',
    );
    expect(seriesL).toHaveLength(1);
  });

  it('values that agree to four digits are one network; the first (best) one stays', () => {
    const a: MatchSolution = {
      elements: [{ kind: 'L', orientation: 'series', value: 7.957747e-9 }],
      q: 1,
      result: complex(50, 0),
      description: 'series L',
    };
    const b: MatchSolution = {
      ...a,
      elements: [{ kind: 'L', orientation: 'series', value: 7.9577e-9 }],
      q: 2,
    };
    const c: MatchSolution = {
      ...a,
      elements: [{ kind: 'L', orientation: 'shunt', value: 7.957747e-9 }],
    };
    expect(distinctSolutions([a, b, c])).toEqual([a, c]);
  });
});

describe('Broadband counts the same ladders in its note and its progress', () => {
  it('the first pass counts the searched ladders, the second the refined ones', () => {
    expect(broadbandProgressText({ done: 0, total: 76 }, 60)).toBe('Searching ladder 1 of 60');
    expect(broadbandProgressText({ done: 59, total: 76 }, 60)).toBe('Searching ladder 60 of 60');
    expect(broadbandProgressText({ done: 60, total: 76 }, 60)).toBe('Refining the best, 1 of 16');
    expect(broadbandProgressText({ done: 76, total: 76 }, 60)).toBe('Refining the best, 16 of 16');
    expect(broadbandProgressText({ done: 3, total: 48 }, 48)).toBe('Searching ladder 4 of 48');
  });
});

describe('S-Plot snapshot names keep their number', () => {
  it('the name splits into a base that can be cut short and the suffix that stays', () => {
    expect(splitNameSuffix('Example 5 (network snapshot 2)')).toEqual({
      base: 'Example 5',
      suffix: ' (network snapshot 2)',
    });
    expect(splitNameSuffix('amp.s2p (snapshot 12)')).toEqual({
      base: 'amp.s2p',
      suffix: ' (snapshot 12)',
    });
    expect(splitNameSuffix('amp.s2p')).toEqual({ base: 'amp.s2p', suffix: '' });
    expect(splitNameSuffix('(network)')).toEqual({ base: '(network)', suffix: '' });
  });
});

describe('CSS', () => {
  const css = readFileSync(resolve(__dirname, '../src/index.css'), 'utf8').replace(
    /\/\*[\s\S]*?\*\//g,
    '',
  );
  const rule = (selector: string): string =>
    [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter((m) =>
        (m[1] as string)
          .split(',')
          .map((s) => s.trim().replace(/\s+/g, ' '))
          .includes(selector),
      )
      .map((m) => m[2])
      .join(';');

  it('the Add button of a solution row centres its label', () => {
    expect(rule('.solutions.touch .solution-add')).toMatch(/align-items: center/);
  });

  it('the snapshot suffix never shrinks; the base takes the ellipsis', () => {
    expect(rule('.file-head .file-name .file-suffix')).toMatch(/flex: none/);
    expect(rule('.file-head .file-name .file-base')).toMatch(/text-overflow: ellipsis/);
  });

  it('the phase 3 interim rules and the old breakpoints are gone', () => {
    expect(css).not.toMatch(/with-tool|\.previewing|start-hint/);
    expect(css).not.toMatch(/max-width: 1000px|max-width: 1250px|min-width: 1251px/);
    // The tool panel is no overlay any more.
    expect(rule('.tool-panel')).not.toMatch(/position: absolute/);
  });
});

describe('the overflow sheet', () => {
  it('names its close button after its title', async () => {
    stubPointer(true);
    const user = userEvent.setup();
    render(
      <OverflowMenu
        label="More for element 2"
        title="Series C 2, 4.7 pF"
        closeLabel="Close Series C 2"
        items={[{ label: 'Delete', onSelect: () => undefined }]}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'More for element 2' }));
    expect(screen.getByRole('button', { name: 'Close Series C 2' })).toBeTruthy();
  });
});
