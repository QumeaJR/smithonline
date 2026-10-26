/**
 * QA round 1 on docs/09 section 3.0 (the workflow engine), without a page:
 * Back after a predicate advance, chaining into a workflow whose start design
 * differs, completion storage that throws or holds junk, the `requires`
 * gate, `workflow:` links, Show me starts on the user's own design, and the
 * anchor selector. Expected values come from the spec and the start designs
 * written in lib/workflows.ts, never from running the code.
 */
import { complex } from '@smithonline/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const memory = new Map<string, string>();
const storage = {
  getItem: (k: string): string | null => memory.get(k) ?? null,
  setItem: (k: string, v: string): void => void memory.set(k, v),
  removeItem: (k: string): void => void memory.delete(k),
  clear: (): void => memory.clear(),
};
vi.stubGlobal('localStorage', storage);

const { emptyDesign } = await import('../src/lib/design');
const { useDesignStore } = await import('../src/store/useDesignStore');
const { useTourStore, workflowSteps, ADVANCE_DELAY_MS } = await import('../src/store/useTourStore');
const { emitTourEvent } = await import('../src/lib/tourEvents');
const { readCompleted, markCompleted, WORKFLOWS_KEY, anchorSelectorOf } = await (async () => {
  const kit = await import('../src/lib/workflowKit');
  const anchor = await import('../src/lib/tourAnchor');
  return { ...kit, anchorSelectorOf: anchor.anchorSelector };
})();
const { WORKFLOWS } = await import('../src/lib/workflows');
const { parseTarget } = await import('../src/lib/helpActions');
const { showMeTarget } = await import('../src/lib/showMe');
const { tourUi } = await import('../src/lib/tourUi');
const { useImported } = await import('../src/lib/importDialog');

const D = () => useDesignStore.getState();
const T = () => useTourStore.getState();
const stepId = (): string | undefined => {
  const t = T().tour;
  return t && t.kind === 'workflow' ? workflowSteps(t)[T().step]?.id : undefined;
};
const later = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** A measured load: 11 rows of a series RLC, 0.9 to 1.1 GHz, as Use all rows leaves the design. */
function measuredDesign() {
  const rows = Array.from({ length: 11 }, (_, i) => {
    const f = 0.9e9 + i * 0.02e9;
    const w = 2 * Math.PI * f;
    return { frequency: f, z: complex(20, w * 10e-9 - 1 / (w * 2.5e-12)) };
  });
  const base = emptyDesign({ frequency: 1e9 });
  return {
    ...base,
    name: 'My antenna',
    load: rows[5]?.z ?? complex(20, 0),
    sweep: {
      ...base.sweep,
      enabled: true,
      start: 0.9e9,
      stop: 1.1e9,
      loads: rows,
      loadsName: 'mine.s1p',
      mode: 'datapoints' as const,
    },
    elements: [
      { id: 'a', color: '#000', kind: 'L' as const, orientation: 'series' as const, value: 5e-9 },
      { id: 'b', color: '#000', kind: 'C' as const, orientation: 'shunt' as const, value: 1e-12 },
    ],
  };
}

beforeEach(() => {
  memory.clear();
  useImported.setState({ imported: null });
  T().close();
  useTourStore.setState({ completed: new Set() });
  D().init({ ...emptyDesign(), name: 'Mine' }, { fresh: true });
});
afterEach(() => {
  T().close();
  vi.restoreAllMocks();
});

describe('Back after a predicate advance', () => {
  it('a design predicate: Back shows the step again and does not bounce forward', async () => {
    T().startWorkflow('buildable');
    expect(stepId()).toBe('realize');
    D().setRealize({ enabled: true });
    await later(ADVANCE_DELAY_MS + 80);
    expect(stepId()).toBe('series');
    T().back();
    expect(stepId()).toBe('realize');
    // Realize is still on: the predicate held when the step came back, so it waits for Next.
    await later(ADVANCE_DELAY_MS + 80);
    expect(stepId()).toBe('realize');
    // Off and on again: a change to true advances once more.
    D().setRealize({ enabled: false });
    D().setRealize({ enabled: true });
    await later(ADVANCE_DELAY_MS + 80);
    expect(stepId()).toBe('series');
  });

  it('an event predicate counts from the moment the step came back, not from the first visit', async () => {
    T().startWorkflow('robust');
    T().next();
    T().next();
    expect(stepId()).toBe('run');
    emitTourEvent('tolerance-result');
    await later(ADVANCE_DELAY_MS + 80);
    expect(stepId()).toBe('yield');
    T().back();
    expect(stepId()).toBe('run');
    await later(ADVANCE_DELAY_MS + 80);
    expect(stepId()).toBe('run');
    emitTourEvent('tolerance-result');
    await later(ADVANCE_DELAY_MS + 80);
    expect(stepId()).toBe('yield');
  });

  it('Back during the 400 ms delay cancels the pending advance', async () => {
    T().startWorkflow('buildable');
    T().next();
    T().next();
    T().next();
    expect(stepId()).toBe('package');
    // Packages for every L and C: the predicate turns true.
    D().setPackage(0, '0402');
    D().setPackage(1, '0402');
    T().back();
    expect(stepId()).toBe('build-open');
    await later(ADVANCE_DELAY_MS + 80);
    expect(stepId()).toBe('build-open');
  });

  it('Back on the first step does nothing', () => {
    T().startWorkflow('robust');
    T().back();
    expect(T().step).toBe(0);
    expect(T().tour?.id).toBe('robust');
  });
});

describe('chaining', () => {
  it('into a workflow whose start design differs: the next start loads, Undo walks back one workflow at a time', () => {
    const mine = D().design;
    T().startWorkflow('amplifier');
    const amp = D().design;
    expect(amp.name).toBe('Workflow: amplifier');
    expect(amp.twoPort).toBeNull();
    const w = T().tour;
    if (!w || w.kind !== 'workflow') throw new Error('no workflow');
    useTourStore.setState({ step: workflowSteps(w).length - 1 });
    T().finish(true);
    // 3.6 starts on a real 25 ohm load at 1 GHz, swept 0.5 to 1.5 GHz.
    expect(T().tour?.id).toBe('broadband-limits');
    expect(stepId()).toBe('transformer');
    expect(D().design.load).toEqual(complex(25, 0));
    expect(D().design.frequency).toBe(1e9);
    expect(D().design.sweep).toMatchObject({ enabled: true, start: 0.5e9, stop: 1.5e9 });
    expect(readCompleted().has('amplifier')).toBe(true);
    // One Undo: back to the amplifier design, and the chained workflow ends with it.
    D().undo();
    expect(T().tour).toBeNull();
    expect(D().design.name).toBe('Workflow: amplifier');
    // One more: the design from before the first workflow.
    D().undo();
    expect(D().design).toBe(mine);
  });

  it('a workflow left without parts chains into the reference design of the next', () => {
    T().startWorkflow('measured-antenna');
    const w = T().tour;
    if (!w || w.kind !== 'workflow') throw new Error('no workflow');
    useTourStore.setState({ step: workflowSteps(w).length - 1 });
    T().finish(true);
    expect(T().tour?.id).toBe('robust');
    // 3.2 start: 100 - j50 at 1 GHz, shunt 11 nH + series 2.7 pF, E24.
    expect(D().design.load).toEqual(complex(100, -50));
    expect(D().design.elements.map((e) => ('value' in e ? e.value : 0))).toEqual([11e-9, 2.7e-12]);
    expect(D().design.realize).toMatchObject({ enabled: true, series: 'E24' });
  });

  it('the last shipped workflow of a chain has no Next: chaining from it ends quietly', () => {
    T().startWorkflow('measure-retune');
    const w = T().tour;
    if (!w || w.kind !== 'workflow') throw new Error('no workflow');
    useTourStore.setState({ step: workflowSteps(w).length - 1 });
    T().finish(true);
    expect(T().tour).toBeNull();
    expect(readCompleted().has('measure-retune')).toBe(true);
  });
});

describe('completion storage', () => {
  it('holds junk: every shape that is not {done: string[]} reads as nothing completed', () => {
    for (const raw of [
      'null',
      '"robust"',
      '42',
      '[]',
      '["robust"]',
      '{"done":"robust"}',
      '{"done":{"0":"robust"}}',
      '{}',
      '',
    ]) {
      memory.set(WORKFLOWS_KEY, raw);
      expect([...readCompleted()], raw).toEqual([]);
    }
    memory.set(WORKFLOWS_KEY, '{"done":["robust","robust",7,"verify"]}');
    expect([...readCompleted()].sort()).toEqual(['robust', 'verify']);
  });

  it('junk is replaced by a clean record when a workflow completes', () => {
    memory.set(WORKFLOWS_KEY, '{"done":"robust"}');
    markCompleted('verify');
    expect(JSON.parse(memory.get(WORKFLOWS_KEY) ?? '')).toEqual({ done: ['verify'] });
  });

  it('a storage that throws on read: nothing completed, and the store still starts', () => {
    vi.spyOn(storage, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    expect(readCompleted().size).toBe(0);
    expect(() => markCompleted('robust')).not.toThrow();
  });

  it('a storage that throws on write: finishing still ends and chains, and the check lasts for this page', () => {
    vi.spyOn(storage, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    T().startWorkflow('robust');
    const w = T().tour;
    if (!w || w.kind !== 'workflow') throw new Error('no workflow');
    useTourStore.setState({ step: workflowSteps(w).length - 1 });
    expect(() => T().finish(true)).not.toThrow();
    expect(T().tour?.id).toBe('buildable');
    // workflowKit.markCompleted: "Private mode or quota: the check mark lasts for this page only."
    expect(T().completed.has('robust')).toBe(true);
  });
});

describe('requires: D7 stays hidden', () => {
  it('a hidden workflow does not start, from the store or a guide link', () => {
    T().startWorkflow('real-frequency');
    expect(T().tour).toBeNull();
    expect(parseTarget('workflow:measure-retune')).toEqual({
      kind: 'workflow',
      id: 'measure-retune',
    });
    expect(parseTarget('workflow:real-frequency')).toBeNull();
  });

  it('workflow: links parse for every shipped workflow, not for unknown ids or a query', () => {
    for (const w of WORKFLOWS.filter((x) => x.requires === undefined || x.requires === 'd5')) {
      expect(parseTarget(`workflow:${w.id}`)).toEqual({ kind: 'workflow', id: w.id });
    }
    expect(parseTarget('WORKFLOW:robust')).toEqual({ kind: 'workflow', id: 'robust' });
    expect(parseTarget('workflow:nope')).toBeNull();
    expect(parseTarget('workflow:robust?view=chart')).toBeNull();
    expect(parseTarget('workflow:')).toBeNull();
  });

  it('a step that requires D7 (broadband limits) is not counted; the D6 step of verify is', () => {
    const verify = WORKFLOWS.find((w) => w.id === 'verify');
    const limits = WORKFLOWS.find((w) => w.id === 'broadband-limits');
    // 3.4 has six steps in the spec plus the closing one; the D6 step is in since D6 shipped.
    expect(verify && workflowSteps(verify).map((s) => s.id)).toEqual([
      's2p',
      'spice',
      'splot',
      'compare',
      'freeze',
      'measure',
      'done',
    ]);
    expect(limits && workflowSteps(limits).map((s) => s.id)).toEqual([
      'transformer',
      'sections',
      'broadband',
      'line',
      'optimize',
    ]);
  });
});

describe('start at a step', () => {
  it('an unknown step id starts at the first step', () => {
    T().startWorkflow('robust', { at: 'no-such-step' });
    expect(T().step).toBe(0);
  });

  it('a known step id starts there', () => {
    T().startWorkflow('robust', { at: 'centre' });
    expect(stepId()).toBe('centre');
  });
});

describe('Show me and next-step chips keep the user design where the workflow can work on it', () => {
  it('Optimize band, Show me on a matched measured load keeps the design (docs/09 section 2, Tools)', () => {
    const mine = measuredDesign();
    D().init(mine, { fresh: false });
    D().setFrequency(1e9); // an edit, so the design is the user's own work
    const before = D().design;
    const target = showMeTarget('optimize', null, before);
    T().startWorkflow(target.workflow, { keep: true, ...(target.at ? { at: target.at } : {}) });
    expect(stepId()).toBe('optimize');
    // Optimize band refines the values you have: the network and its measured load stay.
    expect(D().design.elements).toBe(before.elements);
    expect(D().design.sweep.loads).toBe(before.sweep.loads);
  });
});

describe('anchor selector', () => {
  it('a quote or a bracket in an id never makes an invalid selector', () => {
    for (const id of ['a"b', 'a]b', 'a\\b']) {
      const sel = anchorSelectorOf(id);
      // A valid attribute selector: one [ ... ] with a quoted value and no stray quote inside.
      expect(sel, id).toMatch(/^\[data-tour~="[^"\\\]]*"\]$/);
    }
  });
});

describe('a doIt does the step it sits on', () => {
  const runDoIt = (): void => {
    const t = T().tour;
    if (!t || t.kind !== 'workflow') throw new Error('no workflow');
    workflowSteps(t)[T().step]?.doIt?.run(tourUi);
  };

  it('amplifier/stability-circles: "Draw them" after the sample amplifier moves the step on', async () => {
    T().startWorkflow('amplifier');
    runDoIt(); // Use the sample amplifier: the device comes from the file
    await later(ADVANCE_DELAY_MS + 80);
    expect(stepId()).toBe('stability');
    T().next();
    expect(stepId()).toBe('stability-circles');
    runDoIt(); // Draw them
    await later(ADVANCE_DELAY_MS + 80);
    // docs/09 3.5 row 3: advances when the stability circles are drawn.
    expect(stepId()).toBe('noise');
  });

  it('measured-antenna/use-rows: the doIt with the import dialog open uses the rows', async () => {
    T().startWorkflow('measured-antenna');
    runDoIt(); // Open the sample antenna: the import dialog opens
    await later(ADVANCE_DELAY_MS + 80);
    expect(stepId()).toBe('use-rows');
    runDoIt(); // the step's own "Do it for me"
    await later(ADVANCE_DELAY_MS + 80);
    expect(stepId()).toBe('model');
  });
});
