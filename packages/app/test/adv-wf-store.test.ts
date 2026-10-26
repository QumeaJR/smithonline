// @vitest-environment jsdom
/**
 * Adversarial: the workflow state machine in the stores (no DOM).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { complex } from '@smithonline/core';
import { emptyDesign, withIdentity, type Design } from '../src/lib/design';
import { useDesignStore } from '../src/store/useDesignStore';
import {
  useTourStore,
  ADVANCE_DELAY_MS,
  workflowSteps,
  isWorkflow,
} from '../src/store/useTourStore';
import { emitTourEvent } from '../src/lib/tourEvents';
import { useShell } from '../src/store/useShell';
import { parseTarget } from '../src/lib/helpActions';
import { anchorSelector } from '../src/lib/tourAnchor';
import { readCompleted, markCompleted, WORKFLOWS_KEY } from '../src/lib/workflowKit';

const D = () => useDesignStore.getState();
const T = () => useTourStore.getState();

function userDesign(): Design {
  const base = emptyDesign();
  const els: Design['elements'][number][] = [];
  els.push(withIdentity({ kind: 'L', orientation: 'shunt', value: 10e-9 } as never, els));
  els.push(withIdentity({ kind: 'C', orientation: 'series', value: 2e-12 } as never, els));
  return { ...base, name: 'Mine', load: complex(30, 20), elements: els };
}

beforeEach(() => {
  vi.useFakeTimers();
  T().close();
  D().init(userDesign());
  D().setView('chart');
  useShell.setState({ tool: null, matchMode: null, settings: null, pane: 'network' });
});
afterEach(() => {
  T().close();
  vi.useRealTimers();
});

describe('advance timer races', () => {
  it('predicate timer does not fire after Back', () => {
    T().startWorkflow('robust');
    const i = workflowSteps(T().tour as never).findIndex((s) => s.id === 'run');
    useTourStore.setState({ step: i });
    T().next(); // to yield
    T().back(); // to run, through enter
    expect(T().step).toBe(i);
    emitTourEvent('tolerance-result');
    T().back();
    vi.advanceTimersByTime(ADVANCE_DELAY_MS * 3);
    expect(T().step).toBe(i - 1);
  });

  it('predicate timer does not fire after Escape and a restart of the same workflow at the same step', () => {
    T().startWorkflow('robust', { at: 'run' });
    const i = T().step;
    emitTourEvent('tolerance-result');
    T().end();
    T().startWorkflow('robust', { keep: true, at: 'run' });
    vi.advanceTimersByTime(ADVANCE_DELAY_MS * 3);
    expect(T().step).toBe(i);
  });

  it('timer does not move a lesson started while it was pending', () => {
    T().startWorkflow('robust', { at: 'run' });
    emitTourEvent('tolerance-result');
    T().start('l-network');
    vi.advanceTimersByTime(ADVANCE_DELAY_MS * 3);
    expect(isWorkflow(T().tour)).toBe(false);
    expect(T().step).toBe(0);
  });
});

describe('undo across the start', () => {
  it('keep with a null start: Undo past the start design ends it (useTourStore docstring)', () => {
    const before = D().design;
    D().setName('Edited before');
    const origin = D().design;
    T().startWorkflow('buildable', { keep: true });
    expect(T().tour).not.toBeNull();
    D().setName('Edit inside');
    D().undo(); // back at origin
    D().undo(); // past it
    expect(D().design).toBe(before);
    expect(origin).not.toBe(before);
    // the workflow is still running on a design from before it
    expect(T().tour, 'workflow still running after Undo past its start').toBeNull();
  });

  it('a long workflow (over 100 steps) still undoes in one step', () => {
    const origin = D().design;
    T().startWorkflow('buildable', { keep: true });
    for (let k = 0; k < 120; k++) D().setName(`n${k}`);
    T().end();
    D().undo();
    expect(D().design, 'one Undo after a long workflow').toBe(origin);
  });
});

describe('inputs', () => {
  it('parseTarget rejects junk and hidden ids', () => {
    for (const h of [
      'workflow:',
      'workflow:measure-retune',
      'workflow:rft',
      'workflow:__proto__',
      'workflow:constructor',
      'workflow:robust?view=chart',
      'workflow:robust?x=1',
      'workflow:robust#a',
      'workflow:../robust',
      'workflow:robust ',
    ]) {
      const t = parseTarget(h);
      if (h === 'workflow:robust ') expect(t).toEqual({ kind: 'workflow', id: 'robust' });
      else expect(t, h).toBeNull();
    }
    expect(parseTarget('WORKFLOW:robust')).toEqual({ kind: 'workflow', id: 'robust' });
    expect(parseTarget('workflow:Robust')).toBeNull();
  });

  it('anchorSelector strips quotes and backslashes', () => {
    for (const id of ['a"b', 'a\b', 'a"]{x}', 'a"],*{display:none}[x="']) {
      const sel = anchorSelector(id);
      const inner = sel.slice('[data-tour~="'.length, -2);
      expect(
        inner.includes(String.fromCharCode(34)) || inner.includes(String.fromCharCode(92)),
        `anchor ${id} -> ${sel}`,
      ).toBe(false);
    }
  });

  it('corrupted completion storage', () => {
    for (const raw of [
      '{',
      'null',
      '"x"',
      '[]',
      '{"done":"robust"}',
      '{"done":{"0":"x","length":1}}',
      '{"done":[1,null,"robust"]}',
      '{"__proto__":{"done":["x"]}}',
    ]) {
      localStorage.setItem(WORKFLOWS_KEY, raw);
      expect(() => readCompleted()).not.toThrow();
      expect(() => markCompleted('robust')).not.toThrow();
      expect(readCompleted().has('robust')).toBe(true);
    }
  });

  it('startWorkflow at an unknown or hidden step', () => {
    T().startWorkflow('verify', { at: 'measure' });
    expect(T().step).toBe(0);
    T().startWorkflow('nope');
    expect(T().tour?.id).toBe('verify');
    T().startWorkflow('measure-retune');
    expect(T().tour?.id).toBe('verify');
  });
});

describe('chained workflow and Undo', () => {
  it('after chaining robust -> buildable, one Undo ends the chained workflow', () => {
    D().init({ ...emptyDesign(), name: 'Mine' });
    const mine = D().design;
    T().startWorkflow('robust');
    useTourStore.setState({ step: workflowSteps(T().tour as never).length - 1 });
    T().finish(true);
    expect(T().tour?.id).toBe('buildable');
    D().undo();
    expect(D().design).toBe(mine);
    const stillRunning = T().tour?.id ?? null;
    // its next step's prepare then edits the pre-workflow design
    if (stillRunning) T().next();
    expect(
      D().design.realize.enabled,
      'Next turned Realize on in the design from before both workflows',
    ).toBe(false);
    expect(
      stillRunning,
      'buildable still narrates "Turn Realize on" over the empty design',
    ).toBeNull();
  });
});

describe('predicates fooled by Undo', () => {
  it('robust "Apply the centre" does not count an Undo as Apply', () => {
    T().startWorkflow('robust');
    // the user tweaks a value on the way
    D().update((d) => ({
      ...d,
      elements: d.elements.map((e, i) => (i === 0 ? ({ ...e, value: 12e-9 } as typeof e) : e)),
    }));
    const steps = workflowSteps(T().tour as never);
    const apply = steps.findIndex((s) => s.id === 'apply');
    while (T().step < apply) T().next();
    expect(steps[T().step]?.id).toBe('apply');
    D().undo(); // takes the tweak back; nothing was applied
    vi.advanceTimersByTime(ADVANCE_DELAY_MS + 50);
    expect(steps[T().step]?.id, 'Undo advanced past Apply').toBe('apply');
  });
});
