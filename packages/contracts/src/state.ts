import { z } from 'zod';
import { EpochMillis, MarketId, Side } from './common.js';
import { BTCState } from './btc.js';
import { PolymarketBook } from './book.js';

/**
 * The merged, point-in-time view the pipeline evaluates: the latest BTC state
 * plus the Polymarket book for one market/side, assembled at a decision time.
 * Produced by the unified state engine (packages/market-data). This is the
 * single object features/predictions are computed from, so it carries the
 * staleness snapshot the entry gates need (I5/I6/I14) without re-deriving it.
 */
export const UnifiedMarketState = z.object({
  market_id: MarketId,
  side: Side,
  /** The clock time this state was assembled (not a venue timestamp). */
  as_of: EpochMillis,

  btc: BTCState,
  book: PolymarketBook,

  /** Seconds until market close at `as_of`. */
  seconds_remaining: z.number().nonnegative(),

  /** Age of each feed at `as_of`, measured against its exchange_timestamp. */
  btc_age_ms: z.number().nonnegative(),
  book_age_ms: z.number().nonnegative(),

  /**
   * Quick composite gate: both feeds fresh (within their max ages), neither in a
   * gap, and seconds_remaining > 0. The risk/entry engines still apply their own
   * checks; this is a convenience the scanner can short-circuit on.
   */
  tradeable: z.boolean(),
});
export type UnifiedMarketState = z.infer<typeof UnifiedMarketState>;
