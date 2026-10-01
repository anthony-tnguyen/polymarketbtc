import { z } from 'zod';
import { MarketId, Price01, Side, Size, TimestampPair, TokenId } from './common.js';

/** One price level on the ladder. */
export const BookLevel = z.object({
  price: Price01,
  size: Size,
});
export type BookLevel = z.infer<typeof BookLevel>;

/**
 * The Polymarket CLOB order book for a single outcome token.
 *
 * Bids are sorted descending by price, asks ascending. Executable prices for a
 * given size are computed by walking these ladders (see MATH_SPEC §Executable);
 * the displayed midpoint is NEVER used for P&L/MFE (Invariant I2) and depth is
 * NEVER assumed infinite (Invariant I3).
 */
export const PolymarketBook = z.object({
  market_id: MarketId,
  token_id: TokenId,
  side: Side,
  timestamps: TimestampPair,
  /** Descending by price. */
  bids: z.array(BookLevel),
  /** Ascending by price. */
  asks: z.array(BookLevel),
  /**
   * Venue sequence/version for gap detection. The Polymarket market channel has
   * NO sequence number, so this is always null there; gap detection is done by
   * best-bid/ask reconciliation instead (see market-data/ASSUMPTIONS.md P1).
   * Present for venues that do expose sequencing.
   */
  sequence: z.number().int().nonnegative().nullable(),
  /**
   * The venue-provided integrity hash of the book (`hash` on Polymarket book/
   * price_change messages). Recorded for audit; its algorithm is unspecified by
   * the venue so we do NOT recompute-and-verify it. Null when absent.
   */
  book_hash: z.string().nullable(),
  /**
   * True when the local book is believed out-of-sync (sequence gap, or a failed
   * best-bid/ask reconciliation) and must be resynced before it is traded (I6).
   */
  gap_detected: z.boolean(),
});
export type PolymarketBook = z.infer<typeof PolymarketBook>;
