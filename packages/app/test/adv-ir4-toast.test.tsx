// @vitest-environment jsdom
/** Adversarial: the coarse-pointer toast with repeated messages. */
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TOAST_MS, Toast } from '../src/components/ui/Toast';
import { emptyDesign } from '../src/lib/design';
import { useDesignStore } from '../src/store/useDesignStore';

beforeEach(() => {
  useDesignStore.getState().init(emptyDesign());
  useDesignStore.getState().setMessage(null);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('Toast', () => {
  it('the same message a second time (export twice) shows again after the first one timed out', () => {
    vi.useFakeTimers();
    render(<Toast />);
    act(() => useDesignStore.getState().setMessage('Exported Design.s2p'));
    expect(screen.queryByText('Exported Design.s2p')).not.toBeNull();
    act(() => vi.advanceTimersByTime(TOAST_MS + 10));
    expect(screen.queryByText('Exported Design.s2p')).toBeNull();
    act(() => useDesignStore.getState().setMessage('Exported Design.s2p'));
    expect(screen.queryByText('Exported Design.s2p')).not.toBeNull();
  });
});
