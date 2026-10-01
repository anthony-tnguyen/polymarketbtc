import { z } from 'zod';

/**
 * Raw Polymarket market-channel frames. The channel has NO sequence number; a
 * `hash` is present but its algorithm is unspecified (we record, do not verify).
 * See market-data/ASSUMPTIONS.md (Polymarket). Prices/sizes are decimal strings;
 * `timestamp` is a string of epoch millis.
 */

/** A {price, size} level as the venue encodes it (decimal strings). */
const RawBookLevel = z.object({ price: z.string(), size: z.string() });
export type RawBookLevel = z.infer<typeof RawBookLevel>;

/** Full book snapshot — our source of truth / resync point. */
export const PolymarketBookMessage = z.object({
  event_type: z.literal('book'),
  asset_id: z.string(),
  market: z.string(),
  bids: z.array(RawBookLevel),
  asks: z.array(RawBookLevel),
  hash: z.string().nullish(),
  timestamp: z.string(),
});
export type PolymarketBookMessage = z.infer<typeof PolymarketBookMessage>;

/** One level change inside a price_change message. */
const RawPriceChange = z.object({
  asset_id: z.string(),
  price: z.string(),
  /** New size at this level; "0" removes the level. */
  size: z.string(),
  /** BUY = bid side, SELL = ask side. */
  side: z.enum(['BUY', 'SELL']),
  hash: z.string().nullish(),
  /** Best bid/ask of the resulting book; used for reconciliation (ASSUMPTION P1). */
  best_bid: z.string().nullish(),
  best_ask: z.string().nullish(),
});
export type RawPriceChange = z.infer<typeof RawPriceChange>;

/** Delta update. */
export const PolymarketPriceChangeMessage = z.object({
  event_type: z.literal('price_change'),
  market: z.string(),
  timestamp: z.string(),
  price_changes: z.array(RawPriceChange),
});
export type PolymarketPriceChangeMessage = z.infer<typeof PolymarketPriceChangeMessage>;

/** Market lifecycle end — no further trading. */
export const PolymarketMarketResolvedMessage = z.object({
  event_type: z.literal('market_resolved'),
  market: z.string(),
  timestamp: z.string(),
});
export type PolymarketMarketResolvedMessage = z.infer<typeof PolymarketMarketResolvedMessage>;

/**
 * Any market-channel frame. Types we don't act on in the book core
 * (last_trade_price, tick_size_change, best_bid_ask, new_market) are accepted
 * loosely so parsing never throws on an unmodeled-but-valid frame.
 */
export const PolymarketMarketMessage = z.union([
  PolymarketBookMessage,
  PolymarketPriceChangeMessage,
  PolymarketMarketResolvedMessage,
  z.object({ event_type: z.string() }).passthrough(),
]);
export type PolymarketMarketMessage = z.infer<typeof PolymarketMarketMessage>;
