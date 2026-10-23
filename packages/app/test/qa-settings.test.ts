/**
 * QA round 1: settings parsing at the limits, the CSS variables, and the store.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { ARC_COLORS, nextColor } from '../src/lib/colors';
import {
  applySettings,
  DEFAULT_SETTINGS,
  PALETTE_SIZE,
  parseSettings,
  settingsVars,
  WIDTH_RANGE,
} from '../src/lib/settings';
import { useSettings } from '../src/store/useSettings';

afterEach(() => {
  applySettings(DEFAULT_SETTINGS);
  useSettings.setState({ settings: DEFAULT_SETTINGS });
});

describe('parseSettings limits', () => {
  it('clamps widths into the range, lowercases colours, rejects short hex, fills a short palette', () => {
    const s = parseSettings({
      gridWidth: 10,
      locusWidth: 0.1,
      palette: ['#ABCDEF', 'bad'],
      colors: { gridZ: '#ABC', vswr: '#00FF00', q: 7 },
      defaultZ0: 0,
      defaultFrequency: -5,
      labelDensity: 'bogus',
      schematic: 'diagonal',
    });
    expect(s.gridWidth).toBe(WIDTH_RANGE.max);
    expect(s.locusWidth).toBe(WIDTH_RANGE.min);
    expect(s.palette).toHaveLength(PALETTE_SIZE);
    expect(s.palette[0]).toBe('#abcdef');
    expect(s.palette.slice(1)).toEqual(ARC_COLORS.slice(1));
    expect(s.colors.gridZ).toBeNull();
    expect(s.colors.vswr).toBe('#00ff00');
    expect(s.colors.q).toBeNull();
    expect(s.defaultZ0).toBe(50);
    expect(s.defaultFrequency).toBe(1e9);
    expect(s.labelDensity).toBe('auto');
    expect(s.schematic).toBe('horizontal');
  });

  it('NaN and Infinity widths and defaults fall back; a palette longer than the size is cut', () => {
    const s = parseSettings({
      gridWidth: NaN,
      locusWidth: Infinity,
      defaultFrequency: Infinity,
      palette: Array.from({ length: PALETTE_SIZE + 3 }, () => '#111111'),
    });
    expect(s.gridWidth).toBe(1);
    expect(s.locusWidth).toBe(2);
    expect(s.defaultFrequency).toBe(1e9);
    expect(s.palette).toHaveLength(PALETTE_SIZE);
  });

  it('a boundary width is kept as is', () => {
    expect(parseSettings({ gridWidth: 0.5, locusWidth: 4 })).toMatchObject({
      gridWidth: 0.5,
      locusWidth: 4,
    });
  });

  it('non-object input, null and arrays give the defaults', () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('x')).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings([])).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings({ colors: 'red', palette: 'blue' })).toEqual(DEFAULT_SETTINGS);
  });
});

describe('settingsVars', () => {
  it('writes the widths with the minor grid at half, and each colour to its variables', () => {
    const vars = settingsVars({
      ...DEFAULT_SETTINGS,
      gridWidth: 1.5,
      colors: { ...DEFAULT_SETTINGS.colors, datapoints: '#123456', vswr: '#00ff00' },
    });
    expect(vars).toEqual({
      '--w-grid': '1.5px',
      '--w-grid-minor': '0.75px',
      '--w-locus': '2px',
      '--marker': '#123456',
      '--dp-user': '#123456',
      '--vswr': '#00ff00',
    });
  });
});

describe('applySettings on a given root', () => {
  it('sets the variables, removes the absent ones, and hands the palette to new elements', () => {
    const set: Record<string, string> = {};
    const removed: string[] = [];
    const root = {
      style: {
        setProperty: (k: string, v: string) => {
          set[k] = v;
        },
        removeProperty: (k: string) => {
          removed.push(k);
        },
      },
    } as unknown as HTMLElement;
    const palette = Array.from({ length: PALETTE_SIZE }, (_, i) => `#0000${i}${i}`);
    applySettings(
      { ...DEFAULT_SETTINGS, palette, colors: { ...DEFAULT_SETTINGS.colors, q: '#abcdef' } },
      root,
    );
    expect(set['--q']).toBe('#abcdef');
    expect(set['--w-grid']).toBe('1px');
    expect(removed).toContain('--grid-z');
    expect(removed).toContain('--marker');
    expect(removed).not.toContain('--q');
    expect(nextColor([])).toBe('#000000');
  });
});

describe('useSettings store', () => {
  it('setPaletteColor out of range changes nothing; in range changes one entry', () => {
    const before = useSettings.getState().settings.palette;
    useSettings.getState().setPaletteColor(99, '#000000');
    expect(useSettings.getState().settings.palette).toEqual(before);
    useSettings.getState().setPaletteColor(1, '#000000');
    expect(useSettings.getState().settings.palette[1]).toBe('#000000');
    expect(useSettings.getState().settings.palette[0]).toBe(before[0]);
  });

  it('setColor null returns a colour to the theme and reset restores everything', () => {
    useSettings.getState().setColor('sweep', '#112233');
    expect(useSettings.getState().settings.colors.sweep).toBe('#112233');
    useSettings.getState().setColor('sweep', null);
    expect(useSettings.getState().settings.colors.sweep).toBeNull();
    useSettings.getState().update({ gridWidth: 3, schematic: 'vertical' });
    useSettings.getState().reset();
    expect(useSettings.getState().settings).toEqual(DEFAULT_SETTINGS);
  });
});
