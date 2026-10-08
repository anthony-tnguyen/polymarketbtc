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
 * Integrity anomalies for the Polymarket US Markets WebSocket.
 *
 * The US WS sends a FULL book snapshot per message with NO sequence number, so
 * sequence/gap detection does NOT apply (that belongs to a future FIX adapter).
 * Integrity is instead the set of checks below; any of them degrades the feed and
 * halts new orders (Invariant I14). All default false.
 */
export const PolymarketUsFeedAnomalies = z.object({
  /** A frame failed schema validation (unparseable/unexpected shape). */
  malformed_frame: z.boolean().default(false),
  /** The book came through empty or with no valid levels on a side. */
  empty_or_invalid_book: z.boolean().default(false),
  /** A venue timestamp was absent, non-monotonic, or implausible (see parseNumericTimestamp). */
  timestamp_anomaly: z.boolean().default(false),
  /** A price outside [0,1] (or a crossed book) was observed. */
  impossible_prices: z.boolean().default(false),
  /** Reconnects over the window exceeded MAX_RECONNECT_RATE (reconnect storm). */
  reconnect_storm: z.boolean().default(false),
});
export type PolymarketUsFeedAnomalies = z.infer<typeof PolymarketUsFeedAnomalies>;

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
  /**
   * Sequence-gap flag. Meaningful only on sequenced feeds (Binance diff stream;
   * a future Polymarket FIX adapter). ALWAYS false for the Polymarket US WS,
   * which is snapshot-per-message with no sequence number — use `anomalies`
   * there instead.
   */
  gap_detected: z.boolean(),
  /**
   * Latest venue market-state string for this feed (e.g. open/closed/resolved),
   * where the feed carries one. A non-open state is an operational signal, not a
   * data fault. Optional / feed-dependent.
   */
  venue_state: z.string().optional(),
  /** Snapshot-feed integrity anomalies (Polymarket US); see above. */
  anomalies: PolymarketUsFeedAnomalies.optional(),
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
