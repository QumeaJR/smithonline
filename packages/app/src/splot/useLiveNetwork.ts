import { useEffect } from 'react';
import { startLiveNetworkSync } from '../lib/splotNetwork';

/**
 * Keeps a live "Add the network" entry of the S-Plot list in step with the
 * design while the app runs, in every view, so the S-Plot graphs follow
 * tuning. Mounted once by the app.
 */
export function useLiveNetwork(): void {
  useEffect(() => startLiveNetworkSync(), []);
}
