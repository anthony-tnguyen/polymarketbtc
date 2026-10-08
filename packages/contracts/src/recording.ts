import { z } from 'zod';
import { EpochMillis } from './common.js';

/**
 * A raw, verbatim ingested event — the append-only, write-once archive record
 * that is the AUTHORITY for replay and labels (ARCHITECTURE §7). We store the
 * exact payload plus BOTH timestamps, never collapsing them (I5/I6). Derived
 * state (books, unified state, features) is reproducible from these; these are
 * reproducible from nothing, so they are never mutated.
 */
export const RawEventRecord = z.object({
  /** Which venue/feed produced the frame. */
  venue: z.enum(['POLYMARKET_US', 'BINANCE', 'CF_BRTI']),
  /** Channel / subscription type / stream name as the venue labels it. */
  channel: z.string().min(1),
  /** Market slug the frame pertains to, where applicable. */
  market_slug: z.string().nullable(),
  /** Local receive time (edge SystemClock). Always present and distinct. */
  receive_timestamp: EpochMillis,
  /**
   * Venue/source timestamp parsed from the frame (magnitude-aware). Null when
   * the frame carried none or it was ambiguous/implausible — in which case
   * `timestamp_anomaly` is true and ordering falls back to receive time.
   */
  exchange_timestamp: EpochMillis.nullable(),
  /** True when the source timestamp was absent/ambiguous/implausible. */
  timestamp_anomaly: z.boolean(),
  /** The exact raw payload, verbatim (JSON text as received). */
  raw: z.string(),
});
export type RawEventRecord = z.infer<typeof RawEventRecord>;
