import { useDesignStore } from '../store/useDesignStore';
import { useShell } from '../store/useShell';
import { useTourStore } from '../store/useTourStore';

/**
 * The start guide is on show: a new design (or Help brought it back), never closed, no tour.
 * The empty ladder leaves its own empty state out while the guide says the same.
 */
export function useStartGuideVisible(): boolean {
  const fresh = useDesignStore((s) => s.fresh);
  const closed = useShell((s) => s.guideClosed);
  const shown = useShell((s) => s.guideShown);
  const touring = useTourStore((s) => s.tour !== null);
  return !closed && !touring && (fresh || shown);
}
