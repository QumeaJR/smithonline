import type { Complex } from '@smithonline/core';
import { create } from 'zustand';

/**
 * The pointer over the Smith chart (its reflection coefficient), null when it is off the chart.
 * A store of its own, so a move re-renders only what reads it: App follows it only while a
 * mode needs it (an armed part, a finger, a drag), the status bar's readout reads it itself.
 */
export const useHover = create<{ readonly gamma: Complex | null }>(() => ({ gamma: null }));

export const setHover = (gamma: Complex | null): void => useHover.setState({ gamma });
