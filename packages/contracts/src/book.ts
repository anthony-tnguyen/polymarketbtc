import { z } from 'zod';
import { Direction, MarketId, MarketSlug, OutcomeId, Price01, Size, TimestampPair } from './common.js';

/** One price level on the ladder. */
export const BookLevel = z.object({
  price: Price01,
  size: Size,
});
export type BookLevel = z.infer<typeof BookLevel>;

/**
 * The Polymarket US order book for a single outcome.
 *
 * Identity is venue-neutral: `market_slug` + `outcome_id` + `direction` (the US
 * Markets WS identifies a contract by `marketSlug`; there is no ERC-1155 token
 * id). Bids are sorted descending by price, asks (the venue's `offers`)
 * ascending. Executable prices for a given size are computed by walking these
 * ladders (see MATH_SPEC §Executable); the displayed midpoint is NEVER used for
 * P&L/MFE (Invariant I2) and depth is NEVER assumed infinite (Invariant I3).
 */
export const PolymarketBook = z.object({
  market_id: MarketId,
  /** Polymarket US venue slug. */
  market_slug: MarketSlug,
  /** Venue-neutral outcome identity. */
  outcome_id: OutcomeId,
  direction: Direction,
  timestamps: TimestampPair,
  /** Descending by price. */
  bids: z.array(BookLevel),
  /** Ascending by price (the venue's `offers`). */
  asks: z.array(BookLevel),
  /**
   * Venue sequence/version for gap detection. The Polymarket US Markets WS sends
   * a FULL book snapshot per message and carries NO sequence number, so this is
   * always null on that path; sequence numbers exist only on the FIX gateway
   * (see market-data/ASSUMPTIONS.md). Present for venues that expose sequencing.
   */
  sequence: z.number().int().nonnegative().nullable(),
  /**
   * Venue-provided integrity hash. The US WS carries NO book hash (that was an
   * international-CLOB concept), so this is always null on the US path. Null when
   * absent.
   */
  book_hash: z.string().nullable(),
  /**
   * Snapshot-per-message delta-desync flag. Always false on the US WS path (each
   * message is a complete book, so there is no local delta to desync). Integrity
   * on the US path is a staleness/disconnect concern handled by the feed-health
   * layer (Invariant I14). Reserved true-capable for a future FIX adapter.
   */
  gap_detected: z.boolean(),
});
export type PolymarketBook = z.infer<typeof PolymarketBook>;
