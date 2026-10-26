// @vitest-environment jsdom
/**
 * The fixes of QA round 1 on the guided workflows (docs/09) that the reviewers' tests do not
 * reach: the part-count advice of "Pick a network", the robust workflow on a design whose
 * nominal already misses the limit, the reason without Apply, and what a step closes when
 * the workflow moves on.
 */
import { complex, wilsonInterval } from '@smithonline/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCentreOutcome } from '../src/lib/centre';
import { emptyDesign, withIdentity, type Design } from '../src/lib/design';
import { useImported } from '../src/lib/importDialog';
import { readImportFile } from '../src/lib/import';
import { sampleText } from '../src/lib/samples';
import { fileShortcuts } from '../src/lib/shortcuts';
import { tourSnapshot } from '../src/lib/tourSnapshot';
import { missingText, stepText, type Workflow } from '../src/lib/workflowKit';
import { pickAdvice, robustStart, WORKFLOWS } from '../src/lib/workflows';
import { useDesignStore } from '../src/store/useDesignStore';
import { useShell } from '../src/store/useShell';
import { useTourStore, workflowSteps } from '../src/store/useTourStore';

const D = () => useDesignStore.getState();
const T = () => useTourStore.getState();
const step = (w: string, id: string) => {
  const flow = WORKFLOWS.find((x) => x.id === w) as Workflow;
  return workflowSteps(flow).find((s) => s.id === id);
};
const textOf = (w: string, id: string, d: Design): string => {
  const s = step(w, id);
  if (!s) throw new Error(`${w}/${id}`);
  return stepText(s, d, tourSnapshot({}, d));
};

beforeEach(() => {
  T().close();
  useImported.setState({ imported: null });
  useShell.setState({ settings: null, tool: null });
  D().init({ ...emptyDesign(), name: 'Mine' });
});

describe('Pick a network: the part counts from the numbers', () => {
  it('fewer parts within 5 % of the best are named; near or far from the limit otherwise', () => {
    expect(pickAdvice([], 1.2)).toBe('');
    expect(
      pickAdvice(
        [
          { count: 2, vswr: 1.62 },
          { count: 4, vswr: 1.58 },
        ],
        1.3,
      ),
    ).toMatch(/2 parts reach 1\.620, close to 1\.580 with 4/);
    expect(
      pickAdvice(
        [
          { count: 2, vswr: 2 },
          { count: 4, vswr: 1.4 },
        ],
        1.3,
      ),
    ).toMatch(/near the limit: more parts buy little/);
    expect(
      pickAdvice(
        [
          { count: 2, vswr: 2 },
          { count: 4, vswr: 1.53 },
        ],
        1.136,
      ),
    ).toMatch(/well above the limit/);
  });
});

describe('robust: a nominal that misses the limit', () => {
  /** A shunt C and series L that leave 100 - j50 at VSWR 2.5 or so, judged at VSWR 1.2. */
  function missing(): Design {
    const base = { ...robustStart(), tolerance: { ...robustStart().tolerance!, vswrLimit: 1.2 } };
    return base;
  }

  it('says so and offers a limit the design meets; the reference design (yield near 46 %) does not', () => {
    const d = missing();
    expect(textOf('robust', 'open', d)).toMatch(/nominal design itself has VSWR [\d.]+ there/);
    expect(step('robust', 'open')?.doIt?.when?.(d)).toBe(true);
    expect(textOf('robust', 'open', robustStart())).not.toMatch(/nominal design itself/);
    expect(step('robust', 'open')?.doIt?.when?.(robustStart())).toBe(false);
  });

  it('its doIt sets a limit above the nominal', () => {
    D().init(missing());
    step('robust', 'open')?.doIt?.run({} as never);
    expect(D().design.tolerance?.vswrLimit).toBeGreaterThan(1.38);
    expect(step('robust', 'open')?.doIt?.when?.(D().design)).toBe(false);
  });
});

describe('robust: the reason without Apply', () => {
  const reason = (): string => missingText(step('robust', 'apply')!);
  const estimate = (passed: number) =>
    ({ passed, runs: 1000, interval: wilsonInterval(passed, 1000) }) as never;

  it('names the case of the last centring', () => {
    useCentreOutcome.setState({ running: true, last: null });
    expect(reason()).toMatch(/still runs/);
    useCentreOutcome.setState({ running: false, last: null });
    expect(reason()).toMatch(/No centring result yet/);
    const result = (before: number, after: number, improved: boolean) =>
      ({ before: estimate(before), after: estimate(after), improved, significant: false }) as never;
    useCentreOutcome.setState({ last: { result: result(0, 0, false), limit: 2, offered: false } });
    expect(reason()).toMatch(/no board passes VSWR 2, before or after centring/);
    useCentreOutcome.setState({
      last: { result: result(460, 455, false), limit: 1.38, offered: false },
    });
    expect(reason()).toMatch(/no better centre found/);
    useCentreOutcome.setState({
      last: { result: result(460, 470, true), limit: 1.38, offered: false },
    });
    expect(reason()).toMatch(/within the noise of 1000 runs/);
    useCentreOutcome.setState({ last: null });
  });
});

describe('a step closes what it opened when the workflow moves on', () => {
  it('the File menu, Settings and the import dialog', () => {
    const closeMenus = vi.fn();
    fileShortcuts.current = {
      save: () => undefined,
      open: () => undefined,
      exportMenu: () => undefined,
      closeMenus,
    };
    D().init({
      ...emptyDesign(),
      load: complex(30, 10),
      elements: [withIdentity({ kind: 'C', orientation: 'shunt', value: 2e-12 }, [])],
    });
    T().startWorkflow('buildable', { keep: true, at: 'stackup' });
    useShell.getState().openSettings('new-designs');
    T().next();
    expect(useShell.getState().settings).toBeNull();
    T().startWorkflow('buildable', { keep: true, at: 'bom' });
    T().next();
    expect(closeMenus).not.toHaveBeenCalled(); // the report is on the File menu too
    T().next();
    expect(closeMenus).toHaveBeenCalledTimes(1);
    T().startWorkflow('amplifier', { keep: true });
    useImported.setState({
      imported: {
        file: readImportFile('amp-synthetic.s2p', sampleText('amplifier')),
        id: 1,
      },
    });
    T().next();
    expect(useImported.getState().imported).toBeNull();
    fileShortcuts.current = null;
  });
});
