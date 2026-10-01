import { z } from 'zod';

/**
 * Polymarket US Markets WebSocket frames (wss://api.polymarket.us/v1/ws/markets).
 *
 * Shapes mirror the official SDK's decoded types (Polymarket/polymarket-us-
 * typescript, src/websocket/types.ts). The key property of this feed: a
 * `MarketData` message carries the FULL order book every time — there are no
 * deltas, no `hash`, and no sequence number on the WS path (sequence numbers
 * exist only on the FIX market-data gateway). See market-data/ASSUMPTIONS.md
 * (Polymarket US).
 */

/** A monetary amount as the US venue encodes prices. */
export const Amount = z.object({
  value: z.string(),
  currency: z.literal('USD'),
});
export type Amount = z.infer<typeof Amount>;

/** One book level: price (`px`) + quantity (`qty`). */
const UsBookLevel = z.object({ px: Amount, qty: z.string() });
export type UsBookLevel = z.infer<typeof UsBookLevel>;

/** Full order book + stats. Delivered in full on every update. */
export const MarketDataMessage = z.object({
  requestId: z.string(),
  subscriptionType: z.literal('SUBSCRIPTION_TYPE_MARKET_DATA'),
  marketData: z.object({
    marketSlug: z.string(),
    /** Bids: buy side. */
    bids: z.array(UsBookLevel),
    /** Offers: sell side (the "asks" of a conventional book). */
    offers: z.array(UsBookLevel),
    /** Venue market state, e.g. open/closed/resolved. */
    state: z.string(),
    stats: z
      .object({
        lastTradePx: Amount.nullish(),
        sharesTraded: z.string().nullish(),
        openInterest: z.string().nullish(),
        highPx: Amount.nullish(),
        lowPx: Amount.nullish(),
      })
      .nullish(),
    /** Venue transaction time (string). Unit per ASSUMPTION US-TS. */
    transactTime: z.string().nullish(),
  }),
});
export type MarketDataMessage = z.infer<typeof MarketDataMessage>;

/** Lightweight best-bid/ask-only variant. */
export const MarketDataLiteMessage = z.object({
  requestId: z.string(),
  subscriptionType: z.literal('SUBSCRIPTION_TYPE_MARKET_DATA_LITE'),
  marketDataLite: z.object({
    marketSlug: z.string(),
    bestBid: Amount.nullish(),
    bestAsk: Amount.nullish(),
    lastTradePx: Amount.nullish(),
  }),
});
export type MarketDataLiteMessage = z.infer<typeof MarketDataLiteMessage>;

/** Trade print. */
export const TradeMessage = z.object({
  requestId: z.string(),
  subscriptionType: z.literal('SUBSCRIPTION_TYPE_TRADE'),
  trade: z.object({
    marketSlug: z.string(),
    price: Amount,
    quantity: Amount,
    tradeTime: z.string(),
    maker: z.object({ side: z.string(), intent: z.string() }),
    taker: z.object({ side: z.string(), intent: z.string() }),
  }),
});
export type TradeMessage = z.infer<typeof TradeMessage>;

/** Any markets-channel frame. Unknown-but-valid frames pass through loosely. */
export const PolymarketUsMessage = z.union([
  MarketDataMessage,
  MarketDataLiteMessage,
  TradeMessage,
  z.object({ subscriptionType: z.string() }).passthrough(),
]);
export type PolymarketUsMessage = z.infer<typeof PolymarketUsMessage>;

/**
 * Parse the venue `transactTime` string to epoch millis.
 * ASSUMPTION US-TS: a purely-numeric string is epoch milliseconds; otherwise it
 * is an ISO-8601 datetime. Returns `fallback` when absent/unparseable so the
 * recorder still stamps a coherent time (receive time is always distinct).
 */
export function parseTransactTime(transactTime: string | null | undefined, fallback: number): number {
  if (transactTime == null || transactTime === '') return fallback;
  if (/^\d+$/.test(transactTime)) return Number(transactTime);
  const parsed = Date.parse(transactTime);
  return Number.isNaN(parsed) ? fallback : parsed;
}
