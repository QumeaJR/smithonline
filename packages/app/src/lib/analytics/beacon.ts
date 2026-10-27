/**
 * Cloudflare Web Analytics (docs/10 section 1.4): its script is added only
 * when counts are allowed (the switch on, no Global Privacy Control or Do Not
 * Track, the production host) and a token was set at build time. Switching
 * counts off leaves it out from the next page load.
 */
import { analyticsAllowed } from './track';

export const BEACON_SRC = 'https://static.cloudflareinsights.com/beacon.min.js';

/** A Web Analytics token: letters and digits only, so it cannot break out of the attribute. */
const TOKEN_RE = /^[A-Za-z0-9]{16,64}$/;

function buildToken(): string {
  try {
    return String(import.meta.env?.VITE_CF_BEACON_TOKEN ?? '');
  } catch {
    return '';
  }
}

/** Add the beacon script once; true when it is on the page. */
export function loadBeacon(token: string = buildToken(), doc: Document = document): boolean {
  if (!TOKEN_RE.test(token) || !analyticsAllowed()) return false;
  if (doc.querySelector('script[data-cf-beacon]')) return true;
  const s = doc.createElement('script');
  s.defer = true;
  s.src = BEACON_SRC;
  s.setAttribute('data-cf-beacon', JSON.stringify({ token }));
  doc.head.appendChild(s);
  return true;
}
