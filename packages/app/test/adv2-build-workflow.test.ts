// @vitest-environment jsdom
/**
 * Adversarial QA round 2 (0.6.0): Build edits inside a guided workflow, Use as default, and the
 * Undo back past the workflow to a design that carries no build (the Example 5 demo, a lesson,
 * an .xmlsc file).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { designFromXmlsc } from '../src/lib/design';
import { designBuild } from '../src/lib/designBuild';
import { EXAMPLES } from '../src/lib/examples';
import { WORKFLOWS } from '../src/lib/workflows';

import { tourUi } from '../src/lib/tourUi';
import { useBoard } from '../src/store/useBoard';
import { usePackages } from '../src/store/usePackages';
import { useDesignStore } from '../src/store/useDesignStore';
import { useTourStore, workflowSteps } from '../src/store/useTourStore';

const D = () => useDesignStore.getState();
const T = () => useTourStore.getState();

beforeEach(() => {
  localStorage.clear();
  T().close();
  useBoard.getState().reset();
  usePackages.getState().reset();
});

describe('Make it buildable from the Example 5 demo, Use as default, then Undo', () => {
  it('Example 5 comes back as it was: board off, built-in packages', () => {
    const ex = EXAMPLES.find((e) => e.file === 'Example5.xmlsc')!;
    // The first start without an autosave (main.tsx): the demo, without a build.
    D().init(designFromXmlsc(ex.xml, ex.title), { fresh: false });
    const before = designBuild(D().design);
    expect(before.board.enabled).toBe(false);
    T().startWorkflow('buildable');
    const w = WORKFLOWS.find((x) => x.id === 'buildable')!;
    const steps = workflowSteps(w);
    // The user presses Do it on each step that has one.
    for (const id of ['realize', 'package', 'board', 'default']) {
      steps.find((s) => s.id === id)?.doIt?.run(tourUi);
    }
    expect(designBuild(D().design).board.enabled).toBe(true);
    T().end();
    D().undo();
    expect(D().design.name).toBe(ex.title);
    expect(
      designBuild(D().design).board.enabled,
      'Undo brought Example 5 back with the board on: it follows the default the workflow just set',
    ).toBe(false);
  });
});
