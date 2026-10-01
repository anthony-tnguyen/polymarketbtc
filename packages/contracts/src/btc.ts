import { z } from 'zod';
import { TimestampPair } from './common.js';

/**
 * BTC state derived from the Binance feed. This is the driver of the whole
 * model; a stale BTCState must never price an order (Invariant I5). Staleness
 * is judged against `timestamps.exchange_timestamp`.
 */
export const BTCState = z.object({
  symbol: z.string().min(1),
  timestamps: TimestampPair,
  /** Last trade price. */
  price: z.number().positive(),
  /** Best bid/ask on the underlying venue, if available. */
  bid: z.number().positive().optional(),
  ask: z.number().positive().optional(),
  /**
   * Monotonic sequence number where the venue provides one, for gap detection.
   * Null when the stream does not expose sequencing.
   */
  sequence: z.number().int().nonnegative().nullable(),
  /** True if a sequence gap was detected since the last clean state. */
  gap_detected: z.boolean(),
});
export type BTCState = z.infer<typeof BTCState>;
