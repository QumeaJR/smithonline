/**
 * The few Cloudflare runtime types the Worker uses, declared here instead of
 * depending on @cloudflare/workers-types (they match its declarations).
 */
interface AnalyticsEngineDataPoint {
  indexes?: ((ArrayBuffer | string) | null)[];
  doubles?: number[];
  blobs?: ((ArrayBuffer | string) | null)[];
}
interface AnalyticsEngineDataset {
  writeDataPoint(event?: AnalyticsEngineDataPoint): void;
}
interface D1Result {
  success: boolean;
  meta?: Record<string, unknown>;
  results?: unknown[];
}
interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  run(): Promise<D1Result>;
  all<T = unknown>(): Promise<{ results: T[] }>;
  first<T = unknown>(): Promise<T | null>;
}
interface D1Database {
  prepare(query: string): D1PreparedStatement;
}
interface RateLimitOutcome {
  success: boolean;
}
interface RateLimit {
  limit(options: { key: string }): Promise<RateLimitOutcome>;
}
interface ScheduledController {
  readonly scheduledTime: number;
  readonly cron: string;
}
