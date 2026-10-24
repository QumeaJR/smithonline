// @vitest-environment jsdom
/**
 * Fixes of QA round 3 on the interaction redesign: the ladder field names in the refusal,
 * Escape clearing a field's own refusal, the Settings reset names, the badge text by
 * contrast, the Field keeping fF together, the substrate height in millimetres, and the
 * coarse-pointer and layout rules in index.css.
 */
import { evaluateLadder } from '@smithonline/core';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Ladder } from '../src/components/Ladder';
import { SettingsDialog } from '../src/components/SettingsDialog';
import { Badge } from '../src/components/ui/Badge';
import { Field } from '../src/components/ui/Field';
import { ARC_COLORS, DARK_ON_COLOR, textOnColor } from '../src/lib/colors';
import { emptyDesign } from '../src/lib/design';
import { PALETTE } from '../src/lib/elements';
import { substrateHeight } from '../src/lib/format';
import { effectiveElements } from '../src/lib/realize';
import { useDesignStore } from '../src/store/useDesignStore';

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
afterEach(cleanup);
beforeEach(() => {
  useDesignStore.getState().init(emptyDesign());
  useDesignStore.getState().setMessage(null);
});

const message = (): string | null => useDesignStore.getState().message;
const enter = (input: HTMLElement, text: string): void => {
  act(() => input.focus());
  fireEvent.change(input, { target: { value: text } });
  fireEvent.keyDown(input, { key: 'Enter' });
};

function LiveLadder() {
  const design = useDesignStore((s) => s.design);
  const result = evaluateLadder({
    z0: design.z0,
    frequency: design.frequency,
    load: design.load,
    elements: effectiveElements(design),
  });
  return <Ladder result={result} realization={null} />;
}

describe('ladder value fields', () => {
  it('each field is named for the element and the quantity, and the refusal uses the name', () => {
    const make = (id: string) => PALETTE.find((p) => p.id === id)!.make(50, 1e9);
    useDesignStore.getState().addElements([make('seriesL'), make('shuntC')]);
    render(<LiveLadder />);
    const c = screen.getByRole('textbox', { name: 'Shunt C 2 capacitance' });
    expect(screen.getByRole('textbox', { name: 'Series L 1 inductance' })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Shunt C 2 Q' })).toBeTruthy();
    enter(c, 'abc');
    expect(message()).toBe('Shunt C 2 capacitance: "abc" is not a number');
  });
});

describe('Escape after a refusal', () => {
  it('reverting the field clears its own refusal message', () => {
    render(<Field label="f" value={1e9} unit="Hz" min={1} onCommit={() => undefined} />);
    const input = screen.getByRole('textbox');
    enter(input, 'abc');
    expect(message()).toBe('f: "abc" is not a number');
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(message()).toBeNull();
  });

  it('reverting another field leaves the refusal on show', () => {
    render(
      <>
        <Field label="f" value={1e9} unit="Hz" min={1} onCommit={() => undefined} />
        <Field label="Z0" value={50} unit="Ω" min={1} onCommit={() => undefined} />
      </>,
    );
    const [f, z0] = screen.getAllByRole('textbox') as [HTMLElement, HTMLElement];
    enter(f, 'abc');
    act(() => z0.focus());
    fireEvent.change(z0, { target: { value: '75' } });
    fireEvent.keyDown(z0, { key: 'Escape' });
    expect(message()).toBe('f: "abc" is not a number');
  });
});

describe('a farad field and its prefixes', () => {
  it('a value in femtofarads keeps its unit inside the input, so it reads back', () => {
    const onCommit = vi.fn();
    const { container } = render(
      <Field label="C" value={470e-15} unit="F" min={0} onCommit={onCommit} />,
    );
    const input = screen.getByRole('textbox') as HTMLInputElement;
    expect(input.value).toBe('470 fF');
    expect(container.querySelector('.ui-field-unit')).toBeNull();
    enter(input, '480 fF');
    expect(onCommit.mock.calls[0]![0]).toBeCloseTo(480e-15, 25);
  });

  it('"2 f" is refused with both readings named', () => {
    render(<Field label="C" value={1e-12} unit="F" min={0} onCommit={() => undefined} />);
    enter(screen.getByRole('textbox'), '2 f');
    expect(message()).toBe('C: "2 f" is ambiguous (2 fF or 2 F?)');
  });

  it('"1.5m" in a metre field asks for mm or m', () => {
    render(<Field label="h" value={1e-3} unit="m" min={0} onCommit={() => undefined} />);
    enter(screen.getByRole('textbox'), '1.5m');
    expect(message()).toBe('h: "1.5m" is ambiguous (write 1.5 mm or 1.5 m)');
  });
});

describe('Settings', () => {
  it('each colour reset names its colour', () => {
    render(<SettingsDialog onClose={() => undefined} />);
    expect(
      screen.getByRole('button', { name: 'Back to the theme colour: impedance grid' }),
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Back to the theme colour: Q contours' }),
    ).toBeTruthy();
  });

  it('the package table sits in its own sideways-scrolling box', () => {
    const { container } = render(<SettingsDialog onClose={() => undefined} />);
    expect(container.querySelector('.package-table-scroll > table')).not.toBeNull();
  });
});

describe('badge text by contrast', () => {
  const contrast = (a: string, b: string): number => {
    const lum = (hex: string): number => {
      const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
      const [r, g, bl] = c.map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
      return 0.2126 * r! + 0.7152 * g! + 0.0722 * bl!;
    };
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
    return (x! + 0.05) / (y! + 0.05);
  };

  it('every palette colour gets the text with the higher contrast, at least 3:1', () => {
    for (const c of ARC_COLORS) {
      const text = textOnColor(c);
      const white = contrast(c, '#ffffff');
      const dark = contrast(c, DARK_ON_COLOR);
      expect(text === '#fff' ? white : dark).toBeGreaterThanOrEqual(Math.max(white, dark));
      expect(Math.max(white, dark)).toBeGreaterThanOrEqual(3);
    }
    expect(textOnColor('#f08c00')).toBe(DARK_ON_COLOR);
  });

  it('the badge applies it; a CSS variable fill keeps the caller text', () => {
    render(
      <>
        <Badge color="#f08c00">4</Badge>
        <Badge color="var(--accent)" style={{ color: 'var(--on-accent)' }}>
          T
        </Badge>
      </>,
    );
    expect(screen.getByText('4').style.color).toBe('rgb(26, 26, 26)');
    expect(screen.getByText('T').style.color).toBe('var(--on-accent)');
  });
});

describe('substrate height', () => {
  it('in millimetres from 0.05 mm to 10 mm, with a prefix outside', () => {
    expect(substrateHeight(0.8e-3)).toBe('0.8 mm');
    expect(substrateHeight(1.6e-3)).toBe('1.6 mm');
    expect(substrateHeight(0.05e-3)).toBe('0.05 mm');
    expect(substrateHeight(10e-3)).toBe('10 mm');
    expect(substrateHeight(20e-6)).toBe('20 µm');
    expect(substrateHeight(1)).toBe('1 m');
  });
});

describe('index.css rules of round 3', () => {
  const css = readFileSync(resolve(__dirname, '../src/index.css'), 'utf8').replace(
    /\/\*[\s\S]*?\*\//g,
    '',
  );
  const rule = (selector: string): string => {
    const out: string[] = [];
    for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selectors = m[1]!.split(',').map((s) => s.trim().replace(/\s+/g, ' '));
      if (selectors.includes(selector)) out.push(m[2]!);
    }
    return out.join(';').replace(/\s+/g, ' ');
  };

  it('Settings: the table scrolls in its own box, the dialog never sideways', () => {
    expect(rule('.package-table-scroll')).toMatch(/overflow-x: auto/);
    expect(rule('.package-table tbody th')).toMatch(/position: sticky/);
    expect(rule('.modal.settings')).toMatch(/overflow-x: hidden/);
  });

  it('the wrapping segmented rows are of equal height with a 22 px floor', () => {
    expect(rule('.segmented.wrap')).toMatch(/grid-auto-rows: 1fr/);
    expect(rule('.segmented.wrap .segmented-option')).toMatch(/min-height: var\(--control-h-sm\)/);
  });

  it('the Datapoints heading keeps the help link whole beside its control', () => {
    expect(rule('h2:has(> .toggle) .help-link')).toMatch(/flex-shrink: 0/);
    expect(rule('h2:has(> .toggle)')).toMatch(/gap: 6px/);
  });

  it('coarse pointer: the controls that missed the touch sizes', () => {
    expect(rule('.view-tabs .segmented-option')).toMatch(/min-height: var\(--control-h\)/);
    expect(rule('.toolbar-row .btn')).toMatch(/min-width: var\(--control-h\)/);
    expect(rule('.number-list .value-input')).toMatch(/min-height: var\(--control-h\)/);
    expect(rule(".modal.settings input[type='color']")).toMatch(/min-height: var\(--control-h\)/);
    expect(rule('.modal.settings .check')).toMatch(/min-height: var\(--control-h\)/);
  });
});
