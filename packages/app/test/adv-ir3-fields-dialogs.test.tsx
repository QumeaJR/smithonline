// @vitest-environment jsdom
/**
 * Adversarial round 3 on 38e2242 through the components: units that are prefix letters in
 * real Fields, the metre display round trip through the Dimensions dialog, and the Escape
 * order with Help stacked on Settings and on the Auto match chooser.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { complex } from '@smithonline/core';
import { DimensionsDialog } from '../src/components/DimensionsDialog';
import { HelpDialog } from '../src/components/HelpDialog';
import { NumberList } from '../src/components/NumberList';
import { SettingsDialog } from '../src/components/SettingsDialog';
import { Field } from '../src/components/ui/Field';
import { emptyDesign } from '../src/lib/design';
import { useDesignStore } from '../src/store/useDesignStore';
import { useHelp } from '../src/store/useHelp';
import { DEFAULT_SUBSTRATE, useSubstrateStore } from '../src/store/useSubstrateStore';
import { useBoard } from '../src/store/useBoard';

let coarse = false;
beforeAll(() => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('coarse') ? coarse : false,
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

afterEach(() => {
  cleanup();
  act(() => useHelp.getState().closeHelp());
  coarse = false;
});
beforeEach(() => {
  useDesignStore.getState().init(emptyDesign());
  useDesignStore.getState().setMessage(null);
  useSubstrateStore.getState().setSubstrate({ ...DEFAULT_SUBSTRATE });
  useBoard.getState().reset();
});

const message = (): string | null => useDesignStore.getState().message;

async function typeEnter(input: HTMLElement, text: string): Promise<void> {
  const user = userEvent.setup();
  await user.click(input);
  await user.clear(input);
  await user.type(input, `${text}{Enter}`);
}

describe('adv ir3 prefix letters as units in real Fields', () => {
  it('ladder capacitor: "100nf" commits 100 nF (it did before 38e2242)', async () => {
    const onCommit = vi.fn();
    render(<Field label="C" value={1e-12} unit="F" min={0} onCommit={onCommit} ariaLabel="C" />);
    await typeEnter(screen.getByRole('textbox', { name: 'C' }), '100nf');
    expect(message()).toBeNull();
    expect(onCommit).toHaveBeenCalledWith(100e-9);
  });

  it('stress current limit: "2a" does not commit 2 aA', async () => {
    const onCommit = vi.fn();
    render(<Field label="I rms" value={0} unit="A" min={0} onCommit={onCommit} ariaLabel="I" />);
    await typeEnter(screen.getByRole('textbox', { name: 'I' }), '2a');
    const v = onCommit.mock.calls[0]?.[0] as number | undefined;
    expect(v === undefined || v === 2, `committed ${v}`).toBe(true);
  });

  it('load G (plain, suffix mS): "20m" does not commit 0.02 mS', async () => {
    const onCommit = vi.fn();
    render(<Field label="G" value={10} plain suffix="mS" onCommit={onCommit} ariaLabel="G" />);
    await typeEnter(screen.getByRole('textbox', { name: 'G' }), '20m');
    const v = onCommit.mock.calls[0]?.[0] as number | undefined;
    expect(v === undefined || v === 20, `committed ${v}`).toBe(true);
  });

  it('frequency: "2.4 ghz" is not called a wrong unit (the unit is Hz)', async () => {
    render(<Field label="f" value={1e9} unit="Hz" min={1} onCommit={() => undefined} />);
    await typeEnter(screen.getByRole('textbox'), '2.4 ghz');
    expect(message() ?? '').not.toContain('wrong unit (Hz)');
  });

  it('noise circles NumberList: "1.5 dB" is added', () => {
    const onChange = vi.fn();
    render(
      <NumberList
        label="Noise circles"
        values={[]}
        min={0.5}
        swatch="red"
        placeholder="1"
        unit=" dB"
        onChange={onChange}
      />,
    );
    const input = screen.getByRole('textbox', { name: 'Add Noise circles' });
    fireEvent.change(input, { target: { value: '1.5 dB' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith([1.5]);
  });
});

describe('adv ir3 Dimensions dialog: the metre inside the input', () => {
  const withLine = (): void => {
    useDesignStore.getState().init({
      ...emptyDesign(),
      load: complex(25, 10),
      elements: [
        {
          id: 'l1',
          color: '#000',
          kind: 'line',
          z0: 50,
          length: 0.125,
          refFrequency: 1e9,
          er: 1,
          alphaDbPerM: 0,
        },
      ],
    });
  };
  const presets: readonly { h: number; t: number; d: number }[] = [
    { h: 1.6e-3, t: 35e-6, d: 4.1e-3 },
    { h: 1.524e-3, t: 17.5e-6, d: 2.95e-3 },
    { h: 0.508e-3, t: 0, d: 6.35e-3 },
    { h: 1.57e-3, t: 1e-6, d: 1e-3 },
    { h: 1, t: 1.5e-3, d: 0.0254 },
    { h: 123.456789e-6, t: 34.999e-6, d: 1.23456e-3 },
  ];

  it.each(presets)(
    'Tab through every field without typing: no change, no undo step (%j)',
    async (p) => {
      withLine();
      for (const medium of ['microstrip', 'coax'] as const) {
        // Since phase D4 the microstrip numbers are the board's stackup (Settings > Board).
        useSubstrateStore.getState().setSubstrate({ medium, coaxDiameter: p.d });
        useBoard.getState().setStackup({ h: p.h, t: p.t });
        const before = JSON.stringify(useSubstrateStore.getState().substrate);
        const boardBefore = JSON.stringify(useBoard.getState().board);
        const pastBefore = useDesignStore.getState().past.length;
        const designBefore = useDesignStore.getState().design;
        const onClose = vi.fn();
        render(<DimensionsDialog index={0} onClose={onClose} />);
        const user = userEvent.setup();
        for (let i = 0; i < 12; i++) await user.tab();
        // and type each shown text back verbatim, then Enter
        for (const input of screen.getAllByRole('textbox') as HTMLInputElement[]) {
          const shown = input.value;
          await user.click(input);
          await user.clear(input);
          await user.type(input, `${shown}{Enter}`);
        }
        await user.tab();
        expect(JSON.stringify(useSubstrateStore.getState().substrate)).toBe(before);
        expect(JSON.stringify(useBoard.getState().board)).toBe(boardBefore);
        expect(useDesignStore.getState().past.length).toBe(pastBefore);
        expect(useDesignStore.getState().design).toBe(designBefore);
        expect(message()).toBeNull();
        expect(onClose).not.toHaveBeenCalled();
        cleanup();
      }
    },
  );

  it('h shows its unit inside the input and the shown text means the same value', () => {
    withLine();
    useSubstrateStore.getState().setSubstrate({ medium: 'microstrip' });
    // t was 1 m here; since the D4 QA fixes copper thicker than 1 mm is refused, so 1 mm.
    useBoard.getState().setStackup({ h: 1e-3, t: 1e-3 });
    render(<DimensionsDialog index={0} onClose={() => undefined} />);
    const h = screen.getByRole('textbox', { name: 'Substrate height' }) as HTMLInputElement;
    const t = screen.getByRole('textbox', { name: 'Conductor thickness' }) as HTMLInputElement;
    expect(h.value).toBe('1 mm');
    expect(t.value).toBe('1 mm');
  });

  it('first Escape in a typed h reverts, the second closes', async () => {
    withLine();
    const onClose = vi.fn();
    render(<DimensionsDialog index={0} onClose={onClose} />);
    const h = screen.getByRole('textbox', { name: 'Substrate height' }) as HTMLInputElement;
    const shown = h.value;
    const user = userEvent.setup();
    await user.click(h);
    await user.clear(h);
    await user.type(h, '2 mm');
    await user.keyboard('{Escape}');
    expect(onClose).not.toHaveBeenCalled();
    expect(h.value).toBe(shown);
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('a refused entry kept after Enter: Escape reverts first, the dialog stays', async () => {
    withLine();
    const onClose = vi.fn();
    render(<DimensionsDialog index={0} onClose={onClose} />);
    const h = screen.getByRole('textbox', { name: 'Substrate height' }) as HTMLInputElement;
    const shown = h.value;
    await typeEnter(h, '1,6 mm');
    expect(h.value).toBe('1,6 mm');
    fireEvent.keyDown(h, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    expect(h.value).toBe(shown);
  });
});

describe('adv ir3 Escape order with stacked dialogs', () => {
  it('Help over Settings: the first Escape closes Help only, the second Settings', () => {
    const onClose = vi.fn();
    const Both = () => {
      const open = useHelp((s) => s.open);
      return (
        <>
          <SettingsDialog onClose={onClose} />
          {open && <HelpDialog onClose={() => useHelp.getState().closeHelp()} />}
        </>
      );
    };
    render(<Both />);
    act(() => useHelp.getState().openHelp());
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    expect(useHelp.getState().open).toBe(false);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Help over Settings with typed text left in a Settings field: Escape closes Help', async () => {
    const onClose = vi.fn();
    const Both = () => {
      const open = useHelp((s) => s.open);
      return (
        <>
          <SettingsDialog onClose={onClose} />
          {open && <HelpDialog onClose={() => useHelp.getState().closeHelp()} />}
        </>
      );
    };
    render(<Both />);
    const input = screen.getAllByRole('textbox')[0]!;
    act(() => input.focus());
    fireEvent.change(input, { target: { value: '123' } });
    // F1 from the field: the app opens the help; the keyboard focus may stay in the field
    act(() => useHelp.getState().openHelp());
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    expect(useHelp.getState().open).toBe(false);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('Auto match chooser open, Help opened over it (F1): Escape closes Help first', async () => {
    coarse = true;
    const { AutoMatch } = await import('../src/components/AutoMatch');
    const Both = () => {
      const open = useHelp((s) => s.open);
      return (
        <>
          <AutoMatch
            zin={complex(25, 10)}
            elements={[]}
            onPreview={() => undefined}
            onClose={() => undefined}
          />
          {open && <HelpDialog onClose={() => useHelp.getState().closeHelp()} />}
        </>
      );
    };
    render(<Both />);
    const opener = document.querySelector<HTMLButtonElement>('.chooser-row');
    expect(opener, 'chooser row rendered on a coarse pointer').not.toBeNull();
    fireEvent.click(opener!);
    expect(screen.getByRole('radiogroup', { name: 'Matching method' })).toBeTruthy();
    act(() => useHelp.getState().openHelp());
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    expect(useHelp.getState().open, 'Help (on top) closes on the first Escape').toBe(false);
    // only the top layer closes: the chooser under the help stays open
    expect(screen.queryByRole('radiogroup', { name: 'Matching method' })).not.toBeNull();
  });
});
