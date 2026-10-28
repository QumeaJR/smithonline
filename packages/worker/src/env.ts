/** The Worker's bindings (wrangler.jsonc) and configuration. */
export interface Env {
  /** Analytics Engine dataset `smithonline_events`. */
  readonly EVENTS?: AnalyticsEngineDataset | undefined;
  /** D1 database `smithonline-feedback`. */
  readonly DB?: D1Database | undefined;
  /** Rate limits keyed by the client's address, kept in memory by Cloudflare. */
  readonly EVENTS_LIMIT?: RateLimit | undefined;
  readonly FEEDBACK_LIMIT?: RateLimit | undefined;
  /** Turnstile secret: a Worker secret, never in the repository. */
  readonly TURNSTILE_SECRET?: string | undefined;
  /** The app's origin; default https://smithchart.online. */
  readonly ALLOWED_ORIGIN?: string | undefined;
}
