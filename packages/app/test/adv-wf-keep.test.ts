// @vitest-environment jsdom
/**
 * Adversarial: Show me and next-step chips start workflows with keep; the user's design must stay.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { complex } from '@smithonline/core';
import { emptyDesign, withIdentity, type Design } from '../src/lib/design';
import { useDesignStore } from '../src/store/useDesignStore';
import { useTourStore } from '../src/store/useTourStore';
import { showMeTarget } from '../src/lib/showMe';
import { openSample } from '../src/lib/samples';
import { useSPlotStore } from '../src/store/useSPlotStore';
import { useImported } from '../src/lib/importDialog';

const D = () => useDesignStore.getState();
const T = () => useTourStore.getState();

function userDesign(): Design {
  const base = emptyDesign();
  const els: Design['elements'][number][] = [];
  els.push(withIdentity({ kind: 'L', orientation: 'shunt', value: 10e-9 } as never, els));
  els.push(withIdentity({ kind: 'C', orientation: 'series', value: 2e-12 } as never, els));
  return {
    ...base,
    name: 'Mine',
    load: complex(30, 20),
    elements: els,
    sweep: { ...base.sweep, enabled: true, start: 0.5e9, stop: 1.5e9 },
  };
}

beforeEach(() => {
  T().close();
  D().init(userDesign());
});

describe('Show me keeps the design the tool works on', () => {
  it('Optimize head Show me (and the optimize-band chip) keeps the network', () => {
    const t = showMeTarget('optimize', null, D().design);
    T().startWorkflow(t.workflow, { keep: true, ...(t.at ? { at: t.at } : {}) });
    const d = D().design;
    expect(T().tour?.id).toBe('broadband-limits');
    expect(d.name, 'design replaced by the workflow start').toBe('Mine');
    expect(d.elements.length, 'Optimize step on a design without parts').toBe(2);
  });

  it('Auto match Transformer Show me keeps the design', () => {
    const t = showMeTarget('match', 'transformer', D().design);
    T().startWorkflow(t.workflow, { keep: true, ...(t.at ? { at: t.at } : {}) });
    expect(D().design.name).toBe('Mine');
  });
});

describe('doIt twice quickly', () => {
  it('Open the sample antenna twice adds one S-Plot entry', () => {
    const before = useSPlotStore.getState().files.length;
    openSample('antenna');
    openSample('antenna');
    expect(useImported.getState().imported).not.toBeNull();
    expect(useSPlotStore.getState().files.length - before).toBe(1);
  });
  it('Use the sample amplifier twice records one design step', () => {
    const past = D().past.length;
    openSample('amplifier');
    openSample('amplifier');
    expect(D().past.length - past).toBe(1);
    expect(Object.keys(D().twoPortFiles).length).toBe(1);
  });
});
