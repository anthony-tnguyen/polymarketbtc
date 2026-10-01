import { z } from 'zod';
import { EpochMillis, FeedSource } from './common.js';

/** Health classification of a single feed. */
export const FeedStatus = z.enum([
  'healthy',
  'degraded', // stale/gappy/reconnecting — new orders stop (Invariant I14)
  'down',
]);
export type FeedStatus = z.infer<typeof FeedStatus>;

/**
 * Health of one feed. `age_ms` is measured against the latest event's
 * exchange_timestamp. Any `degraded`/`down` feed flips the `feed_healthy` entry
 * gate false and halts new orders (I14).
 */
export const FeedHealth = z.object({
  source: FeedSource,
  status: FeedStatus,
  evaluated_at: EpochMillis,
  /** Staleness of the latest event in milliseconds. */
  age_ms: z.number().nonnegative(),
  /** Whether a sequence gap is currently outstanding. */
  gap_detected: z.boolean(),
  /** Reconnects observed over the rolling window. */
  reconnect_count: z.number().int().nonnegative(),
  /** Estimated clock drift vs. reference, milliseconds (signed). */
  clock_drift_ms: z.number(),
  /** Whether the clock is within MAX_CLOCK_DRIFT. */
  clock_synced: z.boolean(),
  detail: z.string().optional(),
});
export type FeedHealth = z.infer<typeof FeedHealth>;

/** Severity of a system event. */
export const SystemEventSeverity = z.enum(['info', 'warn', 'error', 'critical']);
export type SystemEventSeverity = z.infer<typeof SystemEventSeverity>;

/**
 * Structured system event — the audit/observability record for anything
 * operationally significant: reconnects, gaps, freezes, reconciles, rejects,
 * trading-enable toggles, degraded-mode entries/exits. Persisted to the DB.
 */
export const SystemEvent = z.object({
  event_id: z.string().min(1),
  occurred_at: EpochMillis,
  severity: SystemEventSeverity,
  /** Stable machine code, e.g. "feed.gap", "order.unknown", "risk.freeze". */
  code: z.string().min(1),
  /** Component that emitted the event, e.g. "market-data/polymarket-ws". */
  source: z.string().min(1),
  message: z.string(),
  /** Arbitrary structured context (ids, counts, ages). */
  context: z.record(z.string(), z.unknown()).optional(),
});
export type SystemEvent = z.infer<typeof SystemEvent>;
