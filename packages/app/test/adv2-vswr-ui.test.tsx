// @vitest-environment jsdom
/**
 * Adversarial QA round 2 (0.6.0): one VSWR limit per design, edited in two places.
 */
import { complex, lMatch } from '@smithonline/core';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MonteCarloPanel } from '../src/components/MonteCarloPanel';
import { BandwidthReadout } from '../src/components/BandwidthReadout';
import { emptyDesign, identify, type Design } from '../src/lib/design';
import { ladderOf } from '../src/lib/files';
import { designVswrLimit, toleranceSettings } from '../src/lib/tolerance';
import { useDesignStore } from '../src/store/useDesignStore';
import { useMonteCarlo } from '../src/store/useMonteCarlo';
import { decodeDesign, encodeDesign } from '../src/lib/share';
import { DEFAULT_SETTINGS, parseSettings } from '../src/lib/settings';

const LOAD = complex(100, -50);
const els = lMatch(LOAD, complex(50, 0), 1e9)[0]!.elements;
const design = (): Design => ({ ...emptyDesign(), load: LOAD, elements: identify(els) });

beforeEach(() => useDesignStore.setState({ design: design(), past: [], future: [] }));
afterEach(() => {
  cleanup();
  useMonteCarlo.getState().clear();
  vi.unstubAllGlobals();
});

describe('the VSWR limit 1', () => {
  // One rule (QA round 2): a limit must be above 1 in Tolerance, the readout, Settings and every
  // reader; a stored 1 opens as the default 2.
  const typeOne = (): void => {
    const box = screen.getByLabelText('VSWR limit') as HTMLInputElement;
    fireEvent.change(box, { target: { value: '1' } });
    fireEvent.keyDown(box, { key: 'Enter' });
  };
  it('Tolerance and the usable bandwidth both refuse 1; a link, a file and Settings read it as 2', () => {
    render(<MonteCarloPanel />);
    typeOne();
    expect(designVswrLimit(useDesignStore.getState().design)).toBe(2);
    cleanup();
    const d = useDesignStore.getState().design;
    render(<BandwidthReadout ladder={ladderOf(d)} />);
    typeOne();
    expect(designVswrLimit(useDesignStore.getState().design)).toBe(2);
    const one = { ...d, tolerance: { ...toleranceSettings(d), vswrLimit: 1 } };
    const linked = decodeDesign(encodeDesign(one));
    const settings = parseSettings({ ...DEFAULT_SETTINGS, defaultVswrLimit: 1 });
    expect({
      link: linked ? designVswrLimit(linked) : null,
      settingsDefault: settings.defaultVswrLimit,
    }).toEqual({ link: 2, settingsDefault: 2 });
    expect(useDesignStore.getState().setVswrLimit(1)).toBeUndefined();
    expect(designVswrLimit(useDesignStore.getState().design)).toBe(2);
  });
});

describe('a huge VSWR limit typed in Tolerance', () => {
  for (const v of ['1e308', '1e300', '1e6']) {
    it(`${v}: no NaN or Infinity in the readout, Tolerance and the tours' bandwidth text`, async () => {
      render(<MonteCarloPanel />);
      const box = screen.getByLabelText('VSWR limit') as HTMLInputElement;
      fireEvent.change(box, { target: { value: v } });
      fireEvent.keyDown(box, { key: 'Enter' });
      const d = useDesignStore.getState().design;
      const panel = document.body.textContent ?? '';
      cleanup();
      render(<BandwidthReadout ladder={{ ...ladderOf(d), elements: d.elements }} />);
      const readout = document.body.textContent ?? '';
      const { bandwidthText } = await import('../src/lib/tourKit');
      const tour = String(bandwidthText(d));
      const { quarterWaveBandwidth } = await import('../src/lib/toursAdvanced');
      const qw = quarterWaveBandwidth(50, 100, designVswrLimit(d));
      expect({
        limit: designVswrLimit(d),
        bad: [panel, readout, tour].filter((t) => /NaN|Infinity/.test(t)),
        qw: qw === null || Number.isFinite(qw),
      }).toEqual({
        limit: Number(v),
        bad: [],
        qw: true,
      });
    });
  }
});
