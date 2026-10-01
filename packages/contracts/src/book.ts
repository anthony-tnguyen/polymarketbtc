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
   * Venue sequence/version for gap detection. Null when unavailable; a detected
   * gap marks the book unhealthy until resynced (Invariant I6).
   */
  sequence: z.number().int().nonnegative().nullable(),
  gap_detected: z.boolean(),
});
export type PolymarketBook = z.infer<typeof PolymarketBook>;
