import type { PaletteEntry } from '../lib/elements';
import { Button } from './ui/Button';

export interface ModeBannerProps {
  /** The palette part armed for placement, if any. */
  readonly armed: PaletteEntry | null;
  /** Datapoint input mode: a tap on the chart adds the next datapoint. */
  readonly datapointInput: boolean;
  /** The number of the datapoint the next tap adds. */
  readonly nextDatapoint: number;
  /** A touch screen says tap, a mouse says click. */
  readonly coarse: boolean;
  /** Add the armed part at its default value. */
  readonly onDefault: () => void;
  readonly onCancel: () => void;
  /** End datapoint input. */
  readonly onDone: () => void;
}

/**
 * A mode as a banner, since it is a state and not an event (docs/07 section 4,
 * Banners): an armed part ("Series L armed: tap, or press and drag, to place
 * it" with Default and Cancel) and datapoint input ("Tap the chart to add DP3"
 * with Done). The phone shows it as the sheet's header at peek, a desktop as a
 * bar under the chart toolbar. The phone has no Escape, hence the buttons.
 */
export function ModeBanner({
  armed,
  datapointInput,
  nextDatapoint,
  coarse,
  onDefault,
  onCancel,
  onDone,
}: ModeBannerProps) {
  if (armed) {
    return (
      <div className="mode-banner" role="status">
        <span className="mode-banner-text">
          <strong>{armed.label} armed:</strong> {coarse ? 'tap' : 'click'}, or press and drag, to
          place it
        </span>
        <Button size="sm" onClick={onDefault} title="Add it at its default value">
          Default
        </Button>
        <Button size="sm" onClick={onCancel} title="Put the part back (Escape)">
          Cancel
        </Button>
      </div>
    );
  }
  if (datapointInput) {
    return (
      <div className="mode-banner" role="status">
        <span className="mode-banner-text">
          {coarse ? 'Tap' : 'Click'} the chart to add DP{nextDatapoint}
        </span>
        <Button size="sm" variant="primary" onClick={onDone} title="End datapoint input (Escape)">
          Done
        </Button>
      </div>
    );
  }
  return null;
}
