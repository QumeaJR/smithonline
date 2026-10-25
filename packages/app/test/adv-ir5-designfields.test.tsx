// @vitest-environment jsdom
/**
 * Adversarial: the design strip's frequency commit glues the Scale sweep
 * offer to whatever message was on show before, however old.
 */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { DesignFields } from '../src/components/DesignFields';
import { emptyDesign } from '../src/lib/design';
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
});
afterEach(cleanup);

describe('frequency commit with a sweep on', () => {
  it('a stale message is not glued in front of the Scale sweep offer', async () => {
    const d = emptyDesign();
    useDesignStore.getState().init({ ...d, sweep: { ...d.sweep, enabled: true } });
    useDesignStore.getState().setMessage('New design. Undo brings the previous one back.');
    const user = userEvent.setup();
    render(<DesignFields />);
    const f = screen.getByRole('textbox', { name: 'Design frequency' });
    await user.clear(f);
    await user.type(f, '2 GHz{Enter}');
    const msg = useDesignStore.getState().message ?? '';
    expect(msg).toMatch(/^f is now 2 GHz/);
    expect(msg).not.toContain('..');
  });
});
