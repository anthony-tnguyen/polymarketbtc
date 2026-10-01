import { z } from 'zod';

/**
 * Shared primitives used across every contract.
 *
 * Conventions (enforced here so no downstream package re-invents them):
 *  - All timestamps are epoch **milliseconds** as integers (UTC). We never pass
 *    around formatted date strings on the hot path.
 *  - Every ingested event carries BOTH an exchange timestamp (source of truth
 *    for ordering/latency) and a receive timestamp (local). See TimestampPair.
 *  - Probabilities are in [0, 1]. Polymarket prices are also in [0, 1] (a
 *    contract pays 1 on YES), so we keep a distinct `Price01` for clarity.
 *  - IDs are branded strings so you cannot accidentally pass a market id where
 *    an order id is expected.
 */

/** Epoch milliseconds, UTC. Integer, non-negative. */
export const EpochMillis = z.number().int().nonnegative();
export type EpochMillis = z.infer<typeof EpochMillis>;

/** A probability in [0, 1]. */
export const Probability = z.number().min(0).max(1);
export type Probability = z.infer<typeof Probability>;

/** A Polymarket price in [0, 1] (contract pays 1.0 on YES resolution). */
export const Price01 = z.number().min(0).max(1);
export type Price01 = z.infer<typeof Price01>;

/** A non-negative size/quantity (shares/contracts). */
export const Size = z.number().nonnegative();
export type Size = z.infer<typeof Size>;

/** USD amount; may be negative (P&L, drawdown). */
export const Usd = z.number();
export type Usd = z.infer<typeof Usd>;

/** Both timestamps for an ingested event. Never collapse these (I5/I6). */
export const TimestampPair = z.object({
  /** Timestamp from the source exchange/venue. Source of truth for ordering. */
  exchange_timestamp: EpochMillis,
  /** Timestamp when our process received the event. Used for latency/staleness. */
  receive_timestamp: EpochMillis,
});
export type TimestampPair = z.infer<typeof TimestampPair>;

/** Branded id helper. */
const brandedId = <B extends string>(brand: B) =>
  z.string().min(1).brand(brand);

export const MarketId = brandedId('MarketId');
export type MarketId = z.infer<typeof MarketId>;

/** Polymarket CLOB token id (one per outcome of a market). */
export const TokenId = brandedId('TokenId');
export type TokenId = z.infer<typeof TokenId>;

export const IntentId = brandedId('IntentId');
export type IntentId = z.infer<typeof IntentId>;

export const OrderId = brandedId('OrderId');
export type OrderId = z.infer<typeof OrderId>;

export const PositionId = brandedId('PositionId');
export type PositionId = z.infer<typeof PositionId>;

/** Client-generated order id (idempotency key we control). */
export const ClientOrderId = brandedId('ClientOrderId');
export type ClientOrderId = z.infer<typeof ClientOrderId>;

/**
 * The outcome side we hold/trade. For a BTC hourly target-price market the
 * target-facing side is the one that pays if BTC reaches/holds the target.
 */
export const Side = z.enum(['YES', 'NO']);
export type Side = z.infer<typeof Side>;

/** Discrete volatility regime; drives model `supported_regime` gating. */
export const VolatilityRegime = z.enum(['low', 'normal', 'elevated', 'extreme']);
export type VolatilityRegime = z.infer<typeof VolatilityRegime>;

/** Which data feed. */
export const FeedSource = z.enum(['binance', 'polymarket', 'clock']);
export type FeedSource = z.infer<typeof FeedSource>;

/**
 * Version string for schemas/features/models, e.g. "v001". A single scheme so
 * feature_version on a model can be compared to the running feature engine.
 */
export const Version = z.string().regex(/^v\d{3,}$/, 'expected vNNN, e.g. v001');
export type Version = z.infer<typeof Version>;

/** Current version of the FeatureVector schema produced by packages/features. */
export const FEATURE_VERSION = 'v001' satisfies z.infer<typeof Version>;

/** A closed time range [start, end) in epoch millis. */
export const TimeRange = z
  .object({ start: EpochMillis, end: EpochMillis })
  .refine((r) => r.end >= r.start, { message: 'end must be >= start' });
export type TimeRange = z.infer<typeof TimeRange>;
