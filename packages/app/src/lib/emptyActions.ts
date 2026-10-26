/**
 * Actions of the empty states (docs/07-interaction-redesign.md section 4)
 * that change the design: each is one named step, so Undo says what it undid.
 */
import { useDesignStore } from '../store/useDesignStore';
import { fmtFrequency } from './format';

/** The label of the empty states' sweep action. */
export const HALF_TO_DOUBLE_LABEL = 'Sweep 0.5 f to 2 f';

/**
 * Set the sweep range to half to twice the design frequency, the range the
 * Touchstone export uses without a sweep. One step, named for Undo.
 */
export function applyHalfToDoubleSweep(): void {
  const { design, setSweep } = useDesignStore.getState();
  const f = design.frequency;
  if (!(f > 0) || !Number.isFinite(f)) return;
  setSweep(
    { start: f / 2, stop: f * 2 },
    `Sweep range set to ${fmtFrequency(f / 2)} to ${fmtFrequency(f * 2)}`,
  );
}
