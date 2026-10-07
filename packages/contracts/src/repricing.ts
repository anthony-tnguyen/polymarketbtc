import { z } from 'zod';
import { Direction, EpochMillis, FeedSource, MarketId, TimestampPair } from './common.js';

/**
 * Repricing-lag instrumentation.
 *
 * Before any modeling, we measure the raw relationship between an underlying
 * move (Binance), an official-reference move (BRTI), and the Polymarket US
 * bid/ask response. The detection rule is deliberately NOT hard-coded: the
 * threshold/window that defines "a move" is configuration, and we log the raw
 * event relationships so research (Gemini) can later choose the best definition
 * from recorded data rather than a guessed constant.
 */

/** Configurable rule for what counts as a "move" worth correlating. */
export const RepricingLagConfig = z.object({
  /** Which feed's move starts the correlation window. */
  trigger_feed: FeedSource,
  /**
   * Minimum absolute move on the trigger feed to open a correlation window, in
   * basis points of price. Configurable — NOT a permanent constant.
   */
  move_threshold_bps: z.number().positive(),
  /** Lookback used to measure the trigger move, milliseconds. */
  move_window_ms: z.number().int().positive(),
  /** Max time to wait for a Polymarket response before censoring, milliseconds. */
  max_response_ms: z.number().int().positive(),
});
export type RepricingLagConfig = z.infer<typeof RepricingLagConfig>;

/** A detected significant move on a single feed (the trigger of a window). */
export const MoveEvent = z.object({
  feed: FeedSource,
  timestamps: TimestampPair,
  /** Price before/after the move and the signed magnitude in bps. */
  price_before: z.number().positive(),
  price_after: z.number().positive(),
  move_bps: z.number(),
});
export type MoveEvent = z.infer<typeof MoveEvent>;

/**
 * One recorded repricing-lag observation: a trigger move and the measured lags
 * until the Polymarket US book responded. Lags are null when no qualifying
 * response occurred within `max_response_ms` (censored, never silently dropped).
 * The raw trigger and the config that produced it are retained so the detection
 * rule can be re-derived offline.
 */
export const RepricingObservation = z.object({
  market_id: MarketId,
  direction: Direction,
  observed_at: EpochMillis,
  /** The move that opened this correlation window. */
  trigger: MoveEvent,
  /** The detection rule in force when this observation was logged. */
  config: RepricingLagConfig,

  /** Lag from a BTC (Binance) move to the Polymarket ask response, ms. */
  btc_to_poly_ask_lag_ms: z.number().nonnegative().nullable(),
  /** Lag from a BTC (Binance) move to the Polymarket bid response, ms. */
  btc_to_poly_bid_lag_ms: z.number().nonnegative().nullable(),
  /** Lag from a BRTI reference move to the Polymarket response, ms. */
  brti_to_poly_lag_ms: z.number().nonnegative().nullable(),

  /** True if the response window elapsed with no qualifying Polymarket move. */
  censored: z.boolean(),
});
export type RepricingObservation = z.infer<typeof RepricingObservation>;
