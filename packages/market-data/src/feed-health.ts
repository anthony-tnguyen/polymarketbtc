import type { EpochMillis, FeedHealth, FeedSource, PolymarketUsFeedAnomalies } from '@pmbtc/contracts';
import { ageMs } from '@pmbtc/core';

/** Inputs to evaluate one feed's health at a point in time. */
export interface FeedHealthInput {
  source: FeedSource;
  now: EpochMillis;
  /** Latest event's exchange_timestamp, or null if nothing received yet. */
  lastExchangeTs: EpochMillis | null;
  /**
   * Sequence/reconciliation gap. Meaningful only on sequenced feeds (Binance
   * diff stream, or a future Polymarket FIX adapter). For the Polymarket US WS
   * this is always false — use `anomalies` instead (snapshot-per-message feed).
   */
  gapDetected: boolean;
  /** Reconnects observed over the rolling window. */
  reconnectCount: number;
  /** Estimated clock drift vs reference, signed ms. */
  clockDriftMs: number;
  /** Max tolerated staleness (ms) for this feed (I5/I6). */
  maxAgeMs: number;
  /** Max tolerated reconnects over the window (MAX_RECONNECT_RATE). */
  maxReconnectRate: number;
  /** Max tolerated absolute clock drift (ms) (MAX_CLOCK_DRIFT). */
  maxClockDriftMs: number;
  /**
   * Snapshot-feed integrity anomalies (Polymarket US). Any true value degrades
   * the feed — this is how the US WS replaces sequence/gap detection (I14).
   */
  anomalies?: Partial<PolymarketUsFeedAnomalies>;
  /** Latest venue market-state string (e.g. open/closed/resolved), if any. */
  venueState?: string;
}

/**
 * Pure feed-health evaluation. A `degraded` or `down` feed flips the
 * `feed_healthy` entry gate false and halts new orders (Invariant I14); this
 * function decides that classification deterministically from the inputs.
 *
 * For the Polymarket US Markets WebSocket (full snapshot per message, no
 * sequence number), integrity is staleness + disconnect + the `anomalies`
 * set (malformed frame, empty/invalid book, timestamp anomaly, impossible
 * prices, reconnect storm) — NOT sequence/gap detection, which belongs to a
 * future FIX adapter.
 */
export function evaluateFeedHealth(input: FeedHealthInput): FeedHealth {
  const clockSynced = Math.abs(input.clockDriftMs) <= input.maxClockDriftMs;

  const a = input.anomalies ?? {};
  const anomalies: PolymarketUsFeedAnomalies = {
    malformed_frame: a.malformed_frame ?? false,
    empty_or_invalid_book: a.empty_or_invalid_book ?? false,
    timestamp_anomaly: a.timestamp_anomaly ?? false,
    impossible_prices: a.impossible_prices ?? false,
    reconnect_storm: a.reconnect_storm ?? false,
  };

  let status: FeedHealth['status'];
  let detail: string | undefined;

  if (input.lastExchangeTs === null) {
    status = 'down';
    detail = 'no events received';
  } else {
    const age = ageMs(input.now, input.lastExchangeTs);
    const stale = age > input.maxAgeMs;
    const reconnectStorm = input.reconnectCount > input.maxReconnectRate || anomalies.reconnect_storm;
    const anyAnomaly =
      anomalies.malformed_frame ||
      anomalies.empty_or_invalid_book ||
      anomalies.timestamp_anomaly ||
      anomalies.impossible_prices;
    if (stale || input.gapDetected || reconnectStorm || anyAnomaly || !clockSynced) {
      status = 'degraded';
      detail = [
        stale ? `stale ${age}ms` : null,
        input.gapDetected ? 'gap' : null,
        reconnectStorm ? `reconnects ${input.reconnectCount}` : null,
        anomalies.malformed_frame ? 'malformed' : null,
        anomalies.empty_or_invalid_book ? 'empty/invalid book' : null,
        anomalies.timestamp_anomaly ? 'timestamp anomaly' : null,
        anomalies.impossible_prices ? 'impossible prices' : null,
        !clockSynced ? `drift ${input.clockDriftMs}ms` : null,
      ]
        .filter(Boolean)
        .join('; ');
    } else {
      status = 'healthy';
    }
  }

  const age = input.lastExchangeTs === null ? 0 : ageMs(input.now, input.lastExchangeTs);
  return {
    source: input.source,
    status,
    evaluated_at: input.now,
    age_ms: age,
    gap_detected: input.gapDetected,
    anomalies,
    reconnect_count: input.reconnectCount,
    clock_drift_ms: input.clockDriftMs,
    clock_synced: clockSynced,
    ...(input.venueState !== undefined ? { venue_state: input.venueState } : {}),
    ...(detail !== undefined ? { detail } : {}),
  };
}
