import type { DatapointColumn } from '../store/useDesignStore';

/** The columns a phone can add to its datapoint table, in table order. */
export const EXTRA_COLUMNS: readonly {
  readonly id: DatapointColumn;
  readonly label: string;
  readonly title: string;
}[] = [
  { id: 'gammaMag', label: '|Γ|', title: 'Magnitude of the reflection coefficient' },
  { id: 'gammaAngle', label: '∠Γ', title: 'Angle of the reflection coefficient' },
  { id: 'q', label: 'Q', title: 'Node Q, |X| / R' },
];

/**
 * The columns of the datapoint table: all of them on a tablet or wider; on a
 * phone #, Z, VSWR and RL plus the ones chosen with the column chooser.
 */
export function datapointColumnsShown(
  phone: boolean,
  chosen: readonly DatapointColumn[],
): ReadonlySet<DatapointColumn> {
  return new Set(phone ? chosen : EXTRA_COLUMNS.map((c) => c.id));
}
