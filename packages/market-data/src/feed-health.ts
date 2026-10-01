import type { EpochMillis, FeedHealth, FeedSource } from '@pmbtc/contracts';
import { ageMs } from '@pmbtc/core';

/** Inputs to evaluate one feed's health at a point in time. */
export interface FeedHealthInput {
  source: FeedSource;
  now: EpochMillis;
  /** Latest event's exchange_timestamp, or null if nothing received yet. */
  lastExchangeTs: EpochMillis | null;
  /** Whether the feed currently has an outstanding sequence/reconciliation gap. */
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
}

/**
 * Pure feed-health evaluation. A `degraded` or `down` feed flips the
 * `feed_healthy` entry gate false and halts new orders (Invariant I14); this
 * function decides that classification deterministically from the inputs.
 */
export function evaluateFeedHealth(input: FeedHealthInput): FeedHealth {
  const clockSynced = Math.abs(input.clockDriftMs) <= input.maxClockDriftMs;

  let status: FeedHealth['status'];
  let detail: string | undefined;

  if (input.lastExchangeTs === null) {
    status = 'down';
    detail = 'no events received';
  } else {
    const age = ageMs(input.now, input.lastExchangeTs);
    const stale = age > input.maxAgeMs;
    const reconnectStorm = input.reconnectCount > input.maxReconnectRate;
    if (stale || input.gapDetected || reconnectStorm || !clockSynced) {
      status = 'degraded';
      detail = [
        stale ? `stale ${age}ms` : null,
        input.gapDetected ? 'gap' : null,
        reconnectStorm ? `reconnects ${input.reconnectCount}` : null,
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
    reconnect_count: input.reconnectCount,
    clock_drift_ms: input.clockDriftMs,
    clock_synced: clockSynced,
    ...(detail !== undefined ? { detail } : {}),
  };
}
