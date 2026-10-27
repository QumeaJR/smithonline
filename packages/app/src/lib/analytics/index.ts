/**
 * Start the usage counts (docs/10 section 1): follow the Settings switch,
 * send on page hide, load the Web Analytics beacon when allowed, and count
 * the start. Nothing here can stop the app: every step fails quietly.
 */
import { useSettings } from '../../store/useSettings';
import { loadBeacon } from './beacon';
import { listenForHide, setSwitch, track } from './track';
import type { EventA } from './schema';

export { track, trackDynamic } from './track';

let started = false;

export function initAnalytics(entry: EventA<'start'>): void {
  if (started) return;
  started = true;
  try {
    setSwitch(useSettings.getState().settings.shareUsageCounts);
    useSettings.subscribe((s) => setSwitch(s.settings.shareUsageCounts));
    listenForHide();
    // A share link opens with the design in the address: no Web Analytics on that page load.
    if (entry !== 'link') loadBeacon();
    track('start', entry);
  } catch {
    // Counting is never worth an error.
  }
}
