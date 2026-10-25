import type { MatchSolution } from '@smithonline/core';
import { createContext } from 'react';

/**
 * The match solution the chart previews now, for the solution lists inside a
 * tool panel: a preview that ends elsewhere (an armed part, Escape) clears
 * the row a tap selected together with the ghost. Undefined outside a
 * provider, where a list keeps its own selection.
 */
export const PreviewedContext = createContext<MatchSolution | null | undefined>(undefined);
