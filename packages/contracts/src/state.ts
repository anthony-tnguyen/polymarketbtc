import { z } from 'zod';
import { Direction, EpochMillis, MarketId } from './common.js';
import { BTCState } from './btc.js';
import { PolymarketBook } from './book.js';
import { ReferenceBasis, ReferencePriceState } from './reference.js';

/**
 * The merged, point-in-time view the pipeline evaluates: the latest BTC state
 * (the fast predictive driver), the official BRTI reference state (settlement
 * truth), the basis between them, and the Polymarket US book for one
 * outcome/direction — assembled at a decision time. Produced by the unified
 * state engine (packages/market-data). This is the single object
 * features/predictions are computed from, so it carries the staleness snapshot
 * the entry gates need (I5/I6/I14) without re-deriving it.
 *
 * Feed roles are kept explicit and never conflated:
 *  - `btc`       — Binance, the fast alpha / microstructure feed (predictive).
 *  - `reference` — CF Benchmarks BRTI, the official reference/settlement feed.
 *  - `book`      — the traded Polymarket US contract.
 */
export const UnifiedMarketState = z.object({
  market_id: MarketId,
  direction: Direction,
  /** The clock time this state was assembled (not a venue timestamp). */
  as_of: EpochMillis,

  btc: BTCState,
  /** Official reference (BRTI) state; null until a BRTI value is seen. */
  reference: ReferencePriceState.nullable(),
  /** Binance−BRTI basis; null until both feeds have a value. */
  basis: ReferenceBasis.nullable(),
  book: PolymarketBook,

  /** Seconds until market close at `as_of`. */
  seconds_remaining: z.number().nonnegative(),

  /** Age of each feed at `as_of`, measured against its source timestamp. */
  btc_age_ms: z.number().nonnegative(),
  book_age_ms: z.number().nonnegative(),
  /** Age of the BRTI reference feed; null when no reference seen yet. */
  reference_age_ms: z.number().nonnegative().nullable(),

  /**
   * Quick composite gate: BTC + book feeds fresh (within their max ages),
   * neither in a gap, and seconds_remaining > 0. The risk/entry engines still
   * apply their own checks; this is a convenience the scanner can short-circuit
   * on. (BRTI freshness is evaluated by the risk/entry layer where settlement
   * reasoning needs it, not here.)
   */
  tradeable: z.boolean(),
});
export type UnifiedMarketState = z.infer<typeof UnifiedMarketState>;
