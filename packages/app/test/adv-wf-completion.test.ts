// @vitest-environment jsdom
/**
 * Adversarial: completion when storage refuses to write.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useTourStore, workflowSteps } from '../src/store/useTourStore';
import { WORKFLOWS_KEY } from '../src/lib/workflowKit';

afterEach(() => vi.restoreAllMocks());

describe('completion without storage', () => {
  it('Done in private mode keeps the check for this page (markCompleted comment)', () => {
    localStorage.removeItem(WORKFLOWS_KEY);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
    const T = () => useTourStore.getState();
    T().startWorkflow('broadband-limits');
    useTourStore.setState({ step: workflowSteps(T().tour as never).length - 1 });
    expect(() => T().finish(false)).not.toThrow();
    expect(T().tour).toBeNull();
    expect(T().completed.has('broadband-limits'), 'no check mark at all').toBe(true);
  });
});
