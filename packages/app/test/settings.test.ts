import { beforeEach, describe, expect, it } from 'vitest';
import { gridLabels } from '../src/chart/grid';
import { ARC_COLORS, colorByIndex, nextColor, setPalette } from '../src/lib/colors';
import { emptyDesign } from '../src/lib/design';
import {
  DEFAULT_SETTINGS,
  PALETTE_SIZE,
  applySettings,
  parseSettings,
  settingsVars,
} from '../src/lib/settings';
import { useDesignStore } from '../src/store/useDesignStore';
import { useSettings } from '../src/store/useSettings';

/** The few parts of an element the settings code touches. */
function fakeRoot(): { el: HTMLElement; props: Map<string, string> } {
  const props = new Map<string, string>();
  const el = {
    style: {
      setProperty: (k: string, v: string) => void props.set(k, v),
      removeProperty: (k: string) => void props.delete(k),
    },
  } as unknown as HTMLElement;
  return { el, props };
}

beforeEach(() => {
  setPalette(ARC_COLORS);
  useSettings.setState({ settings: DEFAULT_SETTINGS });
  useDesignStore.getState().init(emptyDesign());
});

describe('settings parsing', () => {
  it('takes defaults for anything missing or malformed', () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('x')).toEqual(DEFAULT_SETTINGS);
    const s = parseSettings({
      colors: { gridZ: 'red', gridY: '#AABBCC', sweep: 5 },
      palette: ['#112233', 'nope'],
      gridWidth: 99,
      locusWidth: 'wide',
      labelDensity: 'lots',
      defaultFrequency: -1,
      defaultZ0: 75,
      schematic: 'diagonal',
    });
    expect(s.colors.gridZ).toBeNull();
    expect(s.colors.gridY).toBe('#aabbcc');
    expect(s.colors.sweep).toBeNull();
    expect(s.palette).toHaveLength(PALETTE_SIZE);
    expect(s.palette[0]).toBe('#112233');
    expect(s.palette[1]).toBe(ARC_COLORS[1]);
    expect(s.gridWidth).toBe(4);
    expect(s.locusWidth).toBe(DEFAULT_SETTINGS.locusWidth);
    expect(s.labelDensity).toBe('auto');
    expect(s.defaultFrequency).toBe(1e9);
    expect(s.defaultZ0).toBe(75);
    expect(s.schematic).toBe('horizontal');
  });

  it('round-trips through JSON', () => {
    const s = {
      ...DEFAULT_SETTINGS,
      colors: { ...DEFAULT_SETTINGS.colors, vswr: '#123456' },
      schematic: 'vertical' as const,
      labelDensity: 'many' as const,
    };
    expect(parseSettings(JSON.parse(JSON.stringify(s)))).toEqual(s);
  });
});

describe('settings reach the CSS variables', () => {
  it('sets only the colours that were changed, plus the widths', () => {
    const vars = settingsVars({
      ...DEFAULT_SETTINGS,
      gridWidth: 1.5,
      locusWidth: 3,
      colors: { ...DEFAULT_SETTINGS.colors, gridZ: '#010203', datapoints: '#ff0000' },
    });
    expect(vars).toEqual({
      '--w-grid': '1.5px',
      '--w-grid-minor': '0.75px',
      '--w-locus': '3px',
      '--grid-z': '#010203',
      '--marker': '#ff0000',
      '--dp-user': '#ff0000',
    });
  });

  it('applies to the root and a reset removes the colours again', () => {
    const { el, props } = fakeRoot();
    applySettings(
      { ...DEFAULT_SETTINGS, colors: { ...DEFAULT_SETTINGS.colors, sweep: '#00ff00' } },
      el,
    );
    expect(props.get('--sweep')).toBe('#00ff00');
    applySettings(DEFAULT_SETTINGS, el);
    expect(props.has('--sweep')).toBe(false);
    expect(props.get('--w-grid')).toBe('1px');
  });
});

describe('settings change what the app does', () => {
  it('hands new elements the colours of the palette in use', () => {
    setPalette(['#111111', '#222222']);
    expect(colorByIndex(0)).toBe('#111111');
    expect(colorByIndex(3)).toBe('#222222');
    expect(nextColor([{ color: '#111111' }])).toBe('#222222');
    useDesignStore.getState().addElement({ kind: 'L', orientation: 'series', value: 1e-9 });
    expect(useDesignStore.getState().design.elements[0]!.color).toBe('#111111');
  });

  it('starts a new design with the default frequency and Z0', () => {
    useSettings.getState().update({ defaultFrequency: 433e6, defaultZ0: 75 });
    useDesignStore.getState().newDesign();
    const d = useDesignStore.getState().design;
    expect(d.frequency).toBe(433e6);
    expect(d.z0).toBe(75);
    expect(d.load).toEqual({ re: 75, im: 0 });
  });

  it('emptyDesign keeps 50 ohm and 1 GHz without defaults', () => {
    expect(emptyDesign()).toMatchObject({ z0: 50, frequency: 1e9, load: { re: 50, im: 0 } });
  });

  it('label density picks few, grid-dependent or many labels', () => {
    const count = (l: 'few' | 'auto' | 'many') => gridLabels('normal', 1, l).length;
    expect(count('few')).toBeLessThan(count('auto'));
    expect(count('auto')).toBeLessThan(count('many'));
    expect(gridLabels('normal', 1)).toEqual(gridLabels('normal', 1, 'auto'));
  });
});
